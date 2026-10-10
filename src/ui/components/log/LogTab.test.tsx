// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { FileKind, Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor } from './log-state';
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

async function mount(sessions: Session[], meta: Record<string, unknown> = {}) {
  const db = await openDb(new IDBFactory());
  let data: Data | undefined;
  const store = new Store(db, { onChange: (p) => void data?.refresh(p) });
  const files: [FileKind, string, unknown][] = [['exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL])], ...sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)])];
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, NOW);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(meta)) await store.setMeta(key, value);
  data = new Data({ store, now: () => NOW });
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
  render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
  return { data, store, router: deps.router };
}

async function sessionFiles(store: Store): Promise<SessionFile[]> {
  return (await store.sessions()).map((r) => r.file);
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  referenceLoadedFor.value = undefined;
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
    let answer: (v: string) => void = () => {};
    vi.spyOn(data, 'getMeta').mockImplementation(<T,>() => new Promise<T | undefined>((resolve) => { answer = (v) => resolve(v as T); }));
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
