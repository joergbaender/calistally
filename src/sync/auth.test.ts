import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Auth, AuthError, codeChallenge, PENDING_LOGIN_TTL_MS, randomString, type Tokens } from './auth';
import { openDb } from './db';

interface Call { url: string; init: RequestInit }

/** A fetch that records calls and answers from a queue of responses. */
function fakeFetch(responses: (() => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) throw new TypeError('no response queued');
    return next();
  };
  return { fetch: fetchImpl, calls };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CONFIG = { appKey: 'app-key', redirectUri: 'http://localhost:5173/' };
const NOW = new Date('2030-05-01T10:00:00.000Z');

async function setup(responses: (() => Response)[], now: Date = NOW) {
  const db = await openDb(new IDBFactory());
  const { fetch, calls } = fakeFetch(responses);
  let clock = now;
  const auth = new Auth(db, CONFIG, { fetch, now: () => clock, random: (n) => 'v'.repeat(n) });
  return { db, auth, calls, setClock: (d: Date) => { clock = d; } };
}

describe('PKCE helpers', () => {
  it('computes the RFC 7636 test vector', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('draws verifiers from the unreserved set at the requested length', () => {
    const v = randomString(64);
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(randomString(64)).not.toBe(v);
  });
});

describe('Auth.startLogin', () => {
  it('stores the pending login before returning the authorize URL', async () => {
    const { auth } = await setup([]);
    const url = new URL(await auth.startLogin());
    const pending = await auth.pendingLogin();
    expect(pending).toMatchObject({ verifier: 'v'.repeat(64), state: 'v'.repeat(32), mode: 'redirect', createdAt: NOW.toISOString() });
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'app-key',
      response_type: 'code',
      code_challenge: await codeChallenge('v'.repeat(64)),
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      state: 'v'.repeat(32),
      redirect_uri: 'http://localhost:5173/',
    });
  });

  it('omits the redirect_uri for a paste-the-code login', async () => {
    const { auth } = await setup([]);
    const url = new URL(await auth.startLogin('paste'));
    expect(url.searchParams.has('redirect_uri')).toBe(false);
    expect((await auth.pendingLogin())?.mode).toBe('paste');
  });
});

describe('Auth.resumePaste', () => {
  it('returns the same authorize URL for a stored paste login, until it expires', async () => {
    const { auth, setClock } = await setup([]);
    const url = await auth.startLogin('paste');
    expect(await auth.resumePaste()).toBe(url);
    setClock(new Date(NOW.getTime() + PENDING_LOGIN_TTL_MS));
    expect(await auth.resumePaste()).toBe(url);
    setClock(new Date(NOW.getTime() + PENDING_LOGIN_TTL_MS + 1));
    expect(await auth.resumePaste()).toBeUndefined();
  });

  it('returns nothing for a redirect login or no login', async () => {
    const { auth } = await setup([]);
    expect(await auth.resumePaste()).toBeUndefined();
    await auth.startLogin('redirect');
    expect(await auth.resumePaste()).toBeUndefined();
  });
});

describe('Auth.completeLogin', () => {
  const tokenResponse = json(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 14400, token_type: 'bearer' });

  it('exchanges the code with the verifier and stores the tokens', async () => {
    const { auth, calls } = await setup([tokenResponse]);
    await auth.startLogin();
    const tokens = await auth.completeLogin('the-code', 'v'.repeat(32));
    expect(tokens).toEqual({ refreshToken: 'rt1', accessToken: 'at1', expiresAt: '2030-05-01T14:00:00.000Z' });
    expect(await auth.tokens()).toEqual(tokens);
    expect(await auth.pendingLogin()).toBeUndefined();
    expect(calls[0]?.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)))).toEqual({
      grant_type: 'authorization_code', code: 'the-code', client_id: 'app-key', code_verifier: 'v'.repeat(64), redirect_uri: 'http://localhost:5173/',
    });
  });

  it('refuses a state that does not match', async () => {
    const { auth, calls } = await setup([tokenResponse]);
    await auth.startLogin();
    await expect(auth.completeLogin('the-code', 'other')).rejects.toMatchObject({ code: 'state-mismatch' });
    expect(calls).toHaveLength(0);
  });

  it('refuses without a pending login, and after 10 minutes', async () => {
    const { auth, setClock } = await setup([tokenResponse]);
    await expect(auth.completeLogin('c', 's')).rejects.toMatchObject({ code: 'no-pending-login' });
    await auth.startLogin();
    setClock(new Date('2030-05-01T10:10:01.000Z'));
    await expect(auth.completeLogin('c', 'v'.repeat(32))).rejects.toMatchObject({ code: 'login-expired' });
    expect(await auth.pendingLogin()).toBeUndefined();
  });

  it('does not check state and sends no redirect_uri for a pasted code', async () => {
    const { auth, calls } = await setup([tokenResponse]);
    await auth.startLogin('paste');
    await auth.completeLogin('pasted');
    const body = Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)));
    expect(body['redirect_uri']).toBeUndefined();
    expect(body['code_verifier']).toBe('v'.repeat(64));
  });

  it('reports a rejected code as unauthorized and a server error as network', async () => {
    const { auth } = await setup([json(400, { error: 'invalid_grant' }), json(500, {})]);
    await auth.startLogin();
    await expect(auth.completeLogin('bad', 'v'.repeat(32))).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(auth.completeLogin('bad', 'v'.repeat(32))).rejects.toMatchObject({ code: 'network' });
  });

  it('refuses an incomplete token response and stores nothing', async () => {
    const { auth, db } = await setup([json(200, { access_token: 'at1', token_type: 'bearer' })]);
    await auth.startLogin();
    await expect(auth.completeLogin('the-code', 'v'.repeat(32))).rejects.toMatchObject({ code: 'unauthorized', message: 'unexpected token response from Dropbox' });
    expect(await auth.tokens()).toBeUndefined();
  });
});

