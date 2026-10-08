import { restoreReferenced } from '../model/catalog';
import { readFile as defaultReadFile, type ReadResult } from '../model/read';
import { MODEL_VERSION } from '../model/schema';
import { SEED, mergeSeed } from '../model/seed';
import type { Exercise, ExercisesFile, FileKind, SessionFile } from '../model/types';
import { UPGRADE_STEPS, upgradeFile as defaultUpgradeFile, type UpgradeResult } from '../model/upgrade';
import { validateForWrite } from '../model/validate';
import type { ChangeChannel } from './channel';
import type { DropboxClient, DropboxResult, ListingEntry } from './dropbox-client';
import type { Leadership } from './lock';
import { mergeFile, sameContent } from './merge';
import { EXERCISES_PATH, classifyPath } from './paths';
import type { FileRow, Issue, QueueRow, Store } from './store';
import { readZip } from './zip';

/** The sync engine (spec 3 §7): one drain is a pull, then a push. */

export const ZIP_THRESHOLD = 20;
export const DOWNLOAD_CONCURRENCY = 4;
export const PUSH_DEBOUNCE_MS = 1000;
export const MAX_BACKOFF_MS = 5 * 60 * 1000;
export const CONFLICTS_PER_DRAIN = 3;
export const RATE_LIMIT_RETRIES = 5;

export type Phase = 'idle' | 'pulling' | 'pushing';
export type EmptyFolderChoice = 'seed' | 'copy';

export interface SyncStatus {
  phase: Phase;
  online: boolean;
  connected: boolean;
  queueLength: number;
  heldBackCount: number;
  lastPullAt?: string | undefined;
  lastPushAt?: string | undefined;
  lastError?: string | undefined;
  issues: Issue[];
  /** A file newer than this app was seen: the shell checks for an update (spec 3 §8). */
  tooNewSeen: boolean;
  /** The App folder holds no data files and no local writes exist (spec 3 §11). */
  emptyFolder: boolean;
  emptyFolderChoice?: EmptyFolderChoice | undefined;
  /** Milliseconds until the next automatic retry, when backing off. */
  retryInMs?: number | undefined;
}

