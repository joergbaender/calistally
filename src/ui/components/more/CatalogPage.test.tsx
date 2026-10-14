// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, session, sessionFile, set } from '../../../model/test-fixtures';
import type { Exercise, ExercisesFile, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { pathOf, renderIn, setup } from '../../test-harness';
import { dismissToast, toast } from '../../toast';
import { ToastHost } from '../shared';
import { MoreTab } from './MoreTab';

const NOW = new Date('2030-03-10T08:00:00.000Z');
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const CHIN = exercise({ id: 'chin-ups', name: 'Chin-ups', pattern: 'pull', family: 'pull-up' });
const LUNGE = exercise({ id: 'lunges', name: 'Lunges', pattern: 'legs', perSide: true, defaultLoadType: 'external' });
const OLD = exercise({ id: 'kipping', name: 'Kipping', archived: true });

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
});

async function mount(input: { exercises: Exercise[] | undefined; sessions?: Session[]; id?: string }) {
  const m = await setup({ now: NOW, sessions: input.sessions ?? [], exercises: input.exercises });
  m.deps.router.navigate(input.id === undefined ? { tab: 'more', page: 'catalog' } : { tab: 'more', page: 'catalog', id: input.id });
  renderIn(m.deps, <><MoreTab /><ToastHost /></>);
  const catalog = async (): Promise<Exercise[]> => ((await m.store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
  return { ...m, router: m.deps.router, catalog };
}

describe('CatalogPage', () => {
  it('lists live entries by family with their meta, archived ones below; a row opens its edit page', async () => {
    const { router } = await mount({ exercises: [PULL, LUNGE, OLD, CHIN] });
    const live = screen.getByRole('list', { name: 'pull-up' });
    const rows = within(live).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Chin-ups')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('pull · reps · bodyweight')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Pull-ups')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Lunges/ })).getByText('legs · reps · per side · external')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Archived' })).getByRole('button', { name: /Kipping/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pull-ups/ }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'pull-ups' });
  });

  it('Create opens the shared form in a sheet and writes a new entry', async () => {
    const { catalog, router } = await mount({ exercises: [PULL] });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Ring Rows' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'pull' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(async () => expect((await catalog()).map((e) => e.id)).toEqual(['pull-ups', 'ring-rows']));
    expect((await catalog())[1]).toEqual({
      id: 'ring-rows', name: 'Ring Rows', pattern: 'pull', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', archived: false, updatedAt: NOW.toISOString(),
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New exercise' })).toBeNull());
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'ring-rows' });
  });

  it('Create with a name that exists writes nothing and opens that entry', async () => {
    const { store, router } = await mount({ exercises: [PULL] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: ' pull-UPS' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'pull-ups' }));
    expect(writes).not.toHaveBeenCalled();
  });

  it('Create on a deleted name with another metric writes nothing and asks; Use it brings the entry back as it was', async () => {
    const plank = exercise({ id: 'plank', name: 'Plank', pattern: 'core', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const { store, catalog, router } = await mount({ exercises: [PULL, plank] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Plank' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Metric' }), { target: { value: 'seconds' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));

    const clash = await screen.findByRole('dialog', { name: 'An exercise named “Plank” exists' });
    expect(within(clash).getByText('It is deleted, measured in reps, not seconds. Use it as it is, or cancel and pick another name for the new one.')).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(clash).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /exists/ })).toBeNull());
    expect((within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Plank');
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog' });

    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'An exercise named “Plank” exists' })).getByRole('button', { name: 'Use it' }));
    const { deletedAt: _deletedAt, ...alive } = plank;
    await waitFor(async () => expect((await catalog())[1]).toEqual({ ...alive, updatedAt: NOW.toISOString() }));
    expect(await catalog()).toHaveLength(2);
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'plank' }));
  });

  it('Create on an archived name with the same metric asks before bringing it back', async () => {
    const { store, catalog, router } = await mount({ exercises: [PULL, OLD] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'kipping' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    const clash = await screen.findByRole('dialog', { name: 'An exercise named “Kipping” exists' });
    expect(within(clash).getByText('It is archived. Use it to bring it back.')).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(clash).getByRole('button', { name: 'Use it' }));
    await waitFor(async () => expect((await catalog())[1]).toEqual({ ...OLD, archived: false, updatedAt: NOW.toISOString() }));
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'kipping' }));
  });

  it('a double tap on Create exercise writes one entry', async () => {
    const { store, catalog } = await mount({ exercises: [PULL] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Ring Rows' } });
    const create = within(form).getByRole('button', { name: 'Create exercise' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(async () => expect((await catalog()).map((e) => e.id)).toEqual(['pull-ups', 'ring-rows']));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a read-only catalog (written by a newer app) still lists its entries, without edit controls', async () => {
    const m = await mount({ exercises: [PULL] });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: { ...exercisesFile([PULL, OLD]), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exercises.json is needs-update; the catalog cannot be changed here. See the Sync tab.'));
    const live = screen.getByRole('list', { name: 'pull-up' });
    expect(within(live).getByText('Pull-ups')).toBeTruthy();
    expect(within(live).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Archived' })).getByText('Kipping')).toBeTruthy();
    expect(screen.queryByText('No exercises yet.')).toBeNull();
  });

  it('a quarantined catalog shows the banner only, not "No exercises yet."', async () => {
    const m = await mount({ exercises: [PULL] });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([PULL]), status: 'quarantined', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Pull-ups')).toBeNull();
    expect(screen.queryByText('No exercises yet.')).toBeNull();
  });

  it('without a catalog the screen is read-only with a banner and Create disabled', async () => {
    await mount({ exercises: undefined });
    expect(screen.getByRole('alert').textContent).toBe('The exercise catalog is not here yet; it arrives with the first sync.');
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with the catalog row quarantined the banner names the reason', async () => {
    const m = await mount({ exercises: [PULL] });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([PULL]), status: 'quarantined', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exercises.json is quarantined; the catalog cannot be changed here. See the Sync tab.'));
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ExerciseEditPage', () => {
  const used = (): Session => session([block([set()], { exerciseId: 'pull-ups' })], { date: '2030-03-07' });

  it('shows metric and per side locked, without controls for them', async () => {
    await mount({ exercises: [LUNGE], id: 'lunges' });
    expect(screen.queryByRole('combobox', { name: 'Metric' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Per side' })).toBeNull();
    expect(screen.getByText('fixed at creation; create a new exercise instead')).toBeTruthy();
    const locked = screen.getByRole('group', { name: 'Fixed at creation' });
    expect(within(locked).getByText('reps')).toBeTruthy();
    expect(within(locked).getByText('yes')).toBeTruthy();
  });

  it('rename writes the catalog with the same id, only the changed field, and goes back to the catalog', async () => {
    const { catalog, router } = await mount({ exercises: [PULL, CHIN], id: 'pull-ups' });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Pull-ups');
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Strict Pull-ups' } });
    fireEvent.input(screen.getByRole('textbox', { name: 'Cues' }), { target: { value: 'hollow body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await catalog())[0]).toEqual({ ...PULL, name: 'Strict Pull-ups', cues: 'hollow body', updatedAt: NOW.toISOString() }));
    expect((await catalog())[1]).toEqual(CHIN);
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog' }));
  });

  it('a rename clash writes nothing and offers the other entry', async () => {
    const { store, router } = await mount({ exercises: [PULL, CHIN], id: 'pull-ups' });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'chin-UPS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “Chin-ups” exists' });
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use it' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'chin-ups' });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Chin-ups'));
  });

  it('the clash sheet’s Cancel keeps the typed name', async () => {
    await mount({ exercises: [PULL, CHIN], id: 'pull-ups' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chin-ups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “Chin-ups” exists' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Chin-ups');
  });

  it('Archive archives the entry, Unarchive brings it back', async () => {
    const { catalog } = await mount({ exercises: [PULL], sessions: [used()], id: 'pull-ups' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(async () => expect((await catalog())[0]).toEqual({ ...PULL, archived: true, updatedAt: NOW.toISOString() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive' }));
    await waitFor(async () => expect((await catalog())[0]?.archived).toBe(false));
  });

  it('a referenced exercise offers no Delete, only the reason', async () => {
    await mount({ exercises: [PULL], sessions: [used()], id: 'pull-ups' });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText('used in 1 session; archive instead')).toBeTruthy();
  });

  it('Delete tombstones an unreferenced exercise, goes back to the catalog, and Undo restores it', async () => {
    const { catalog, router } = await mount({ exercises: [PULL, CHIN], sessions: [used()], id: 'chin-ups' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await catalog())[1]).toEqual({ ...CHIN, updatedAt: NOW.toISOString(), deletedAt: NOW.toISOString() }));
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog' }));
    expect(toast.value?.text).toBe('Exercise deleted');
    expect(toast.value?.ms).toBe(6000);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await catalog())[1]).not.toHaveProperty('deletedAt'));
  });

  it('a rename to the name of a deleted entry writes nothing; Use it opens that entry, which offers Restore (spec 1 §3)', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const { store, catalog, router } = await mount({ exercises: [PULL, gone], id: 'pull-ups' });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'ring ROWS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “Ring Rows” exists' });
    expect(writes).not.toHaveBeenCalled();
    expect(within(sheet).getByText('Names are unique in the catalog, deleted ones included. Open that exercise to restore it, or cancel and pick another name.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use it' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'ring-rows' });
    await waitFor(() => expect(screen.getByText('This exercise was deleted. Restore it to edit.')).toBeTruthy());
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ring Rows');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await catalog())[1]).not.toHaveProperty('deletedAt'));
    expect((await catalog())[0]).toEqual(PULL);
  });

  it('a session on a read-only row that uses the exercise keeps Delete away (spec 1 §3)', async () => {
    const s = used();
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'read-only', issues: [], version: 1 });
    await act(async () => { await m.data.refresh(pathOf(s)); });
    await waitFor(() => expect(screen.getByText('used in 1 session; archive instead')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('Delete refuses at write time when a locked session that uses the exercise arrived meanwhile', async () => {
    const s = used();
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    const del = screen.getByRole('button', { name: 'Delete' });
    // The row arrives in the store, but the page has not re-rendered yet when the owner taps.
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    m.data.refusedRows.value = [...m.data.refusedRows.value, { path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 }];
    fireEvent.click(del);
    await waitFor(() => expect(toast.value?.text).toBe('Pull-ups is used in 1 session; archive it instead'));
    expect((await m.catalog())[0]).toEqual(PULL);
  });

  it('a deleted exercise shows its fields read-only with Restore only; Restore makes it editable', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const { catalog } = await mount({ exercises: [PULL, gone], id: 'ring-rows' });
    expect(screen.getByText('This exercise was deleted. Restore it to edit.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Pattern' }) as HTMLSelectElement).disabled).toBe(true);
    for (const name of ['Save', 'Archive', 'Unarchive', 'Delete']) expect(screen.queryByRole('button', { name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await catalog())[1]).not.toHaveProperty('deletedAt'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy());
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('Restore when a live entry took the name meanwhile writes nothing and offers that entry (spec 1 §3)', async () => {
    // Another device named Rows "ring rows" offline before it saw the delete (the race spec 1 §3 accepts).
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const rows = exercise({ id: 'rows', name: 'ring rows' });
    const { store, router } = await mount({ exercises: [gone, rows], id: 'ring-rows' });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “ring rows” exists' });
    expect(writes).not.toHaveBeenCalled();
    expect(within(sheet).getByText('Names are unique in the catalog. Rename that one to restore this one, or open it.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use it' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'rows' });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('ring rows'));
  });

  it('Undo of a delete when another entry took the name meanwhile writes nothing and offers that entry', async () => {
    const { catalog, router, data } = await mount({ exercises: [PULL, CHIN], id: 'chin-ups' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.value?.text).toBe('Exercise deleted'));
    // Before Undo, a merge from another device that renamed Pull-ups offline (it had not seen the
    // delete) brings the deleted entry's name: the race spec 1 §3 accepts. A rename here would clash.
    await act(async () => {
      await data.edit('exercises', EXERCISES_PATH, (f) => ({
        ...f,
        exercises: f.exercises.map((e) => (e.id === 'pull-ups' ? { ...e, name: 'Chin-ups', updatedAt: '2030-03-10T08:00:00.001Z' } : e)),
      }));
    });
    const before = await catalog();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(toast.value?.text).toBe('Not restored: an exercise named “Chin-ups” exists'));
    expect(await catalog()).toEqual(before);
    expect(before.filter((e) => e.deletedAt === undefined).map((e) => e.id)).toEqual(['pull-ups']);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'pull-ups' });
  });

  it('a double tap on Save or Archive writes once', async () => {
    const { store } = await mount({ exercises: [PULL], id: 'pull-ups' });
    const writes = vi.spyOn(store, 'writeFile');
    const archive = screen.getByRole('button', { name: 'Archive' });
    fireEvent.click(archive);
    fireEvent.click(archive);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy());
    expect(writes).toHaveBeenCalledTimes(1);
    writes.mockClear();
    fireEvent.input(screen.getByRole('textbox', { name: 'Cues' }), { target: { value: 'hollow body' } });
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a refused write leaves Save enabled again', async () => {
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Cues' }), { target: { value: 'hollow body' } });
    vi.spyOn(m.data, 'edit').mockResolvedValue({ ok: false, reason: 'quarantined' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('This file is read-only (quarantined)'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a refused catalog shows the banner and no form', async () => {
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([PULL]), status: 'read-only', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exercises.json is read-only; the catalog cannot be changed here. See the Sync tab.'));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
