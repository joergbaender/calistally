// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteBodyweightEntry, setBodyweightEntry } from '../../../model/edit-bodyweight';
import { bodyweight, bodyweightFile } from '../../../model/test-fixtures';
import type { BodyweightEntry, BodyweightFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { BODYWEIGHT_PATH } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatAmount, localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { dismissToast, toast } from '../../toast';
import { ToastHost } from '../shared';
import { BodyweightPage } from './BodyweightPage';

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
});

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/more/bodyweight' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

/** The clock of Data: every write must take its time from it (`data.clock()`). */
const NOW = new Date('2030-03-10T08:00:00.000Z');

async function mount(entries?: BodyweightEntry[]) {
  let data: Data | undefined;
  const store = new Store(await openDb(new IDBFactory()), { onChange: (path) => void data?.refresh(path) });
  if (entries !== undefined) await store.writeFile('bodyweight', BODYWEIGHT_PATH, bodyweightFile(entries), new Date(), 0);
  data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const deps: AppDeps = {
    data,
    router: new Router(fakeWindow()),
    sync,
    ui: {
      connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    },
  };
  render(
    <AppContext.Provider value={deps}>
      <BodyweightPage />
      <ToastHost />
    </AppContext.Provider>,
  );
  const stored = async (): Promise<BodyweightFile | undefined> => (await store.getRow(BODYWEIGHT_PATH))?.content as BodyweightFile | undefined;
  return { ...deps, store, stored };
}

const press = (...keys: string[]): void => {
  for (const k of keys) fireEvent.click(screen.getByRole('button', { name: k }));
};

