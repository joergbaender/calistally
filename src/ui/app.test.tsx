// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../sync/db';
import { block, ladder, session, sessionFile } from '../model/test-fixtures';
import { sessionPath } from '../sync/paths';
import type { Issue } from '../sync/store';
import { Store } from '../sync/store';
import { App } from './app';
import { AppContext, type AppDeps, type SyncActions } from './context';
import { Data } from './data';
import { Router, type RouterWindow } from './router';

function fakeWindow(hash: string): RouterWindow {
  const win: RouterWindow = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

async function mount(over: { hash?: string; connected?: boolean; issues?: Issue[]; before?: (store: Store) => Promise<void> } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  await over.before?.(store);
  const data = new Data({ store });
  await data.load();
  if (over.issues !== undefined) data.issues.value = over.issues;
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const router = new Router(fakeWindow(over.hash ?? '#/log'));
  const deps: AppDeps = {
    data, router, sync,
    ui: {
      connected: signal(over.connected ?? true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    },
  };
  render(<AppContext.Provider value={deps}><App /></AppContext.Provider>);
  return deps;
}

const heading = () => document.querySelector('main h2')?.textContent;

describe('App', () => {
  it('renders the screen of the current route and switches with the router', async () => {
    const { router } = await mount();
    act(() => { router.navigate({ tab: 'more' }); });
    expect(heading()).toBe('More');
    act(() => { router.navigate({ tab: 'sync' }); });
    expect(document.querySelector('.sync')).toBeTruthy();
  });

  it('tab buttons navigate and mark the active tab', async () => {
    const { router } = await mount();
    const tabs = screen.getAllByRole('button', { name: /^(Log|Days|More|Sync)$/ });
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(true);
    act(() => { screen.getByRole('button', { name: 'Days' }).click(); });
    expect(router.route.value).toEqual({ tab: 'days' });
    expect(screen.getByRole('button', { name: 'Days' }).classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(false);
  });

  it('shows 3 on the Sync tab for three issues', async () => {
    await mount({
      issues: [
        { path: 'a.json', reason: 'quarantined', detail: 'x' },
        { path: 'b.json', reason: 'duplicate', detail: 'y' },
        { path: 'c.txt', reason: 'unexpected-file', detail: 'z' },
      ],
    });
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('3');
    expect(document.querySelector('.tabbar__dot')).toBeNull();
  });

  it('counts a held-back write once, though the store lists it as an issue too', async () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    // 30 February fails a hard rule: the write stays local and queued, held back (spec 3 §5).
    const bad = sessionFile({ ...s, date: '2030-02-30' });
    const { data } = await mount({
      before: async (store) => {
        expect(await store.writeFile('session', sessionPath(s.date, s.id), bad, new Date('2030-03-04T11:00:00.000Z'))).toMatchObject({ ok: true, heldBack: expect.any(Array) });
      },
    });
    expect(data.issues.value.map((i) => i.reason)).toEqual(['held-back']);
    expect(data.heldBackCount.value).toBe(1);
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('1');
  });

  it('shows a dot when disconnected without issues, nothing when connected and clean', async () => {
    const { ui } = await mount({ connected: false });
    expect(document.querySelector('.tabbar__dot')).toBeTruthy();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
    act(() => { ui.connected.value = true; });
    expect(document.querySelector('.tabbar__dot')).toBeNull();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
  });
});
