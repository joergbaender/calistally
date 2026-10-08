import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../model/test-fixtures';
import { openDb } from './db';
import { EXERCISES_PATH, sessionPath } from './paths';
import { Store, type FileRow } from './store';

async function makeStore(): Promise<{ store: Store; changes: string[] }> {
  const changes: string[] = [];
  const db = await openDb(new IDBFactory());
  return { store: new Store(db, { onChange: (p) => changes.push(p) }), changes };
}

const s1 = session([block(ladder([5, 4]))], { id: 'a1b2c3d4-0000-4000-8000-000000000001', date: '2030-02-03' });
const p1 = sessionPath(s1.date, s1.id);

describe('Store.writeFile', () => {
  it('creates a row with rev null, version 1 and a queue entry', async () => {
    const { store, changes } = await makeStore();
    const r = await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    expect(r).toEqual({ ok: true });
    const row = await store.getRow(p1);
    expect(row).toMatchObject({ path: p1, kind: 'session', rev: null, status: 'ok', version: 1, issues: [] });
    expect(await store.queue()).toEqual([{ path: p1, kind: 'session', enqueuedAt: '2030-02-03T10:00:00.000Z', attempts: 0 }]);
    expect(changes).toEqual([p1]);
  });

  it('coalesces repeated writes into one queue row and keeps the first enqueuedAt', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'x' }), new Date('2030-02-03T10:05:00.000Z'));
    expect(await store.queue()).toHaveLength(1);
    expect((await store.queue())[0]?.enqueuedAt).toBe('2030-02-03T10:00:00.000Z');
    expect((await store.getRow(p1))?.version).toBe(2);
  });

  it.each(['read-only', 'needs-update', 'quarantined'] as const)('refuses a write to a %s row and stores nothing', async (status) => {
    const { store } = await makeStore();
    const row: FileRow = { path: p1, kind: 'session', rev: 'r1', content: { schemaVersion: 9 }, status, issues: [], version: 3 };
    await store.saveRow(row);
    expect(await store.writeFile('session', p1, sessionFile(s1))).toEqual({ ok: false, reason: status });
    expect(await store.getRow(p1)).toEqual(row);
    expect(await store.queue()).toHaveLength(0);
  });

  it('refuses a write to the loser of a duplicate pair', async () => {
    const { store } = await makeStore();
    await store.saveRow({ path: p1, kind: 'session', rev: 'r1', content: sessionFile(s1), status: 'ok', issues: [], version: 1, duplicateOf: '/sessions/2030/2030-02-03_00000000.json' });
    expect(await store.writeFile('session', p1, sessionFile(s1))).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('keeps an invalid write locally and queued, marked held back, and releases it when a valid write follows', async () => {
    const { store } = await makeStore();
    const bad = sessionFile({ ...s1, date: '2030-02-30' });
    const r = await store.writeFile('session', p1, bad);
    expect(r.ok).toBe(true);
    expect(r.ok && r.heldBack?.[0]?.path).toBe('/session/date');
    expect((await store.getRow(p1))?.content).toEqual(bad);
    expect((await store.queue())[0]?.heldBack).toHaveLength(1);
    expect((await store.issues()).map((i) => i.reason)).toEqual(['held-back']);
    await store.writeFile('session', p1, sessionFile(s1));
    expect((await store.queue())[0]?.heldBack).toBeUndefined();
    expect(await store.issues()).toEqual([]);
  });

  it('fires onWrite on a successful writeFile only, never on saveRow, mutate or a refused write', async () => {
    const writes: string[] = [];
    const changes: string[] = [];
    const db = await openDb(new IDBFactory());
    const store = new Store(db, { onChange: (p) => changes.push(p), onWrite: (p) => writes.push(p) });
    await store.saveRow({ path: p1, kind: 'session', rev: 'r1', content: sessionFile(s1), status: 'ok', issues: [], version: 1 });
    await store.mutate(p1, (row) => (row === undefined ? {} : { row: { ...row, rev: 'r2' } }));
    expect(writes).toEqual([]);
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'z' }));
    expect(writes).toEqual([p1]);
    expect(await store.writeFile('session', p1, sessionFile(s1), new Date(), 99)).toEqual({ ok: false, reason: 'changed' });
    expect(writes).toEqual([p1]);
    expect(changes).toEqual([p1, p1, p1]);
  });

  it('keeps rev, syncedAt and remoteDeleted of an existing row', async () => {
    const { store } = await makeStore();
    await store.saveRow({ path: p1, kind: 'session', rev: 'r7', content: sessionFile(s1), status: 'ok', issues: [], version: 4, syncedAt: '2030-01-01T00:00:00.000Z', remoteDeleted: true });
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'y' }));
    expect(await store.getRow(p1)).toMatchObject({ rev: 'r7', version: 5, syncedAt: '2030-01-01T00:00:00.000Z', remoteDeleted: true });
  });
});

