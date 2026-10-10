import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile } from '../model/test-fixtures';
import type { Session, SessionFile } from '../model/types';
import type { ChangeChannel } from '../sync/channel';
import { openDb } from '../sync/db';
import type { SyncStatus } from '../sync/engine';
import { BODYWEIGHT_PATH, EXERCISES_PATH, sessionPath } from '../sync/paths';
import { Store, type FileRow, type WriteResult } from '../sync/store';
import { Data, sessionRowById, storeChanges, type DataDeps } from './data';

const NOW = new Date('2030-03-04T11:00:00.000Z');

const sA = session([block(ladder([5, 4]))], { id: 'a1b2c3d4-0000-4000-8000-000000000001', date: '2030-03-01' });
const sB = session([block(ladder([6]))], { id: 'a1b2c3d4-0000-4000-8000-000000000002', date: '2030-03-02' });
const sOpen = session([block(ladder([7]))], { id: 'a1b2c3d4-0000-4000-8000-000000000003', date: '2030-03-04', startedAt: '2030-03-04T10:00:00.000Z' });
const sGone = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000004', date: '2030-03-03', deletedAt: '2030-03-03T12:00:00.000Z' });
const pathOf = (s: Session) => sessionPath(s.date, s.id);

function okRow(s: Session, version = 1): FileRow {
  return { path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', issues: [], version };
}

const STATUS: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

class FakeEngine {
  status: SyncStatus = { ...STATUS };
  readonly listeners = new Set<(s: SyncStatus) => void>();
  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }
  emit(patch: Partial<SyncStatus>): void {
    Object.assign(this.status, patch);
    for (const l of this.listeners) l(this.status);
  }
}

class FakeChannel implements ChangeChannel {
  readonly listeners = new Set<(path: string) => void>();
  post(path: string): void {
    for (const l of this.listeners) l(path);
  }
  subscribe(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function makeStore(factory = new IDBFactory()): Promise<Store> {
  return new Store(await openDb(factory));
}

async function makeData(over: Partial<DataDeps> = {}): Promise<{ data: Data; store: Store; engine: FakeEngine; channel: FakeChannel }> {
  const store = over.store ?? (await makeStore());
  const engine = new FakeEngine();
  const channel = new FakeChannel();
  const data = new Data({ store, engine, channel, now: () => NOW, ...over });
  return { data, store, engine, channel };
}

describe('Data.load', () => {
  it('fills sessions (ok rows, not duplicates, with the row version), catalog and bodyweight', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA, 3));
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 2 });
    await store.saveRow({ path: BODYWEIGHT_PATH, kind: 'bodyweight', rev: 'r1', content: bodyweightFile([]), status: 'ok', issues: [], version: 5 });
    await data.load();
    expect(data.sessions.value).toEqual([{ path: pathOf(sA), file: sessionFile(sA), version: 3 }]);
    expect(data.catalog.value).toEqual({ file: exercisesFile([exercise()]), version: 2 });
    expect(data.bodyweight.value).toEqual({ file: bodyweightFile([]), version: 5 });
  });

  it('leaves catalog and bodyweight undefined when their rows are missing or not ok', async () => {
    const { data, store } = await makeData();
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: { schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await data.load();
    expect(data.catalog.value).toBeUndefined();
    expect(data.bodyweight.value).toBeUndefined();
  });

  it('collects refusedRows: a quarantined row and a duplicate', async () => {
    const { data, store } = await makeData();
    const bad: FileRow = { path: pathOf(sA), kind: 'session', rev: 'r1', content: { schemaVersion: 1 }, status: 'quarantined', issues: [{ level: 'schema', path: '/session', message: 'missing' }], version: 1 };
    const dup: FileRow = { ...okRow(sB), duplicateOf: pathOf(sA) };
    await store.saveRow(bad);
    await store.saveRow(dup);
    await store.saveRow(okRow(sOpen));
    await data.load();
    expect(data.refusedRows.value.map((r) => r.path).sort()).toEqual([bad.path, dup.path].sort());
    expect(data.sessions.value.map((r) => r.path)).toEqual([pathOf(sOpen)]);
  });

  it('reads issues from the store and status from the engine', async () => {
    const { data, store, engine } = await makeData();
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    engine.status.queueLength = 7;
    await data.load();
    expect(data.issues.value).toEqual(await store.issues());
    expect(data.issues.value.map((i) => i.reason)).toEqual(['duplicate']);
    expect(data.status.value.queueLength).toBe(7);
  });

  it('keeps status current through engine.subscribe and re-reads issues on each callback', async () => {
    const { data, store, engine } = await makeData();
    await data.load();
    expect(data.issues.value).toEqual([]);
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    engine.emit({ phase: 'pulling' });
    expect(data.status.value.phase).toBe('pulling');
    await vi.waitFor(() => expect(data.issues.value.map((i) => i.reason)).toEqual(['duplicate']));
  });

  it('has a disconnected default status without an engine', async () => {
    const store = await makeStore();
    const data = new Data({ store });
    await data.load();
    expect(data.status.value.connected).toBe(false);
    expect(data.status.value.phase).toBe('idle');
  });
});

