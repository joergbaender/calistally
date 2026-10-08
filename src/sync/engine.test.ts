import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { readFile } from '../model/read';
import { tombstone } from '../model/record';
import { block, exercise, exercisesFile, ladder, session, sessionFile, set } from '../model/test-fixtures';
import type { Exercise, FileKind, SessionFile } from '../model/types';
import { LocalChangeChannel } from './channel';
import { openDb } from './db';
import type { DropboxClient } from './dropbox-client';
import { Engine, type EngineDeps } from './engine';
import { FakeDropbox } from './fake-dropbox';
import { FakeLeadership } from './lock';
import { EXERCISES_PATH, sessionPath } from './paths';
import { Store } from './store';
import { FakeTimers } from './test-fixtures';

const SEED: Exercise[] = [exercise({ id: 'pull-ups', name: 'Pull-ups' }), exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' })];
const NOW = new Date('2030-06-01T10:00:00.000Z');
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const sid = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sessionAt = (n: number, date = '2030-05-20'): SessionFile => sessionFile(session([block(ladder([5, 4]), { id: sid(n + 1000) })], { id: sid(n), date }));

async function harness(over: Partial<EngineDeps> = {}, dropbox = new FakeDropbox()) {
  const db = await openDb(new IDBFactory());
  const changes: string[] = [];
  const store = new Store(db, { onChange: (p) => changes.push(p) });
  const sleeps: number[] = [];
  const leadership = new FakeLeadership();
  const engine = new Engine({ store, client: dropbox, leadership, buildId: 'build-1', seed: SEED, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); }, ...over });
  await engine.init();
  return { db, store, dropbox, engine, sleeps, changes, leadership };
}


