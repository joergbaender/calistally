import type { DropboxClient, DropboxError, DropboxResult, Listing, ListingEntry, UploadMode } from './dropbox-client';
import { buildZip } from './test-fixtures';

/** An in-memory Dropbox with real rev and conflict semantics, cursors, and fault injection (spec 3 §14). */
export class FakeDropbox implements DropboxClient {
  private readonly files = new Map<string, { rev: string; text: string }>();
  /** Every change in order; a cursor is an index into it. */
  private readonly journal: { path: string; deleted: boolean }[] = [];
  private revCounter = 0;
  /** Call log, e.g. 'upload /a.json update:r1'. */
  readonly log: string[] = [];
  /** Fault injection. `failNext` answers the next matching calls with the error, then clears. */
  offline = false;
  failNext: { error: DropboxError; times: number; retryAfterMs?: number; only?: string } | undefined;
  /** Dropbox's state when the folder is brand new: no files at all. */

  // ---- test-side helpers ("another device" or the desktop client) ----

  put(path: string, text: string): string {
    const rev = this.nextRev();
    this.files.set(path.toLowerCase(), { rev, text });
    this.journal.push({ path: path.toLowerCase(), deleted: false });
    return rev;
  }

  remove(path: string): void {
    this.files.delete(path.toLowerCase());
    this.journal.push({ path: path.toLowerCase(), deleted: true });
  }

  get(path: string): { rev: string; text: string } | undefined {
    return this.files.get(path.toLowerCase());
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  // ---- DropboxClient ----

  async listFolder(): Promise<DropboxResult<Listing>> {
    const fault = this.fault('listFolder');
    if (fault) return fault;
    this.log.push('listFolder');
    const entries: ListingEntry[] = [];
    const folders = new Set<string>();
    for (const [path, f] of [...this.files].sort()) {
      const parts = path.split('/').slice(1, -1);
      for (let i = 1; i <= parts.length; i += 1) folders.add(`/${parts.slice(0, i).join('/')}`);
      entries.push({ kind: 'file', path, rev: f.rev, size: f.text.length });
    }
    for (const folder of [...folders].sort()) entries.unshift({ kind: 'folder', path: folder });
    return { ok: true, value: { entries, cursor: `c${this.journal.length}` } };
  }

  async listFolderContinue(cursor: string): Promise<DropboxResult<Listing>> {
    const fault = this.fault('listFolderContinue');
    if (fault) return fault;
    this.log.push(`listFolderContinue ${cursor}`);
    const from = Number(cursor.slice(1));
    if (!cursor.startsWith('c') || !Number.isInteger(from) || from > this.journal.length) {
      return { ok: false, error: 'cursor-reset', message: 'reset' };
    }
    const latest = new Map<string, boolean>();
    for (const change of this.journal.slice(from)) latest.set(change.path, change.deleted);
    const entries: ListingEntry[] = [...latest].map(([path, deleted]) => {
      const f = this.files.get(path);
      return deleted || f === undefined ? { kind: 'deleted', path } : { kind: 'file', path, rev: f.rev, size: f.text.length };
    });
    return { ok: true, value: { entries, cursor: `c${this.journal.length}` } };
  }

  async getLatestCursor(): Promise<DropboxResult<string>> {
    const fault = this.fault('getLatestCursor');
    if (fault) return fault;
    return { ok: true, value: `c${this.journal.length}` };
  }

  async download(path: string): Promise<DropboxResult<{ rev: string; text: string }>> {
    const fault = this.fault('download');
    if (fault) return fault;
    this.log.push(`download ${path}`);
    const f = this.files.get(path.toLowerCase());
    if (f === undefined) return { ok: false, error: 'missing', message: 'not_found' };
    return { ok: true, value: { rev: f.rev, text: f.text } };
  }

  async upload(path: string, text: string, mode: UploadMode): Promise<DropboxResult<{ rev: string }>> {
    const fault = this.fault('upload');
    if (fault) return fault;
    this.log.push(`upload ${path} ${'add' in mode ? 'add' : `update:${mode.rev}`}`);
    const key = path.toLowerCase();
    const existing = this.files.get(key);
    if ('add' in mode ? existing !== undefined : existing === undefined || existing.rev !== mode.rev) {
      return { ok: false, error: 'conflict', message: 'path/conflict/file' };
    }
    const rev = this.nextRev();
    this.files.set(key, { rev, text });
    this.journal.push({ path: key, deleted: false });
    return { ok: true, value: { rev } };
  }

  async downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>> {
    const fault = this.fault('downloadZip');
    if (fault) return fault;
    this.log.push(`downloadZip ${path}`);
    const prefix = `${path.toLowerCase()}/`;
    const inputs = [...this.files]
      .filter(([p]) => p.startsWith(prefix))
      .sort()
      .map(([p, f]) => ({ name: p.slice(1), data: new TextEncoder().encode(f.text) }));
    if (inputs.length === 0) return { ok: false, error: 'missing', message: 'not_found' };
    const zip = await buildZip(inputs);
    return { ok: true, value: zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer };
  }

  async revokeToken(): Promise<DropboxResult<void>> {
    this.log.push('revokeToken');
    return { ok: true, value: undefined };
  }

  // ---- internals ----

  private nextRev(): string {
    this.revCounter += 1;
    return `rev${this.revCounter}`;
  }

  private fault(call: string): { ok: false; error: DropboxError; message: string; retryAfterMs?: number } | undefined {
    if (this.offline) {
      this.log.push(`${call} (offline)`);
      return { ok: false, error: 'offline', message: 'offline' };
    }
    const f = this.failNext;
    if (f !== undefined && f.times > 0 && (f.only === undefined || f.only === call)) {
      f.times -= 1;
      if (f.times === 0) this.failNext = undefined;
      this.log.push(`${call} (${f.error})`);
      return { ok: false, error: f.error, message: f.error, ...(f.retryAfterMs !== undefined ? { retryAfterMs: f.retryAfterMs } : {}) };
    }
    return undefined;
  }
}
