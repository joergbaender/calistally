/** The seven Dropbox calls the engine needs, over fetch (spec 3 §4). */

export interface Listing {
  entries: ListingEntry[];
  cursor: string;
}

export type ListingEntry =
  | { kind: 'file'; path: string; rev: string; size: number }
  | { kind: 'folder'; path: string }
  | { kind: 'deleted'; path: string };

export type DropboxError = 'conflict' | 'missing' | 'cursor-reset' | 'unauthorized' | 'rate-limited' | 'offline' | 'other';

export type DropboxResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DropboxError; message: string; retryAfterMs?: number };

export type UploadMode = { add: true } | { rev: string };

export interface DropboxClient {
  /** The whole App folder, recursively; follows `has_more`. */
  listFolder(): Promise<DropboxResult<Listing>>;
  /** Changes since `cursor`; follows `has_more`. */
  listFolderContinue(cursor: string): Promise<DropboxResult<Listing>>;
  getLatestCursor(): Promise<DropboxResult<string>>;
  download(path: string): Promise<DropboxResult<{ rev: string; text: string }>>;
  upload(path: string, text: string, mode: UploadMode): Promise<DropboxResult<{ rev: string }>>;
  downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>>;
  revokeToken(): Promise<DropboxResult<void>>;
}

export interface TokenSource {
  accessToken(): Promise<string>;
  /** Forced refresh after a 401. */
  refresh(): Promise<string>;
}

export interface ClientDeps {
  fetch: typeof fetch;
  tokens: TokenSource;
  apiUrl?: string;
  contentUrl?: string;
  rpcTimeoutMs?: number;
  contentTimeoutMs?: number;
}

const API_URL = 'https://api.dropboxapi.com/2';
const CONTENT_URL = 'https://content.dropboxapi.com/2';
export const RPC_TIMEOUT_MS = 30_000;
export const CONTENT_TIMEOUT_MS = 120_000;
export const LIST_LIMIT = 2000;

/** The Dropbox-API-Arg header must be ASCII: non-ASCII characters are JSON-escaped. */
export function headerSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Dropbox's content hash: SHA-256 over the concatenated SHA-256s of 4 MiB blocks. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const BLOCK = 4 * 1024 * 1024;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < Math.max(bytes.length, 1); i += BLOCK) {
    parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(i, i + BLOCK))));
  }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { joined.set(p, offset); offset += p.length; }
  return hex(await crypto.subtle.digest('SHA-256', joined));
}

type Raw = { ok: true; res: Response } | { ok: false; error: DropboxError; message: string; retryAfterMs?: number; body?: unknown };

export class DropboxHttpClient implements DropboxClient {
  constructor(private readonly deps: ClientDeps) {}

  async listFolder(): Promise<DropboxResult<Listing>> {
    const first = await this.rpc<RawListing>('files/list_folder', { path: '', recursive: true, limit: LIST_LIMIT, include_deleted: false });
    if (!first.ok) return first;
    return this.followListing(first.value);
  }

  async listFolderContinue(cursor: string): Promise<DropboxResult<Listing>> {
    const first = await this.rpc<RawListing>('files/list_folder/continue', { cursor }, whenTag('reset', 'cursor-reset'));
    if (!first.ok) return first;
    return this.followListing(first.value);
  }

  async getLatestCursor(): Promise<DropboxResult<string>> {
    const r = await this.rpc<{ cursor: string }>('files/list_folder/get_latest_cursor', { path: '', recursive: true, limit: LIST_LIMIT, include_deleted: false });
    return r.ok ? { ok: true, value: r.value.cursor } : r;
  }