describe('Engine push', () => {
  it('uploads a new session with add, then edits with update, and records rev and lastPushAt', async () => {
    const { store, dropbox, engine } = await harness();
    const s = sessionAt(1);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    await engine.drain();
    expect(dropbox.get(path)?.text).toBe(json(s));
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toEqual([`upload ${path} add`]);
    expect(await store.getRow(path)).toMatchObject({ rev: 'rev1', syncedAt: NOW.toISOString() });
    expect(await store.queue()).toEqual([]);
    expect(engine.status).toMatchObject({ phase: 'idle', queueLength: 0, lastPushAt: NOW.toISOString(), online: true });
    const edited = { ...s, session: { ...s.session, notes: 'later' } };
    await store.writeFile('session', path, edited);
    await engine.pushNow();
    expect(dropbox.log.at(-1)).toBe(`upload ${path} update:rev1`);
    expect(dropbox.get(path)?.text).toBe(json(edited));
  });

  it('pushes the catalog and bodyweight before sessions', async () => {
    const { store, dropbox, engine } = await harness();
    const s = sessionAt(2);
    await store.writeFile('session', sessionPath(s.session.date, s.session.id), s, new Date('2030-06-01T09:00:00.000Z'));
    await store.writeFile('bodyweight', '/bodyweight.json', { schemaVersion: 1, entries: [] }, new Date('2030-06-01T09:01:00.000Z'));
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(SEED), new Date('2030-06-01T09:02:00.000Z'));
    await engine.pushNow();
    expect(dropbox.log.filter((l) => l.startsWith('upload')).map((l) => l.split(' ')[1])).toEqual([EXERCISES_PATH, '/bodyweight.json', sessionPath(s.session.date, s.session.id)]);
  });

  it('skips a held-back catalog and still pushes the sessions behind it', async () => {
    const { store, dropbox, engine } = await harness();
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([exercise({ name: '' })]));
    const s = sessionAt(3);
    await store.writeFile('session', sessionPath(s.session.date, s.session.id), s);
    await engine.pushNow();
    expect(dropbox.paths()).toEqual([sessionPath(s.session.date, s.session.id)]);
    expect((await store.queue()).map((q) => [q.path, q.heldBack !== undefined])).toEqual([[EXERCISES_PATH, true]]);
    expect(engine.status.heldBackCount).toBe(1);
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(SEED));
    await engine.pushNow();
    expect(dropbox.get(EXERCISES_PATH)).toBeDefined();
    expect(engine.status.heldBackCount).toBe(0);
  });

  it('merges on a conflict and retries with the remote rev', async () => {
    const { store, dropbox, engine } = await harness();
    const s = sessionAt(4);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    await engine.drain();
    // Another device adds a set; this device edits the note without pulling first.
    const extra = set({ id: sid(9), order: 2, reps: 3, updatedAt: '2030-06-01T10:30:00.000Z' });
    const other = { ...s, session: { ...s.session, blocks: [{ ...(s.session.blocks[0] as SessionFile['session']['blocks'][number]), sets: [...(s.session.blocks[0]?.sets ?? []), extra] }] } };
    dropbox.put(path, json(other));
    const mine = { ...s, session: { ...s.session, notes: 'mine', updatedAt: '2030-06-01T10:31:00.000Z' } };
    await store.writeFile('session', path, mine);
    await engine.pushNow();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('mine');
    expect(stored.session.blocks[0]?.sets).toHaveLength(3);
    expect(dropbox.log.filter((l) => l.startsWith('upload')).slice(-2)).toEqual([`upload ${path} update:rev1`, `upload ${path} update:rev2`]);
    expect(await store.queue()).toEqual([]);
    expect((await store.getRow(path))?.rev).toBe('rev3');
  });

  it('ends the drain after three conflicts on one path and keeps the write queued', async () => {
    const dropbox = new FakeDropbox();
    let n = 0;
    const restless: DropboxClient = {
      ...dropbox,
      listFolder: () => dropbox.listFolder(),
      listFolderContinue: (c) => dropbox.listFolderContinue(c),
      getLatestCursor: () => dropbox.getLatestCursor(),
      downloadZip: (p) => dropbox.downloadZip(p),
      revokeToken: () => dropbox.revokeToken(),
      upload: async () => ({ ok: false, error: 'conflict', message: 'conflict' }),
      download: async (path) => {
        n += 1;
        const s = sessionAt(5);
        return { ok: true, value: { rev: `r${n}`, text: json({ ...s, session: { ...s.session, notes: `other ${n}`, updatedAt: `2030-06-01T1${n}:00:00.000Z` } }) } };
      },
    };
    const { store, engine } = await harness({ client: restless });
    const s = sessionAt(5);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    await engine.pushNow();
    expect(n).toBe(3);
    expect(engine.status.lastError).toMatch(/3 conflicts/);
    expect(await store.queue()).toHaveLength(1);
    expect((await store.queue())[0]).toMatchObject({ attempts: 3, lastError: expect.stringMatching(/3 conflicts/) });
  });

  it('keeps keystrokes that land while a pulled file is being downloaded and applied', async () => {
    const dropbox = new FakeDropbox();
    let storeRef: Store | undefined;
    let typed = false;
    const s = sessionAt(40);
    const path = sessionPath(s.session.date, s.session.id);
    const typing: DropboxClient = {
      ...dropbox,
      listFolder: () => dropbox.listFolder(),
      listFolderContinue: (c) => dropbox.listFolderContinue(c),
      getLatestCursor: () => dropbox.getLatestCursor(),
      downloadZip: (p) => dropbox.downloadZip(p),
      revokeToken: () => dropbox.revokeToken(),
      upload: (p, t, m) => dropbox.upload(p, t, m),
      download: async (p) => {
        if (typed && p === path) {
          typed = false;
          const mine = set({ id: sid(41), order: 3, reps: 2, updatedAt: '2030-06-01T10:20:00.000Z' });
          const row = await storeRef?.getRow(path);
          const file = row?.content as SessionFile;
          const b = file.session.blocks[0] as SessionFile['session']['blocks'][number];
          await storeRef?.writeFile('session', p, { ...file, session: { ...file.session, blocks: [{ ...b, sets: [...b.sets, mine] }] } });
        }
        return dropbox.download(p);
      },
    };
    dropbox.put(path, json(s));
    const h = await harness({ client: typing }, dropbox);
    storeRef = h.store;
    await h.engine.drain();
    const theirs = set({ id: sid(42), order: 2, reps: 3, updatedAt: '2030-06-01T10:10:00.000Z' });
    const b0 = s.session.blocks[0] as SessionFile['session']['blocks'][number];
    dropbox.put(path, json({ ...s, session: { ...s.session, blocks: [{ ...b0, sets: [...b0.sets, theirs] }] } }));
    typed = true;
    await h.engine.drain();
    const ids = (r: unknown) => ((r as SessionFile).session.blocks[0]?.sets ?? []).map((x) => x.id);
    expect(ids((await h.store.getRow(path))?.content)).toEqual(expect.arrayContaining([sid(41), sid(42)]));
    expect(ids(JSON.parse(dropbox.get(path)?.text as string))).toEqual(expect.arrayContaining([sid(41), sid(42)]));
    expect(await h.store.queue()).toEqual([]);
  });

  it('keeps the queue row when a write lands during the upload (version race)', async () => {
    const dropbox = new FakeDropbox();
    let storeRef: Store | undefined;
    let raced = false;
    const racing: DropboxClient = {
      ...dropbox,
      listFolder: () => dropbox.listFolder(),
      listFolderContinue: (c) => dropbox.listFolderContinue(c),
      getLatestCursor: () => dropbox.getLatestCursor(),
      downloadZip: (p) => dropbox.downloadZip(p),
      revokeToken: () => dropbox.revokeToken(),
      download: (p) => dropbox.download(p),
      upload: async (path, text, mode) => {
        if (!raced) {
          raced = true;
          const s = sessionAt(6);
          await storeRef?.writeFile('session', path, { ...s, session: { ...s.session, notes: 'during upload' } });
        }
        return dropbox.upload(path, text, mode);
      },
    };
    const h = await harness({ client: racing });
    storeRef = h.store;
    const s = sessionAt(6);
    const path = sessionPath(s.session.date, s.session.id);
    await h.store.writeFile('session', path, s);
    await h.engine.pushNow();
    expect(await h.store.queue()).toHaveLength(1);
    expect((await h.store.getRow(path))?.rev).toBe('rev1');
    await h.engine.pushNow();
    expect(await h.store.queue()).toHaveLength(0);
    expect((JSON.parse(dropbox.get(path)?.text as string) as SessionFile).session.notes).toBe('during upload');
  });

  it('waits Retry-After on a 429 and then succeeds', async () => {
    const { store, dropbox, engine, sleeps } = await harness();
    const s = sessionAt(7);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    dropbox.failNext = { error: 'rate-limited', times: 1, retryAfterMs: 3000, only: 'upload' };
    await engine.pushNow();
    expect(sleeps).toEqual([3000]);
    expect(dropbox.get(path)).toBeDefined();
    expect(engine.status.online).toBe(true);
  });

  it('records a non-transient failure on the queue row and moves on', async () => {
    const { store, dropbox, engine } = await harness();
    const a = sessionAt(8);
    const b = sessionAt(9, '2030-05-21');
    await store.writeFile('session', sessionPath(a.session.date, a.session.id), a, new Date('2030-06-01T09:00:00.000Z'));
    await store.writeFile('session', sessionPath(b.session.date, b.session.id), b, new Date('2030-06-01T09:01:00.000Z'));
    dropbox.failNext = { error: 'other', times: 1, only: 'upload' };
    await engine.pushNow();
    expect(dropbox.paths()).toEqual([sessionPath(b.session.date, b.session.id)]);
    expect((await store.queue())[0]).toMatchObject({ attempts: 1, lastError: 'other' });
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['push-error']);
  });
});

