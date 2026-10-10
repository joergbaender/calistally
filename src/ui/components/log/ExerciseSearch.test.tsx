// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercise, session } from '../../../model/test-fixtures';
import type { Exercise, ExercisesFile, FileKind, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import type { FileOf, WriteOutcome } from '../../data';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push', family: 'push-up' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const OLD = exercise({ id: 'kipping-pull-ups', name: 'Kipping Pull-ups', pattern: 'pull', family: 'pull-up', archived: true });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session => session([], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mount(today: Session, exercises: Exercise[] | undefined) {
  const m = await setup({ now: NOW, sessions: [today], exercises, meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Other exercise…' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Other exercise…' }));
  const sheet = screen.getByRole('dialog', { name: 'Exercise' });
  return { ...m, sheet };
}

const search = (sheet: HTMLElement, text: string): void => {
  fireEvent.input(within(sheet).getByRole('textbox', { name: 'Search exercises' }), { target: { value: text } });
};

describe('ExerciseSearch', () => {
  it('lists live entries by name as typed, archived ones in their own group; picking one adds a block and makes it current', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    search(sheet, 'pull');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Push-ups' })).toBeNull());
    expect(within(sheet).getByText('Archived (1)')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Create/ })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Pull-ups' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups']));
    const added = (await fileAt(store, pathOf(today))).session.blocks[0];
    await waitFor(() => expect(currentBlockId.value).toBe(added?.id));
    expect(screen.queryByRole('dialog', { name: 'Exercise' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Entry' }).textContent).toContain('Pull-ups · set 1'));
  });

  it('Create writes the catalog before the session, and the block references the new id', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    expect((within(form).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ring Rows');
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'pull' } });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Family' }), { target: { value: 'row' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks).toHaveLength(1));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([EXERCISES_PATH, pathOf(today)]);
    const catalog = (await store.getRow(EXERCISES_PATH))?.content as ExercisesFile;
    const created = catalog.exercises.find((e) => e.name === 'Ring Rows');
    expect(created).toMatchObject({
      id: 'ring-rows', pattern: 'pull', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: 'row', archived: false, updatedAt: NOW.toISOString(),
    });
    const added = (await fileAt(store, pathOf(today))).session.blocks[0];
    expect(added?.exerciseId).toBe('ring-rows');
    await waitFor(() => expect(currentBlockId.value).toBe(added?.id));
  });

  it('a name that exists already uses that entry and writes no catalog', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Rows”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: ' pull-UPS ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups']));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([pathOf(today)]);
  });

  it('Create on the name of a deleted entry undeletes it, writes the catalog first and adds its block', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', pattern: 'pull', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, gone]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'ring rows');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Ring Rows' })).toBeNull());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “ring rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['ring-rows']));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([EXERCISES_PATH, pathOf(today)]);
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.filter((e) => e.name.toLowerCase() === 'ring rows')).toHaveLength(1);
    const revived = catalog.find((e) => e.id === 'ring-rows');
    expect(revived?.deletedAt).toBeUndefined();
    expect(revived?.updatedAt).toBe(NOW.toISOString());
  });

  it('Create on the name of an archived entry unarchives it and adds its block', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    search(sheet, 'Kipping Pull-ups');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Kipping Pull-ups”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['kipping-pull-ups']));
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.find((e) => e.id === 'kipping-pull-ups')).toMatchObject({ archived: false, updatedAt: NOW.toISOString() });
  });

  it("a held-back catalog write keeps its note when the session write shows a toast of its own", async () => {
    const today = openToday();
    const { data, sheet } = await mount(today, [PUSH, PULL]);
    const edit = data.edit.bind(data);
    vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> => {
      if (kind !== 'exercises') return { ok: false, reason: 'changed' };
      const r = await edit(kind, path, fn);
      return r.ok ? { ok: true, heldBack: true } : r;
    });
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));
    await waitFor(() => expect(toast.value?.text).toBe('Changed elsewhere, try again · Saved here, not uploaded (app bug)'));
  });
  it('a double tap on Create exercise adds one block', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    const create = within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(currentBlockId.value).toBeDefined());
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks).toHaveLength(1);
  });

  // The quiet-session case is in ExerciseSearch.held-back.test.tsx: the once-per-path note for
  // exercises.json is module state, so that case needs a module of its own.

  it('without a catalog, Create is disabled with the reason', async () => {
    const today = openToday();
    const { sheet } = await mount(today, undefined);
    search(sheet, 'Ring Rows');
    await waitFor(() => expect(within(sheet).getByText('catalog not available')).toBeTruthy());
    expect((within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
