// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatDay } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { CalendarPage, INITIAL_MONTHS, MORE_MONTHS } from './CalendarPage';

// Wednesday; the week starts Monday 2030-03-11.
const NOW = new Date('2030-03-13T11:00:00.000Z');

const CATALOG = [
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }),
  exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
];

const on = (date: string, exerciseIds: string[], over: Partial<Session> = {}): Session =>
  session(exerciseIds.map((id, i) => block(ladder([5]), { exerciseId: id, order: i })), { date, ...over });

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/more/calendar' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

async function mount(sessions: Session[]) {
  const store = new Store(await openDb(new IDBFactory()));
  await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(CATALOG), NOW);
  for (const s of sessions) await store.writeFile('session', sessionPath(s.date, s.id), sessionFile(s), NOW);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow());
  const all: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={all}><CalendarPage /></AppContext.Provider>);
  return { data, router };
}

describe('CalendarPage', () => {
  /** The cells' accessible name carries the day, the count, the day types and the uncertain date. */
  const dayButton = (date: string, rest: string): HTMLElement => screen.getByRole('button', { name: `${formatDay(date)}, ${rest}` });
  const sessionsIn = (sheet: HTMLElement): HTMLElement[] => within(sheet).getAllByRole('button').filter((b) => b.textContent !== 'Cancel');

  it("shows the streak, months newest first with counts, and the day types and uncertain dates in each day's name", async () => {
    const a = on('2030-03-04', ['dips', 'pull-ups']);
    const b = on('2030-02-20', ['pull-ups'], { dateUncertain: true });
    await mount([a, b]);
    expect(screen.getByText('Streak: 1 week')).toBeTruthy();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['March 2030', 'February 2030']);
    for (const month of ['March 2030', 'February 2030']) {
      expect(within(screen.getByRole('region', { name: month })).getByText('1 session · 1 training day')).toBeTruthy();
    }
    expect(dayButton('2030-03-04', '1 session: push, pull')).toBeTruthy();
    expect(dayButton('2030-02-20', '1 session: pull; date uncertain')).toBeTruthy();
  });

  it('back goes to the More menu', async () => {
    const { router } = await mount([]);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.route.value).toEqual({ tab: 'more' });
  });

  it('a day with one session lists it in the sheet (spec 4 §6); tapping it opens its session page', async () => {
    const a = on('2030-03-04', ['dips']);
    const { router } = await mount([a]);
    fireEvent.click(dayButton('2030-03-04', '1 session: push'));
    expect(router.route.value).toEqual({ tab: 'more', page: 'calendar' });
    const items = sessionsIn(screen.getByRole('dialog', { name: formatDay('2030-03-04') }));
    expect(items).toHaveLength(1);
    fireEvent.click(items[0] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: a.id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the open session opens the Log tab', async () => {
    const open = on('2030-03-13', ['dips'], { startedAt: '2030-03-13T10:30:00.000Z' });
    const { router, data } = await mount([open]);
    expect(data.openSession.value?.file.session.id).toBe(open.id);
    fireEvent.click(dayButton('2030-03-13', '1 session: push'));
    fireEvent.click(sessionsIn(screen.getByRole('dialog', { name: formatDay('2030-03-13') }))[0] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'log' });
  });

  it('a day with several sessions lists them in a sheet; tapping one opens it', async () => {
    // Distinct first id segments: the session path carries the first eight characters of the id.
    const a = on('2030-03-04', ['dips'], { id: 'a1b2c3d4-0000-4000-8000-000000000001', startedAt: '2030-03-04T08:00:00.000Z' });
    const b = on('2030-03-04', ['pull-ups'], { id: 'b1b2c3d4-0000-4000-8000-000000000002', startedAt: '2030-03-04T18:00:00.000Z' });
    const { router } = await mount([a, b]);
    fireEvent.click(dayButton('2030-03-04', '2 sessions: push, pull'));
    const items = sessionsIn(screen.getByRole('dialog', { name: formatDay('2030-03-04') }));
    expect(items.map((el) => el.textContent)).toEqual([expect.stringMatching(/^Push · /), expect.stringMatching(/^Pull · /)]);
    fireEvent.click(items[1] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: b.id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('lazy months (spec 4 §6)', () => {
    afterEach(() => vi.unstubAllGlobals());

    // One session a month from March 2030 back to April 2029: 12 months.
    const yearOfSessions = (): Session[] =>
      Array.from({ length: 12 }, (_, i) => {
        const month = new Date(Date.UTC(2030, 2 - i, 4));
        return on(month.toISOString().slice(0, 10), ['dips']);
      });
    const monthTitles = (): (string | null)[] => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

    it('mounts the newest months first and the earlier ones on demand, until the first session', async () => {
      expect(INITIAL_MONTHS).toBeLessThan(12);
      await mount(yearOfSessions());
      expect(monthTitles()).toHaveLength(INITIAL_MONTHS);
      expect(monthTitles()[0]).toBe('March 2030');
      fireEvent.click(screen.getByRole('button', { name: 'Show earlier months' }));
      expect(monthTitles()).toHaveLength(Math.min(12, INITIAL_MONTHS + MORE_MONTHS));
      while (screen.queryByRole('button', { name: 'Show earlier months' }) !== null) {
        fireEvent.click(screen.getByRole('button', { name: 'Show earlier months' }));
      }
      expect(monthTitles()).toHaveLength(12);
      expect(monthTitles()[11]).toBe('April 2029');
    });

    it('mounts the next months by itself when the end of the list scrolls into view', async () => {
      let fire: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
      const observed: Element[] = [];
      class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { fire = cb; }
        observe(el: Element): void { observed.push(el); }
        disconnect(): void {}
      }
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      await mount(yearOfSessions());
      expect(observed.map((el) => el.textContent)).toContain('Show earlier months');
      await act(() => fire?.([{ isIntersecting: false }]));
      expect(monthTitles()).toHaveLength(INITIAL_MONTHS);
      await act(() => fire?.([{ isIntersecting: true }]));
      expect(monthTitles()).toHaveLength(Math.min(12, INITIAL_MONTHS + MORE_MONTHS));
    });

    it('a new session keeps the months shown so far', async () => {
      const { data } = await mount(yearOfSessions());
      fireEvent.click(screen.getByRole('button', { name: 'Show earlier months' }));
      const shown = monthTitles().length;
      const extra = on('2030-03-12', ['pull-ups']);
      await act(async () => {
        await data.create('session', sessionPath(extra.date, extra.id), sessionFile(extra));
        await data.refresh(sessionPath(extra.date, extra.id));
      });
      await waitFor(() => expect(dayButton('2030-03-12', '1 session: pull')).toBeTruthy());
      expect(monthTitles()).toHaveLength(shown);
    });
  });

  it('days without sessions are not buttons', async () => {
    await mount([on('2030-03-04', ['dips'])]);
    expect(screen.queryByRole('button', { name: new RegExp(formatDay('2030-03-05')) })).toBeNull();
  });
});