describe('Data.refresh', () => {
  it('updates only the slice of that path', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 1 });
    await data.load();
    const catalogBefore = data.catalog.value;
    const bodyweightBefore = data.bodyweight.value;
    await store.saveRow(okRow(sB, 4));
    await data.refresh(pathOf(sB));
    expect(data.sessions.value.map((r) => [r.path, r.version])).toEqual([[pathOf(sA), 1], [pathOf(sB), 4]]);
    expect(data.catalog.value).toBe(catalogBefore);
    expect(data.bodyweight.value).toBe(bodyweightBefore);
  });

  it('replaces an existing session row in place and moves a row that turned refused', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA, 1));
    await data.load();
    await store.saveRow(okRow({ ...sA, notes: 'n' }, 2));
    await data.refresh(pathOf(sA));
    expect(data.sessions.value).toEqual([{ path: pathOf(sA), file: sessionFile({ ...sA, notes: 'n' }), version: 2 }]);
    await store.saveRow({ ...okRow(sA, 3), status: 'quarantined' });
    await data.refresh(pathOf(sA));
    expect(data.sessions.value).toEqual([]);
    expect(data.refusedRows.value.map((r) => r.path)).toEqual([pathOf(sA)]);
    await store.deleteRow(pathOf(sA));
    await data.refresh(pathOf(sA));
    expect(data.refusedRows.value).toEqual([]);
  });

  it('refreshes the catalog and bodyweight slices and the issues', async () => {
    const { data, store } = await makeData();
    await data.load();
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 1 });
    await data.refresh(EXERCISES_PATH);
    expect(data.catalog.value?.version).toBe(1);
    await store.saveRow({ path: BODYWEIGHT_PATH, kind: 'bodyweight', rev: 'r1', content: bodyweightFile([]), status: 'ok', issues: [], version: 1 });
    await data.refresh(BODYWEIGHT_PATH);
    expect(data.bodyweight.value?.version).toBe(1);
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    await data.refresh(pathOf(sB));
    expect(data.issues.value.map((i) => i.reason)).toEqual(['duplicate']);
  });

  it('runs on a channel message from another tab', async () => {
    const { data, store, channel } = await makeData();
    await data.load();
    await store.saveRow(okRow(sA));
    channel.post(pathOf(sA));
    await vi.waitFor(() => expect(data.sessions.value.map((r) => r.path)).toEqual([pathOf(sA)]));
  });
});

