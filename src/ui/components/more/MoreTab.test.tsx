// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatAmount, formatDay } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { MoreTab } from './MoreTab';

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

const older = session([block(ladder([5, 4]), { exerciseId: 'pull-ups' })], { date: '2030-03-01' });
const newer = session([block(ladder([8, 7]), { exerciseId: 'pull-ups' }), block(ladder([3]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-04' });

async function mount(hash: string, sessions: Session[] = [older, newer]) {
  const store = new Store(await openDb(new IDBFactory()));
  const data = new Data({ store, now: () => new Date('2030-03-05T10:00:00.000Z') });
  await data.load();
  await data.create('exercises', EXERCISES_PATH, exercisesFile([
    exercise({ id: 'pull-ups', name: 'Pull-ups', family: 'Pull-up' }),
    exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
    exercise({ id: 'rows', name: 'Rows', archived: true }),
  ]));
  for (const s of sessions) await data.create('session', sessionPath(s.date, s.id), sessionFile(s));
  await data.refresh(EXERCISES_PATH);
  for (const s of sessions) await data.refresh(sessionPath(s.date, s.id));
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow(hash));
  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><MoreTab /></AppContext.Provider>);
  return { data, router };
}

describe('MoreTab', () => {
  it('shows the menu and each entry navigates to its page', async () => {
    const { router } = await mount('#/more');
    for (const [label, page] of [['Exercises', 'exercises'], ['Calendar', 'calendar'], ['Bodyweight', 'bodyweight'], ['Catalog', 'catalog']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(router.route.value).toEqual({ tab: 'more', page });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(router.route.value).toEqual({ tab: 'more' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Exercises' })).toBeTruthy());
    }
  });

  it('the catalog route with an id shows the exercise edit page', async () => {
    await mount('#/more/catalog/pull-ups');
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Pull-ups');
  });

  it('the exercise route without an id shows the exercise list', async () => {
    await mount('#/more/exercise');
    expect(screen.getByRole('button', { name: /Pull-ups/ }).textContent).toContain(formatDay('2030-03-04'));
  });

  it('lists exercises by family with the last date, archived ones apart, and opens the history', async () => {
    const { router } = await mount('#/more/exercises');
    expect(screen.getByText('Pull-up')).toBeTruthy();
    const pullUps = screen.getByRole('button', { name: /Pull-ups/ });
    expect(pullUps.textContent).toContain(formatDay('2030-03-04'));
    const archived = screen.getByText('Archived').closest('details');
    expect(archived?.open).toBe(false);
    expect(archived?.textContent).toContain('Rows');
    fireEvent.click(pullUps);
    expect(router.route.value).toEqual({ tab: 'more', page: 'exercise', id: 'pull-ups' });
  });

  it('lists the history rows of an exercise, and a row opens its session', async () => {
    const { router } = await mount('#/more/exercise/pull-ups');
    expect(screen.getByRole('heading', { name: 'Pull-ups' })).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /sets/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(formatDay('2030-03-04'));
    expect(rows[0]?.textContent).toContain(`${formatAmount(15)} · 2 sets`);
    expect(rows[0]?.querySelector('[aria-label="more"]')).toBeTruthy();
    fireEvent.click(rows[1] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: older.id });
  });

  it('numbers a second run in one session', async () => {
    const twice = session([block(ladder([6]), { exerciseId: 'pull-ups' }), block(ladder([4]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-02' });
    await mount('#/more/exercise/pull-ups', [twice]);
    expect(screen.getByText('run 2')).toBeTruthy();
    expect(screen.queryByText('run 1')).toBeNull();
  });
});