describe('Auth.accessToken and refresh', () => {
  const stored: Tokens = { refreshToken: 'rt', accessToken: 'at-old', expiresAt: '2030-05-01T14:00:00.000Z' };

  it('returns the stored token while it is fresh', async () => {
    const { auth, db, calls } = await setup([]);
    await db.setValue('auth', 'tokens', stored);
    expect(await auth.accessToken()).toBe('at-old');
    expect(calls).toHaveLength(0);
  });

  it('refreshes within 5 minutes of expiry, with the refresh token and no secret', async () => {
    const { auth, db, calls, setClock } = await setup([json(200, { access_token: 'at-new', expires_in: 14400 })]);
    await db.setValue('auth', 'tokens', stored);
    setClock(new Date('2030-05-01T13:56:00.000Z'));
    expect(await auth.accessToken()).toBe('at-new');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)))).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'app-key' });
    expect(await auth.tokens()).toEqual({ refreshToken: 'rt', accessToken: 'at-new', expiresAt: '2030-05-01T17:56:00.000Z' });
  });

  it('shares one in-flight refresh between parallel callers', async () => {
    const { auth, db, calls } = await setup([json(200, { access_token: 'at-new', expires_in: 14400 })]);
    await db.setValue('auth', 'tokens', stored);
    const [a, b] = await Promise.all([auth.refresh(), auth.refresh()]);
    expect([a, b]).toEqual(['at-new', 'at-new']);
    expect(calls).toHaveLength(1);
  });

  it('is unauthorized when not connected or when Dropbox rejects the refresh token', async () => {
    const { auth, db } = await setup([json(401, { error: 'invalid_grant' })]);
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'unauthorized' });
    await db.setValue('auth', 'tokens', stored);
    await expect(auth.refresh()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('Auth.signOut', () => {
  it('revokes at Dropbox with the access token and forgets the tokens', async () => {
    const { auth, db, calls } = await setup([() => new Response('', { status: 200 })]);
    await db.setValue('auth', 'tokens', { refreshToken: 'rt', accessToken: 'at', expiresAt: '2030-05-01T14:00:00.000Z' });
    await auth.signOut();
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/2/auth/token/revoke', init: { method: 'POST', headers: { Authorization: 'Bearer at' } } });
    expect(await auth.tokens()).toBeUndefined();
  });

  it('forgets the tokens even when the revoke call fails', async () => {
    const { auth, db } = await setup([]);
    await db.setValue('auth', 'tokens', { refreshToken: 'rt', accessToken: 'at', expiresAt: '2030-05-01T14:00:00.000Z' });
    await auth.signOut();
    expect(await auth.isConnected()).toBe(false);
  });

  it('leaves no tokens when signOut runs during a pending refresh', async () => {
    let resolveTokenResponse: (res: Response) => void;
    const tokenPromise = new Promise<Response>((resolve) => { resolveTokenResponse = resolve; });
    const { auth, db, calls } = await setup([
      () => tokenPromise as any,
      () => new Response('', { status: 200 }),
    ]);
    // Store FRESH tokens (well beyond the 5-minute refresh margin)
    await db.setValue('auth', 'tokens', { refreshToken: 'rt', accessToken: 'at-fresh', expiresAt: '2030-05-01T11:00:00.000Z' });
    // Start a forced refresh (after a 401); this will await the held response
    const refreshPromise = auth.refresh();
    // Meanwhile, signOut revokes with the fresh token (no refresh triggered) and deletes tokens
    await auth.signOut();
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/oauth2/token' });
    expect(calls[1]).toMatchObject({ url: 'https://api.dropboxapi.com/2/auth/token/revoke' });
    expect(await auth.tokens()).toBeUndefined();
    // Now resolve the held token response; the refresh should fail because tokens are gone
    resolveTokenResponse!(json(200, { access_token: 'at-new', expires_in: 14400 })());
    await expect(refreshPromise).rejects.toMatchObject({ code: 'unauthorized', message: 'signed out' });
  });

  it('revokes with a fresh access token on sign out with an expired token', async () => {
    const { auth, db, calls } = await setup([
      json(200, { access_token: 'at-fresh', expires_in: 14400 }),
      () => new Response('', { status: 200 }),
    ]);
    await db.setValue('auth', 'tokens', { refreshToken: 'rt', accessToken: 'at-stale', expiresAt: '2030-05-01T09:00:00.000Z' });
    await auth.signOut();
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/oauth2/token' });
    expect(calls[1]).toMatchObject({ url: 'https://api.dropboxapi.com/2/auth/token/revoke', init: { method: 'POST', headers: { Authorization: 'Bearer at-fresh' } } });
    expect(await auth.isConnected()).toBe(false);
  });
});