describe('Data computed signals', () => {
  it('liveSessions sorts by compareSessions with tombstones out', async () => {
    const { data, store } = await makeData();
    for (const s of [sOpen, sGone, sB, sA]) await store.saveRow(okRow(s));
    await data.load();
    expect(data.liveSessions.value.map((s) => s.id)).toEqual([sA.id, sB.id, sOpen.id]);
  });

  it('exercises and exerciseById include tombstoned entries; [] without a catalog', async () => {
    const { data, store } = await makeData();
    await data.load();
    expect(data.exercises.value).toEqual([]);
    expect(data.exerciseById.value.size).toBe(0);
    const gone = exercise({ id: 'dips', name: 'Dips', pattern: 'push', deletedAt: '2030-01-02T00:00:00.000Z' });
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise(), gone]), status: 'ok', issues: [], version: 1 });
    await data.refresh(EXERCISES_PATH);
    expect(data.exercises.value.map((e) => e.id)).toEqual(['pull-ups', 'dips']);
    expect(data.exerciseById.value.get('dips')).toEqual(gone);
  });

  it('openSession is the one isSessionOpen names and closes when now passes 3 h', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await store.saveRow(okRow(sOpen, 2));
    await data.load();
    expect(data.openSession.value).toEqual({ path: pathOf(sOpen), file: sessionFile(sOpen), version: 2 });
    data.now.value = new Date('2030-03-04T13:00:00.000Z');
    expect(data.openSession.value).toBeUndefined();
  });

  it('softIssues runs checkCatalogRules per live session and is [] without a catalog', async () => {
    const { data, store } = await makeData();
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'a1b2c3d4-0000-4000-8000-000000000005', date: '2030-03-05' });
    await store.saveRow(okRow(sA));
    await store.saveRow(okRow(unknown));
    await store.saveRow(okRow({ ...sGone, blocks: [block([], { exerciseId: 'nope' })] }));
    await data.load();
    expect(data.softIssues.value).toEqual([]);
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 1 });
    await data.refresh(EXERCISES_PATH);
    expect(data.softIssues.value).toEqual([
      { path: pathOf(unknown), sessionId: unknown.id, date: '2030-03-05', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise nope' }] },
    ]);
  });

  it('heldBackCount counts the queue rows that are held back', async () => {
    const { data, store } = await makeData();
    await store.writeFile('session', pathOf(sA), sessionFile({ ...sA, date: '2030-02-30' }), NOW);
    await store.writeFile('session', pathOf(sB), sessionFile(sB), NOW);
    await data.load();
    expect(data.heldBackCount.value).toBe(1);
    await store.writeFile('session', pathOf(sA), sessionFile(sA), NOW);
    await data.refresh(pathOf(sA));
    expect(data.heldBackCount.value).toBe(0);
  });
});

describe('Data.create', () => {
  it('writes a new file with expectedVersion 0', async () => {
    const { data, store } = await makeData();
    await data.load();
    expect(await data.create('session', pathOf(sA), sessionFile(sA))).toEqual({ ok: true, heldBack: false });
    expect((await store.getRow(pathOf(sA)))?.version).toBe(1);
  });

  it("returns 'changed' when the path already exists", async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await data.load();
    expect(await data.create('session', pathOf(sA), sessionFile(sA))).toEqual({ ok: false, reason: 'changed' });
  });
});