describe('Engine pull', () => {
  it('loads everything on a fresh device, then pulls only changes through the cursor', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    dropbox.put('/bodyweight.json', json({ schemaVersion: 1, entries: [] }));
    const a = sessionAt(10);
    dropbox.put(sessionPath(a.session.date, a.session.id), json(a));
    dropbox.put('/review.md', '# notes');
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.rows()).map((r) => [r.path, r.status, r.rev]).sort()).toEqual([
      ['/bodyweight.json', 'ok', 'rev2'],
      [EXERCISES_PATH, 'ok', 'rev1'],
      [sessionPath(a.session.date, a.session.id), 'ok', 'rev3'],
    ]);
    expect(await store.getMeta('cursor')).toBe('c4');
    expect(engine.status).toMatchObject({ lastPullAt: NOW.toISOString(), emptyFolder: false, queueLength: 0 });
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual(['listFolderContinue c4']);
    const b = sessionAt(11, '2030-05-22');
    dropbox.put(sessionPath(b.session.date, b.session.id), json(b));
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual(['listFolderContinue c4', `download ${sessionPath(b.session.date, b.session.id)}`]);
    expect((await store.sessions()).length).toBe(2);
  });

  it('relists from scratch when the cursor is rejected', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    const { store, engine } = await harness({}, dropbox);
    await store.setMeta('cursor', 'bogus');
    await engine.drain();
    expect(dropbox.log.slice(0, 2)).toEqual(['listFolderContinue bogus', 'listFolder']);
    expect(await store.catalog()).toBeDefined();
  });

  it('lists stray json files as unexpected and never reads them', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put('/exercises (conflicted copy).json', '{}');
    dropbox.put('/sessions/2030/notes.json', '{}');
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('download'))).toEqual([]);
    expect(engine.status.issues.map((i) => [i.path, i.reason])).toEqual([['/exercises (conflicted copy).json', 'unexpected-file'], ['/sessions/2030/notes.json', 'unexpected-file']]);
    expect(await store.rows()).toEqual([]);
    dropbox.remove('/sessions/2030/notes.json');
    await engine.drain();
    expect(engine.status.issues).toHaveLength(1);
  });

  it('merges a remote change into a row with pending local changes and pushes the union', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(12);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    await store.writeFile('session', path, { ...s, session: { ...s.session, notes: 'local', updatedAt: '2030-06-01T10:05:00.000Z' } });
    const extra = set({ id: sid(13), order: 2, reps: 3 });
    dropbox.put(path, json({ ...s, session: { ...s.session, blocks: [{ ...(s.session.blocks[0] as SessionFile['session']['blocks'][number]), sets: [...(s.session.blocks[0]?.sets ?? []), extra] }] } }));
    await engine.drain();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('local');
    expect(stored.session.blocks[0]?.sets).toHaveLength(3);
    expect(await store.queue()).toEqual([]);
  });

  it('parks local changes under a too-new remote and releases them once the app is updated', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(14);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const h = await harness({}, dropbox);
    await h.engine.drain();
    const mine = { ...s, session: { ...s.session, notes: 'phone', updatedAt: '2030-06-01T10:05:00.000Z' } };
    await h.store.writeFile('session', path, mine);
    // The PC, on a newer app, wrote the file at schema version 2 with a field this app does not know.
    const pcSet = set({ id: sid(99), order: 2, reps: 3, updatedAt: '2030-06-01T10:04:00.000Z' });
    const firstBlock = s.session.blocks[0] as SessionFile['session']['blocks'][number];
    const newer = { ...s, schemaVersion: 2, session: { ...s.session, blocks: [{ ...firstBlock, sets: [...firstBlock.sets, pcSet] }] }, extra: true };
    dropbox.put(path, json(newer));
    await h.engine.drain();
    expect((await h.store.getRow(path))).toMatchObject({ status: 'read-only', content: newer, rev: 'rev2' });
    expect((await h.store.getQueueRow(path))).toMatchObject({ pendingContent: mine, pendingVersion: 1 });
    expect(await h.store.writeFile('session', path, mine)).toEqual({ ok: false, reason: 'read-only' });
    expect(h.engine.status).toMatchObject({ tooNewSeen: true, queueLength: 1 });
    await h.engine.pushNow();
    expect(dropbox.get(path)?.rev).toBe('rev2');
    // The updated app: it knows version 2 (simulated by a reader that accepts it).
    const v2Reader = (kind: FileKind, raw: unknown) => {
      const r = raw as { schemaVersion: number; extra?: boolean };
      if (r.schemaVersion === 2) { const { extra: _x, ...rest } = r; return readFile(kind, { ...rest, schemaVersion: 1 }); }
      return readFile(kind, raw);
    };
    const updated = new Engine({ store: h.store, client: dropbox, leadership: new FakeLeadership(), buildId: 'build-2', seed: SEED, now: () => NOW, readFile: v2Reader });
    await updated.init();
    await h.store.setMeta('cursor', undefined);
    await updated.drain();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('phone');
    expect(stored.session.blocks[0]?.sets.map((x) => x.id)).toContain(sid(99));
    expect(await h.store.queue()).toEqual([]);
    expect((await h.store.getRow(path))?.status).toBe('ok');
  });

  it('keeps parked local changes, with an error, when their upgrade fails', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(43);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const h = await harness({}, dropbox);
    await h.engine.drain();
    const mine = { ...s, session: { ...s.session, notes: 'phone', updatedAt: '2030-06-01T10:05:00.000Z' } };
    await h.store.writeFile('session', path, mine);
    dropbox.put(path, json({ ...s, schemaVersion: 2, extra: true }));
    await h.engine.drain();
    expect((await h.store.getQueueRow(path))?.pendingContent).toEqual(mine);
    const v2Reader = (kind: FileKind, raw: unknown) => {
      const r = raw as { schemaVersion: number; extra?: boolean };
      if (r.schemaVersion === 2) { const { extra: _x, ...rest } = r; return readFile(kind, { ...rest, schemaVersion: 1 }); }
      return readFile(kind, raw);
    };
    const broken = new Engine({ store: h.store, client: dropbox, leadership: new FakeLeadership(), buildId: 'build-2', seed: SEED, now: () => NOW, readFile: v2Reader, upgradeFile: () => ({ status: 'invalid', message: 'step exploded' }) });
    await broken.init();
    await h.store.setMeta('cursor', undefined);
    await broken.drain();
    await broken.drain();
    expect(await h.store.getQueueRow(path)).toMatchObject({ pendingContent: mine, pendingVersion: 1, lastError: expect.stringMatching(/could not be upgraded: step exploded/) });
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toEqual([]);
  });

  it('pushes a set typed while changes were parked once the upgrade works, without calling local content remote', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(44);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const h = await harness({}, dropbox);
    await h.engine.drain();
    const mine = { ...s, session: { ...s.session, notes: 'phone', updatedAt: '2030-06-01T10:05:00.000Z' } };
    await h.store.writeFile('session', path, mine);
    dropbox.put(path, json({ ...s, schemaVersion: 2, extra: true }));
    await h.engine.drain();
    const v2Reader = (kind: FileKind, raw: unknown) => {
      const r = raw as { schemaVersion: number; extra?: boolean };
      if (r.schemaVersion === 2) { const { extra: _x, ...rest } = r; return readFile(kind, { ...rest, schemaVersion: 1 }); }
      return readFile(kind, raw);
    };
    const common = { store: h.store, client: dropbox, leadership: new FakeLeadership(), seed: SEED, now: () => NOW, readFile: v2Reader };
    const broken = new Engine({ ...common, buildId: 'build-2', upgradeFile: () => ({ status: 'invalid', message: 'step exploded' }) });
    await broken.init();
    await h.store.setMeta('cursor', undefined);
    await broken.drain();
    // The owner types a set (newer than the parked records) while the changes are parked.
    const row = await h.store.getRow(path);
    const file = row?.content as SessionFile;
    const b0 = file.session.blocks[0] as SessionFile['session']['blocks'][number];
    const typed = { ...file, session: { ...file.session, notes: 'typed', updatedAt: '2030-06-01T10:30:00.000Z', blocks: [{ ...b0, sets: [...b0.sets, set({ id: sid(45), order: 3, reps: 2, updatedAt: '2030-06-01T10:30:00.000Z' })] }] } };
    await h.store.writeFile('session', path, typed);
    const changesBefore = h.changes.length;
    await broken.drain();
    expect(h.changes.length).toBe(changesBefore); // a failing upgrade rewrites nothing and notifies nobody
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toEqual([]);
    const fixed = new Engine({ ...common, buildId: 'build-3' });
    await fixed.init();
    await fixed.drain();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('typed');
    expect(stored.session.blocks[0]?.sets.map((x) => x.id)).toContain(sid(45));
    expect(await h.store.queue()).toEqual([]);
  });

  it('keeps a set typed right after the pull read the row (regression for the non-transactional apply)', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(46);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    let armed: (() => Promise<void>) | undefined;
    let downloaded = false;
    class ArmedStore extends Store {
      private async keystroke(p: string): Promise<void> {
        if (p === path && downloaded && armed !== undefined) { const fire = armed; armed = undefined; await fire(); }
      }
      // The keystroke lands right after a read of the pulled path (the old apply read, then wrote blindly).
      override async getRow(p: string) {
        const row = await super.getRow(p);
        await this.keystroke(p);
        return row;
      }
      override async getQueueRow(p: string) {
        const row = await super.getQueueRow(p);
        await this.keystroke(p);
        return row;
      }
      // The atomic apply reads inside mutate, so there the keystroke lands right after it.
      override async mutate(p: string, fn: Parameters<Store['mutate']>[1]) {
        await super.mutate(p, fn);
        await this.keystroke(p);
      }
    }
    const db = await openDb(new IDBFactory());
    const store = new ArmedStore(db);
    const client: DropboxClient = {
      ...dropbox,
      listFolder: () => dropbox.listFolder(),
      listFolderContinue: (c) => dropbox.listFolderContinue(c),
      getLatestCursor: () => dropbox.getLatestCursor(),
      downloadZip: (p) => dropbox.downloadZip(p),
      revokeToken: () => dropbox.revokeToken(),
      upload: (p, t, m) => dropbox.upload(p, t, m),
      download: async (p) => { downloaded = true; return dropbox.download(p); },
    };
    const engine = new Engine({ store, client, leadership: new FakeLeadership(), buildId: 'build-1', seed: SEED, now: () => NOW });
    await engine.init();
    await engine.drain();
    const theirs = set({ id: sid(47), order: 2, reps: 3, updatedAt: '2030-06-01T10:10:00.000Z' });
    const b0 = s.session.blocks[0] as SessionFile['session']['blocks'][number];
    dropbox.put(path, json({ ...s, session: { ...s.session, blocks: [{ ...b0, sets: [...b0.sets, theirs] }] } }));
    downloaded = false;
    // Once the file is downloaded, the first read of its row is followed by a keystroke.
    armed = async () => {
      const cur = (await Store.prototype.getRow.call(store, path))?.content as SessionFile;
      const b = cur.session.blocks[0] as SessionFile['session']['blocks'][number];
      await store.writeFile('session', path, { ...cur, session: { ...cur.session, blocks: [{ ...b, sets: [...b.sets, set({ id: sid(48), order: 4, reps: 1, updatedAt: '2030-06-01T10:20:00.000Z' })] }] } });
    };
    await engine.drain();
    await engine.drain();
    const ids = (r: unknown) => ((r as SessionFile).session.blocks[0]?.sets ?? []).map((x) => x.id);
    expect(ids((await store.getRow(path))?.content)).toEqual(expect.arrayContaining([sid(47), sid(48)]));
    expect(ids(JSON.parse(dropbox.get(path)?.text as string))).toEqual(expect.arrayContaining([sid(47), sid(48)]));
    expect(await store.queue()).toEqual([]);
  });

  it('never overwrites a quarantined remote and holds the local write', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(15);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    await store.writeFile('session', path, { ...s, session: { ...s.session, notes: 'phone' } });
    const broken = json({ ...s, session: { ...s.session, date: '2030-02-30' } });
    dropbox.put(path, broken);
    await engine.drain();
    expect((await store.getRow(path))?.status).toBe('quarantined');
    expect(await store.getQueueRow(path)).toMatchObject({ lastError: expect.stringMatching(/invalid/), pendingContent: expect.anything() });
    expect(dropbox.get(path)?.text).toBe(broken);
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toHaveLength(0);
    expect(engine.status.issues.map((i) => i.reason).sort()).toEqual(['push-error', 'quarantined']);
  });

  it('quarantines a file that is not JSON, and one whose JSON is not an object', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, '{not json');
    dropbox.put('/bodyweight.json', '[1, 2, 3]');
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.getRow(EXERCISES_PATH))).toMatchObject({ status: 'quarantined', content: '{not json' });
    expect((await store.getRow('/bodyweight.json'))).toMatchObject({ status: 'quarantined', content: [1, 2, 3] });
    await engine.drain();
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['quarantined', 'quarantined']);
  });

  it('reads a session whose date no longer matches its path (the content is the truth)', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(30, '2030-05-20');
    const path = sessionPath('2030-05-19', s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.sessions()).map((x) => [x.path, x.file.session.date])).toEqual([[path, '2030-05-20']]);
    expect(engine.status.issues).toEqual([]);
  });

  it('keeps the old cursor when a download fails, so the next pull fetches the missed file', async () => {
    const dropbox = new FakeDropbox();
    const a = sessionAt(31);
    dropbox.put(sessionPath(a.session.date, a.session.id), json(a));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    const b = sessionAt(32, '2030-05-21');
    dropbox.put(sessionPath(b.session.date, b.session.id), json(b));
    dropbox.failNext = { error: 'offline', times: 1, only: 'download' };
    await engine.drain();
    expect(engine.status.online).toBe(false);
    expect(await store.getMeta('cursor')).toBe('c1');
    expect(await store.getRow(sessionPath(b.session.date, b.session.id))).toBeUndefined();
    await engine.wentOnline();
    expect(await store.getRow(sessionPath(b.session.date, b.session.id))).toMatchObject({ status: 'ok' });
    expect(await store.getMeta('cursor')).toBe('c2');
    engine.dispose();
  });

  it('carries a duplicate loser\'s pending local changes into the winner', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(33);
    const first = sessionPath(s.session.date, s.session.id);
    const copy = '/sessions/2030/2030-05-21_00000021.json';
    dropbox.put(first, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    // The copy appears in Dropbox, is pulled, and gets a local edit before the next pull sees both.
    dropbox.put(copy, json(s));
    await store.saveRow({ path: copy, kind: 'session', rev: dropbox.get(copy)?.rev as string, content: s, status: 'ok', issues: [], version: 0 });
    await store.writeFile('session', copy, { ...s, session: { ...s.session, notes: 'typed into the copy', updatedAt: '2030-06-01T10:05:00.000Z' } });
    await engine.drain();
    expect((await store.getRow(copy))?.duplicateOf).toBe(first);
    expect(await store.getQueueRow(copy)).toBeUndefined();
    expect((JSON.parse(dropbox.get(first)?.text as string) as SessionFile).session.notes).toBe('typed into the copy');
  });

  it('merges duplicate session files into the first path and drops the loser once Dropbox has', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(16);
    const first = sessionPath(s.session.date, s.session.id);
    const copy = '/sessions/2030/2030-05-21_00000010.json';
    dropbox.put(first, json(s));
    dropbox.put(copy, json({ ...s, session: { ...s.session, notes: 'from the copy', updatedAt: '2030-06-01T10:05:00.000Z' } }));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.sessions()).map((x) => x.path)).toEqual([first]);
    expect((await store.getRow(copy))?.duplicateOf).toBe(first);
    expect((JSON.parse(dropbox.get(first)?.text as string) as SessionFile).session.notes).toBe('from the copy');
    expect(dropbox.get(copy)?.rev).toBe('rev2');
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['duplicate']);
    await engine.drain();
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['duplicate']);
    dropbox.remove(copy);
    await engine.drain();
    expect(await store.getRow(copy)).toBeUndefined();
    expect(engine.status.issues).toEqual([]);
  });

  it('keeps a file deleted in Dropbox, lists it, and re-creates it only after a local write', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(17);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    dropbox.remove(path);
    await engine.drain();
    expect(await store.getRow(path)).toMatchObject({ rev: null, remoteDeleted: true, content: s });
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['remote-deleted']);
    expect(dropbox.get(path)).toBeUndefined();
    await store.writeFile('session', path, { ...s, session: { ...s.session, notes: 'back' } });
    await engine.pushNow();
    expect(dropbox.log.at(-1)).toBe(`upload ${path} add`);
    expect(await store.getRow(path)).not.toHaveProperty('remoteDeleted');
    expect(engine.status.issues).toEqual([]);
  });

  it('fetches a big first load as one zip, with the revs from the listing', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    for (let i = 0; i < 25; i += 1) {
      const s = sessionAt(100 + i, `2030-04-${String(1 + i).padStart(2, '0')}`);
      dropbox.put(sessionPath(s.session.date, s.session.id), json(s));
    }
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('downloadZip'))).toEqual(['downloadZip /sessions']);
    expect(dropbox.log.filter((l) => l.startsWith('download '))).toEqual([`download ${EXERCISES_PATH}`]);
    const rows = await store.sessions();
    expect(rows).toHaveLength(25);
    for (const r of rows) expect((await store.getRow(r.path))?.rev).toBe(dropbox.get(r.path)?.rev);
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual(['listFolderContinue c26']);
  });

  it('falls back to single downloads when the zip fails', async () => {
    const dropbox = new FakeDropbox();
    for (let i = 0; i < 22; i += 1) {
      const s = sessionAt(200 + i, `2030-03-${String(1 + i).padStart(2, '0')}`);
      dropbox.put(sessionPath(s.session.date, s.session.id), json(s));
    }
    dropbox.failNext = { error: 'other', times: 1, only: 'downloadZip' };
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('download ')).length).toBe(22);
    expect(await store.sessions()).toHaveLength(22);
  });

  it('restores a tombstoned exercise that a live block still references, and pushes the catalog', async () => {
    const dropbox = new FakeDropbox();
    const dead = tombstone(exercise({ id: 'pull-ups', name: 'Pull-ups' }), new Date('2030-05-01T00:00:00.000Z'));
    dropbox.put(EXERCISES_PATH, json(exercisesFile([dead])));
    const s = sessionAt(18);
    dropbox.put(sessionPath(s.session.date, s.session.id), json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    const catalog = await store.catalog();
    const restored = catalog?.exercises.find((e) => e.id === 'pull-ups');
    expect(restored).toMatchObject({ archived: true });
    expect(restored?.deletedAt).toBeUndefined();
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toEqual([`upload ${EXERCISES_PATH} update:rev1`]);
  });
});

