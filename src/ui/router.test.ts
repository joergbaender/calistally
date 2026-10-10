import { describe, expect, it } from 'vitest';
import { parseRoute, Router, routeHash, startRoute, type Route, type RouterWindow } from './router';

/** Every route of the spec 4 §3 table, with its canonical hash. */
const TABLE: ReadonlyArray<readonly [string, Route]> = [
  ['#/log', { tab: 'log' }],
  ['#/days', { tab: 'days' }],
  ['#/days/abc', { tab: 'days', sessionId: 'abc' }],
  ['#/more', { tab: 'more' }],
  ['#/more/exercises', { tab: 'more', page: 'exercises' }],
  ['#/more/exercise/pull-up', { tab: 'more', page: 'exercise', id: 'pull-up' }],
  ['#/more/calendar', { tab: 'more', page: 'calendar' }],
  ['#/more/bodyweight', { tab: 'more', page: 'bodyweight' }],
  ['#/more/catalog', { tab: 'more', page: 'catalog' }],
  ['#/more/catalog/ring-dip', { tab: 'more', page: 'catalog', id: 'ring-dip' }],
  ['#/sync', { tab: 'sync' }],
];

interface FakeWindow extends RouterWindow {
  listeners: Array<() => void>;
  calls: Array<{ method: 'pushState' | 'replaceState'; url: string }>;
  fire(): void;
}

function fakeWindow(hash: string): FakeWindow {
  const win: FakeWindow = {
    location: { hash },
    listeners: [],
    calls: [],
    addEventListener(_type, fn) {
      win.listeners.push(fn);
    },
    removeEventListener(_type, fn) {
      win.listeners = win.listeners.filter((l) => l !== fn);
    },
    history: {
      pushState(_data, _unused, url) {
        win.location.hash = url;
        win.calls.push({ method: 'pushState', url });
      },
      replaceState(_data, _unused, url) {
        win.location.hash = url;
        win.calls.push({ method: 'replaceState', url });
      },
    },
    fire() {
      for (const l of [...win.listeners]) l();
    },
  };
  return win;
}

describe('parseRoute', () => {
  it.each(TABLE)('parses %s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it('sends an empty or bare hash to the Log tab', () => {
    expect(parseRoute('')).toEqual({ tab: 'log' });
    expect(parseRoute('#')).toEqual({ tab: 'log' });
    expect(parseRoute('#/')).toEqual({ tab: 'log' });
  });

  it('sends unknown hashes to the Log tab', () => {
    expect(parseRoute('#/nowhere')).toEqual({ tab: 'log' });
    expect(parseRoute('#/more/nowhere')).toEqual({ tab: 'log' });
    expect(parseRoute('#/more/exercises/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/more/calendar/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/days/abc/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/sync/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/log/extra')).toEqual({ tab: 'log' });
  });

  it('decodes an encoded id', () => {
    expect(parseRoute('#/more/exercise/a%20b')).toEqual({ tab: 'more', page: 'exercise', id: 'a b' });
  });

  it('never carries an id on pages that have none', () => {
    expect(parseRoute('#/more/exercises')).not.toHaveProperty('id');
    expect(parseRoute('#/days')).not.toHaveProperty('sessionId');
  });
});

describe('routeHash', () => {
  it.each(TABLE)('renders %s', (hash, route) => {
    expect(routeHash(route)).toBe(hash);
  });

  it.each(TABLE)('round-trips %s', (hash) => {
    expect(routeHash(parseRoute(hash))).toBe(hash);
  });

  it('encodes an id with reserved characters', () => {
    const route: Route = { tab: 'more', page: 'exercise', id: 'a b/c' };
    expect(parseRoute(routeHash(route))).toEqual(route);
  });
});

