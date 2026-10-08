import type { ReadStatus } from '../model/read';
import { validateForWrite, type ValidationIssue } from '../model/validate';
import type { BodyweightFile, ExercisesFile, FileKind, SessionFile } from '../model/types';
import type { Db, Tx } from './db';
import { BODYWEIGHT_PATH, EXERCISES_PATH, queueRank } from './paths';

/** The local copy of one Dropbox file (spec 3 §5). Every view reads these rows. */
export interface FileRow {
  path: string;
  kind: FileKind;
  /** null until the file exists in Dropbox. */
  rev: string | null;
  /** The upgraded file at MODEL_VERSION when status is 'ok'; the raw file otherwise. */
  content: unknown;
  status: ReadStatus;
  issues: ValidationIssue[];
  /** Bumped on every local write; the engine's race guard. */
  version: number;
  syncedAt?: string;
  /** Set on the losing path of a duplicate session: hidden from views, refused by writeFile. */
  duplicateOf?: string;
  /** The file vanished from Dropbox; the content is kept. */
  remoteDeleted?: true;
}

export interface QueueRow {
  path: string;
  kind: FileKind;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
  /** The write failed validateForWrite; stays local until a later content passes. */
  heldBack?: ValidationIssue[];
  /** Local content parked while the remote file is too new for this app (spec 3 §6). */
  pendingContent?: unknown;
  pendingVersion?: number;
}

export type WriteRefusal = 'read-only' | 'needs-update' | 'quarantined' | 'duplicate' | 'changed';
export type WriteResult = { ok: true; heldBack?: ValidationIssue[] } | { ok: false; reason: WriteRefusal };

export type IssueReason =
  | 'quarantined' | 'read-only' | 'needs-update' | 'unexpected-file' | 'duplicate' | 'remote-deleted' | 'held-back' | 'push-error';

export interface Issue {
  path: string;
  reason: IssueReason;
  detail: string;
}

export interface StoreEvents {
  /** A row changed locally or by the engine; the shell and other tabs refresh. */
  onChange?: (path: string) => void;
}

const UNEXPECTED_KEY = 'unexpectedPaths';

/** Spec 3 §5: the write path with the ReadStatus guard, and the read helpers. */
export class Store {
  constructor(readonly db: Db, private readonly events: StoreEvents = {}) {}

  /** The write every screen calls. One transaction over files and queue. */
  async writeFile(kind: FileKind, path: string, file: unknown, now: Date = new Date(), expectedVersion?: number): Promise<WriteResult> {
    const result = await this.db.tx(['files', 'queue'], 'readwrite', async (t): Promise<WriteResult> => {
      const row = await t.get<FileRow>('files', path);
      // The caller derived `file` from an earlier read; if the row moved since, write nothing.
      if (expectedVersion !== undefined && (row?.version ?? 0) !== expectedVersion) return { ok: false, reason: 'changed' };
      if (row !== undefined) {
        if (row.duplicateOf !== undefined) return { ok: false, reason: 'duplicate' };
        if (row.status !== 'ok') return { ok: false, reason: row.status };
      }
      const validation = validateForWrite(kind, file);
      const next: FileRow = {
        path,
        kind,
        rev: row?.rev ?? null,
        content: file,
        status: 'ok',
        issues: [],
        version: (row?.version ?? 0) + 1,
        ...(row?.syncedAt !== undefined ? { syncedAt: row.syncedAt } : {}),
        ...(row?.remoteDeleted !== undefined ? { remoteDeleted: row.remoteDeleted } : {}),
      };
      await t.put('files', next);
      const queued = await t.get<QueueRow>('queue', path);
      const entry: QueueRow = {
        path,
        kind,
        enqueuedAt: queued?.enqueuedAt ?? now.toISOString(),
        attempts: queued?.attempts ?? 0,
        ...(queued?.lastError !== undefined ? { lastError: queued.lastError } : {}),
        ...(validation.ok ? {} : { heldBack: validation.issues }),
        ...(queued?.pendingContent !== undefined ? { pendingContent: queued.pendingContent, pendingVersion: queued.pendingVersion as number } : {}),
      };
      await t.put('queue', entry);
      return validation.ok ? { ok: true } : { ok: true, heldBack: validation.issues };
    });
    if (result.ok) this.events.onChange?.(path);
    return result;
  }

  getRow(path: string): Promise<FileRow | undefined> {
    return this.db.get<FileRow>('files', path);
  }

  rows(): Promise<FileRow[]> {
    return this.db.getAll<FileRow>('files');
  }

  /** Readable session files: status ok and not the loser of a duplicate pair. */
  async sessions(): Promise<{ path: string; file: SessionFile }[]> {
    const rows = await this.rows();
    return rows
      .filter((r) => r.kind === 'session' && r.status === 'ok' && r.duplicateOf === undefined)
      .map((r) => ({ path: r.path, file: r.content as SessionFile }));
  }

