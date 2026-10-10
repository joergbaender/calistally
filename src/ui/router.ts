/**
 * Hash routing (spec 4 §3 "Routing"): the route is a signal derived from
 * `location.hash`; navigation writes the hash through the History API so the
 * browser back button works; an unknown hash is the Log tab.
 */
import { signal, type Signal } from '@preact/signals';

export type MorePage = 'exercises' | 'exercise' | 'calendar' | 'bodyweight' | 'catalog';

export type Route =
  | { tab: 'log' }
  | { tab: 'days'; sessionId?: string }
  | { tab: 'more'; page?: MorePage; id?: string }
  | { tab: 'sync' };

const LOG: Route = { tab: 'log' };

/** More pages that stand alone, and those that may carry an id as a third segment. */
const MORE_PLAIN: ReadonlySet<string> = new Set<MorePage>(['exercises', 'calendar', 'bodyweight', 'catalog']);
const MORE_WITH_ID: ReadonlySet<string> = new Set<MorePage>(['exercise', 'catalog']);

function isMorePage(s: string): s is MorePage {
  return MORE_PLAIN.has(s) || MORE_WITH_ID.has(s);
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** '#/days/abc' → { tab: 'days', sessionId: 'abc' }; anything unknown → { tab: 'log' }. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter((p) => p.length > 0);
  const [tab, second, third, ...rest] = parts;
  if (rest.length > 0) return LOG;

  switch (tab) {
    case undefined:
    case 'log':
      return LOG; // '#/log/extra' is unknown, which is Log too
    case 'sync':
      return second === undefined ? { tab: 'sync' } : LOG;
    case 'days':
      if (third !== undefined) return LOG;
      return second === undefined ? { tab: 'days' } : { tab: 'days', sessionId: decode(second) };
    case 'more': {
      if (second === undefined) return { tab: 'more' };
      if (!isMorePage(second)) return LOG;
      if (third === undefined) return { tab: 'more', page: second };
      if (!MORE_WITH_ID.has(second)) return LOG;
      return { tab: 'more', page: second, id: decode(third) };
    }
    default:
      return LOG;
  }
}

/** The inverse of parseRoute: { tab: 'days', sessionId: 'abc' } → '#/days/abc'. */
export function routeHash(route: Route): string {
  switch (route.tab) {
    case 'log':
      return '#/log';
    case 'sync':
      return '#/sync';
    case 'days':
      return route.sessionId === undefined ? '#/days' : `#/days/${encodeURIComponent(route.sessionId)}`;
    case 'more': {
      if (route.page === undefined) return '#/more';
      const base = `#/more/${route.page}`;
      return route.id === undefined ? base : `${base}/${encodeURIComponent(route.id)}`;
    }
  }
}

/**
 * Where the app opens (spec 4 §3): Sync after the OAuth redirect; else Log while a session is
 * open (§4 Resume: a reload or an app update lands back on it); else the last route; else Sync
 * when there is neither local data nor a connection; else Log.
 */
export function startRoute(input: { afterOAuth: boolean; openSession: boolean; lastRoute: string | undefined; hasLocalData: boolean; connected: boolean }): Route {
  if (input.afterOAuth) return { tab: 'sync' };
  if (input.openSession) return LOG;
  if (input.lastRoute !== undefined) return parseRoute(input.lastRoute);
  if (!input.hasLocalData && !input.connected) return { tab: 'sync' };
  return LOG;
}

/** The slice of `window` the router needs, so tests can pass a plain object. */
export interface RouterWindow {
  location: { hash: string };
  addEventListener(type: 'hashchange', fn: () => void): void;
  removeEventListener(type: 'hashchange', fn: () => void): void;
  history: {
    replaceState(data: unknown, unused: string, url: string): void;
    pushState(data: unknown, unused: string, url: string): void;
  };
}

export class Router {
  readonly route: Signal<Route>;
  private readonly win: RouterWindow;
  private readonly onHashChange = (): void => {
    this.route.value = parseRoute(this.win.location.hash);
  };

  constructor(win: RouterWindow) {
    this.win = win;
    this.route = signal(parseRoute(win.location.hash));
    win.addEventListener('hashchange', this.onHashChange);
  }

  /** Writes the hash (pushState, or replaceState with `replace`) and updates the signal. */
  navigate(route: Route, opts?: { replace?: boolean }): void {
    const hash = routeHash(route);
    if (opts?.replace === true) this.win.history.replaceState(null, '', hash);
    else this.win.history.pushState(null, '', hash);
    this.route.value = route;
  }

  /** To the root of the current tab: '#/days/abc' → '#/days'. Already at a tab root: a no-op (no history entry). */
  back(): void {
    const root: Route = { tab: this.route.value.tab };
    if (routeHash(this.route.value) === routeHash(root)) return;
    this.navigate(root);
  }

  dispose(): void {
    this.win.removeEventListener('hashchange', this.onHashChange);
  }
}
