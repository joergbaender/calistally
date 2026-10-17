// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile, timedSet } from '../../../model/test-fixtures';
import type { FileKind, Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor, restStop } from './log-state';
import { LogTab } from './LogTab';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/log' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const pathOf = (s: Session): string => sessionPath(s.date, s.id);

async function mount(sessions: Session[], meta: Record<string, unknown> = {}, clock: () => Date = () => NOW) {
  const db = await openDb(new IDBFactory());
  let data: Data | undefined;
  const store = new Store(db, { onChange: (p) => void data?.refresh(p) });
  const files: [FileKind, string, unknown][] = [['exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL])], ...sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)])];
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, NOW);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(meta)) await store.setMeta(key, value);
  data = new Data({ store, now: clock });
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
  const deps: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  const view = render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
  return { data, store, router: deps.router, view, deps };
}

async function sessionFiles(store: Store): Promise<SessionFile[]> {
  return (await store.sessions()).map((r) => r.file);
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  referenceLoadedFor.value = undefined;
  restStop.value = undefined;
  entryDraft.value = new Map();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** happy-dom has no window.confirm; the stub is undone after each test. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

async function fileOf(store: Store, s: Session): Promise<SessionFile> {
  return (await store.getRow(pathOf(s)))?.content as SessionFile;
}

// 2030-03-05 is a Tuesday.
const pastPush = (): Session =>
  session([block(ladder([8, 8], { completedAt: '2030-03-05T10:05:00.000Z' }), { exerciseId: 'dips-bar' }), block(ladder([17, 16, 15]), { exerciseId: 'push-ups', order: 1 })], {
    date: '2030-03-05',
    startedAt: '2030-03-05T10:00:00.000Z',
  });

describe('LogTab without an open session', () => {
  it('starts a session against the chosen reference: writes the file with startedAt and stores the choice', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const sheet = screen.getByRole('dialog', { name: 'Train against' });
    const row = within(sheet).getByRole('button', { name: /Tue 05 Mar/ });
    expect(row.textContent).toContain('Dips (Bar) · Push-ups');
    expect(row.textContent).toContain('proposed');
    fireEvent.click(row);

    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const started = (await sessionFiles(store)).find((f) => f.session.id !== past.id)?.session;
    expect(started?.startedAt).toBe(NOW.toISOString());
    expect(started?.date).toBe(localDate(NOW));
    expect(started?.blocks).toEqual([]);
    const id = started?.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe(past.id));
    // The open session now shows, with the reference in the header and its cards not started.
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card--not-started')).toHaveLength(2);
  });

  it('a double tap on a picker row starts one session', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const row = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: /Tue 05 Mar/ });
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('a double tap on No reference starts one session; the rows are disabled while it runs', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }) as HTMLButtonElement;
    fireEvent.click(none);
    await waitFor(() => expect(none.disabled).toBe(true));
    fireEvent.click(none);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('stores none for No reference', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.click(screen.getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const id = (await sessionFiles(store)).find((f) => f.session.startedAt === NOW.toISOString())?.session.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });
});