describe('startRoute', () => {
  const base = { afterOAuth: false, openSession: false, lastRoute: undefined, hasLocalData: true, connected: true };

  it('goes to Sync after the OAuth redirect, whatever else is set', () => {
    expect(startRoute({ ...base, afterOAuth: true, lastRoute: '#/days/abc' })).toEqual({ tab: 'sync' });
    expect(startRoute({ afterOAuth: true, openSession: false, lastRoute: undefined, hasLocalData: false, connected: false })).toEqual({ tab: 'sync' });
    expect(startRoute({ ...base, afterOAuth: true, openSession: true })).toEqual({ tab: 'sync' });
  });

  it('an open session wins over the last route (spec 4 §4 Resume: a reload or an app update lands on it)', () => {
    expect(startRoute({ ...base, openSession: true, lastRoute: '#/sync' })).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, openSession: true, lastRoute: '#/days/abc' })).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, openSession: true, hasLocalData: false, connected: false })).toEqual({ tab: 'log' });
  });

  it('resumes the last route when there is one', () => {
    expect(startRoute({ ...base, lastRoute: '#/days/abc' })).toEqual({ tab: 'days', sessionId: 'abc' });
    expect(startRoute({ ...base, lastRoute: '#/more/calendar', hasLocalData: false, connected: false })).toEqual({ tab: 'more', page: 'calendar' });
  });

  it('treats an unknown last route as Log', () => {
    expect(startRoute({ ...base, lastRoute: '#/nowhere' })).toEqual({ tab: 'log' });
  });

  it('goes to Sync with no local data and no connection', () => {
    expect(startRoute({ ...base, hasLocalData: false, connected: false })).toEqual({ tab: 'sync' });
  });

  it('goes to Log otherwise', () => {
    expect(startRoute(base)).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, hasLocalData: false, connected: true })).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, hasLocalData: true, connected: false })).toEqual({ tab: 'log' });
  });
});

describe('Router', () => {
  it('reflects the initial hash in the route signal', () => {
    const win = fakeWindow('#/days/abc');
    const router = new Router(win);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: 'abc' });
    router.dispose();
  });

  it('starts at Log for an empty hash', () => {
    const router = new Router(fakeWindow(''));
    expect(router.route.value).toEqual({ tab: 'log' });
    router.dispose();
  });

  it('navigate pushes a history entry and updates the signal', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    router.navigate({ tab: 'days', sessionId: 'abc' });
    expect(win.calls).toEqual([{ method: 'pushState', url: '#/days/abc' }]);
    expect(win.location.hash).toBe('#/days/abc');
    expect(router.route.value).toEqual({ tab: 'days', sessionId: 'abc' });
    router.dispose();
  });

  it('navigate with replace uses replaceState', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    router.navigate({ tab: 'sync' }, { replace: true });
    expect(win.calls).toEqual([{ method: 'replaceState', url: '#/sync' }]);
    expect(router.route.value).toEqual({ tab: 'sync' });
    router.dispose();
  });

  it('back goes to the tab root of the current route', () => {
    const win = fakeWindow('#/days/abc');
    const router = new Router(win);
    router.back();
    expect(router.route.value).toEqual({ tab: 'days' });
    expect(win.location.hash).toBe('#/days');

    router.navigate({ tab: 'more', page: 'exercise', id: 'x' });
    router.back();
    expect(router.route.value).toEqual({ tab: 'more' });
    expect(win.location.hash).toBe('#/more');
    expect(win.calls.at(-1)).toEqual({ method: 'pushState', url: '#/more' });
    router.dispose();
  });

  it('back at a tab root stays there without a history entry', () => {
    const win = fakeWindow('#/sync');
    const router = new Router(win);
    router.back();
    expect(router.route.value).toEqual({ tab: 'sync' });
    expect(win.location.hash).toBe('#/sync');
    expect(win.calls).toEqual([]);

    router.navigate({ tab: 'days' });
    router.back();
    expect(win.calls).toEqual([{ method: 'pushState', url: '#/days' }]);
    router.dispose();
  });

  it('follows a hashchange event from the window', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    expect(win.listeners).toHaveLength(1);
    win.location.hash = '#/more/bodyweight';
    win.fire();
    expect(router.route.value).toEqual({ tab: 'more', page: 'bodyweight' });
    expect(win.calls).toEqual([]);
    router.dispose();
  });

  it('dispose removes the listener so later events are ignored', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    router.dispose();
    expect(win.listeners).toHaveLength(0);
    win.location.hash = '#/sync';
    win.fire();
    expect(router.route.value).toEqual({ tab: 'log' });
  });
});
