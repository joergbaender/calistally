// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store, type FileRow } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { toast } from '../../toast';
import { DaysTab } from './DaysTab';

const NOW = new Date('2030-03-09T11:00:00.000Z');

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/days' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const PULL = session([block(ladder([8, 8]), { exerciseId: 'pull-ups' })], { id: 'a1000000-0000-4000-8000-000000000001', date: '2030-03-04', dateUncertain: true, source: 'migrated' });
const PUSH = session([block(ladder([10]), { exerciseId: 'dips' })], { id: 'b2000000-0000-4000-8000-000000000002', date: '2030-03-07', label: 'push' });
const OPEN = session([], { id: 'c3000000-0000-4000-8000-000000000003', date: '2030-03-09', startedAt: '2030-03-09T10:30:00.000Z' });

function okRow(s: Session, version = 1): FileRow {
  return { path: sessionPath(s.date, s.id), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', issues: [], version };
}

async function setup(over: { refused?: FileRow[]; chip?: string; open?: Session } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  await store.saveRow({
    path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', status: 'ok', issues: [], version: 1,
    content: exercisesFile([exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }), exercise({ id: 'dips', name: 'Dips', pattern: 'push' })]),
  });
  for (const s of [PULL, PUSH, over.open ?? OPEN]) await store.saveRow(okRow(s));
  for (const r of over.refused ?? []) await store.saveRow(r);
  if (over.chip !== undefined) await store.setMeta('daysChip', over.chip);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(false), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow());
  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><DaysTab /></AppContext.Provider>);
  return { store, data, router };
}

const rowOf = (text: string): HTMLButtonElement => {
  const button = screen.getByText(text).closest('button');
  if (button === null) throw new Error(`no row for ${text}`);
  return button;
};

