import { describe, expect, it } from 'vitest';
import { DropboxHttpClient, contentHash, headerSafeJson, type TokenSource } from './dropbox-client';

interface Call { url: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null | undefined }

function harness(responses: (() => Response)[], tokens: Partial<TokenSource> = {}) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const rawBody = init?.body;
    const body = typeof rawBody === 'string' ? safeJson(rawBody) : rawBody instanceof Uint8Array ? new TextDecoder().decode(rawBody) : rawBody;
    calls.push({ url: String(url), headers, body, signal: init?.signal });
    const next = responses.shift();
    if (next === undefined) throw new TypeError('fetch failed');
    return next();
  };
  const source: TokenSource = {
    accessToken: tokens.accessToken ?? (async () => 'tok'),
    refresh: tokens.refresh ?? (async () => 'tok2'),
  };
  return { client: new DropboxHttpClient({ fetch: fetchImpl, tokens: source }), calls };
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const file = (path: string, rev: string) => ({ '.tag': 'file', name: path.split('/').pop(), path_lower: path, path_display: path, rev, size: 10 });

describe('headerSafeJson', () => {
  it('escapes every non-ASCII character', () => {
    expect(headerSafeJson({ path: '/Übung.json' })).toBe('{"path":"/\\u00dcbung.json"}');
  });
});

describe('contentHash', () => {
  it('is the hex SHA-256 of the block hashes (one block for small files)', async () => {
    const bytes = new TextEncoder().encode('abc');
    const inner = await crypto.subtle.digest('SHA-256', bytes);
    const outer = await crypto.subtle.digest('SHA-256', inner);
    const hex = [...new Uint8Array(outer)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await contentHash(bytes)).toBe(hex);
  });

  it('hashes an empty body without throwing', async () => {
    expect(await contentHash(new Uint8Array(0))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('DropboxHttpClient.listFolder', () => {
  it('lists the root recursively, follows has_more and maps the entries', async () => {
    const { client, calls } = harness([
      json(200, { entries: [file('/exercises.json', 'r1'), { '.tag': 'folder', path_lower: '/sessions' }], cursor: 'c1', has_more: true }),
      json(200, { entries: [{ '.tag': 'deleted', path_lower: '/old.json' }], cursor: 'c2', has_more: false }),
    ]);
    const r = await client.listFolder();
    expect(r).toEqual({ ok: true, value: { cursor: 'c2', entries: [
      { kind: 'file', path: '/exercises.json', rev: 'r1', size: 10 },
      { kind: 'folder', path: '/sessions' },
      { kind: 'deleted', path: '/old.json' },
    ] } });
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/2/files/list_folder', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: { path: '', recursive: true, limit: 2000, include_deleted: false } });
    expect(calls[1]).toMatchObject({ url: 'https://api.dropboxapi.com/2/files/list_folder/continue', body: { cursor: 'c1' } });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a reset cursor to cursor-reset', async () => {
    const { client } = harness([json(409, { error_summary: 'reset/..', error: { '.tag': 'reset' } })]);
    expect(await client.listFolderContinue('stale')).toMatchObject({ ok: false, error: 'cursor-reset' });
  });
});

describe('DropboxHttpClient.download', () => {
  it('sends the path in Dropbox-API-Arg and reads the rev from Dropbox-API-Result', async () => {
    const { client, calls } = harness([() => new Response('{"schemaVersion":1}', { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify({ rev: 'r9', path_lower: '/exercises.json' }) } })]);
    expect(await client.download('/exercises.json')).toEqual({ ok: true, value: { rev: 'r9', text: '{"schemaVersion":1}' } });
    expect(calls[0]).toMatchObject({ url: 'https://content.dropboxapi.com/2/files/download', headers: { 'Dropbox-API-Arg': '{"path":"/exercises.json"}' } });
    expect(calls[0]?.headers['Content-Type']).toBeUndefined();
  });

  it('maps not_found to missing', async () => {
    const { client } = harness([json(409, { error: { '.tag': 'path', path: { '.tag': 'not_found' } } })]);
    expect(await client.download('/x.json')).toMatchObject({ ok: false, error: 'missing' });
  });
});

describe('DropboxHttpClient.upload', () => {
  it('uploads with mode update, strict_conflict, mute and the content hash', async () => {
    const { client, calls } = harness([json(200, { rev: 'r2' })]);
    expect(await client.upload('/a.json', '{}', { rev: 'r1' })).toEqual({ ok: true, value: { rev: 'r2' } });
    const arg = JSON.parse(calls[0]?.headers['Dropbox-API-Arg'] as string) as Record<string, unknown>;
    expect(arg).toEqual({ path: '/a.json', mode: { '.tag': 'update', update: 'r1' }, autorename: false, mute: true, strict_conflict: true, content_hash: await contentHash(new TextEncoder().encode('{}')) });
    expect(calls[0]).toMatchObject({ url: 'https://content.dropboxapi.com/2/files/upload', headers: { 'Content-Type': 'application/octet-stream' }, body: '{}' });
  });

  it('uses mode add for a new file and maps path/conflict to conflict', async () => {
    const { client, calls } = harness([json(409, { error: { '.tag': 'path', path: { '.tag': 'conflict', conflict: { '.tag': 'file' } } } })]);
    expect(await client.upload('/a.json', '{}', { add: true })).toMatchObject({ ok: false, error: 'conflict' });
    expect((JSON.parse(calls[0]?.headers['Dropbox-API-Arg'] as string) as { mode: string }).mode).toBe('add');
  });
});

describe('DropboxHttpClient errors', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    let refreshed = 0;
    const { client, calls } = harness([json(401, { error: { '.tag': 'expired_access_token' } }), json(200, { cursor: 'c' })], { refresh: async () => { refreshed += 1; return 'tok2'; } });
    expect(await client.getLatestCursor()).toEqual({ ok: true, value: 'c' });
    expect(refreshed).toBe(1);
    expect(calls[1]?.headers['Authorization']).toBe('Bearer tok2');
  });

  it('is unauthorized when the retry fails again or the refresh throws', async () => {
    const a = harness([json(401, {}), json(401, {})]);
    expect(await a.client.getLatestCursor()).toMatchObject({ ok: false, error: 'unauthorized' });
    const b = harness([json(401, {})], { refresh: async () => { throw new Error('revoked'); } });
    expect(await b.client.getLatestCursor()).toMatchObject({ ok: false, error: 'unauthorized', message: 'revoked' });
    const c = harness([], { accessToken: async () => { throw new Error('not connected'); } });
    expect(await c.client.getLatestCursor()).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('maps 429 to rate-limited with Retry-After from the header, the body, or 1 s', async () => {
    const { client } = harness([
      json(429, { error: { '.tag': 'too_many_requests' } }, { 'Retry-After': '7' }),
      json(429, { error: { '.tag': 'too_many_write_operations', retry_after: 3 } }),
      json(429, {}),
    ]);
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'rate-limited', retryAfterMs: 7000 });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'rate-limited', retryAfterMs: 3000 });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'rate-limited', retryAfterMs: 1000 });
  });

  it('maps 5xx and network failures to offline, and anything else to other', async () => {
    const { client } = harness([json(503, {}), json(400, { error_summary: 'bad' })]);
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'offline' });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'other' });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'offline', message: 'fetch failed' });
  });

  it('revokes the token with a bare POST', async () => {
    const { client, calls } = harness([() => new Response('', { status: 200 })]);
    expect(await client.revokeToken()).toEqual({ ok: true, value: undefined });
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/2/auth/token/revoke', headers: { Authorization: 'Bearer tok' } });
  });
});
