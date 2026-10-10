import { signal } from '@preact/signals';
import { render } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import type { ComponentChildren } from 'preact';
import { expect, vi } from 'vitest';
import { exercisesFile, sessionFile } from '../model/test-fixtures';
import type { Exercise, FileKind, Session, SessionFile } from '../model/types';
import { openDb } from '../sync/db';
import { EXERCISES_PATH, sessionPath } from '../sync/paths';
import { Store } from '../sync/store';
import { AppContext, type AppDeps, type SyncActions } from './context';
import { Data, storeChanges, type FileOf, type WriteOutcome } from './data';
import { Router, type RouterWindow } from './router';

/** Test-only, shared by the component tests of every tab: a real Data over a Store on a fresh fake
 *  IndexedDB, with the files written through the store. */

export const pathOf = (s: Session): string => sessionPath(s.date, s.id);

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

export interface Mounted { data: Data; store: Store; deps: AppDeps }

export async function setup(input: { now: Date; sessions: Session[]; exercises?: Exercise[] | undefined; meta?: Record<string, unknown> }): Promise<Mounted> {
  const db = await openDb(new IDBFactory());
  // The same wiring as main.tsx: the store's own events reach Data (no channel in a test).
  const changes = storeChanges(undefined);
  const store = new Store(db, { onChange: changes.onChange });
  const files: [FileKind, string, unknown][] = input.sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)]);
  if (input.exercises !== undefined) files.unshift(['exercises', EXERCISES_PATH, exercisesFile(input.exercises)]);
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, input.now);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(input.meta ?? {})) await store.setMeta(key, value);
  const data = new Data({ store, now: () => input.now });
  changes.bind(data);
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
  return { data, store, deps: { data, router: new Router(fakeWindow()), sync, ui } };
}

export function renderIn(deps: AppDeps, children: ComponentChildren): void {
  render(<AppContext.Provider value={deps}>{children}</AppContext.Provider>);
}

export async function fileAt(store: Store, path: string): Promise<SessionFile> {
  return (await store.getRow(path))?.content as SessionFile;
}

/** Every write of `data` that goes through reports `heldBack: true`, as a write that fails
 *  validation would (spec 3 §5), so the screens' held-back toast can be tested. */
export function reportHeldBack(data: Data): void {
  const edit = data.edit.bind(data);
  const create = data.create.bind(data);
  const held = (r: WriteOutcome): WriteOutcome => (r.ok ? { ok: true, heldBack: true } : r);
  vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>) => held(await edit(kind, path, fn)));
  vi.spyOn(data, 'create').mockImplementation(async (kind: FileKind, path: string, file: unknown) => held(await create(kind, path, file)));
}