  async download(path: string): Promise<DropboxResult<{ rev: string; text: string }>> {
    const raw = await this.content('files/download', { path }, undefined, whenTag('not_found', 'missing'));
    if (!raw.ok) return raw;
    const meta = raw.res.headers.get('Dropbox-API-Result');
    if (meta === null) return { ok: false, error: 'other', message: 'download without Dropbox-API-Result header' };
    let rev: string;
    try {
      const parsed = JSON.parse(meta) as { rev?: unknown };
      if (typeof parsed.rev !== 'string') return { ok: false, error: 'other', message: 'download missing rev in Dropbox-API-Result' };
      rev = parsed.rev;
    } catch (e) {
      return { ok: false, error: 'other', message: `garbled Dropbox-API-Result: ${e instanceof Error ? e.message : String(e)}` };
    }
    const text = await this.readResponseBody(() => raw.res.text());
    if (!text.ok) return text;
    return { ok: true, value: { rev, text: text.value } };
  }

  async upload(path: string, text: string, mode: UploadMode): Promise<DropboxResult<{ rev: string }>> {
    const bytes = new TextEncoder().encode(text);
    const arg = {
      path,
      mode: 'add' in mode ? 'add' : { '.tag': 'update', update: mode.rev },
      autorename: false,
      mute: true,
      strict_conflict: true,
      content_hash: await contentHash(bytes),
    };
    const raw = await this.content('files/upload', arg, bytes, whenTag('conflict', 'conflict'));
    if (!raw.ok) return raw;
    const meta = await this.readResponseBody(() => raw.res.json() as Promise<{ rev: string }>);
    if (!meta.ok) return meta;
    return { ok: true, value: { rev: meta.value.rev } };
  }

  async downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>> {
    const raw = await this.content('files/download_zip', { path }, undefined, whenTag('not_found', 'missing'));
    if (!raw.ok) return raw;
    const buffer = await this.readResponseBody(() => raw.res.arrayBuffer());
    if (!buffer.ok) return buffer;
    return { ok: true, value: buffer.value };
  }

  async revokeToken(): Promise<DropboxResult<void>> {
    const raw = await this.send(`${this.deps.apiUrl ?? API_URL}/auth/token/revoke`, { method: 'POST' }, this.deps.rpcTimeoutMs ?? RPC_TIMEOUT_MS);
    return raw.ok ? { ok: true, value: undefined } : raw;
  }

  private async followListing(first: RawListing): Promise<DropboxResult<Listing>> {
    const entries = [...first.entries];
    let cursor = first.cursor;
    let more = first.has_more;
    while (more) {
      const next = await this.rpc<RawListing>('files/list_folder/continue', { cursor }, whenTag('reset', 'cursor-reset'));
      if (!next.ok) return next;
      entries.push(...next.value.entries);
      cursor = next.value.cursor;
      more = next.value.has_more;
    }
    return { ok: true, value: { entries: entries.map(mapEntry), cursor } };
  }

