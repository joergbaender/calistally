import type { Db } from './db';

/** OAuth 2 authorization code with PKCE and a refresh token (spec 3 §3). */

export interface AuthConfig {
  appKey: string;
  /** The page's own base URL, registered in the App Console. */
  redirectUri: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
}

export interface Tokens {
  refreshToken: string;
  accessToken: string;
  /** ISO timestamp. */
  expiresAt: string;
}

export interface PendingLogin {
  verifier: string;
  state: string;
  mode: 'redirect' | 'paste';
  createdAt: string;
}

export type AuthErrorCode = 'unauthorized' | 'state-mismatch' | 'no-pending-login' | 'login-expired' | 'network';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string = code) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthDeps {
  fetch: typeof fetch;
  now?: () => Date;
  /** Random unreserved characters; replaced in tests. */
  random?: (length: number) => string;
}

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
export const VERIFIER_LENGTH = 64;
export const STATE_LENGTH = 32;
export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** `length` characters from the RFC 7636 unreserved set, from crypto.getRandomValues. */
export function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += UNRESERVED[b % UNRESERVED.length];
  return out;
}

export function base64Url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export class Auth {
  private readonly now: () => Date;
  private readonly random: (length: number) => string;
  private inflightRefresh: Promise<string> | undefined;

  constructor(private readonly db: Db, private readonly config: AuthConfig, private readonly deps: AuthDeps) {
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? randomString;
  }

  /** Stores the pending login (awaited) and returns the URL to navigate to. */
  async startLogin(mode: 'redirect' | 'paste' = 'redirect'): Promise<string> {
    const pending: PendingLogin = { verifier: this.random(VERIFIER_LENGTH), state: this.random(STATE_LENGTH), mode, createdAt: this.now().toISOString() };
    await this.db.setValue('auth', 'pending-login', pending);
    const url = new URL(this.config.authorizeUrl ?? AUTHORIZE_URL);
    url.searchParams.set('client_id', this.config.appKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', await codeChallenge(pending.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('state', pending.state);
    if (mode === 'redirect') url.searchParams.set('redirect_uri', this.config.redirectUri);
    return url.toString();
  }

  pendingLogin(): Promise<PendingLogin | undefined> {
    return this.db.getValue<PendingLogin>('auth', 'pending-login');
  }

  /** Exchanges the code. `state` is checked for redirect logins; a pasted code carries none. */
  async completeLogin(code: string, state?: string): Promise<Tokens> {
    const pending = await this.pendingLogin();
    if (pending === undefined) throw new AuthError('no-pending-login', 'no login in progress');
    if (this.now().getTime() - Date.parse(pending.createdAt) > PENDING_LOGIN_TTL_MS) {
      await this.db.delete('auth', 'pending-login');
      throw new AuthError('login-expired', 'the login took longer than 10 minutes; start again');
    }
    if (pending.mode === 'redirect' && state !== pending.state) throw new AuthError('state-mismatch', 'the redirect did not match the login that was started');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: this.config.appKey, code_verifier: pending.verifier });
    if (pending.mode === 'redirect') body.set('redirect_uri', this.config.redirectUri);
    const json = await this.tokenRequest(body);
    const tokens: Tokens = {
      refreshToken: String(json['refresh_token']),
      accessToken: String(json['access_token']),
      expiresAt: this.expiry(json['expires_in']),
    };
    await this.db.tx(['auth'], 'readwrite', async (t) => {
      await t.put('auth', { key: 'tokens', value: tokens });
      await t.delete('auth', 'pending-login');
    });
    return tokens;
  }

  tokens(): Promise<Tokens | undefined> {
    return this.db.getValue<Tokens>('auth', 'tokens');
  }

  async isConnected(): Promise<boolean> {
    return (await this.tokens()) !== undefined;
  }

  /** A valid access token; refreshes when within 5 minutes of expiry. */
  async accessToken(): Promise<string> {
    const t = await this.tokens();
    if (t === undefined) throw new AuthError('unauthorized', 'not connected');
    if (Date.parse(t.expiresAt) - this.now().getTime() > REFRESH_MARGIN_MS) return t.accessToken;
    return this.refresh();
  }

  /** Forces a refresh (after a 401). Parallel callers share one request. */
  refresh(): Promise<string> {
    if (this.inflightRefresh === undefined) {
      this.inflightRefresh = this.doRefresh().finally(() => { this.inflightRefresh = undefined; });
    }
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<string> {
    const t = await this.tokens();
    if (t === undefined) throw new AuthError('unauthorized', 'not connected');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: this.config.appKey });
    const json = await this.tokenRequest(body);
    const next: Tokens = { ...t, accessToken: String(json['access_token']), expiresAt: this.expiry(json['expires_in']) };
    await this.db.setValue('auth', 'tokens', next);
    return next.accessToken;
  }

  /** Revokes the refresh token at Dropbox and forgets it locally. The caller clears the data stores. */
  async signOut(): Promise<void> {
    const t = await this.tokens();
    if (t !== undefined) {
      try {
        await this.deps.fetch(this.config.revokeUrl ?? REVOKE_URL, { method: 'POST', headers: { Authorization: `Bearer ${t.accessToken}` } });
      } catch {
        // Offline: the token stays valid at Dropbox until the owner unlinks the app; local state is cleared anyway.
      }
    }
    await this.db.delete('auth', 'tokens');
    await this.db.delete('auth', 'pending-login');
  }

  private async tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.deps.fetch(this.config.tokenUrl ?? TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      throw new AuthError('network', e instanceof Error ? e.message : 'network error');
    }
    if (res.status === 400 || res.status === 401) {
      const text = await res.text();
      throw new AuthError('unauthorized', `Dropbox rejected the token request (${res.status}): ${text}`);
    }
    if (!res.ok) throw new AuthError('network', `token endpoint returned ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  private expiry(expiresIn: unknown): string {
    const seconds = typeof expiresIn === 'number' ? expiresIn : 14400;
    return new Date(this.now().getTime() + seconds * 1000).toISOString();
  }
}
