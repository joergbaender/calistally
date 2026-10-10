// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import type { SyncStatus } from '../../../sync/engine';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import type { Issue, IssueReason } from '../../../sync/store';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { Router, type RouterWindow } from '../../router';
import { SyncTab } from './SyncTab';

const URL_WITH_QUERY = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';
const STATUS: SyncStatus = { phase: 'idle', online: true, connected: false, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/sync' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const NOW = new Date('2030-03-04T11:00:00.000Z');

async function deps(over: { connected?: boolean; pasteMode?: boolean; pasteUrl?: string; status?: Partial<SyncStatus>; issues?: Issue[]; sessions?: Session[]; exercises?: Exercise[] } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  if (over.exercises !== undefined) await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(over.exercises), NOW);
  for (const s of over.sessions ?? []) await store.writeFile('session', sessionPath(s.date, s.id), sessionFile(s), NOW);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  data.status.value = { ...STATUS, ...over.status };
  data.issues.value = over.issues ?? [];
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(over.connected ?? false), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(over.pasteMode ?? false), pasteUrl: signal<string | undefined>(over.pasteUrl), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const all: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  return { ...all, mount: () => render(<AppContext.Provider value={all}><SyncTab /></AppContext.Provider>) };
}

describe('SyncTab, not connected', () => {
  it('Connect and Paste a code call their actions', async () => {
    const d = await deps();
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Dropbox' }));
    expect(d.sync.connect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a code instead' }));
    expect(d.sync.startPaste).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Not connected.')).toBeTruthy();
  });

  it('still lists the issues and the data the badge counts; no Status without a connection', async () => {
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'c1000000-0000-4000-8000-000000000001', date: '2030-03-02' });
    const d = await deps({
      sessions: [unknown],
      exercises: [exercise()],
      issues: [{ path: '/sessions/2030/2030-03-01_x.json', reason: 'held-back', detail: '/session/date: bad' }],
    });
    d.mount();
    expect(screen.getByText('Held back')).toBeTruthy();
    expect(screen.getByText('Unknown exercise')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeTruthy();
    expect(screen.getByText('Build b1 · storage persistent')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('says Connect again and keeps the data when the device holds local rows', async () => {
    const d = await deps({ status: { queueLength: 2 } });
    d.mount();
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
    expect(screen.getByText(/queued changes are kept/)).toBeTruthy();
  });

  it('shows the Dropbox link as a real link next to the code field (ported shell test)', async () => {
    const d = await deps({ pasteMode: true, pasteUrl: URL_WITH_QUERY });
    d.mount();
    const link = screen.getByRole('link', { name: 'Open Dropbox to get the code' });
    expect(link.getAttribute('href')).toBe(URL_WITH_QUERY);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(document.getElementById('code')).toBeTruthy();
    expect(screen.getByText('Dropbox may ask you to log in inside this sheet')).toBeTruthy();
  });

  it('shows the code field but no link while the login is being prepared; neither outside paste mode', async () => {
    const d = await deps({ pasteMode: true });
    d.mount();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Preparing the Dropbox link…')).toBeTruthy();
    expect(document.getElementById('code')).toBeTruthy();
    act(() => { d.ui.pasteMode.value = false; });
    expect(document.getElementById('code')).toBeNull();
  });

  it('Finish login passes the typed code, kept across a re-render (ported shell test)', async () => {
    const d = await deps({ pasteMode: true, pasteUrl: URL_WITH_QUERY });
    d.mount();
    const field = document.getElementById('code') as HTMLInputElement;
    fireEvent.input(field, { target: { value: ' abc123 ' } });
    act(() => { d.ui.loginError.value = 'login failed'; });
    expect(screen.getByText('login failed')).toBeTruthy();
    expect((document.getElementById('code') as HTMLInputElement).value).toBe(' abc123 ');
    fireEvent.click(screen.getByRole('button', { name: 'Finish login' }));
    expect(d.sync.submitCode).toHaveBeenCalledWith('abc123');
  });
});

describe('SyncTab, connected', () => {
  it('Sync now, Sign out and the status rows', async () => {
    const d = await deps({ connected: true, status: { connected: true, queueLength: 3, heldBackCount: 1, lastError: 'boom' } });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(d.sync.syncNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(d.sync.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3 (1 held back)')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Build b1 · storage persistent')).toBeTruthy();
  });

  it('says Connected in one line and orders the sections as spec 4 §7: Connection, Update, Status, Issues, Data', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    expect(screen.getByText('Connected to Dropbox.')).toBeTruthy();
    const order = Array.from(document.querySelectorAll('.sync section')).map((s) => s.querySelector('h2')?.textContent ?? s.querySelector('button')?.textContent);
    expect(order).toEqual(['Dropbox', 'Update app', 'Status', 'Issues', 'Data']);
  });

  it('the empty-folder choice follows the connection card', async () => {
    const d = await deps({ connected: true, status: { connected: true, emptyFolder: true } });
    d.mount();
    const titles = Array.from(document.querySelectorAll('.sync section h2')).map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual(['Dropbox', 'Empty Dropbox folder']);
  });

  it('counts the retry down as the clock ticks', async () => {
    const d = await deps({ connected: true, status: { connected: true, retryInMs: 10_000 } });
    d.mount();
    expect(screen.getByText('idle · retry in 10 s')).toBeTruthy();
    act(() => { d.data.now.value = new Date(NOW.getTime() + 3_000); });
    expect(screen.getByText('idle · retry in 7 s')).toBeTruthy();
    act(() => { d.data.now.value = new Date(NOW.getTime() + 30_000); });
    expect(screen.getByText('idle · retry in 0 s')).toBeTruthy();
  });

  it('Sync now is disabled while the engine works', async () => {
    const d = await deps({ connected: true, status: { connected: true, phase: 'pulling' } });
    d.mount();
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty folder offers the two choices', async () => {
    const d = await deps({ connected: true, status: { connected: true, emptyFolder: true } });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start with the seed catalog' }));
    expect(d.sync.chooseEmptyFolder).toHaveBeenCalledWith('seed');
    fireEvent.click(screen.getByRole('button', { name: "I'll copy files in, then sync" }));
    expect(d.sync.chooseEmptyFolder).toHaveBeenCalledWith('copy');
  });

  const CARDS: ReadonlyArray<readonly [IssueReason, string, string]> = [
    ['quarantined', 'Quarantined', "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it."],
    ['read-only', 'Read-only', 'Written by a newer app; update this app.'],
    ['needs-update', 'Needs a newer app', 'Written by a newer app; update this app.'],
    ['held-back', 'Held back', 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.'],
    ['duplicate', 'Duplicate file', 'Remove the second file in Dropbox; the first one holds the merged content.'],
    ['remote-deleted', 'Removed from Dropbox', 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.'],
    ['unexpected-file', 'Unexpected file', 'Not a CalisTally file; ignored.'],
    ['push-error', 'Upload failed', 'Retried automatically on the next sync.'],
  ];

  it.each(CARDS)('renders a %s card with its title, path, detail and advice', async (reason, title, advice) => {
    const d = await deps({ connected: true, status: { connected: true }, issues: [{ path: '/sessions/2030/2030-03-04_a.json', reason, detail: `the ${reason} detail` }] });
    d.mount();
    expect(document.querySelectorAll('.sync-issue')).toHaveLength(1);
    const card = document.querySelector('.sync-issue') as HTMLElement;
    expect(within(card).getByText(title)).toBeTruthy();
    expect(within(card).getByText('/sessions/2030/2030-03-04_a.json')).toBeTruthy();
    expect(within(card).getByText(`the ${reason} detail`)).toBeTruthy();
    expect(within(card).getByText(advice)).toBeTruthy();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('renders a soft card for a session with an unknown exercise, linking to its page', async () => {
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'c1000000-0000-4000-8000-000000000002', date: '2030-03-02' });
    const d = await deps({ connected: true, status: { connected: true }, sessions: [unknown], exercises: [exercise()] });
    d.mount();
    const card = document.querySelector('.sync-issue--soft') as HTMLElement;
    expect(within(card).getByText('Unknown exercise')).toBeTruthy();
    expect(within(card).getByText(/block 1: unknown exercise nope/)).toBeTruthy();
    expect(within(card).getByText('Nothing is blocked; open the session to fix the block.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open the session' }).getAttribute('href')).toBe(`#/days/${unknown.id}`);
  });

  it('shows None without issues', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    d.mount();
    expect(screen.getByText('None.')).toBeTruthy();
  });
});

describe('SyncTab, update', () => {
  it("hides the button without a waiting build; tapping it runs 'reloading' and stays Updating…", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    d.mount();
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
    act(() => { d.ui.updateAvailable.value = true; });
    const button = screen.getByRole('button', { name: 'Update app' });
    fireEvent.click(button);
    expect(d.sync.updateApp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();
    const after = screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement;
    expect(after.disabled).toBe(true);
  });

  it("'busy' once → Still syncing and a second call; 'busy' twice → Could not update, enabled again", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    // The second call stays pending until the test releases it, so the DOM shows the retrying state.
    let release: (r: 'reloading' | 'busy') => void = () => undefined;
    (d.sync.updateApp as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('busy')
      .mockImplementationOnce(() => new Promise<'reloading' | 'busy'>((r) => { release = r; }));
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Still syncing, trying again' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Still syncing, trying again' }) as HTMLButtonElement).disabled).toBe(true);
    release('busy');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Could not update; try again after sync' })).toBeTruthy());
    expect(d.sync.updateApp).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Could not update; try again after sync' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("'busy' then 'reloading' stays Updating…", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    (d.sync.updateApp as ReturnType<typeof vi.fn>).mockResolvedValueOnce('busy').mockResolvedValueOnce('reloading');
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    await waitFor(() => expect(d.sync.updateApp).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
  });

  it('a rejected update ends in Could not update, enabled again', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    (d.sync.updateApp as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no service worker'));
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    const button = await screen.findByRole('button', { name: 'Could not update; try again after sync' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the too-new notice when a newer build wrote files and no update is offered', async () => {
    const d = await deps({ connected: true, status: { connected: true, tooNewSeen: true } });
    d.mount();
    expect(screen.getByText(/A newer version of the app wrote some files/)).toBeTruthy();
  });
});
