// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSessionFields } from '../../../model/edit';
import { block, exercise, ladder, session, set, sessionFile, T0 } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatAmount, formatDayLong } from '../../format';
import { dismissToast, toast } from '../../toast';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';
import { justCreated } from './PastSessionSheet';
import { SessionPage } from './SessionPage';

const NOW = new Date('2030-03-09T12:00:00.000Z');
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const ROWS = exercise({ id: 'australian-pull-ups', name: 'Australians', pattern: 'pull' });

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  justCreated.value = undefined;
});

const threeBlocks = (over: Partial<Session> = {}): Session =>
  session(
    [
      block(ladder([8, 7], { completedAt: '2030-03-07T10:05:00.000Z' }), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([12]), { exerciseId: 'dips-bar', order: 1 }),
      block(ladder([15]), { exerciseId: 'australian-pull-ups', order: 2 }),
    ],
    { date: '2030-03-07', tags: ['deload'], ...over },
  );

async function mount(s: Session, others: Session[] = [], opts: { staleNow?: Date } = {}) {
  const m = await setup({ now: NOW, sessions: [...others, s], exercises: [PULL, DIPS, ROWS] });
  // A `now` signal away from the clock from the first render on: a handler or a render that read it shows it.
  if (opts.staleNow !== undefined) m.data.now.value = opts.staleNow;
  renderIn(m.deps, <SessionPage sessionId={s.id} />);
  return m;
}

const article = (name: string): HTMLElement => screen.getByRole('article', { name });

/** happy-dom has no window.confirm; the page calls it before Delete session. Undone in afterEach. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

/** A 'now' far from the clock: a write that took its time from the ticking signal would show it. */
const STALE_NOW = new Date('2030-03-01T00:00:00.000Z');

