// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import type { JSX } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addSet } from '../../../model/edit';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatLoad } from '../../format';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, entryDraft, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const WEIGHTED = exercise({ id: 'weighted-pull-ups', name: 'Weighted Pull-ups', pattern: 'pull', defaultLoadType: 'added' });
const PLANK = exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds' });
const CATALOG = [PUSH, WEIGHTED, PLANK];

/** The Log tab, or another tab's stand-in: switching unmounts and remounts LogTab as App does. */
const onLog = signal(true);
function Tabs(): JSX.Element {
  return onLog.value ? <LogTab /> : <p>Days</p>;
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  entryDraft.value = new Map();
  onLog.value = true;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (blocks: Parameters<typeof session>[0]): Session =>
  session(blocks, { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mount(sessions: Session[], meta: Record<string, unknown>) {
  const m = await setup({ now: NOW, sessions, exercises: CATALOG, meta });
  renderIn(m.deps, <Tabs />);
  return m;
}

const entry = (): HTMLElement => screen.getByRole('region', { name: 'Entry' });
const value = (): string => within(entry()).getByRole('button', { name: 'Edit value' }).textContent ?? '';
const tapAll = (scope: HTMLElement, keys: string[]): void => {
  for (const key of keys) fireEvent.click(within(scope).getByRole('button', { name: key }));
};

describe('EntryArea', () => {
  it('Add set writes the proposed amount with completedAt and the sticky load; the stepper then shows the next proposal', async () => {
    const past = session([block(ladder([17, 16, 15], { loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })], {
      date: '2030-03-05',
      startedAt: '2030-03-05T10:00:00.000Z',
    });
    const today = openToday([block([], { exerciseId: 'push-ups' })]);
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });

    await waitFor(() => expect(value()).toBe('17'));
    expect(entry().textContent).toContain('Push-ups · set 1');
    expect(within(entry()).getByRole('button', { name: formatLoad('added', 10) })).toBeTruthy();

    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 17' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    const written = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0];
    expect(written).toMatchObject({ reps: 17, loadType: 'added', loadKg: 10, completedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(written?.note).toBeUndefined();

    await waitFor(() => expect(value()).toBe('16'));
    expect(entry().textContent).toContain('set 2');
    expect(currentBlockId.value).toBe(today.blocks[0]?.id);
  });

  it('the set number has a span of its own, so a long name truncates before it (375 px)', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    expect(entry().querySelector('.entry__name')?.textContent).toBe('Push-ups');
    expect(entry().querySelector('.entry__set')?.textContent).toBe('· set 2');
  });

  it('the load button and the note change the next set; after Add the note is gone and the load stays', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z', loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));

    fireEvent.click(within(entry()).getByRole('button', { name: formatLoad('added', 10) }));
    const sheet = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'bodyweight' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy());

    fireEvent.click(within(entry()).getByRole('button', { name: 'note' }));
    const noteSheet = screen.getByRole('dialog', { name: 'Set note' });
    fireEvent.input(within(noteSheet).getByRole('textbox'), { target: { value: 'slow' } });
    fireEvent.click(within(noteSheet).getByRole('button', { name: 'Save' }));

    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    const written = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1];
    expect(written).toMatchObject({ reps: 8, loadType: 'bodyweight', loadKg: 0, note: 'slow' });
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    expect(within(entry()).getByRole('button', { name: 'note' }).className).not.toContain('is-set');
    expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy();
  });

  it('needsKg: the first Add of the block opens the load sheet and adds with the chosen kg', async () => {
    const today = openToday([block([], { exerciseId: 'weighted-pull-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('–'));
    const disabled = within(entry()).getByRole('button', { name: 'Add set' }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);

    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Load' });
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(0);
    expect(within(sheet).getByRole('button', { name: 'added' }).getAttribute('aria-pressed')).toBe('true');
    tapAll(sheet, ['1', '2', '.', '5', 'Use']);

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 1, loadType: 'added', loadKg: 12.5, completedAt: NOW.toISOString() });
    expect(screen.queryByRole('dialog', { name: 'Load' })).toBeNull();
  });

  it("the pad's Add adds the set at once with the typed value and closes the pad", async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Edit value' }));
    const pad = screen.getByRole('dialog', { name: 'Amount' });
    tapAll(pad, ['1', '6', '.', '5', 'Add']);
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 16.5, completedAt: NOW.toISOString() });
    expect(screen.queryByRole('dialog', { name: 'Amount' })).toBeNull();
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
  });

  it("the pad's Add follows the load-sheet-first rule when a weight is required", async () => {
    const today = openToday([block([], { exerciseId: 'weighted-pull-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('–'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Edit value' }));
    tapAll(screen.getByRole('dialog', { name: 'Amount' }), ['5', 'Add']);
    const load = await screen.findByRole('dialog', { name: 'Load' });
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(0);
    tapAll(load, ['1', '0', 'Use']);
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 5, loadType: 'added', loadKg: 10 });
  });

  it('the load sheet takes 0 kg for band and external (spec 1 §3) and requires more for added', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'bodyweight' }));
    const sheet = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'added' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '0' }));
    expect((within(sheet).getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'band' }));
    expect((within(sheet).getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(within(entry()).getByRole('button', { name: formatLoad('band', 0) })).toBeTruthy());
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ loadType: 'band', loadKg: 0 });
  });

  it('an EditError from addSet shows its message as a toast and writes nothing', async () => {
    // A reps set in a block of a seconds exercise (a soft metric mismatch): adding seconds is refused.
    const today = openToday([block(ladder([30]), { exerciseId: 'plank' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('30'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 30' }));
    await waitFor(() => expect(toast.value?.text).toBe("the block's sets count reps, not seconds"));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1);
  });

  it('a double tap on Add set adds one set', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    const add = within(entry()).getByRole('button', { name: 'Add set · 8' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);
  });

  it('Add set stays held for a minimum time after an add, even when the refreshed row shows at once', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    // A double tap 150 ms apart: the refresh has long landed, the second tap must still not add.
    await new Promise((r) => setTimeout(r, 150));
    const again = within(entry()).getByRole('button', { name: /^Add set/ }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    fireEvent.click(again);
    await new Promise((r) => setTimeout(r, 30));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);

    // After the minimum hold the button is free again and the next tap adds.
    await waitFor(() => expect((within(entry()).getByRole('button', { name: /^Add set/ }) as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
    fireEvent.click(within(entry()).getByRole('button', { name: /^Add set/ }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(3));
  });

  it('Add set stays held after the write until the refreshed row shows the new set', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store, data } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    const refresh = data.refresh.bind(data);
    const pending: (() => void)[] = [];
    vi.spyOn(data, 'refresh').mockImplementation((path: string) => new Promise<void>((resolve) => {
      pending.push(() => void refresh(path).then(resolve));
    }));
    const add = within(entry()).getByRole('button', { name: 'Add set · 8' }) as HTMLButtonElement;
    fireEvent.click(add);
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    // The write is done, the screen still shows set 2: a second tap must not add a third set.
    expect(entry().textContent).toContain('set 2');
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    await new Promise((r) => setTimeout(r, 20));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);

    act(() => { for (const run of pending) run(); });
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    // Free again once the set shows and the minimum hold (ADD_SET_MIN_HOLD_MS) has passed.
    await waitFor(() => expect((within(entry()).getByRole('button', { name: /^Add set/ }) as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
  });

  it('a value typed for a set number does not come back after a delete lowers the set count', async () => {
    const today = openToday([block(ladder([8, 9], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('9'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 10' }));
    await waitFor(() => expect(entry().textContent).toContain('set 4'));

    const chips = screen.getByRole('article', { name: 'Push-ups' }).querySelector('.setchips--today') as HTMLElement;
    fireEvent.click(within(chips).getByRole('button', { name: '10' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[2]?.deletedAt).toBeDefined());
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    expect(value()).toBe('9');
  });

  it('a typed value does not carry over to the next set number when a set arrives from elsewhere', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store, data } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    await waitFor(() => expect(value()).toBe('10'));

    // The session page (or a pull from the other device) adds set 2 while the Log tab is away.
    act(() => { onLog.value = false; });
    const blockId = today.blocks[0]?.id ?? '';
    const result = await data.edit('session', pathOf(today), (f) => addSet(f, blockId, { reps: 7, loadType: 'bodyweight', loadKg: 0 }, data.clock()).file);
    expect(result.ok).toBe(true);
    act(() => { onLog.value = true; });

    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    expect(value()).toBe('7');
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);
  });

  it('a load chosen for a block stays with that block and never applies to another one', async () => {
    const today = openToday([
      block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z', loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups', order: 0 }),
      block(ladder([5], { completedAt: '2030-03-07T10:20:00.000Z', loadType: 'added', loadKg: 20 }), { exerciseId: 'weighted-pull-ups', order: 1 }),
    ]);
    await mount([today], { [`reference:${today.id}`]: 'none' });
    const makeCurrent = (name: string): void => {
      fireEvent.click(within(screen.getByRole('article', { name })).getByRole('button', { name }));
      fireEvent.click(within(screen.getByRole('dialog', { name })).getByRole('button', { name: 'Make current' }));
    };
    await waitFor(() => expect(entry().textContent).toContain('Weighted Pull-ups · set 2'));
    makeCurrent('Push-ups');
    await waitFor(() => expect(entry().textContent).toContain('Push-ups · set 2'));

    fireEvent.click(within(entry()).getByRole('button', { name: formatLoad('added', 10) }));
    const sheet = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'bodyweight' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy());

    makeCurrent('Weighted Pull-ups');
    await waitFor(() => expect(entry().textContent).toContain('Weighted Pull-ups · set 2'));
    expect(within(entry()).getByRole('button', { name: formatLoad('added', 20) })).toBeTruthy();
    makeCurrent('Push-ups');
    await waitFor(() => expect(entry().textContent).toContain('Push-ups · set 2'));
    expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy();
  });

  it('a set note never carries over to another block', async () => {
    const today = openToday([
      block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups', order: 0 }),
      block(ladder([5], { completedAt: '2030-03-07T10:20:00.000Z', loadType: 'added', loadKg: 20 }), { exerciseId: 'weighted-pull-ups', order: 1 }),
    ]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(entry().textContent).toContain('Weighted Pull-ups · set 2'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'note' }));
    const noteSheet = screen.getByRole('dialog', { name: 'Set note' });
    fireEvent.input(within(noteSheet).getByRole('textbox'), { target: { value: 'left shoulder' } });
    fireEvent.click(within(noteSheet).getByRole('button', { name: 'Save' }));

    fireEvent.click(within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Push-ups' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Push-ups' })).getByRole('button', { name: 'Make current' }));
    await waitFor(() => expect(entry().textContent).toContain('Push-ups · set 2'));
    expect(within(entry()).getByRole('button', { name: 'note' }).className).not.toContain('is-set');
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]?.note).toBeUndefined();
  });

  it('the stepper value, the note and the chosen load survive a switch to another tab and back', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z', loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: formatLoad('added', 10) }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Load' })).getByRole('button', { name: 'bodyweight' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Load' })).getByRole('button', { name: 'Save' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'note' }));
    fireEvent.input(within(screen.getByRole('dialog', { name: 'Set note' })).getByRole('textbox'), { target: { value: 'slow negatives' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set note' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(value()).toBe('9'));

    act(() => { onLog.value = false; });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Entry' })).toBeNull());
    act(() => { onLog.value = true; });
    await waitFor(() => expect(value()).toBe('9'));
    expect(within(entry()).getByRole('button', { name: 'note' }).className).toContain('is-set');
    expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy();

    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 9' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 9, loadType: 'bodyweight', note: 'slow negatives' });
  });
});
