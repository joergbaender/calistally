import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { isSessionOpen, sortSessions } from '../model/derive';
import type { BodyweightFile, Exercise, ExercisesFile, FileKind, Session, SessionFile } from '../model/types';
import { checkCatalogRules, type ValidationIssue } from '../model/validate';
import type { ChangeChannel } from '../sync/channel';
import type { SyncStatus } from '../sync/engine';
import { canonicalJson } from '../sync/merge';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../sync/paths';
import type { FileRow, Issue, QueueRow, Store, WriteRefusal, WriteResult } from '../sync/store';

/** Spec 4 §3 "Signals over the store": one signal per slice, everything derived is a computed. */

export interface SessionRow { path: string; file: SessionFile; version: number }
export interface FileSlice<F> { file: F; version: number }
export interface SoftIssue { path: string; sessionId: string; date: string; issues: ValidationIssue[] }
export type WriteOutcome = { ok: true; heldBack: boolean } | { ok: false; reason: WriteRefusal | 'missing' };

/** The file type of each kind, so `Data.edit` ties the function's file type to the kind it writes. */
export interface FileByKind { session: SessionFile; exercises: ExercisesFile; bodyweight: BodyweightFile }
export type FileOf<K extends FileKind> = FileByKind[K];

export interface DataDeps {
  store: Store;
  engine?: { status: SyncStatus; subscribe(fn: (s: SyncStatus) => void): () => void };
  channel?: ChangeChannel;
  now?: () => Date;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

const FAST_MS = 1000;
const SLOW_MS = 60000;

/** Before the engine reports: nothing known, not connected. */
const NO_STATUS: SyncStatus = { phase: 'idle', online: true, connected: false, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

function isReadable(row: FileRow): boolean {
  return row.status === 'ok' && row.duplicateOf === undefined;
}

/** Why the store would refuse a write to this row (its own guard, spec 3 §5), or undefined for an ok row. */
function refusalOf(row: FileRow): WriteRefusal | undefined {
  if (row.duplicateOf !== undefined) return 'duplicate';
  return row.status === 'ok' ? undefined : row.status;
}

function outcomeOf(result: WriteResult): WriteOutcome {
  return result.ok ? { ok: true, heldBack: result.heldBack !== undefined } : result;
}

export class Data {
  readonly sessions: Signal<SessionRow[]> = signal<SessionRow[]>([]);
  readonly catalog: Signal<FileSlice<ExercisesFile> | undefined> = signal<FileSlice<ExercisesFile> | undefined>(undefined);
  readonly bodyweight: Signal<FileSlice<BodyweightFile> | undefined> = signal<FileSlice<BodyweightFile> | undefined>(undefined);
  /** status != ok or duplicateOf set. Screens list the read-only sessions through `lockedSessionRows` (src/ui/locked.ts), which leaves duplicates out (spec 4 §5). */
  readonly refusedRows: Signal<FileRow[]> = signal<FileRow[]>([]);
  readonly status: Signal<SyncStatus>;
  /** The engine's retry delay counted down against `now` from the moment its status arrived; floored at 0, undefined without a retry. */
  readonly retryLeftMs: ReadonlySignal<number | undefined>;
  readonly issues: Signal<Issue[]> = signal<Issue[]>([]);
  readonly now: Signal<Date>;
  readonly liveSessions: ReadonlySignal<Session[]>;
  readonly exercises: ReadonlySignal<Exercise[]>;
  readonly exerciseById: ReadonlySignal<Map<string, Exercise>>;
  readonly openSession: ReadonlySignal<SessionRow | undefined>;
  readonly softIssues: ReadonlySignal<SoftIssue[]>;
  readonly heldBackCount: ReadonlySignal<number>;

  private readonly queue: Signal<QueueRow[]> = signal<QueueRow[]>([]);
  /** `clock()` when the current status arrived: `retryInMs` is relative to it. */
  private readonly statusAt: Signal<Date>;
  private readonly store: Store;
  private readonly engine: DataDeps['engine'];
  private readonly channel: ChangeChannel | undefined;
  /** The current time from the injected clock, read afresh on every call (the `now` signal only ticks).
   *  Screens take "now" for edits and defaults from here so tests control it in one place. */
  readonly clock: () => Date;
  private readonly startInterval: (fn: () => void, ms: number) => unknown;
  private readonly stopInterval: (id: unknown) => void;
  private intervalId: unknown;
  private unsubscribers: (() => void)[] = [];

  constructor(deps: DataDeps) {
    this.store = deps.store;
    this.engine = deps.engine;
    this.channel = deps.channel;
    this.clock = deps.now ?? (() => new Date());
    this.startInterval = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.stopInterval = deps.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
    this.status = signal<SyncStatus>({ ...(deps.engine?.status ?? NO_STATUS) });
    this.now = signal<Date>(this.clock());
    this.statusAt = signal<Date>(this.now.value);

    this.retryLeftMs = computed(() => {
      const retry = this.status.value.retryInMs;
      if (retry === undefined) return undefined;
      // `now` ticks at most once a second and may lag the status's arrival: no negative elapsed time.
      const elapsed = Math.max(0, this.now.value.getTime() - this.statusAt.value.getTime());
      return Math.max(0, retry - elapsed);
    });
    this.liveSessions = computed(() => sortSessions(this.sessions.value.map((r) => r.file.session)));
    this.exercises = computed(() => this.catalog.value?.file.exercises ?? []);
    this.exerciseById = computed(() => new Map(this.exercises.value.map((e) => [e.id, e])));
    this.openSession = computed(() => {
      const all = this.liveSessions.value;
      const now = this.now.value;
      return this.sessions.value.find((r) => isSessionOpen(r.file.session, all, now));
    });
    this.softIssues = computed(() => {
      if (this.catalog.value === undefined) return [];
      const catalog = this.exercises.value;
      const out: SoftIssue[] = [];
      for (const row of this.sessions.value) {
        const s = row.file.session;
        if (s.deletedAt !== undefined) continue;
        const issues = checkCatalogRules(s, catalog);
        if (issues.length > 0) out.push({ path: row.path, sessionId: s.id, date: s.date, issues });
      }
      return out;
    });
    this.heldBackCount = computed(() => this.queue.value.filter((q) => q.heldBack !== undefined).length);
  }

  /** Initial load of every slice; call once. Also subscribes to engine status and channel. */
  async load(): Promise<void> {
    const rows = await this.store.rows();
    const sessions: SessionRow[] = [];
    const refused: FileRow[] = [];
    let catalog: FileSlice<ExercisesFile> | undefined;
    let bodyweight: FileSlice<BodyweightFile> | undefined;
    for (const row of rows) {
      if (!isReadable(row)) {
        refused.push(row);
        continue;
      }
      if (row.path === EXERCISES_PATH) catalog = { file: row.content as ExercisesFile, version: row.version };
      else if (row.path === BODYWEIGHT_PATH) bodyweight = { file: row.content as BodyweightFile, version: row.version };
      else if (row.kind === 'session') sessions.push({ path: row.path, file: row.content as SessionFile, version: row.version });
    }
    this.sessions.value = sessions;
    this.refusedRows.value = refused;
    this.catalog.value = catalog;
    this.bodyweight.value = bodyweight;
    this.queue.value = await this.store.queue();
    this.issues.value = await this.store.issues();

    if (this.engine !== undefined) {
      this.unsubscribers.push(
        this.engine.subscribe((s) => {
          // The engine mutates one status object; copy it so the signal sees a change. The retry
          // countdown starts from this moment (one batch, one re-render).
          batch(() => {
            this.statusAt.value = this.clock();
            this.status.value = { ...s };
          });
          void this.reloadIssues();
        }),
      );
    }
    if (this.channel !== undefined) {
      this.unsubscribers.push(this.channel.subscribe((path) => void this.refresh(path)));
    }
  }

  /** Reload one path (the store's onChange and the channel call this). */
  async refresh(path: string): Promise<void> {
    const row = await this.store.getRow(path);
    const readable = row !== undefined && isReadable(row);
    if (path === EXERCISES_PATH) {
      this.catalog.value = readable ? { file: row.content as ExercisesFile, version: row.version } : undefined;
    } else if (path === BODYWEIGHT_PATH) {
      this.bodyweight.value = readable ? { file: row.content as BodyweightFile, version: row.version } : undefined;
    } else {
      const others = this.sessions.value.filter((r) => r.path !== path);
      this.sessions.value = readable && row.kind === 'session' ? [...others, { path, file: row.content as SessionFile, version: row.version }] : others;
    }
    const refusedOthers = this.refusedRows.value.filter((r) => r.path !== path);
    this.refusedRows.value = row !== undefined && !readable ? [...refusedOthers, row] : refusedOthers;
    this.queue.value = await this.store.queue();
    this.issues.value = await this.store.issues();
  }

  /** Create a file that does not exist yet (expectedVersion 0). */
  async create(kind: FileKind, path: string, file: unknown): Promise<WriteOutcome> {
    return outcomeOf(await this.store.writeFile(kind, path, file, this.clock(), 0));
  }

  /**
   * Read the fresh row, apply `fn`, write with that row's version; on 'changed' read again and replay
   * once. 'missing' when there is no row of that kind at the path; a refused row returns the store's
   * reason (spec 4 §9: the toast names it). A result with the same content (the very object, or the
   * same canonical JSON) writes nothing, so an edit that changes nothing never re-uploads a file.
   */
  async edit<K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> {
    const first = await this.attempt(kind, path, fn);
    if (first !== 'changed') return first;
    const second = await this.attempt(kind, path, fn);
    return second === 'changed' ? { ok: false, reason: 'changed' } : second;
  }

  private async attempt<K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome | 'changed'> {
    const row = await this.store.getRow(path);
    if (row === undefined || row.kind !== kind) return { ok: false, reason: 'missing' };
    const refusal = refusalOf(row);
    if (refusal !== undefined) return { ok: false, reason: refusal };
    // An ok row of this kind holds an upgraded file of that kind (spec 3 §5).
    const current = row.content as FileOf<K>;
    const next = fn(current);
    if (next === current || canonicalJson(next) === canonicalJson(current)) return { ok: true, heldBack: false };
    const result = await this.store.writeFile(kind, path, next, this.clock(), row.version);
    if (!result.ok && result.reason === 'changed') return 'changed';
    return outcomeOf(result);
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.store.getMeta<T>(key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.store.setMeta(key, value);
  }

  /** The `now` tick: 1000 ms when fast, else 60000 ms. */
  setClock(mode: 'fast' | 'slow' | 'off'): void {
    if (this.intervalId !== undefined) {
      this.stopInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (mode === 'off') return;
    this.intervalId = this.startInterval(() => {
      this.now.value = this.clock();
    }, mode === 'fast' ? FAST_MS : SLOW_MS);
  }

  dispose(): void {
    this.setClock('off');
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  private async reloadIssues(): Promise<void> {
    this.queue.value = await this.store.queue();
    this.issues.value = await this.store.issues();
  }
}

/**
 * Spec 4 §3: where the store's `onChange` goes. Other tabs hear it through the channel, which never
 * delivers to the posting tab, so this tab's Data refreshes directly. The store is built before Data,
 * so Data binds late; a change before `bind` only reaches the channel (`Data.load` reads everything).
 */
export function storeChanges(channel: Pick<ChangeChannel, 'post'> | undefined): { onChange(path: string): void; bind(data: Pick<Data, 'refresh'>): void } {
  let bound: Pick<Data, 'refresh'> | undefined;
  return {
    onChange(path) {
      channel?.post(path);
      void bound?.refresh(path);
    },
    bind(data) {
      bound = data;
    },
  };
}

export function sessionRowById(rows: readonly SessionRow[], id: string): SessionRow | undefined {
  return rows.find((r) => r.file.session.id === id);
}