describe('Engine seed and empty folder', () => {
  it('adds missing seed entries once per build when a catalog exists remotely', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile([exercise({ id: 'pull-ups', name: 'Pull-ups', cues: 'mine' })])));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    const ids = (await store.catalog())?.exercises.map((e) => e.id).sort();
    expect(ids).toEqual(['dips-bar', 'pull-ups']);
    expect((await store.catalog())?.exercises.find((e) => e.id === 'pull-ups')?.cues).toBe('mine');
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toHaveLength(1);
    expect(await store.getMeta('seededBuild')).toBe('build-1');
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toHaveLength(1);
  });

  it('reports an empty folder and waits for the choice; "seed" writes the catalog, "copy" does nothing', async () => {
    const a = await harness();
    await a.engine.drain();
    expect(a.engine.status.emptyFolder).toBe(true);
    expect(a.dropbox.paths()).toEqual([]);
    await a.engine.chooseEmptyFolder('seed');
    expect(a.engine.status.emptyFolder).toBe(false);
    expect(a.dropbox.paths()).toEqual([EXERCISES_PATH]);
    expect((await a.store.catalog())?.exercises).toHaveLength(2);
    await a.engine.drain();
    expect(a.engine.status.emptyFolder).toBe(false);

    const b = await harness();
    await b.engine.drain();
    await b.engine.chooseEmptyFolder('copy');
    await b.engine.drain();
    expect(b.dropbox.paths()).toEqual([]);
    expect(b.engine.status).toMatchObject({ emptyFolder: true, emptyFolderChoice: 'copy' });
    b.dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    await b.engine.drain();
    expect(b.engine.status.emptyFolder).toBe(false);
    expect((await b.store.catalog())?.exercises).toHaveLength(2);
  });

  it('ignores "copy" once the seed was chosen, and "seed" before a pull found the folder empty', async () => {
    const a = await harness();
    await a.engine.drain();
    await a.engine.chooseEmptyFolder('seed');
    const uploads = a.dropbox.log.filter((l) => l.startsWith('upload')).length;
    await a.engine.chooseEmptyFolder('copy');
    expect(a.engine.status).toMatchObject({ emptyFolder: false, emptyFolderChoice: 'seed' });
    expect(await a.store.getMeta('emptyFolderChoice')).toBe('seed');
    expect(a.dropbox.log.filter((l) => l.startsWith('upload')).length).toBe(uploads);

    const b = await harness();
    await b.engine.chooseEmptyFolder('seed');
    expect(b.dropbox.paths()).toEqual([]);
    expect(await b.store.catalog()).toBeUndefined();
    expect(b.engine.status.emptyFolderChoice).toBeUndefined();
    expect(await b.store.getMeta('emptyFolderChoice')).toBeUndefined();
  });
});

