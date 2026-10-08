/** Public configuration (spec 3 §3). The app key is not a secret: PKCE replaces the client secret. */

declare const __BUILD_ID__: string;

/** From the Dropbox App Console once the app exists (spec 3 §17). */
export const DROPBOX_APP_KEY = 'sdyp6j5t67hgf0n';

/** '/calistally/' on GitHub Pages, '/' in dev (vite.config.ts). */
export const BASE_URL: string = import.meta.env.BASE_URL;

/** The exact redirect URI registered in the App Console: the page's own base URL. */
export function redirectUri(): string {
  return new URL(BASE_URL, window.location.origin).toString();
}

/** Short commit hash and build time, injected by Vite. */
export const BUILD_ID: string = __BUILD_ID__;
