// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import { setSetFields } from '../../../model/edit';
import type { Session } from '../../../model/types';
import { sessionRowById } from '../../data';
import { formatLoad } from '../../format';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { SetSheet } from './SetSheet';
import { fileAt, pathOf, renderIn, reportHeldBack, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const DONE = '2030-03-07T10:10:00.000Z';
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const WEIGHTED = exercise({ id: 'weighted-pull-ups', name: 'Weighted Pull-ups', pattern: 'pull', defaultLoadType: 'added' });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session =>
  session([block(ladder([8, 9], { completedAt: DONE }), { exerciseId: 'push-ups' })], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mountLog(today: Session) {
  const m = await setup({ now: NOW, sessions: [today], exercises: [PUSH, WEIGHTED], meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
  return m;
}

const chip = (amount: string): HTMLElement =>
  within(screen.getByRole('article', { name: 'Push-ups' }).querySelector('.setchips--today') as HTMLElement).getByRole('button', { name: amount });

describe('SetSheet (edit, from a today chip)', () => {
  it('Delete writes a tombstone; Undo writes the undelete', async () => {
    const today = openToday();
    const setId = today.blocks[0]?.sets[0]?.id ?? '';
    const { store } = await mountLog(today);
    fireEvent.click(chip('8'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]?.deletedAt).toBe(NOW.toISOString()));
    expect(toast.value?.text).toBe('Set 8 deleted');
    expect(toast.value?.ms).toBe(6000);
    expect(screen.queryByRole('dialog', { name: 'Set' })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: '8' })).toBeNull());

    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]?.deletedAt).toBeUndefined());
    const restored = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0];
    expect(restored).toMatchObject({ id: setId, reps: 8, completedAt: DONE });
    await waitFor(() => expect(chip('8')).toBeTruthy());
  });

  it('a held-back Delete folds the held-back note into the Undo toast', async () => {
    const today = openToday();
    const { data, store } = await mountLog(today);
    reportHeldBack(data);
    fireEvent.click(chip('8'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]?.deletedAt).toBe(NOW.toISOString()));
    await waitFor(() => expect(toast.value?.text).toBe('Set 8 deleted · Saved here, not uploaded (app bug)'));
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
  });

  it('a double tap on Save writes once', async () => {
    const today = openToday();
    const { store } = await mountLog(today);
    fireEvent.click(chip('9'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    const writes = vi.spyOn(store, 'writeFile');
    const save = within(sheet).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set' })).toBeNull());
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('Save changes amount, load and note and never touches completedAt', async () => {
    const today = openToday();
    const { store } = await mountLog(today);
    fireEvent.click(chip('9'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: ' strict ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'bodyweight' }));
    const load = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(load).getByRole('button', { name: 'added' }));
    for (const key of ['5']) fireEvent.click(within(load).getByRole('button', { name: key }));
    fireEvent.click(within(load).getByRole('button', { name: 'Use' }));
    const back = screen.getByRole('dialog', { name: 'Set' });
    expect(within(back).getByRole('button', { name: formatLoad('added', 5) })).toBeTruthy();
    expect(within(back).getByRole('button', { name: 'Edit value' }).textContent).toBe('10');
    fireEvent.click(within(back).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 10 }));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({
      reps: 10, loadType: 'added', loadKg: 5, note: 'strict', completedAt: DONE, updatedAt: NOW.toISOString(),
    });
    expect(screen.queryByRole('dialog', { name: 'Set' })).toBeNull();
  });

  it("Save writes only what the owner changed: another device's load change made while the sheet was open survives", async () => {
    const today = session([block(ladder([8], { completedAt: DONE, loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })], {
      date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z',
    });
    const setId = today.blocks[0]?.sets[0]?.id ?? '';
    const { data, store } = await mountLog(today);
    fireEvent.click(chip('8'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    await data.edit('session', pathOf(today), (f) => setSetFields(f, setId, { loadKg: 12 }, new Date('2030-03-07T10:29:00.000Z')));
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Push-ups' })).getByText(formatLoad('added', 12))).toBeTruthy());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 9 }));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 9, loadType: 'added', loadKg: 12 });
  });

  it("a note-only Save keeps another device's amount change made while the sheet was open", async () => {
    const today = openToday();
    const setId = today.blocks[0]?.sets[1]?.id ?? '';
    const { data, store } = await mountLog(today);
    fireEvent.click(chip('9'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    await data.edit('session', pathOf(today), (f) => setSetFields(f, setId, { reps: 13 }, new Date('2030-03-07T10:29:00.000Z')));
    await waitFor(() => expect(chip('13')).toBeTruthy());
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: 'strict' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]?.note).toBe('strict'));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 13, note: 'strict' });
  });

  it("the set sheet's pad has exactly one Cancel and it returns to the set sheet", async () => {
    const today = openToday();
    await mountLog(today);
    fireEvent.click(chip('9'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Edit value' }));
    const pad = screen.getByRole('dialog', { name: 'Amount' });
    expect(within(pad).getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    fireEvent.click(within(pad).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Amount' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Set' })).toBeTruthy();
  });

  it("the set sheet's pad reads Use and only sets the value", async () => {
    const today = openToday();
    const { store } = await mountLog(today);
    fireEvent.click(chip('9'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Edit value' }));
    const pad = screen.getByRole('dialog', { name: 'Amount' });
    for (const key of ['1', '2', 'Use']) fireEvent.click(within(pad).getByRole('button', { name: key }));
    const back = screen.getByRole('dialog', { name: 'Set' });
    expect(within(back).getByRole('button', { name: 'Edit value' }).textContent).toBe('12');
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 9 });
  });
});

describe('SetSheet (create, as the session page uses it)', () => {
  async function mountCreate(today: Session, blockIndex: number, timed: boolean) {
    const m = await setup({ now: NOW, sessions: [today], exercises: [PUSH, WEIGHTED] });
    const row = sessionRowById(m.data.sessions.value, today.id);
    if (row === undefined) throw new Error('no row');
    const onClose = vi.fn();
    renderIn(m.deps, <SetSheet row={row} blockId={today.blocks[blockIndex]?.id ?? ''} create timed={timed} onClose={onClose} />);
    return { ...m, onClose };
  }

  it('timed: false adds a set without completedAt, starting from the last set', async () => {
    const today = openToday();
    const { store, onClose } = await mountCreate(today, 0, false);
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    expect(within(sheet).getByRole('button', { name: 'Edit value' }).textContent).toBe('9');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(3));
    const added = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[2];
    expect(added).toMatchObject({ reps: 9, loadType: 'bodyweight', loadKg: 0, updatedAt: NOW.toISOString() });
    expect(added?.completedAt).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('a double tap on Add set adds one set', async () => {
    const today = openToday();
    const { store, onClose } = await mountCreate(today, 0, false);
    const add = within(screen.getByRole('dialog', { name: 'New set' })).getByRole('button', { name: 'Add set' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(3);
  });

  it('timed: true stamps completedAt; a weighted exercise asks for the kg first', async () => {
    const today = session([block([], { exerciseId: 'weighted-pull-ups' })], { date: '2030-03-07' });
    const { store } = await mountCreate(today, 0, true);
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    expect((within(sheet).getByRole('button', { name: 'Add set' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    const load = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(load).getByRole('button', { name: '7' }));
    fireEvent.click(within(load).getByRole('button', { name: 'Use' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 1, loadType: 'added', loadKg: 7, completedAt: NOW.toISOString() });
  });
});