export interface EngineDeps {
  store: Store;
  client: DropboxClient;
  leadership: Leadership;
  channel?: ChangeChannel;
  /** Identifies the build; the seed merge runs once per value. */
  buildId: string;
  seed?: readonly Exercise[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** The model's read and upgrade functions; tests replace them to simulate an updated app. */
  readFile?: (kind: FileKind, raw: unknown) => ReadResult;
  upgradeFile?: (kind: FileKind, raw: unknown) => UpgradeResult;
  modelVersion?: number;
  /** The debounce and backoff timers; tests pass a FakeTimers. */
  timers?: Timers;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Outcome = 'done' | 'stopped';

export class Engine {
  readonly status: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

  private readonly store: Store;
  private readonly client: DropboxClient;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly read: (kind: FileKind, raw: unknown) => ReadResult;
  private readonly upgrade: (kind: FileKind, raw: unknown) => UpgradeResult;
  private readonly modelVersion: number;
  private readonly seed: readonly Exercise[];
  private readonly timers: Timers;
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private chain: Promise<void> = Promise.resolve();
  private drainQueued = false;
  private pushTimer: unknown;
  private retryTimer: unknown;
  private failures = 0;
  private stopped = false;

  constructor(private readonly deps: EngineDeps) {
    this.store = deps.store;
    this.client = deps.client;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.read = deps.readFile ?? ((kind, raw) => defaultReadFile(kind, raw, UPGRADE_STEPS, deps.modelVersion ?? MODEL_VERSION));
    this.upgrade = deps.upgradeFile ?? ((kind, raw) => defaultUpgradeFile(kind, raw, UPGRADE_STEPS, deps.modelVersion ?? MODEL_VERSION));
    this.modelVersion = deps.modelVersion ?? MODEL_VERSION;
    this.seed = deps.seed ?? SEED;
    this.timers = deps.timers ?? REAL_TIMERS;
    deps.channel?.subscribe(() => this.requestPush());
  }

  /** Resolves when every queued run has finished. */
  idle(): Promise<void> {
    return this.chain;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Loads the persisted parts of the status. Call once after construction. */
  async init(): Promise<void> {
    this.status.lastPullAt = await this.store.getMeta<string>('lastPullAt');
    this.status.lastPushAt = await this.store.getMeta<string>('lastPushAt');
    this.status.emptyFolderChoice = await this.store.getMeta<EmptyFolderChoice>('emptyFolderChoice');
    await this.refreshCounts();
  }

  /** A full drain (pull, then push), serialised with everything else. Coalesces while one is queued. */
  drain(): Promise<void> {
    if (this.drainQueued) return this.chain;
    this.drainQueued = true;
    return this.enqueue(async () => {
      this.drainQueued = false;
      if (await this.pull() === 'done') await this.push();
    });
  }

  /** Push only, 1 s after the last call (spec 3 §7 triggers). */
  requestPush(): void {
    if (this.pushTimer !== undefined) this.timers.clearTimeout(this.pushTimer);
    this.pushTimer = this.timers.setTimeout(() => {
      this.pushTimer = undefined;
      void this.enqueue(() => this.push().then(() => undefined));
    }, PUSH_DEBOUNCE_MS);
  }

  pushNow(): Promise<void> {
    return this.enqueue(() => this.push().then(() => undefined));
  }

  /** The owner's answer on an empty App folder (spec 3 §11). */
  async chooseEmptyFolder(choice: EmptyFolderChoice): Promise<void> {
    await this.store.setMeta('emptyFolderChoice', choice);
    this.status.emptyFolderChoice = choice;
    if (choice === 'seed') {
      await this.enqueue(async () => {
        await this.runSeed(true);
        await this.push();
      });
    } else {
      this.notify();
    }
  }

  /** No tokens: nothing runs until a login. Local writes still queue. */
  disconnect(): void {
    this.status.connected = false;
    this.stopped = true;
    this.notify();
  }

  /** After a new login: the engine runs again. */
  reconnect(): void {
    this.status.connected = true;
    this.stopped = false;
    this.notify();
  }

  /** Stops timers; used on sign out and in tests. */
  dispose(): void {
    this.stopped = true;
    if (this.pushTimer !== undefined) this.timers.clearTimeout(this.pushTimer);
    if (this.retryTimer !== undefined) this.timers.clearTimeout(this.retryTimer);
  }

  // ---- pull ----

  private async pull(): Promise<Outcome> {
    if (!this.status.connected || this.stopped) return 'stopped';
    this.setPhase('pulling');
    try {
      const cursor = await this.store.getMeta<string>('cursor');
      let listing = cursor === undefined ? await this.client.listFolder() : await this.client.listFolderContinue(cursor);
      if (!listing.ok && listing.error === 'cursor-reset') {
        await this.store.setMeta('cursor', undefined);
        listing = await this.client.listFolder();
      }
      if (!listing.ok) return this.failed(listing);
      const outcome = await this.applyListing(listing.value.entries, cursor === undefined);
      if (outcome !== 'done') return outcome;
      await this.store.setMeta('cursor', listing.value.cursor);
      await this.afterPull();
      const at = this.now().toISOString();
      await this.store.setMeta('lastPullAt', at);
      this.status.lastPullAt = at;
      this.succeeded();
      return 'done';
    } finally {
      await this.refreshCounts();
      this.setPhase('idle');
    }
  }

  private async applyListing(entries: ListingEntry[], firstLoad: boolean): Promise<Outcome> {
    const unexpected = new Set(await this.store.unexpectedPaths());
    const toFetch: { path: string; kind: FileKind; rev: string }[] = [];
    for (const e of entries) {
      const cls = classifyPath(e.path);
      if (cls.kind === 'ignored') continue;
      if (e.kind === 'deleted') {
        unexpected.delete(e.path);
        if (cls.kind === 'data') await this.remoteDeleted(e.path);
        continue;
      }
      if (e.kind === 'folder') continue;
      if (cls.kind === 'unexpected') { unexpected.add(e.path); continue; }
      const row = await this.store.getRow(e.path);
      if (row?.rev !== e.rev) toFetch.push({ path: e.path, kind: cls.fileKind, rev: e.rev });
    }
    await this.store.setUnexpectedPaths([...unexpected]);
    let remaining = toFetch;
    const missingSessions = toFetch.filter((f) => f.kind === 'session');
    if (firstLoad && missingSessions.length > ZIP_THRESHOLD) {
      const done = await this.fetchZip(missingSessions);
      remaining = toFetch.filter((f) => !done.has(f.path));
    }
    return this.fetchEach(remaining);
  }

  /** First load: one zip for /sessions. Returns the paths it covered; the rest go file by file. */
  private async fetchZip(wanted: { path: string; kind: FileKind; rev: string }[]): Promise<Set<string>> {
    const done = new Set<string>();
    const zip = await this.client.downloadZip('/sessions');
    if (!zip.ok) return done;
    let entries;
    try {
      entries = await readZip(zip.value);
    } catch {
      return done;
    }
    const byPath = new Map(wanted.map((w) => [w.path, w]));
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      const target = byPath.get(`/${name}`) ?? byPath.get(`/sessions/${name}`);
      if (target === undefined) continue;
      await this.applyRemote(target.path, target.kind, target.rev, new TextDecoder().decode(entry.bytes));
      done.add(target.path);
    }
    return done;
  }

  private async fetchEach(files: { path: string; kind: FileKind; rev: string }[]): Promise<Outcome> {
    let index = 0;
    let stop: Extract<DropboxResult<never>, { ok: false }> | undefined;
    const worker = async () => {
      while (index < files.length && stop === undefined) {
        const f = files[index] as { path: string; kind: FileKind; rev: string };
        index += 1;
        const r = await this.client.download(f.path);
        if (!r.ok) {
          if (r.error === 'missing') { await this.remoteDeleted(f.path); continue; }
          stop = r;
          return;
        }
        await this.applyRemote(f.path, f.kind, r.value.rev, r.value.text);
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
    return stop === undefined ? 'done' : this.failed(stop);
  }

  /** One downloaded file into the local copy: read, merge, park or quarantine (spec 3 §6, §7). */
  private async applyRemote(path: string, kind: FileKind, rev: string, text: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      await this.saveNonOk(path, kind, rev, text, 'quarantined', [{ level: 'hard', path: '', message: `not JSON: ${e instanceof Error ? e.message : String(e)}` }]);
      return;
    }
    await this.applyRaw(path, kind, rev, raw);
  }

  /** Rows that were too new or invalid are read again from their stored raw content on every
   *  pull: after an app update (or a fix) they become readable without a download, and parked
   *  local changes are released (spec 3 §6). */
  private async rereadNonOk(): Promise<void> {
    for (const row of await this.store.rows()) {
      if (row.rev === null || typeof row.content !== 'object' || row.content === null) continue;
      // An ok row is read again only while parked local changes wait on it (their upgrade failed).
      if (row.status === 'ok' && (await this.store.getQueueRow(row.path))?.pendingContent === undefined) continue;
      await this.applyRaw(row.path, row.kind, row.rev, row.content);
    }
    const rows = await this.store.rows();
    this.status.tooNewSeen = rows.some((r) => r.status === 'read-only' || r.status === 'needs-update');
  }

  /** Read, merge and write happen in one transaction (Store.mutate): a set typed meanwhile survives. */
  private async applyRaw(path: string, kind: FileKind, rev: string, raw: unknown): Promise<void> {
    const result = this.read(kind, raw);
    if (result.status !== 'ok') {
      if (result.status !== 'quarantined') this.status.tooNewSeen = true;
      await this.saveNonOk(path, kind, rev, raw, result.status, result.issues);
      return;
    }
    const at = this.now().toISOString();
    await this.store.mutate(path, (row, queued) => {
      let merged: unknown = result.file;
      let localVersion = row?.version ?? 0;
      const localOk = row !== undefined && row.status === 'ok' && row.duplicateOf === undefined;
      if (localOk) merged = this.mergeInto(kind, row.content, merged);
      let upgradeError: string | undefined;
      if (queued?.pendingContent !== undefined) {
        const up = this.upgrade(kind, queued.pendingContent);
        if (up.status === 'ok') merged = this.mergeInto(kind, up.file, merged);
        else upgradeError = up.status === 'invalid' ? up.message : `newer than this app (version ${up.version})`;
      }
      const equalsRemote = sameContent(merged, result.file);
      const equalsLocal = localOk && sameContent(merged, row.content);
      if (!equalsLocal) localVersion += 1;
      const next: FileRow = {
        path, kind, rev, content: merged, status: 'ok', issues: [], version: localVersion,
        ...(equalsRemote ? { syncedAt: at } : row?.syncedAt !== undefined ? { syncedAt: row.syncedAt } : {}),
      };
      if (upgradeError !== undefined && queued !== undefined) {
        // Parked local changes that cannot be upgraded are kept as they are, never dropped.
        return { row: next, queue: { ...queued, lastError: `parked local changes could not be upgraded: ${upgradeError}` } };
      }
      if (equalsRemote) return { row: next, queue: null };
      const base: QueueRow = queued ?? { path, kind, enqueuedAt: at, attempts: 0 };
      const { pendingContent: _p, pendingVersion: _v, lastError: _e, heldBack: _h, ...kept } = base;
      const validation = validateForWrite(kind, merged);
      return { row: next, queue: { ...kept, ...(validation.ok ? {} : { heldBack: validation.issues }) } };
    });
  }

  private mergeInto(kind: FileKind, local: unknown, remote: unknown): unknown {
    const merged = mergeFile(kind, local, remote) as Record<string, unknown>;
    return { ...merged, schemaVersion: this.modelVersion };
  }

  /** A too-new or invalid remote replaces the row; queued local content is parked, never lost. */
  private async saveNonOk(path: string, kind: FileKind, rev: string, raw: unknown, status: 'read-only' | 'needs-update' | 'quarantined', issues: FileRow['issues']): Promise<void> {
    await this.store.mutate(path, (row, queued) => {
      let queue: QueueRow | undefined;
      if (queued !== undefined && row !== undefined && row.status === 'ok' && queued.pendingContent === undefined) {
        const { heldBack: _h, ...kept } = queued;
        queue = { ...kept, pendingContent: row.content, pendingVersion: this.modelVersion, lastError: status === 'quarantined' ? 'Dropbox copy invalid; local changes wait' : 'Dropbox copy is newer than this app; local changes wait' };
      } else if (queued !== undefined && status === 'quarantined') {
        queue = { ...queued, lastError: 'Dropbox copy invalid; local changes wait' };
      }
      return { row: { path, kind, rev, content: raw, status, issues, version: row?.version ?? 0 }, ...(queue !== undefined ? { queue } : {}) };
    });
  }

  private async remoteDeleted(path: string): Promise<void> {
    await this.store.mutate(path, (row) => {
      if (row === undefined) return {};
      if (row.duplicateOf !== undefined) return { row: null };
      return { row: { ...row, rev: null, remoteDeleted: true } };
    });
  }

  private async afterPull(): Promise<void> {
    await this.rereadNonOk();
    await this.resolveDuplicates();
    await this.heal();
    await this.runSeed(false);
    const rows = await this.store.rows();
    const queue = await this.store.queue();
    this.status.emptyFolder = rows.length === 0 && queue.length === 0;
  }

  /** Spec 1 §4: two files with one session id merge into the path that sorts first. */
  private async resolveDuplicates(): Promise<void> {
    const groups = new Map<string, FileRow[]>();
    for (const row of await this.store.rows()) {
      if (row.kind !== 'session' || row.status !== 'ok' || row.duplicateOf !== undefined) continue;
      const id = (row.content as SessionFile).session.id;
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => a.path.localeCompare(b.path));
      const winner = rows[0] as FileRow;
      let merged: unknown = winner.content;
      for (const loser of rows.slice(1)) merged = this.mergeInto('session', merged, loser.content);
      if (!sameContent(merged, winner.content)) {
        const written = await this.store.writeFile('session', winner.path, merged, this.now(), winner.version);
        if (!written.ok) continue; // the winner moved since it was read; the next pull retries
      }
      for (const loser of rows.slice(1)) {
        // A loser edited since it was read keeps its changes; the next pull retries.
        await this.store.mutate(loser.path, (row) => (row === undefined || row.version !== loser.version ? {} : { row: { ...row, duplicateOf: winner.path }, queue: null }));
      }
    }
  }

  private async heal(): Promise<void> {
    const row = await this.store.getRow(EXERCISES_PATH);
    if (row === undefined || row.status !== 'ok') return;
    const catalog = row.content as ExercisesFile;
    const sessions = (await this.store.sessions()).map((s) => s.file.session);
    const healed = restoreReferenced(catalog.exercises, sessions, this.now());
    if (healed.some((e, i) => e !== catalog.exercises[i])) {
      // Skipped when the catalog changed since the read; the next pull heals again.
      await this.store.writeFile('exercises', EXERCISES_PATH, { ...catalog, exercises: healed } satisfies ExercisesFile, this.now(), row.version);
    }
  }

  /** Once per build, and only once a catalog exists remotely or the owner chose the seed (spec 3 §6). */
  private async runSeed(chosenNow: boolean): Promise<void> {
    const seeded = await this.store.getMeta<string>('seededBuild');
    if (seeded === this.deps.buildId && !chosenNow) return;
    const row = await this.store.getRow(EXERCISES_PATH);
    const choice = chosenNow ? 'seed' : await this.store.getMeta<EmptyFolderChoice>('emptyFolderChoice');
    if (row === undefined && choice !== 'seed') return;
    if (row !== undefined && row.status !== 'ok') return;
    const existing = row === undefined ? [] : (row.content as ExercisesFile).exercises;
    const result = mergeSeed(existing, this.seed);
    if (result.added.length > 0 || row === undefined) {
      const written = await this.store.writeFile('exercises', EXERCISES_PATH, { schemaVersion: this.modelVersion, exercises: result.catalog }, this.now(), row?.version ?? 0);
      if (!written.ok) return; // the catalog changed since the read: not seeded, the next pull retries
    }
    await this.store.setMeta('seededBuild', this.deps.buildId);
  }

  // ---- push ----

  private async push(): Promise<Outcome> {
    if (!this.status.connected || this.stopped) return 'stopped';
    this.setPhase('pushing');
    try {
      const conflicts = new Map<string, number>();
      for (const queued of await this.store.queue()) {
        const outcome = await this.pushOne(queued, conflicts);
        if (outcome !== 'done') return outcome;
      }
      this.succeeded();
      return 'done';
    } finally {
      await this.refreshCounts();
      this.setPhase('idle');
    }
  }

  private async pushOne(queued: QueueRow, conflicts: Map<string, number>): Promise<Outcome> {
    const row = await this.store.getRow(queued.path);
    if (row === undefined) { await this.store.deleteQueueRow(queued.path); return 'done'; }
    if (row.status !== 'ok' || row.duplicateOf !== undefined) return 'done';
    if (queued.pendingContent !== undefined) return 'done'; // parked local changes wait for their upgrade
    const validation = validateForWrite(row.kind, row.content);
    if (!validation.ok) {
      if (queued.heldBack === undefined) await this.store.setQueueRow({ ...queued, heldBack: validation.issues });
      return 'done';
    }
    if (queued.heldBack !== undefined) {
      const { heldBack: _h, ...rest } = queued;
      queued = rest;
      await this.store.setQueueRow(queued);
    }
    const text = `${JSON.stringify(row.content, null, 2)}\n`;
    let rateLimited = 0;
    for (;;) {
      const r = await this.client.upload(row.path, text, row.rev === null ? { add: true } : { rev: row.rev });
      if (r.ok) {
        const at = this.now().toISOString();
        await this.store.finishQueueRow(row.path, row.version, r.value.rev, at);
        await this.store.setMeta('lastPushAt', at);
        this.status.lastPushAt = at;
        return 'done';
      }
      if (r.error === 'conflict') {
        const n = (conflicts.get(row.path) ?? 0) + 1;
        conflicts.set(row.path, n);
        await this.store.mutate(row.path, (_r, q) => (q === undefined ? {} : { queue: { ...q, attempts: q.attempts + 1 } }));
        const remote = await this.client.download(row.path);
        if (remote.ok) await this.applyRemote(row.path, row.kind, remote.value.rev, remote.value.text);
        else if (remote.error === 'missing') await this.remoteDeleted(row.path);
        else return this.failed(remote);
        if (n >= CONFLICTS_PER_DRAIN) {
          const message = `${row.path}: ${n} conflicts in one run; will retry`;
          await this.store.mutate(row.path, (_r, q) => (q === undefined ? {} : { queue: { ...q, lastError: message } }));
          this.status.lastError = message;
          return 'stopped';
        }
        const again = await this.store.getQueueRow(row.path);
        return again === undefined ? 'done' : this.pushOne(again, conflicts);
      }
      if (r.error === 'rate-limited') {
        rateLimited += 1;
        if (rateLimited > RATE_LIMIT_RETRIES) return this.failed(r);
        await this.sleep(r.retryAfterMs ?? 1000);
        continue;
      }
      if (r.error === 'other') {
        await this.store.setQueueRow({ ...queued, attempts: queued.attempts + 1, lastError: r.message });
        return 'done';
      }
      return this.failed(r);
    }
  }

  // ---- bookkeeping ----

  private failed(r: { ok: false; error: string; message: string; retryAfterMs?: number }): Outcome {
    this.status.lastError = `${r.error}: ${r.message}`;
    if (r.error === 'unauthorized') {
      this.status.connected = false;
      this.stopped = true;
    } else if (r.error === 'offline' || r.error === 'rate-limited') {
      this.status.online = false;
      this.scheduleRetry(r.retryAfterMs);
    }
    this.notify();
    return 'stopped';
  }

  private succeeded(): void {
    this.failures = 0;
    this.status.online = true;
    this.status.lastError = undefined;
    this.status.retryInMs = undefined;
    if (this.retryTimer !== undefined) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = undefined; }
  }

  /** Exponential backoff: 2 s, 4 s, 8 s … capped at 5 min (spec 3 §7). */
  private scheduleRetry(atLeastMs?: number): void {
    if (this.stopped) return;
    this.failures += 1;
    const delay = Math.max(atLeastMs ?? 0, Math.min(2 ** this.failures * 1000, MAX_BACKOFF_MS));
    this.status.retryInMs = delay;
    if (this.retryTimer !== undefined) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      void this.drain();
    }, delay);
  }

  /** The `online` event: forget the backoff and try now. */
  wentOnline(): Promise<void> {
    this.failures = 0;
    if (this.retryTimer !== undefined) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    return this.drain();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(async () => {
      await this.deps.leadership.whenLeader();
      await work();
    });
    this.chain = run.catch((e: unknown) => {
      this.status.lastError = e instanceof Error ? e.message : String(e);
      this.notify();
    });
    return this.chain;
  }

  private async refreshCounts(): Promise<void> {
    const queue = await this.store.queue();
    this.status.queueLength = queue.length;
    this.status.heldBackCount = queue.filter((q) => q.heldBack !== undefined).length;
    this.status.issues = await this.store.issues();
    this.notify();
  }

  private setPhase(phase: Phase): void {
    this.status.phase = phase;
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l(this.status);
  }
}