describe('LogTab with an open session', () => {
  function openToday(): Session {
    return session([block(ladder([8, 8], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'dips-bar' })], {
      date: '2030-03-07',
      startedAt: '2030-03-07T10:00:00.000Z',
    });
  }

  it('shows the cards; Start on a not-started card adds a block and makes it current', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    expect(dips.className).toContain('log-card--current');
    expect(within(dips).getByText('today 16 · 2 sets')).toBeTruthy();
    const push = screen.getByRole('article', { name: 'Push-ups' });
    expect(push.className).toContain('log-card--not-started');

    fireEvent.click(within(push).getByRole('button', { name: 'Start' }));
    await waitFor(async () => {
      const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
      expect(file.session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
    });
    const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
    const added = file.session.blocks[1];
    expect(added?.updatedAt).toBe(NOW.toISOString());
    expect(currentBlockId.value).toBe(added?.id);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
  });

  it("flags a block with an unknown exercise or a metric mismatch under its name, today's or, on a not-started card, the reference's", async () => {
    const past = session([block(ladder([5]), { exerciseId: 'gone' })], { date: '2030-03-05', startedAt: '2030-03-05T10:00:00.000Z' });
    const today = session(
      [
        block(ladder([5], { completedAt: '2030-03-07T10:05:00.000Z' }), { exerciseId: 'nope', order: 0 }),
        block([timedSet({ completedAt: '2030-03-07T10:10:00.000Z' })], { exerciseId: 'pull-ups', order: 1 }),
        block(ladder([8], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'dips-bar', order: 2 }),
      ],
      { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' },
    );
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'nope' })).toBeTruthy());
    const flagsOf = (name: string): string[] =>
      within(screen.getByRole('article', { name })).queryAllByText(/^(unknown exercise|metric mismatch)$/).map((e) => e.textContent ?? '');
    expect(flagsOf('nope')).toEqual(['unknown exercise']);
    expect(flagsOf('Pull-ups')).toEqual(['metric mismatch']);
    expect(flagsOf('Dips (Bar)')).toEqual([]);
    // The reference's block of an unknown exercise, not started today: the Sync tab lists it too.
    expect(flagsOf('gone')).toEqual(['unknown exercise']);
    // Under the name: after the heading, not inside it.
    const card = screen.getByRole('article', { name: 'nope' });
    const heading = within(card).getByRole('heading', { name: 'nope' });
    const flag = within(card).getByText('unknown exercise');
    expect(heading.contains(flag)).toBe(false);
    expect(heading.compareDocumentPosition(flag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a double tap on Start adds one block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    await new Promise((r) => setTimeout(r, 30));
    expect((await fileOf(store, today)).session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
  });

  it('Start stays held after its write until the refreshed row shows the block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const refresh = data.refresh.bind(data);
    const pending: (() => void)[] = [];
    vi.spyOn(data, 'refresh').mockImplementation((path: string) => new Promise<void>((resolve) => {
      pending.push(() => void refresh(path).then(resolve));
    }));
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    fireEvent.click(start);
    await waitFor(async () => expect((await fileOf(store, today)).session.blocks).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    await new Promise((r) => setTimeout(r, 20));
    expect((await fileOf(store, today)).session.blocks).toHaveLength(2);
    act(() => { for (const run of pending) run(); });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
  });

  it("the header's Details opens the session page of the open session", async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(router.route.value).toEqual({ tab: 'days', sessionId: today.id });
  });

  it('a double tap on a row of the change picker stores the choice once', async () => {
    const past = pastPush();
    const today = openToday();
    const { data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const setMeta = vi.spyOn(data, 'setMeta');
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' });
    fireEvent.click(none);
    fireEvent.click(none);
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(setMeta.mock.calls.filter(([key]) => key === `reference:${today.id}`)).toHaveLength(1);
  });

  it('tapping a finished card makes it current again', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    fireEvent.click(dips.querySelector('.log-card__body') as Element);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it('the finished card has a keyboard target: a focusable button that Enter or Space makes current', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const target = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / });
    expect(target.tabIndex).toBe(0);
    fireEvent.keyDown(target, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
    // The current card offers no make-current target.
    expect(within(screen.getByRole('article', { name: 'Dips (Bar)' })).queryByRole('button', { name: /^Make Dips \(Bar\) current/ })).toBeNull();
  });

  it('Space on the make-current target works as Enter does', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block(ladder([17], { completedAt: '2030-03-07T10:25:00.000Z' }), { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    fireEvent.keyDown(within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / }), { key: ' ' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it("a tap on a finished card's today chip opens the set sheet and does not make the card current", async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const chip = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getAllByRole('button', { name: '8' })[0] as HTMLElement;
    fireEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Set' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
    expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current');
  });

  it('renders no card before the stored reference is read, so the proposal never flashes', async () => {
    const past = pastPush();
    const today = openToday();
    const db = await openDb(new IDBFactory());
    const store = new Store(db);
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL]), NOW);
    for (const s of [past, today]) await store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    const data = new Data({ store, now: () => NOW });
    await data.load();
    // Only the reference read is held; the other meta keys (the rest stop) read as missing at once.
    let answer: (v: string) => void = () => {};
    vi.spyOn(data, 'getMeta').mockImplementation(<T,>(key: string) =>
      key.startsWith('reference:') ? new Promise<T | undefined>((resolve) => { answer = (v) => resolve(v as T); }) : Promise.resolve(undefined));
    const sync: SyncActions = {
      connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
      updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
    };
    const ui = {
      connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    };
    render(<AppContext.Provider value={{ data, router: new Router(fakeWindow()), sync, ui }}><LogTab /></AppContext.Provider>);
    await new Promise((r) => setTimeout(r, 10));
    // The proposal (Tue 05 Mar) would show the Push-ups card; nothing shows until the read finished.
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^vs / })).toBeNull();
    answer('none');
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(screen.queryByRole('article', { name: 'Push-ups' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy();
  });

  it('takes write times from data.clock(), not from the ticking now signal', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    // The screen re-renders with a later tick (the session stays open), so a handler that read
    // data.now at render time would write 10:31.
    act(() => { data.now.value = new Date(NOW.getTime() + 60_000); });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }));
    await waitFor(async () => expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks).toHaveLength(2));
    expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks[1]?.updatedAt).toBe(NOW.toISOString());
  });

  it('re-proposes when the stored reference is gone, and changing it writes only the meta key', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: 'deleted-session' });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await store.getMeta(`reference:${today.id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new asks first and writes nothing when declined', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    const confirm = answerConfirm(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^A session from \d\d:\d\d is still open\. Start a new one anyway\?$/);
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new, confirmed, writes a new session that takes over the screen', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(3));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });

  it('Done goes to the Days tab', async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(router.route.value).toEqual({ tab: 'days' });
  });

  describe('the rest counter', () => {
    // The time is part of the button's name (a screen reader never sees its text otherwise).
    const RUNNING = /^Rest \d+:\d\d since the last set, tap to stop$/;
    const STOPPED = /^Rest taken \d+:\d\d, tap to resume$/;
    const counter = (name: RegExp): HTMLElement => screen.getByRole('button', { name });
    // openToday's two dips sets completed at 10:20; the clock and the now signal start at 10:30.
    const AFTER = '2030-03-07T10:20:00.000Z';

    it('a tap stops it: the text no longer moves with now and meta holds the stop; a second tap continues from the frozen value', async () => {
      const today = openToday();
      let at = NOW;
      const { data, store } = await mount([today], {}, () => at);
      await waitFor(() => expect(counter(RUNNING).textContent).toBe('10:00'));
      // The stop takes its time from data.clock(), not from the last tick.
      at = new Date('2030-03-07T10:30:30.000Z');
      fireEvent.click(counter(RUNNING));
      await waitFor(() => expect(counter(STOPPED).textContent).toBe('10:30'));
      expect(counter(STOPPED).className).toContain('is-stopped');
      act(() => { data.now.value = new Date('2030-03-07T10:35:00.000Z'); });
      expect(counter(STOPPED).textContent).toBe('10:30');
      await waitFor(async () => expect(await store.getMeta(`restStop:${today.id}`)).toEqual({ after: AFTER, pausedMs: 0, stoppedAt: '2030-03-07T10:30:30.000Z' }));

      // Continued at 10:35: the 4:30 paused never counts, the counter goes on from 10:30.
      at = new Date('2030-03-07T10:35:00.000Z');
      fireEvent.click(counter(STOPPED));
      await waitFor(() => expect(counter(RUNNING).textContent).toBe('10:30'));
      expect(counter(RUNNING).className).not.toContain('is-stopped');
      act(() => { data.now.value = new Date('2030-03-07T10:36:00.000Z'); });
      expect(counter(RUNNING).textContent).toBe('11:30');
      await waitFor(async () => expect(await store.getMeta(`restStop:${today.id}`)).toEqual({ after: AFTER, pausedMs: 270000 }));
    });

    it('right after a continue the counter shows the frozen value, even while the now signal lags the clock', async () => {
      const today = openToday();
      let at = NOW;
      const { data } = await mount([today], {}, () => at);
      await waitFor(() => expect(counter(RUNNING).textContent).toBe('10:00'));
      at = new Date('2030-03-07T10:30:30.000Z');
      fireEvent.click(counter(RUNNING));
      await waitFor(() => expect(counter(STOPPED).textContent).toBe('10:30'));
      // The last tick was a second before the continue's clock reading.
      act(() => { data.now.value = new Date('2030-03-07T10:34:59.000Z'); });
      at = new Date('2030-03-07T10:35:00.000Z');
      fireEvent.click(counter(STOPPED));
      await waitFor(() => expect(counter(RUNNING)).toBeTruthy());
      expect(counter(RUNNING).textContent).toBe('10:30');
    });

    it('a remount after a continue still leaves the pause out', async () => {
      const today = openToday();
      let at = NOW;
      const { data, store, view, deps } = await mount([today], {}, () => at);
      await waitFor(() => expect(counter(RUNNING)).toBeTruthy());
      fireEvent.click(counter(RUNNING));
      await waitFor(() => expect(counter(STOPPED).textContent).toBe('10:00'));
      at = new Date('2030-03-07T10:32:00.000Z');
      fireEvent.click(counter(STOPPED));
      await waitFor(async () => expect(await store.getMeta(`restStop:${today.id}`)).toEqual({ after: AFTER, pausedMs: 120000 }));

      // A reload loses the module state; the paused time comes back from meta.
      view.unmount();
      referenceLoadedFor.value = undefined;
      referenceId.value = undefined;
      restStop.value = undefined;
      data.now.value = new Date('2030-03-07T10:33:00.000Z');
      render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
      // 13:00 since the set, less 2:00 paused.
      await waitFor(() => expect(counter(RUNNING).textContent).toBe('11:00'));
    });

    it('a stored stop of the earlier shape { after, at } shows frozen at `at`', async () => {
      const today = openToday();
      await mount([today], { [`restStop:${today.id}`]: { after: AFTER, at: '2030-03-07T10:25:00.000Z' } });
      await waitFor(() => expect(counter(STOPPED).textContent).toBe('5:00'));
    });

    it('Add set ends the stop: the counter runs from the new set', async () => {
      const today = openToday();
      let at = NOW;
      const { data, store } = await mount([today], {}, () => at);
      await waitFor(() => expect(counter(RUNNING)).toBeTruthy());
      fireEvent.click(counter(RUNNING));
      await waitFor(() => expect(counter(STOPPED).textContent).toBe('10:00'));
      at = new Date('2030-03-07T10:32:00.000Z');
      fireEvent.click(screen.getByRole('button', { name: 'Add set · 8' }));
      await waitFor(async () => expect((await fileOf(store, today)).session.blocks[0]?.sets).toHaveLength(3));
      act(() => { data.now.value = new Date('2030-03-07T10:33:00.000Z'); });
      await waitFor(() => expect(counter(RUNNING).textContent).toBe('1:00'));
    });

    it('names the time: running "Rest 10:00 since the last set, tap to stop", stopped "Rest taken 10:00, tap to resume"', async () => {
      await mount([openToday()]);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Rest 10:00 since the last set, tap to stop' })).toBeTruthy());
      fireEvent.click(counter(RUNNING));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Rest taken 10:00, tap to resume' })).toBeTruthy());
    });

    // A stored value of the wrong shape reads as running, like a failed read: the cards still render.
    it.each([
      ['null', null],
      ['a number', 7],
      ['a string', 'stopped'],
      ['an object with only after', { after: '2030-03-07T10:20:00.000Z' }],
      ['an object whose at is not a timestamp', { after: '2030-03-07T10:20:00.000Z', at: 'soon' }],
      ['an object whose after is not a timestamp', { after: 'later', at: '2030-03-07T10:30:00.000Z' }],
      ['an object with a non-string at', { after: '2030-03-07T10:20:00.000Z', at: 12 }],
      ['an object with a negative pausedMs', { after: '2030-03-07T10:20:00.000Z', pausedMs: -1 }],
      ['an object whose stoppedAt is not a timestamp', { after: '2030-03-07T10:20:00.000Z', pausedMs: 0, stoppedAt: 'soon' }],
    ])('a stored stop that is %s leaves the counter running', async (_name, stored) => {
      const today = openToday();
      await mount([today], { [`restStop:${today.id}`]: stored });
      await waitFor(() => expect(counter(RUNNING).textContent).toBe('10:00'));
      expect(document.querySelectorAll('.log-card')).toHaveLength(1);
      expect(document.querySelector('[aria-busy]')).toBeNull();
    });

    it('a remount shows the stop frozen: at once after a tab switch, from meta after a reload', async () => {
      const today = openToday();
      const { store, view, deps } = await mount([today]);
      await waitFor(() => expect(counter(RUNNING)).toBeTruthy());
      fireEvent.click(counter(RUNNING));
      await waitFor(async () => expect(await store.getMeta(`restStop:${today.id}`)).toEqual({ after: AFTER, pausedMs: 0, stoppedAt: NOW.toISOString() }));

      // A tab switch unmounts the Log tab; the module state keeps the stop.
      view.unmount();
      const again = render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
      expect(counter(STOPPED).textContent).toBe('10:00');

      // A reload (or a kill) loses the module state; the stop comes back from meta. Its read is held
      // here past the reference's: nothing renders until both are in, so it never shows running first.
      again.unmount();
      referenceLoadedFor.value = undefined;
      referenceId.value = undefined;
      restStop.value = undefined;
      const getMeta = deps.data.getMeta.bind(deps.data);
      let release: () => void = () => {};
      vi.spyOn(deps.data, 'getMeta').mockImplementation(<T,>(key: string) =>
        key.startsWith('restStop:') ? new Promise<T | undefined>((resolve) => { release = () => void getMeta<T>(key).then(resolve); }) : getMeta<T>(key));
      render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
      await new Promise((r) => setTimeout(r, 10));
      expect(document.querySelectorAll('.log-card')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: RUNNING })).toBeNull();
      act(() => release());
      await waitFor(() => expect(counter(STOPPED).textContent).toBe('10:00'));
    });
  });

  it('Done writes nothing: no file write, the queue unchanged (spec 4 U7)', async () => {
    const today = openToday();
    const { store } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    const queueBefore = await store.queue();
    const rowBefore = await store.getRow(pathOf(today));
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).not.toHaveBeenCalled();
    expect(await store.queue()).toEqual(queueBefore);
    expect(await store.getRow(pathOf(today))).toEqual(rowBefore);
  });
});