  private async rpc<T>(endpoint: string, arg: unknown, classify409: Classify = () => 'other'): Promise<DropboxResult<T>> {
    const raw = await this.send(
      `${this.deps.apiUrl ?? API_URL}/${endpoint}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg) },
      this.deps.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
      classify409,
    );
    if (!raw.ok) return raw;
    const body = await this.readResponseBody(() => raw.res.json() as Promise<T>);
    if (!body.ok) return body;
    return { ok: true, value: body.value };
  }

  private content(endpoint: string, arg: unknown, body: Uint8Array | undefined, classify409: Classify): Promise<Raw> {
    const headers: Record<string, string> = { 'Dropbox-API-Arg': headerSafeJson(arg) };
    if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
    return this.send(
      `${this.deps.contentUrl ?? CONTENT_URL}/${endpoint}`,
      { method: 'POST', headers, ...(body !== undefined ? { body: body as BodyInit } : {}) },
      this.deps.contentTimeoutMs ?? CONTENT_TIMEOUT_MS,
      classify409,
    );
  }

  /** One request with the bearer token; on 401 refreshes once and retries. */
  private async send(url: string, init: RequestInit, timeoutMs: number, classify409: Classify = () => 'other'): Promise<Raw> {
    let token: string;
    try {
      token = await this.deps.tokens.accessToken();
    } catch (e) {
      return { ok: false, error: 'unauthorized', message: e instanceof Error ? e.message : 'not connected' };
    }
    let res = await this.fetchOnce(url, init, token, timeoutMs);
    if (res instanceof Response && res.status === 401) {
      try {
        token = await this.deps.tokens.refresh();
      } catch (e) {
        return { ok: false, error: 'unauthorized', message: e instanceof Error ? e.message : 'refresh failed' };
      }
      res = await this.fetchOnce(url, init, token, timeoutMs);
    }
    if (!(res instanceof Response)) return { ok: false, error: 'offline', message: res.message };
    if (res.ok) return { ok: true, res };
    const text = await res.text();
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: text };
    if (res.status === 429) {
      const header = res.headers.get('Retry-After');
      let seconds = header === null ? Number.NaN : Number(header);
      if (!Number.isFinite(seconds)) seconds = retryAfterFromBody(text) ?? 1;
      return { ok: false, error: 'rate-limited', message: text, retryAfterMs: Math.max(0, seconds) * 1000 };
    }
    if (res.status === 409) return { ok: false, error: classify409(errorTags(text)), message: text };
    if (res.status >= 500) return { ok: false, error: 'offline', message: `Dropbox returned ${res.status}` };
    return { ok: false, error: 'other', message: `Dropbox returned ${res.status}: ${text}` };
  }

  private async readResponseBody<T>(fn: () => Promise<T>): Promise<DropboxResult<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // AbortError/TimeoutError/TypeError from network failure or stream abort
      if (e instanceof TypeError || ((e instanceof Error || e instanceof DOMException) && (e.name === 'AbortError' || e.name === 'TimeoutError'))) {
        return { ok: false, error: 'offline', message: msg };
      }
      // SyntaxError from JSON.parse, or other parse failures
      return { ok: false, error: 'other', message: msg };
    }
  }

  private async fetchOnce(url: string, init: RequestInit, token: string, timeoutMs: number): Promise<Response | { message: string }> {
    try {
      return await this.deps.fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { message: e instanceof Error ? e.message : 'network error' };
    }
  }
}

/** Maps the `.tag` chain of a 409 body to a DropboxError. */
type Classify = (tags: string[]) => DropboxError;
const whenTag = (tag: string, error: DropboxError): Classify => (tags) => (tags.includes(tag) ? error : 'other');

interface RawListing {
  entries: RawEntry[];
  cursor: string;
  has_more: boolean;
}

interface RawEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  path_lower: string;
  rev?: string;
  size?: number;
}

function mapEntry(e: RawEntry): ListingEntry {
  if (e['.tag'] === 'file') return { kind: 'file', path: e.path_lower, rev: e.rev ?? '', size: e.size ?? 0 };
  if (e['.tag'] === 'folder') return { kind: 'folder', path: e.path_lower };
  return { kind: 'deleted', path: e.path_lower };
}

/** The chain of `.tag`s in a 409 body, outermost first: `path/conflict/file` → ['path', 'conflict', 'file']. */
function errorTags(text: string): string[] {
  const tags: string[] = [];
  try {
    const body = JSON.parse(text) as { error?: unknown };
    let node: unknown = body.error;
    while (typeof node === 'object' && node !== null) {
      const record = node as Record<string, unknown>;
      const tag = record['.tag'];
      if (typeof tag !== 'string') break;
      tags.push(tag);
      node = record[tag];
    }
  } catch {
    // not JSON: no tags
  }
  return tags;
}

function retryAfterFromBody(text: string): number | undefined {
  try {
    const body = JSON.parse(text) as { error?: { retry_after?: unknown } };
    return typeof body.error?.retry_after === 'number' ? body.error.retry_after : undefined;
  } catch {
    return undefined;
  }
}