describe('SessionPage', () => {
  it('renders the header and the blocks in canonical order', async () => {
    const s = threeBlocks({ notes: 'felt strong', label: 'pull' });
    await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('heading', { name: formatDayLong('2030-03-07') })).toBeTruthy();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Pull-ups', 'Dips (Bar)', 'Australians']);
    expect(within(article('Pull-ups')).getByText(`${formatAmount(15)} · 2 sets`)).toBeTruthy();
    expect(within(article('Pull-ups')).getByRole('button', { name: '8' })).toBeTruthy();
    expect(screen.getByText('felt strong')).toBeTruthy();
    // Display text through formatLabel, as on the Days list.
    expect(screen.getByText('Pull')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag deload' })).toBeTruthy();
  });

  it('the exercise name opens its history', async () => {
    const s = threeBlocks();
    const { deps } = await mount(s);
    await waitFor(() => expect(article('Dips (Bar)')).toBeTruthy());
    fireEvent.click(within(article('Dips (Bar)')).getByRole('button', { name: 'Dips (Bar)' }));
    expect(deps.router.route.value).toEqual({ tab: 'more', page: 'exercise', id: 'dips-bar' });
  });

  it('Add set writes a set without completedAt', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Add set' }));
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets).toHaveLength(3));
    const added = (await fileAt(store, pathOf(s))).session.blocks[0]?.sets[2];
    expect(added).toMatchObject({ reps: 7, loadType: 'bodyweight', updatedAt: NOW.toISOString() });
    expect(added?.completedAt).toBeUndefined();
    await waitFor(() => expect(within(article('Pull-ups')).getByText(`${formatAmount(22)} · 3 sets`)).toBeTruthy());
  });

  it('Move down gives the block a midpoint order and touches only that block', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Block options' }));
    const sheet = screen.getByRole('dialog', { name: 'Pull-ups' });
    expect((within(sheet).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).queryByRole('button', { name: 'Make current' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move down' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.order).toBe(1.5));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.blocks[0]?.updatedAt).toBe(NOW.toISOString());
    expect(after.blocks.slice(1).map((b) => [b.order, b.updatedAt])).toEqual([[1, T0], [2, T0]]);
    expect(after.updatedAt).toBe(T0);
    await waitFor(() => expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Dips (Bar)', 'Pull-ups', 'Australians']));
  });

  it('Delete session tombstones the session only, goes to Days, and Undo restores it', async () => {
    const s = threeBlocks();
    const { store, deps } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    answerConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBe(NOW.toISOString()));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.blocks.every((b) => b.deletedAt === undefined && b.sets.every((x) => x.deletedAt === undefined))).toBe(true);
    expect(deps.router.route.value).toEqual({ tab: 'days' });
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
  });

  it('Delete session ignores a second tap while the first write runs: one tombstone write', async () => {
    const s = threeBlocks();
    const { store, deps } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const asked = answerConfirm(true);
    const writes = vi.spyOn(store, 'writeFile');
    const del = screen.getByRole('button', { name: 'Delete session' });
    fireEvent.click(del);
    fireEvent.click(del);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBe(NOW.toISOString()));
    await waitFor(() => expect(deps.router.route.value).toEqual({ tab: 'days' }));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a cancelled confirm deletes nothing', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const asked = answerConfirm(false);
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
  });

  it('a tombstoned session shows Deleted with Undo', async () => {
    const s = threeBlocks({ deletedAt: '2030-03-08T10:00:00.000Z' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Add block' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy());
  });

  it('a refused row renders read-only with a banner and no edit controls', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.data.refresh(pathOf(s));
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/newer app/);
    expect(screen.getByRole('link', { name: 'Sync tab' }).getAttribute('href')).toBe('#/sync');
    for (const name of ['Edit', 'Add set', 'Add block', 'Block options', 'Delete session', 'Remove tag deload', 'Add tag', 'Edit notes']) {
      expect(screen.queryAllByRole('button', { name })).toHaveLength(0);
    }
    expect(within(article('Pull-ups')).queryByRole('button', { name: '8' })).toBeNull();
    expect(within(article('Pull-ups')).getByText('8')).toBeTruthy();
  });

  it('resolves an id like the Days list: the ok row first, then the first refused row; a duplicate loser is never reached', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [s], exercises: [PULL, DIPS, ROWS] });
    // A refused row of the same id as an ok row: the ok row opens, editable, no banner.
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_other.json', kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_other.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy();
  });

  it('two refused rows of one id: the first one opens, with its own reason', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_a.json', kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_b.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_a.json');
    await m.data.refresh('/sessions/2030/2030-03-07_b.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/newer app/);
  });

  it('the loser of a duplicate pair alone does not open (spec 3 §6 hides it; the Sync tab lists it)', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_b.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', duplicateOf: '/sessions/2030/2030-03-07_a.json', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_b.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    expect(screen.getByText('This session is not here.')).toBeTruthy();
  });

  it('renders and edits an open session like a closed one: no redirect, Add set writes no completedAt', async () => {
    const s = session([block(ladder([8], { completedAt: '2030-03-09T11:40:00.000Z' }), { exerciseId: 'pull-ups' })], {
      date: '2030-03-09',
      startedAt: '2030-03-09T11:30:00.000Z',
    });
    const m = await setup({ now: NOW, sessions: [s], exercises: [PULL, DIPS, ROWS] });
    expect(m.data.openSession.value?.file.session.id).toBe(s.id);
    m.deps.router.navigate({ tab: 'days', sessionId: s.id });
    const navigate = vi.spyOn(m.deps.router, 'navigate');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Add set' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New set' })).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(m.store, pathOf(s))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(m.store, pathOf(s))).session.blocks[0]?.sets[1]?.completedAt).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.input(within(screen.getByRole('dialog', { name: 'Add tag' })).getByRole('textbox', { name: 'New tag' }), { target: { value: 'gym' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add tag' })).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await fileAt(m.store, pathOf(s))).session.tags).toEqual(['gym']));
    expect(navigate).not.toHaveBeenCalled();
    expect(m.deps.router.route.value).toEqual({ tab: 'days', sessionId: s.id });
  });

  it('a session just created on this device shows as loading, not missing, until its row arrives', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    justCreated.value = s.id;
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    expect(screen.queryByText('This session is not here.')).toBeNull();
    expect(document.querySelector('section.session[aria-busy="true"]')).toBeTruthy();
    await m.store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('removing a tag ignores a second tap while the first write runs', async () => {
    const s = threeBlocks();
    const { data, store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    const chip = screen.getByRole('button', { name: 'Remove tag deload' });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('the Undo of a deleted session ignores a second tap while the first write runs', async () => {
    const s = threeBlocks({ deletedAt: '2030-03-08T10:00:00.000Z' });
    const { data, store } = await mount(s);
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('adding a tag the session already has writes nothing and closes the sheet', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: ' deload ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add tag' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('the set interval and the stated rest carry spoken labels', async () => {
    const s = session(
      [
        block(
          [
            set({ order: 0, reps: 8, completedAt: '2030-03-07T10:00:00.000Z' }),
            set({ order: 1, reps: 8, completedAt: '2030-03-07T10:01:02.000Z' }),
            // restSec only on a set without completedAt (migrated shape, spec 2).
            set({ order: 2, reps: 8, restSec: 120 }),
          ],
          { exerciseId: 'pull-ups' },
        ),
      ],
      { date: '2030-03-07' },
    );
    await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByLabelText('interval 1:02 since the previous set').textContent).toBe('+1:02');
    expect(screen.getByLabelText(`stated rest ${formatAmount(120)} s`).textContent).toBe(`rest ${formatAmount(120)} s`);
  });

  it('the read-only banner link to the Sync tab is a touch target', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    await m.data.refresh(pathOf(s));
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    // theme.css gives .session__banner-link a 44 px min-height (no layout in happy-dom).
    expect(screen.getByRole('link', { name: 'Sync tab' }).classList.contains('session__banner-link')).toBe(true);
  });

  it('notes Save ignores a second tap while the first write runs', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'new' } });
    const save = within(sheet).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('new'));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('notes Save without an edit writes nothing, even for a migrated note with surrounding whitespace', async () => {
    const s = threeBlocks({ notes: '  raw row  ', source: 'migrated' });
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Notes' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notes' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('Add tag ignores a second tap while the first write runs', async () => {
    const s = threeBlocks();
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: 'hotel gym' } });
    const add = within(sheet).getByRole('button', { name: 'Add' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['deload', 'hotel gym']));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('an unknown id says so', async () => {
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL] });
    renderIn(m.deps, <SessionPage sessionId="nope" />);
    expect(screen.getByText('This session is not here.')).toBeTruthy();
  });

  it('a migrated aggregate set: totals text, and its sheet offers note and Delete only', async () => {
    const agg = set({ reps: 100, aggregate: true, order: 0 });
    const s = session(
      [block([agg], { exerciseId: 'pull-ups' }), block([], { exerciseId: 'dips-bar', order: 1, note: '3x max' })],
      { date: '2030-03-07', source: 'migrated', dateUncertain: true },
    );
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(within(article('Pull-ups')).getByText(`${formatAmount(100)} total, set count unknown`)).toBeTruthy();
    expect(within(article('Dips (Bar)')).getByText('no sets recorded')).toBeTruthy();
    expect(screen.getByText('date estimated by the migration')).toBeTruthy();
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: `${formatAmount(100)}*` }));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    expect(within(sheet).queryByRole('button', { name: 'Increase' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Edit value' })).toBeNull();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: 'ladders' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets[0]?.note).toBe('ladders'));
    expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 100, aggregate: true });
  });

  it('a tag tap removes it; Add tag offers tags seen elsewhere and free text', async () => {
    const other = session([], { date: '2030-03-01', tags: ['travel', 'deload'] });
    const s = threeBlocks();
    const { store } = await mount(s, [other]);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag deload' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove tag deload' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    let sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'travel' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['travel']));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove tag travel' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    sheet = screen.getByRole('dialog', { name: 'Add tag' });
    expect(within(sheet).queryByRole('button', { name: 'travel' })).toBeNull();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: 'hotel gym' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['travel', 'hotel gym']));
    expect((await fileAt(store, pathOf(s))).session.blocks.every((b) => b.updatedAt === T0)).toBe(true);
  });

  it('notes edit in a sheet', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'line one\nline two' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('line one\nline two'));
  });

  it('page writes take their time from data.clock(), not from the ticking now signal', async () => {
    const s = threeBlocks();
    const { store, data } = await mount(s, [], { staleNow: STALE_NOW });
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    // A later tick lands too (inside act, so any re-render happens before the taps).
    await act(() => { data.now.value = new Date(STALE_NOW.getTime() + 1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag deload' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));
    expect((await fileAt(store, pathOf(s))).session.updatedAt).toBe(NOW.toISOString());
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Exercise' })).getByRole('button', { name: 'Dips (Bar)' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks).toHaveLength(4));
    expect((await fileAt(store, pathOf(s))).session.blocks[3]?.updatedAt).toBe(NOW.toISOString());
  });

  it('Add block picks an exercise from the search', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    const sheet = screen.getByRole('dialog', { name: 'Exercise' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dips (Bar)' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks).toHaveLength(4));
    expect((await fileAt(store, pathOf(s))).session.blocks[3]).toMatchObject({ exerciseId: 'dips-bar', order: 3, sets: [] });
  });
});

describe('SessionHeaderSheet', () => {
  it('Save with "date is exact" drops dateUncertain; a changed date says the file keeps its name', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '2030-03-06' } });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Date is exact' }));
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'legs' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.date).toBe('2030-03-06'));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.dateUncertain).toBeUndefined();
    expect(after.label).toBe('legs');
    expect(after.updatedAt).toBe(NOW.toISOString());
    expect(toast.value?.text).toBe('The file keeps its old name');
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  it('saving with the switch off keeps dateUncertain; no switch on an exact date', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'n' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('n'));
    expect((await fileAt(store, pathOf(s))).session.dateUncertain).toBe(true);
    expect(toast.value).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog', { name: 'Session' })).getByRole('switch', { name: 'Date is exact' })).toBeTruthy();
  });

  it('a changed date with the switch off keeps dateUncertain', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '2030-03-05' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.date).toBe('2030-03-05'));
    expect((await fileAt(store, pathOf(s))).session.dateUncertain).toBe(true);
  });

  it('the label select shows display text and stores the label value', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const select = within(screen.getByRole('dialog', { name: 'Session' })).getByRole('combobox', { name: 'Label' }) as HTMLSelectElement;
    const legs = [...select.options].find((o) => o.value === 'legs');
    expect(legs?.textContent).toBe('Legs');
    fireEvent.change(select, { target: { value: 'legs' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Session' })).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('legs'));
  });

  it('an unrelated save leaves a migrated note with surrounding whitespace as it was', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', notes: '  raw row\n' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'pull' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('pull'));
    expect((await fileAt(store, pathOf(s))).session.notes).toBe('  raw row\n');
  });

  it('takes the write time from data.clock(), not from the ticking now signal', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store, data } = await mount(s, [], { staleNow: STALE_NOW });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    await act(() => { data.now.value = new Date(STALE_NOW.getTime() + 1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'pull' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('pull'));
    expect((await fileAt(store, pathOf(s))).session.updatedAt).toBe(NOW.toISOString());
  });

  it('Save writes only what the owner changed against the opened values: a label and date changed elsewhere meanwhile survive', async () => {
    const s = session([], { date: '2030-03-07', label: 'push', notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // The PC's change lands (a pull) while the sheet is open.
    await act(async () => {
      await data.edit('session', pathOf(s), (f) => setSessionFields(f, { label: 'pull', date: '2030-03-06' }, new Date('2030-03-09T11:59:00.000Z')));
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: formatDayLong('2030-03-06') })).toBeTruthy());
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'new' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('new'));
    expect((await fileAt(store, pathOf(s))).session).toMatchObject({ label: 'pull', date: '2030-03-06' });
    expect(toast.value?.text).not.toBe('The file keeps its old name');
  });

  it('notes edited elsewhere while the notes sheet is open: an unchanged Save keeps them', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    await act(async () => {
      await data.edit('session', pathOf(s), (f) => setSessionFields(f, { notes: 'from the PC' }, new Date('2030-03-09T11:59:00.000Z')));
    });
    // The refreshed row reached the page (its notes line behind the sheet).
    await waitFor(() => expect(screen.getByText('from the PC')).toBeTruthy());
    // The owner types and returns to the text the sheet opened with: nothing to write.
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'old!' } });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'old' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notes' })).toBeNull());
    expect((await fileAt(store, pathOf(s))).session.notes).toBe('from the PC');
  });

  it('an exact date shows no switch; an empty date is refused with a toast', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    expect(within(sheet).queryByRole('switch')).toBeNull();
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('Enter a date'));
    expect(writes).not.toHaveBeenCalled();
  });
});