describe('DaysTab', () => {
  it('renders the rows newest first under a month header, with ?, label, exercises and open', async () => {
    await setup();
    expect(screen.getByText('March 2030').classList.contains('days__month')).toBe(true);
    const rows = Array.from(document.querySelectorAll('.days-row'));
    expect(rows.map((r) => r.querySelector('.days-row__day')?.textContent)).toEqual(['Sat 09 Mar', 'Thu 07 Mar', 'Mon 04 Mar?']);
    expect(rowOf('Thu 07 Mar').textContent).toContain('Push');
    expect(rowOf('Thu 07 Mar').textContent).toContain('Dips');
    expect(rowOf('Sat 09 Mar').textContent).toContain('open');
    expect(rowOf('Thu 07 Mar').textContent).not.toContain('open');
  });

  it('a chip tap filters by pattern and stores the chip in meta', async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(document.querySelectorAll('.days-row')).toHaveLength(1));
    expect(rowOf('Mon 04 Mar').textContent).toContain('Pull-ups');
    expect(screen.getByRole('button', { name: 'Pull' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(async () => expect(await store.getMeta('daysChip')).toBe('pull'));
  });

  it('loads the stored chip on mount and shows the empty text when nothing matches', async () => {
    await setup({ chip: 'legs' });
    await waitFor(() => expect(screen.getByText('No session matches this filter.')).toBeTruthy());
    expect(document.querySelectorAll('.days-row')).toHaveLength(0);
  });

  it('a row opens its session page; the open session goes to the Log tab', async () => {
    const { router } = await setup();
    fireEvent.click(rowOf('Thu 07 Mar'));
    expect(router.route.value).toEqual({ tab: 'days', sessionId: PUSH.id });
    fireEvent.click(rowOf('Sat 09 Mar'));
    expect(router.route.value).toEqual({ tab: 'log' });
  });

  it('lists a refused session with a lock and opens it like any other', async () => {
    const locked = session([block(ladder([5]), { exerciseId: 'dips' })], { id: 'd4000000-0000-4000-8000-000000000004', date: '2030-02-20' });
    const { router } = await setup({ refused: [{ ...okRow(locked), status: 'needs-update' }] });
    expect(screen.getByText('February 2030')).toBeTruthy();
    const row = rowOf('Wed 20 Feb');
    expect(row.querySelector('[aria-label="read-only"]')).toBeTruthy();
    expect(rowOf('Thu 07 Mar').querySelector('[aria-label="read-only"]')).toBeNull();
    fireEvent.click(row);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: locked.id });
  });

  it('does not list the loser of a duplicate pair: its ok twin is the one row, editable (spec 3 §6)', async () => {
    const twin = okRow(PUSH);
    await setup({ refused: [{ ...twin, path: sessionPath(PUSH.date, 'ffffffff-0000-4000-8000-00000000000f'), duplicateOf: twin.path }] });
    expect(document.querySelectorAll('.days-row')).toHaveLength(3);
    expect(rowOf('Thu 07 Mar').querySelector('[aria-label="read-only"]')).toBeNull();
  });

  it('does not list a refused row whose session id an ok row holds: its route would open the ok one', async () => {
    const other = { ...okRow({ ...PUSH, date: '2030-02-20' }), status: 'needs-update' as const };
    await setup({ refused: [other] });
    expect(document.querySelectorAll('.days-row')).toHaveLength(3);
    expect(document.querySelector('[aria-label="read-only"]')).toBeNull();
  });

  it('Add past session writes a session without startedAt and opens its page', async () => {
    const { store, router } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe(localDate(NOW));
    fireEvent.input(input, { target: { value: '2030-03-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.route.value).toMatchObject({ tab: 'days', sessionId: expect.any(String) }));
    const route = router.route.value;
    if (route.tab !== 'days' || route.sessionId === undefined) throw new Error('not on a session page');
    const row = await store.getRow(sessionPath('2030-03-02', route.sessionId));
    const file = row?.content as SessionFile;
    expect(file.session).toMatchObject({ id: route.sessionId, date: '2030-03-02', source: 'app', blocks: [], tags: [] });
    expect(file.session.startedAt).toBeUndefined();
    expect(file.session.updatedAt).toBe(NOW.toISOString());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Add past session shows the held-back toast and still opens the page', async () => {
    const { data, router } = await setup();
    vi.spyOn(data, 'create').mockResolvedValue({ ok: true, heldBack: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)'));
    expect(router.route.value).toMatchObject({ tab: 'days', sessionId: expect.any(String) });
  });

  it.each([
    ['quarantined', 'This file is read-only (quarantined)'],
    ['changed', 'Changed elsewhere, try again'],
  ] as const)('Add past session names a refused write (%s) with the shared toast text and keeps the sheet usable', async (reason, text) => {
    const { data, router } = await setup();
    vi.spyOn(data, 'create').mockResolvedValue({ ok: false, reason });
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe(text));
    expect(router.route.value).toEqual({ tab: 'days' });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Add past session ignores a second tap on Create while the first write runs', async () => {
    const { data, store } = await setup();
    const creates = vi.spyOn(data, 'create');
    const before = (await store.sessions()).length;
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    const create = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(creates).toHaveBeenCalledTimes(1);
    expect((await store.sessions()).length).toBe(before + 1);
  });

  it("the open session's marks are dimmed as provisional; a closed session's are not", async () => {
    const open = session([block(ladder([8], { completedAt: '2030-03-09T10:40:00.000Z' }), { exerciseId: 'dips' })], { id: OPEN.id, date: OPEN.date, startedAt: '2030-03-09T10:30:00.000Z' });
    await setup({ open });
    const openMarks = rowOf('Sat 09 Mar').querySelector('.marks');
    expect(openMarks?.classList.contains('is-provisional')).toBe(true);
    expect(openMarks?.querySelector('[aria-label="less"]')).toBeTruthy();
    expect(rowOf('Thu 07 Mar').querySelector('.marks')?.classList.contains('is-provisional')).toBe(false);
  });

  it('a malformed quarantined session (label 5, a number among the tags) stays off the list and breaks nothing', async () => {
    const bad = session([block(ladder([5]), { exerciseId: 'dips' })], { id: 'e5000000-0000-4000-8000-000000000005', date: '2030-02-21' });
    const raw = { schemaVersion: 1, session: { ...bad, label: 5, tags: [7] } };
    await setup({ refused: [{ ...okRow(bad), content: raw, status: 'quarantined' }] });
    expect(document.querySelectorAll('.days-row')).toHaveLength(3);
    expect(screen.queryByText('February 2030')).toBeNull();
  });

  it('Add past session survives a failing store: error toast, Create enabled again, no unhandled rejection', async () => {
    const { data, router } = await setup();
    vi.spyOn(data, 'create').mockRejectedValue(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe('Not saved: disk full'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(router.route.value).toEqual({ tab: 'days' });
  });

  it('Add past session refuses an invalid date with a toast and writes nothing', async () => {
    const { store } = await setup();
    const before = (await store.rows()).length;
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe('Pick a valid date.'));
    expect((await store.rows()).length).toBe(before);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