  async catalog(): Promise<ExercisesFile | undefined> {
    const row = await this.getRow(EXERCISES_PATH);
    return row?.status === 'ok' ? (row.content as ExercisesFile) : undefined;
  }

  async bodyweight(): Promise<BodyweightFile | undefined> {
    const row = await this.getRow(BODYWEIGHT_PATH);
    return row?.status === 'ok' ? (row.content as BodyweightFile) : undefined;
  }

  /** Pending writes in push order: catalog, bodyweight, then sessions by enqueue time (spec 3 S12). */
  async queue(): Promise<QueueRow[]> {
    const rows = await this.db.getAll<QueueRow>('queue');
    return rows.sort((a, b) => queueRank(a.kind) - queueRank(b.kind) || a.enqueuedAt.localeCompare(b.enqueuedAt) || a.path.localeCompare(b.path));
  }

  async issues(): Promise<Issue[]> {
    const out: Issue[] = [];
    for (const r of await this.rows()) {
      if (r.duplicateOf !== undefined) out.push({ path: r.path, reason: 'duplicate', detail: `same session as ${r.duplicateOf}; not read` });
      else if (r.status !== 'ok') out.push({ path: r.path, reason: r.status, detail: r.issues.map((i) => `${i.path} ${i.message}`).join('; ') || 'newer than this app' });
      if (r.remoteDeleted) out.push({ path: r.path, reason: 'remote-deleted', detail: 'removed from Dropbox; the local copy is kept' });
    }
    for (const q of await this.queue()) {
      if (q.heldBack) out.push({ path: q.path, reason: 'held-back', detail: q.heldBack.map((i) => `${i.path} ${i.message}`).join('; ') });
      else if (q.lastError !== undefined) out.push({ path: q.path, reason: 'push-error', detail: q.lastError });
    }
    for (const p of await this.unexpectedPaths()) out.push({ path: p, reason: 'unexpected-file', detail: 'not a CalisTally file; not read' });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ---- used by the engine ----

  /** Replaces a row as read from Dropbox (merge already applied by the caller). */
  async saveRow(row: FileRow): Promise<void> {
    await this.db.put('files', row);
    this.events.onChange?.(row.path);
  }

  /** Reads the row and its queue row and writes the outcome in ONE transaction, so a merge sees
   *  one consistent state and a concurrent writeFile cannot be overwritten. `fn` must be
   *  synchronous. For each field of its result: an object is stored, null deletes, absent leaves
   *  the record alone. */
  async mutate(
    path: string,
    fn: (row: FileRow | undefined, queued: QueueRow | undefined) => { row?: FileRow | null; queue?: QueueRow | null },
  ): Promise<void> {
    const rowChanged = await this.db.tx(['files', 'queue'], 'readwrite', async (t) => {
      const row = await t.get<FileRow>('files', path);
      const queued = await t.get<QueueRow>('queue', path);
      const out = fn(row, queued);
      if (out.row === null) await t.delete('files', path);
      else if (out.row !== undefined) await t.put('files', out.row);
      if (out.queue === null) await t.delete('queue', path);
      else if (out.queue !== undefined) await t.put('queue', out.queue);
      return out.row !== undefined;
    });
    if (rowChanged) this.events.onChange?.(path);
  }

  /** Engine-side update of a row inside a caller's transaction. */
  static async putRow(t: Tx, row: FileRow): Promise<void> {
    await t.put('files', row);
  }

  /** Removes a row entirely (only for the loser of a duplicate pair once Dropbox dropped it). */
  async deleteRow(path: string): Promise<void> {
    await this.db.delete('files', path);
    this.events.onChange?.(path);
  }

  async setQueueRow(row: QueueRow): Promise<void> {
    await this.db.put('queue', row);
  }

  async deleteQueueRow(path: string): Promise<void> {
    await this.db.delete('queue', path);
  }

  getQueueRow(path: string): Promise<QueueRow | undefined> {
    return this.db.get<QueueRow>('queue', path);
  }

  /** Removes the queue row only if the file row's version still equals `version` (spec 3 §7 race guard). */
  async finishQueueRow(path: string, version: number, rev: string, syncedAt: string): Promise<boolean> {
    return this.db.tx(['files', 'queue'], 'readwrite', async (t) => {
      const row = await t.get<FileRow>('files', path);
      if (row === undefined) return false;
      const { remoteDeleted: _gone, ...kept } = row;
      await t.put('files', { ...kept, rev, syncedAt });
      if (row.version !== version) return false;
      await t.delete('queue', path);
      return true;
    });
  }

  unexpectedPaths(): Promise<string[]> {
    return this.db.getValue<string[]>('meta', UNEXPECTED_KEY).then((v) => v ?? []);
  }

  setUnexpectedPaths(paths: string[]): Promise<void> {
    return this.db.setValue('meta', UNEXPECTED_KEY, [...paths].sort());
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.getValue<T>('meta', key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.db.setValue('meta', key, value);
  }
}