describe('Engine failures and triggers', () => {
  it('backs off while offline and recovers on the online event', async () => {
    const timers = new FakeTimers();
    const { dropbox, engine } = await harness({ timers });
    dropbox.offline = true;
    await engine.drain();
    expect(engine.status).toMatchObject({ online: false, retryInMs: 2000 });
    expect(engine.status.lastError).toMatch(/offline/);
    expect(timers.due()).toEqual([2000]);
    await timers.advance(2000, () => engine.idle());
    expect(engine.status.retryInMs).toBe(4000);
    expect(dropbox.log.filter((l) => l.includes('offline'))).toHaveLength(2);
    await timers.advance(4000, () => engine.idle());
    expect(engine.status.retryInMs).toBe(8000);
    dropbox.offline = false;
    await engine.wentOnline();
    expect(engine.status).toMatchObject({ online: true, lastError: undefined, retryInMs: undefined });
    expect(timers.due()).toEqual([]);
  });

  it('caps the backoff at five minutes', async () => {
    const timers = new FakeTimers();
    const { dropbox, engine } = await harness({ timers });
    dropbox.offline = true;
    await engine.drain();
    for (let i = 0; i < 12; i += 1) await timers.advance(timers.due()[0] as number, () => engine.idle());
    expect(engine.status.retryInMs).toBe(300_000);
  });

  it('stops on unauthorized until reconnect', async () => {
    const { dropbox, engine, store } = await harness();
    dropbox.failNext = { error: 'unauthorized', times: 1 };
    await engine.drain();
    expect(engine.status.connected).toBe(false);
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual([]);
    engine.reconnect();
    await store.writeFile('session', sessionPath('2030-05-20', sid(19)), sessionAt(19));
    await engine.drain();
    expect(dropbox.paths()).toHaveLength(1);
  });

  it('only drains once it holds the leadership lock', async () => {
    const leadership = new FakeLeadership(false);
    const { dropbox, engine } = await harness({ leadership });
    let done = false;
    const pending = engine.drain().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    expect(dropbox.log).toEqual([]);
    leadership.grant();
    await pending;
    expect(dropbox.log).toEqual(['listFolder']);
  });

  it('pushes one second after the last request, and on a change from another tab', async () => {
    const timers = new FakeTimers();
    const channel = new LocalChangeChannel();
    const { store, dropbox, engine } = await harness({ channel, timers });
    const s = sessionAt(20);
    await store.writeFile('session', sessionPath(s.session.date, s.session.id), s);
    engine.requestPush();
    await timers.advance(500, () => engine.idle());
    engine.requestPush();
    await timers.advance(900, () => engine.idle());
    expect(dropbox.paths()).toEqual([]);
    await timers.advance(200, () => engine.idle());
    expect(dropbox.paths()).toHaveLength(1);
    const t = sessionAt(21, '2030-05-23');
    await store.writeFile('session', sessionPath(t.session.date, t.session.id), t);
    channel.post(sessionPath(t.session.date, t.session.id));
    await timers.advance(1100, () => engine.idle());
    expect(dropbox.paths()).toHaveLength(2);
  });
});