describe('Store read helpers', () => {
  it('orders the queue catalog, bodyweight, then sessions by enqueue time', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    await store.writeFile('bodyweight', '/bodyweight.json', { schemaVersion: 1, entries: [] }, new Date('2030-02-03T10:01:00.000Z'));
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([exercise()]), new Date('2030-02-03T10:02:00.000Z'));
    expect((await store.queue()).map((q) => q.path)).toEqual([EXERCISES_PATH, '/bodyweight.json', p1]);
  });

  it('hides non-ok rows and duplicate losers from sessions()', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1));
    await store.saveRow({ path: '/sessions/2030/2030-02-04_bbbbbbbb.json', kind: 'session', rev: 'r', content: {}, status: 'quarantined', issues: [{ level: 'hard', path: '/session', message: 'bad' }], version: 0 });
    await store.saveRow({ path: '/sessions/2030/2030-02-05_cccccccc.json', kind: 'session', rev: 'r', content: sessionFile(s1), status: 'ok', issues: [], version: 0, duplicateOf: p1 });
    expect((await store.sessions()).map((s) => s.path)).toEqual([p1]);
    expect((await store.issues()).map((i) => [i.path, i.reason])).toEqual([
      ['/sessions/2030/2030-02-04_bbbbbbbb.json', 'quarantined'],
      ['/sessions/2030/2030-02-05_cccccccc.json', 'duplicate'],
    ]);
  });

  it('lists unexpected paths and remote deletions as issues', async () => {
    const { store } = await makeStore();
    await store.setUnexpectedPaths(['/exercises (conflicted copy).json']);
    await store.saveRow({ path: p1, kind: 'session', rev: null, content: sessionFile(s1), status: 'ok', issues: [], version: 1, remoteDeleted: true });
    expect((await store.issues()).map((i) => i.reason)).toEqual(['unexpected-file', 'remote-deleted']);
  });

  it('returns the catalog only when its row is ok', async () => {
    const { store } = await makeStore();
    expect(await store.catalog()).toBeUndefined();
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([exercise()]));
    expect((await store.catalog())?.exercises).toHaveLength(1);
  });
});

describe('Store.finishQueueRow', () => {
  it('stores rev and syncedAt, clears remoteDeleted, and removes the queue row only when the version is unchanged', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1));
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'later' }));
    expect(await store.finishQueueRow(p1, 1, 'r1', '2030-02-03T10:00:00.000Z')).toBe(false);
    expect(await store.queue()).toHaveLength(1);
    expect((await store.getRow(p1))?.rev).toBe('r1');
    expect(await store.finishQueueRow(p1, 2, 'r2', '2030-02-03T10:01:00.000Z')).toBe(true);
    expect(await store.queue()).toHaveLength(0);
    expect(await store.getRow(p1)).toMatchObject({ rev: 'r2', syncedAt: '2030-02-03T10:01:00.000Z' });
  });
});

describe('Store.writeFile with an expected version', () => {
  it('writes when the row is still at the expected version (0 for an absent row)', async () => {
    const { store } = await makeStore();
    expect(await store.writeFile('session', p1, sessionFile(s1), new Date(), 0)).toEqual({ ok: true });
    expect(await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'x' }), new Date(), 1)).toEqual({ ok: true });
    expect((await store.getRow(p1))?.version).toBe(2);
  });

  it('refuses with changed and writes nothing when the row moved since the read', async () => {
    const { store, changes } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'newer' }), new Date('2030-02-03T10:01:00.000Z'));
    changes.length = 0;
    expect(await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'stale' }), new Date(), 1)).toEqual({ ok: false, reason: 'changed' });
    expect(await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'stale' }), new Date(), 0)).toEqual({ ok: false, reason: 'changed' });
    expect((await store.getRow(p1))?.version).toBe(2);
    expect(((await store.getRow(p1))?.content as { session: { notes?: string } }).session.notes).toBe('newer');
    expect(changes).toEqual([]);
  });
});

describe('Store.mutate', () => {
  it('stores, deletes or leaves each record by its field, in one transaction', async () => {
    const { store, changes } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    changes.length = 0;
    await store.mutate(p1, (row, queued) => ({ queue: { ...(queued as NonNullable<typeof queued>), attempts: 4 }, ...(row === undefined ? { row: null } : {}) }));
    expect((await store.getQueueRow(p1))?.attempts).toBe(4);
    expect(await store.getRow(p1)).toBeDefined();
    expect(changes).toEqual([]);
    await store.mutate(p1, () => ({ row: null, queue: null }));
    expect(await store.getRow(p1)).toBeUndefined();
    expect(await store.getQueueRow(p1)).toBeUndefined();
    expect(changes).toEqual([p1]);
  });

  it('sees a write that was issued before it, even when not awaited', async () => {
    const { store } = await makeStore();
    void store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    let seen: number | undefined;
    await store.mutate(p1, (row) => { seen = row?.version; return {}; });
    expect(seen).toBe(1);
  });
});