describe('Data.edit', () => {
  it('applies fn to the fresh content and writes with the row version', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA, 4));
    await data.load();
    const seen: SessionFile[] = [];
    const r = await data.edit('session', pathOf(sA), (f) => {
      seen.push(f);
      return sessionFile({ ...f.session, notes: 'edited' });
    });
    expect(r).toEqual({ ok: true, heldBack: false });
    expect(seen).toEqual([sessionFile(sA)]);
    const row = await store.getRow(pathOf(sA));
    expect(row?.version).toBe(5);
    expect((row?.content as SessionFile).session.notes).toBe('edited');
  });

  it('reports heldBack when the result fails validation; the store still saved it', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await data.load();
    const broken = (f: SessionFile): SessionFile => {
      const b = f.session.blocks[0];
      if (b === undefined) throw new Error('fixture');
      const s0 = b.sets[0];
      if (s0 === undefined) throw new Error('fixture');
      return sessionFile({ ...f.session, blocks: [{ ...b, sets: [{ ...s0, reps: -1 }, ...b.sets.slice(1)] }] });
    };
    expect(await data.edit('session', pathOf(sA), broken)).toEqual({ ok: true, heldBack: true });
    expect((await store.queue())[0]?.heldBack).toBeDefined();
    expect((await store.getRow(pathOf(sA)))?.version).toBe(2);
  });

  it("returns 'missing' only without a row (or a row of another kind); a refused row names its reason", async () => {
    const { data, store } = await makeData();
    const sQ = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000011', date: '2030-02-11' });
    const sR = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000012', date: '2030-02-12' });
    const sN = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000013', date: '2030-02-13' });
    await store.saveRow({ ...okRow(sQ), status: 'quarantined' });
    await store.saveRow({ ...okRow(sR), status: 'read-only' });
    await store.saveRow({ ...okRow(sN), status: 'needs-update' });
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sQ) });
    await store.saveRow(okRow(sA));
    await data.load();
    const calls: string[] = [];
    const fn = (f: SessionFile) => { calls.push(f.session.id); return sessionFile({ ...f.session, notes: 'x' }); };
    expect(await data.edit('session', pathOf(sOpen), fn)).toEqual({ ok: false, reason: 'missing' });
    expect(await data.edit('session', pathOf(sQ), fn)).toEqual({ ok: false, reason: 'quarantined' });
    expect(await data.edit('session', pathOf(sR), fn)).toEqual({ ok: false, reason: 'read-only' });
    expect(await data.edit('session', pathOf(sN), fn)).toEqual({ ok: false, reason: 'needs-update' });
    expect(await data.edit('session', pathOf(sB), fn)).toEqual({ ok: false, reason: 'duplicate' });
    // The kind ties the file type: an exercises edit on a session path finds no exercises row.
    expect(await data.edit('exercises', pathOf(sA), (f) => ({ ...f, exercises: [] }))).toEqual({ ok: false, reason: 'missing' });
    expect(calls).toEqual([]);
    expect((await store.getRow(pathOf(sA)))?.version).toBe(1);
  });

  it('writes nothing when fn returns its input or a file with the same canonical JSON', async () => {
    const { data, store } = await makeData();
    await store.saveRow({ ...okRow(sA, 3), remoteDeleted: true });
    await data.load();
    const writes = vi.spyOn(store, 'writeFile');
    expect(await data.edit('session', pathOf(sA), (f) => f)).toEqual({ ok: true, heldBack: false });
    // A copy with the keys in another order is the same content.
    expect(await data.edit('session', pathOf(sA), (f) => ({ session: { ...f.session }, schemaVersion: f.schemaVersion }))).toEqual({ ok: true, heldBack: false });
    expect(writes).not.toHaveBeenCalled();
    expect((await store.getRow(pathOf(sA)))?.version).toBe(3);
    expect(await store.queue()).toEqual([]);
  });

  /** A store where another writer (a pull merging the PC's change) lands between Data.edit's read
   *  and its write, for the first `races` writes: the write then meets a moved version for real. */
  class RacyStore extends Store {
    writes = 0;
    constructor(db: ConstructorParameters<typeof Store>[0], private readonly races: number) {
      super(db);
    }
    override async writeFile(...args: Parameters<Store['writeFile']>): Promise<WriteResult> {
      this.writes += 1;
      if (this.writes <= this.races) {
        const row = await this.getRow(args[1]);
        if (row === undefined) throw new Error('fixture');
        const file = row.content as SessionFile;
        await this.saveRow({ ...row, content: sessionFile({ ...file.session, tags: [...file.session.tags, `pc ${this.writes}`] }), version: row.version + 1 });
      }
      return super.writeFile(...args);
    }
  }

  it("replays fn once on 'changed' on the fresh row, so the other writer's change is kept", async () => {
    const store = new RacyStore(await openDb(new IDBFactory()), 1);
    const { data } = await makeData({ store });
    await store.saveRow(okRow(sA));
    await data.load();
    let calls = 0;
    const r = await data.edit('session', pathOf(sA), (f) => {
      calls += 1;
      return sessionFile({ ...f.session, notes: `try ${calls}` });
    });
    expect(r).toEqual({ ok: true, heldBack: false });
    expect(calls).toBe(2);
    expect(store.writes).toBe(2);
    const row = await store.getRow(pathOf(sA));
    expect(row?.content).toEqual(sessionFile({ ...sA, tags: ['pc 1'], notes: 'try 2' }));
    expect(row?.version).toBe(3);
  });

  it("gives up with 'changed' after a second 'changed' in a row and writes nothing of its own", async () => {
    const store = new RacyStore(await openDb(new IDBFactory()), 2);
    const { data } = await makeData({ store });
    await store.saveRow(okRow(sA));
    await data.load();
    let calls = 0;
    const r = await data.edit('session', pathOf(sA), (f) => { calls += 1; return sessionFile({ ...f.session, notes: 'mine' }); });
    expect(r).toEqual({ ok: false, reason: 'changed' });
    expect(calls).toBe(2);
    const session2 = ((await store.getRow(pathOf(sA)))?.content as SessionFile).session;
    expect(session2.tags).toEqual(['pc 1', 'pc 2']);
    expect(session2.notes).toBeUndefined();
  });
});

describe('Data.retryLeftMs', () => {
  it('counts the engine retry down from the time its status arrived, floored at 0', async () => {
    let current = NOW;
    const { data, engine } = await makeData({ now: () => current });
    await data.load();
    expect(data.retryLeftMs.value).toBeUndefined();
    engine.emit({ retryInMs: 10_000 });
    expect(data.retryLeftMs.value).toBe(10_000);
    current = new Date(NOW.getTime() + 4_000);
    data.now.value = current;
    expect(data.retryLeftMs.value).toBe(6_000);
    current = new Date(NOW.getTime() + 15_000);
    data.now.value = current;
    expect(data.retryLeftMs.value).toBe(0);
    engine.emit({ retryInMs: 2_000 });
    expect(data.retryLeftMs.value).toBe(2_000);
    engine.emit({ retryInMs: undefined });
    expect(data.retryLeftMs.value).toBeUndefined();
  });
});