describe('BodyweightPage', () => {
  it('Add entry creates bodyweight.json with the entry when no file exists', async () => {
    const d = await mount();
    expect(screen.queryByRole('img', { name: 'Bodyweight over time' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('7', '9', '.', '5', 'Use');
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    expect(date.value).toBe(localDate(d.data.now.value));
    fireEvent.input(date, { target: { value: '2030-03-07' } });
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: ' fasted ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      const file = await d.stored();
      expect(file?.entries).toHaveLength(1);
    });
    const entry = (await d.stored())?.entries[0];
    expect(entry).toMatchObject({ date: '2030-03-07', kg: 79.5, note: 'fasted', updatedAt: NOW.toISOString() });
    await waitFor(() => expect(screen.getByText(`${formatAmount(79.5)} kg`)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Add entry appends to an existing file', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '1', 'Use');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries).toHaveLength(2));
    expect((await d.stored())?.entries[1]).toMatchObject({ kg: 81 });
  });

  it('refuses a weight with more than one decimal', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '0', '.', '2', '5', 'Use');
    expect(screen.getByText('One decimal at most')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('draws the line with min and max labels from two entries on', async () => {
    await mount([bodyweight({ date: '2030-03-01', kg: 80 }), bodyweight({ date: '2030-03-08', kg: 82.5 })]);
    const svg = screen.getByRole('img', { name: 'Bodyweight over time' });
    expect(svg.querySelector('polyline')?.getAttribute('points')).toMatch(/^[\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
    const labels = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels).toEqual([`${formatAmount(82.5)} kg`, `${formatAmount(80)} kg`]);
  });

  it('tapping a row edits the entry', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeTruthy();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2030-03-01');
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]).toMatchObject({ id: a.id, kg: 80, note: 'evening' }));
  });

  it('Delete tombstones the entry, Undo restores it', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const b = bodyweight({ date: '2030-03-02', kg: 81 });
    const d = await mount([a, b]);
    fireEvent.click(screen.getByRole('button', { name: /81 kg/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect((await d.stored())?.entries[1]?.deletedAt).toBeDefined());
    await waitFor(() => expect(screen.queryByRole('button', { name: /81 kg/ })).toBeNull());
    expect((await d.stored())?.entries[0]).toEqual(a);

    expect(toast.value?.ms).toBe(6000);
    expect((await d.stored())?.entries[1]?.deletedAt).toBe(NOW.toISOString());
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await d.stored())?.entries[1]?.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('button', { name: /81 kg/ })).toBeTruthy());
  });

  it('the kg pad reads Use and does not accept 0', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('0');
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('a migrated two-decimal entry can still get a new note and date', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80.25 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${formatAmount(80.25)} kg`) }));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'migrated' } });
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2030-03-02' } });
    expect(screen.queryByText('One decimal at most')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]).toMatchObject({ id: a.id, kg: 80.25, date: '2030-03-02', note: 'migrated', updatedAt: NOW.toISOString() }));
  });

  it('an edit Save that changes nothing writes nothing and closes the sheet', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80, note: 'fasted' });
    const d = await mount([a]);
    const before = await d.store.getRow(BODYWEIGHT_PATH);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: ' fasted ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = await d.store.getRow(BODYWEIGHT_PATH);
    expect(after?.version).toBe(before?.version);
    expect((await d.stored())?.entries[0]).toEqual(a);
  });

  it('an edit writes only the fields changed in the sheet, keeping a change made elsewhere meanwhile', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    // Another device changes the kg while the sheet is open.
    await d.data.edit('bodyweight', BODYWEIGHT_PATH, (f) => setBodyweightEntry(f, a.id, { kg: 82 }, NOW));
    await waitFor(async () => expect((await d.stored())?.entries[0]?.kg).toBe(82));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]?.note).toBe('evening'));
    expect((await d.stored())?.entries[0]).toMatchObject({ kg: 82, date: '2030-03-01' });
  });

  it('the date defaults to the clock\'s day, not the slow `now` tick (after a resume or past midnight)', async () => {
    const d = await mount();
    act(() => { d.data.now.value = new Date('2030-03-09T08:00:00.000Z'); });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '0', 'Use');
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(localDate(NOW));
  });

  it('typing 0 on the kg pad says why Use is disabled', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('0');
    expect(screen.getByText('More than 0 kg')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    press('Backspace', '8');
    expect(screen.queryByText('More than 0 kg')).toBeNull();
  });

  it('the kg pad has exactly one Cancel; it and Escape go back to the form and keep the typed note', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Weight' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit entry' });
    expect(within(sheet).getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Note') as HTMLInputElement).value).toBe('evening');
    fireEvent.click(screen.getByRole('button', { name: 'Weight' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit entry' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeTruthy();
    expect((screen.getByLabelText('Note') as HTMLInputElement).value).toBe('evening');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]).toMatchObject({ id: a.id, note: 'evening' }));
  });

  it('a new entry\'s pad Cancel without a kg closes the sheet', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add entry' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a double tap on Save appends one entry', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '1', 'Use');
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await d.stored())?.entries).toHaveLength(2);
  });

  it('a refused write shows the reason and leaves Save enabled', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '1', 'Use');
    // The file turns quarantined after the sheet opened (a pull).
    const row = await d.store.getRow(BODYWEIGHT_PATH);
    if (row === undefined) throw new Error('no row');
    await d.store.saveRow({ ...row, status: 'quarantined' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('This file is read-only (quarantined)'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    expect((await d.stored())?.entries).toHaveLength(1);
  });

  it('an edit or Delete of an entry another device deleted meanwhile writes nothing and says so', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    await d.data.edit('bodyweight', BODYWEIGHT_PATH, (f) => deleteBodyweightEntry(f, a.id, NOW));
    const before = (await d.store.getRow(BODYWEIGHT_PATH))?.version;
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('This entry was deleted elsewhere'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false));
    expect(toast.value?.text).toBe('This entry was deleted elsewhere');
    expect((await d.store.getRow(BODYWEIGHT_PATH))?.version).toBe(before);
    expect((await d.stored())?.entries[0]).not.toHaveProperty('note');
  });

  it('a read-only bodyweight.json (written by a newer app) still lists its entries and line, without edit controls', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 }), bodyweight({ date: '2030-03-08', kg: 81 })]);
    const row = await d.store.getRow(BODYWEIGHT_PATH);
    if (row === undefined) throw new Error('no row');
    await d.store.saveRow({ ...row, status: 'needs-update', content: { ...(row.content as BodyweightFile), schemaVersion: 99 } });
    await act(async () => { await d.data.refresh(BODYWEIGHT_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('bodyweight.json is needs-update'));
    expect(screen.getByRole('button', { name: /81 kg/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('img', { name: 'Bodyweight over time' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add entry' })).toBeNull();
    expect(screen.queryByText('No entries yet.')).toBeNull();
  });

  it('a quarantined bodyweight.json shows the banner, no Add entry and no "No entries yet."', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    const row = await d.store.getRow(BODYWEIGHT_PATH);
    if (row === undefined) throw new Error('no row');
    await d.store.saveRow({ ...row, status: 'quarantined' });
    await act(async () => { await d.data.refresh(BODYWEIGHT_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('bodyweight.json is quarantined'));
    expect(screen.queryByRole('button', { name: 'Add entry' })).toBeNull();
    expect(screen.queryByText('No entries yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: /80 kg/ })).toBeNull();
  });

  it('Back goes to the More menu', async () => {
    const d = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(d.router.route.value).toEqual({ tab: 'more' });
  });
});
