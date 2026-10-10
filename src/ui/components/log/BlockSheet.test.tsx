// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import { setBlockNote } from '../../../model/edit';
import type { Session } from '../../../model/types';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, entryDraft, referenceId, setDraft } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, reportHeldBack, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session =>
  session(
    [
      block(ladder([8, 8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'dips-bar' }),
      block(ladder([15], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'push-ups', order: 1 }),
    ],
    { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' },
  );

async function mount(today: Session) {
  const m = await setup({ now: NOW, sessions: [today], exercises: [PUSH, DIPS], meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy());
  return m;
}

const openSheet = (): HTMLElement => {
  fireEvent.click(within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: 'Dips (Bar)' }));
  return screen.getByRole('dialog', { name: 'Dips (Bar)' });
};

describe('BlockSheet (a card name)', () => {
  it('saves the block note', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const sheet = openSheet();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Block note' }), { target: { value: 'rings next time' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.note).toBe('rings next time'));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.updatedAt).toBe(NOW.toISOString());
    await waitFor(() => expect(screen.getByText('rings next time')).toBeTruthy());
    expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull();
  });

  it('Save note with the note unchanged writes nothing and closes', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const writes = vi.spyOn(store, 'writeFile');
    const sheet = openSheet();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Block note' }), { target: { value: '  ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('a held-back Delete block folds the held-back note into the Undo toast', async () => {
    const today = openToday();
    const { data, store } = await mount(today);
    reportHeldBack(data);
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Delete block' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.deletedAt).toBe(NOW.toISOString()));
    await waitFor(() => expect(toast.value?.text).toBe('Dips (Bar) deleted · Saved here, not uploaded (app bug)'));
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
  });

  it('Make current makes the card current', async () => {
    const today = openToday();
    await mount(today);
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Make current' }));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
    expect(currentBlockId.value).toBe(today.blocks[0]?.id);
  });

  it('Delete block writes a tombstone; Undo writes the undelete', async () => {
    const today = openToday();
    const { store } = await mount(today);
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Delete block' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.deletedAt).toBe(NOW.toISOString()));
    expect(toast.value?.text).toBe('Dips (Bar) deleted');
    expect(toast.value?.ms).toBe(6000);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Dips (Bar)' })).toBeNull());

    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy());
  });

  it('a double tap on Delete block writes once and keeps the Undo toast', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const writes = vi.spyOn(store, 'writeFile');
    const sheet = openSheet();
    const remove = within(sheet).getByRole('button', { name: 'Delete block' }) as HTMLButtonElement;
    fireEvent.click(remove);
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    await waitFor(() => expect(toast.value?.text).toBe('Dips (Bar) deleted'));
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(toast.value?.text).toBe('Dips (Bar) deleted');
  });

  it('a double tap on Save note writes once', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const writes = vi.spyOn(store, 'writeFile');
    const sheet = openSheet();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Block note' }), { target: { value: 'rings next time' } });
    const save = within(sheet).getByRole('button', { name: 'Save note' }) as HTMLButtonElement;
    fireEvent.click(save);
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('Save note with the note untouched keeps a note another device wrote while the sheet was open', async () => {
    const today = openToday();
    const dips = today.blocks[0]?.id ?? '';
    const { data, store } = await mount(today);
    const sheet = openSheet();
    await data.edit('session', pathOf(today), (f) => setBlockNote(f, dips, 'from the PC', new Date('2030-03-07T10:29:00.000Z')));
    await waitFor(() => expect(screen.getByText('from the PC')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.note).toBe('from the PC');
  });

  it("Delete block drops the block's entry draft", async () => {
    const today = openToday();
    const dips = today.blocks[0]?.id ?? '';
    await mount(today);
    setDraft(dips, { note: 'left shoulder' });
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Delete block' }));
    await waitFor(() => expect(toast.value?.text).toBe('Dips (Bar) deleted'));
    expect(entryDraft.value.has(dips)).toBe(false);
  });
});