describe('storeChanges', () => {
  it("delivers the store's onChange to this tab's Data and posts it to the other tabs", async () => {
    const channel = new FakeChannel();
    const posted: string[] = [];
    channel.subscribe((p) => posted.push(p));
    const changes = storeChanges(channel);
    const store = new Store(await openDb(new IDBFactory()), { onChange: changes.onChange });
    // A change before Data exists only goes to the channel.
    await store.writeFile('session', pathOf(sB), sessionFile(sB), NOW);
    const data = new Data({ store, now: () => NOW });
    changes.bind(data);
    await data.load();
    expect(data.sessions.value.map((r) => r.path)).toEqual([pathOf(sB)]);
    // No manual refresh: the store's own event updates the signals.
    await store.writeFile('session', pathOf(sA), sessionFile(sA), NOW);
    await vi.waitFor(() => expect(data.sessions.value.map((r) => r.path).sort()).toEqual([pathOf(sA), pathOf(sB)].sort()));
    expect(posted).toEqual([pathOf(sB), pathOf(sA)]);
  });
});

describe('Data meta, clock and dispose', () => {
  it('getMeta and setMeta go to the store meta', async () => {
    const { data, store } = await makeData();
    expect(await data.getMeta<string>('daysChip')).toBeUndefined();
    await data.setMeta('daysChip', 'push');
    expect(await data.getMeta<string>('daysChip')).toBe('push');
    expect(await store.getMeta<string>('daysChip')).toBe('push');
  });

  it('clock() reads the injected clock afresh on every call, without waiting for the now tick', async () => {
    let current = NOW;
    const { data } = await makeData({ now: () => current });
    expect(data.clock()).toEqual(NOW);
    current = new Date('2030-03-04T11:00:42.000Z');
    expect(data.clock()).toEqual(current);
    expect(data.now.value).toEqual(NOW);
  });

  it('setClock uses the injected interval: fast 1000, slow 60000, off clears', async () => {
    const intervals: { fn: () => void; ms: number; id: number }[] = [];
    const cleared: unknown[] = [];
    let nextId = 1;
    let current = NOW;
    const { data } = await makeData({
      now: () => current,
      setInterval: (fn, ms) => { const id = nextId++; intervals.push({ fn, ms, id }); return id; },
      clearInterval: (id) => cleared.push(id),
    });
    data.setClock('fast');
    expect(intervals.map((i) => i.ms)).toEqual([1000]);
    current = new Date('2030-03-04T11:00:01.000Z');
    intervals[0]?.fn();
    expect(data.now.value).toEqual(current);
    data.setClock('slow');
    expect(cleared).toEqual([1]);
    expect(intervals.map((i) => i.ms)).toEqual([1000, 60000]);
    data.setClock('off');
    expect(cleared).toEqual([1, 2]);
    data.setClock('off');
    expect(cleared).toEqual([1, 2]);
  });

  it('dispose clears the interval and unsubscribes from engine and channel', async () => {
    const cleared: unknown[] = [];
    const { data, engine, channel } = await makeData({ setInterval: () => 'tick', clearInterval: (id) => cleared.push(id) });
    await data.load();
    expect(engine.listeners.size).toBe(1);
    expect(channel.listeners.size).toBe(1);
    data.setClock('fast');
    data.dispose();
    expect(cleared).toEqual(['tick']);
    expect(engine.listeners.size).toBe(0);
    expect(channel.listeners.size).toBe(0);
    engine.emit({ phase: 'pushing' });
    expect(data.status.value.phase).toBe('idle');
  });
});

describe('sessionRowById', () => {
  it('finds a row by session id', () => {
    const rows = [{ path: pathOf(sA), file: sessionFile(sA), version: 1 }, { path: pathOf(sB), file: sessionFile(sB), version: 1 }];
    expect(sessionRowById(rows, sB.id)?.path).toBe(pathOf(sB));
    expect(sessionRowById(rows, 'nope')).toBeUndefined();
  });
});
