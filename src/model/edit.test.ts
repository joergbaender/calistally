import { describe, expect, it } from 'vitest';
import {
  EditError,
  addBlock,
  addSet,
  createPastSession,
  deleteBlock,
  deleteSession,
  deleteSet,
  findBlock,
  findSet,
  moveBlock,
  normalizeLoad,
  setBlockNote,
  setSessionFields,
  setSetFields,
  startSession,
  undeleteBlock,
  undeleteSession,
  undeleteSet,
} from './edit';
import type { SetInput } from './edit';
import { amountOf, liveBlocks } from './derive';
import { MODEL_VERSION } from './schema';
import { T0, block, ladder, session, sessionFile, set, timedSet, uuid } from './test-fixtures';
import type { SessionFile, WorkoutSet } from './types';
import { validateForWrite } from './validate';

const later = new Date('2030-01-01T11:00:00.000Z');
const LATER = '2030-01-01T11:00:00.000Z';
const earlier = new Date('2030-01-01T09:00:00.000Z');
const T0_PLUS_1 = '2030-01-01T10:00:00.001Z';

/** Every edit result must be writable as it is (spec 4 §11). */
function valid(file: SessionFile): SessionFile {
  const result = validateForWrite('session', file);
  expect(result.issues).toEqual([]);
  expect(result.ok).toBe(true);
  return file;
}

describe('EditError', () => {
  it('is an Error with its own name', () => {
    const e = new EditError('nope');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('EditError');
    expect(e.message).toBe('nope');
  });
});

describe('normalizeLoad', () => {
  it('turns added and assist at 0 kg into bodyweight', () => {
    expect(normalizeLoad('added', 0)).toEqual({ loadType: 'bodyweight', loadKg: 0 });
    expect(normalizeLoad('assist', 0)).toEqual({ loadType: 'bodyweight', loadKg: 0 });
  });

  it('keeps every other valid load as it is', () => {
    expect(normalizeLoad('added', 11.5)).toEqual({ loadType: 'added', loadKg: 11.5 });
    expect(normalizeLoad('assist', 10)).toEqual({ loadType: 'assist', loadKg: 10 });
    expect(normalizeLoad('bodyweight', 0)).toEqual({ loadType: 'bodyweight', loadKg: 0 });
    expect(normalizeLoad('external', 0)).toEqual({ loadType: 'external', loadKg: 0 });
    expect(normalizeLoad('external', 35)).toEqual({ loadType: 'external', loadKg: 35 });
    expect(normalizeLoad('band', 0)).toEqual({ loadType: 'band', loadKg: 0 });
    expect(normalizeLoad('band', 50)).toEqual({ loadType: 'band', loadKg: 50 });
  });

  it('throws EditError on negative kg for every load type', () => {
    expect(() => normalizeLoad('added', -1)).toThrow(EditError);
    expect(() => normalizeLoad('assist', -0.5)).toThrow(EditError);
    expect(() => normalizeLoad('external', -1)).toThrow(EditError);
    expect(() => normalizeLoad('band', -1)).toThrow(EditError);
    expect(() => normalizeLoad('bodyweight', -1)).toThrow(EditError);
  });

  it('throws EditError on bodyweight with kg other than 0 (the file would not validate)', () => {
    expect(() => normalizeLoad('bodyweight', 5)).toThrow(EditError);
  });

  it('throws EditError on a non-finite kg', () => {
    expect(() => normalizeLoad('external', Number.NaN)).toThrow(EditError);
    expect(() => normalizeLoad('added', Number.POSITIVE_INFINITY)).toThrow(EditError);
  });
});

describe('startSession', () => {
  it('creates a live session: startedAt and updatedAt = now, tags [], source app, no blocks', () => {
    const file = valid(startSession(later, '2030-03-04'));
    expect(file.schemaVersion).toBe(MODEL_VERSION);
    expect(file.session).toEqual({
      id: file.session.id,
      date: '2030-03-04',
      startedAt: LATER,
      tags: [],
      source: 'app',
      blocks: [],
      updatedAt: LATER,
    });
    expect(file.session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('takes a given id', () => {
    const id = uuid();
    expect(startSession(later, '2030-03-04', id).session.id).toBe(id);
  });

  it('throws EditError on a date that is not a calendar date', () => {
    expect(() => startSession(later, '2030-02-30')).toThrow(EditError);
    expect(() => startSession(later, '04.03.2030')).toThrow(EditError);
  });
});

describe('createPastSession', () => {
  it('creates a session without startedAt', () => {
    const file = valid(createPastSession('2030-03-04', later));
    expect(file.session).toEqual({
      id: file.session.id,
      date: '2030-03-04',
      tags: [],
      source: 'app',
      blocks: [],
      updatedAt: LATER,
    });
    expect('startedAt' in file.session).toBe(false);
  });

  it('takes a given id and refuses a bad date', () => {
    const id = uuid();
    expect(createPastSession('2030-03-04', later, id).session.id).toBe(id);
    expect(() => createPastSession('2030-13-01', later)).toThrow(EditError);
  });
});

describe('setSessionFields', () => {
  const base = (): SessionFile =>
    sessionFile(session([block(ladder([5, 4]))], { label: 'pull', notes: 'old', tags: ['sick'] }));

  it('sets date, label, notes and tags and touches only the session', () => {
    const file = base();
    const out = valid(setSessionFields(file, { date: '2030-03-05', label: 'push', notes: 'new', tags: ['a', 'b'] }, later));
    expect(out.session.date).toBe('2030-03-05');
    expect(out.session.label).toBe('push');
    expect(out.session.notes).toBe('new');
    expect(out.session.tags).toEqual(['a', 'b']);
    expect(out.session.updatedAt).toBe(LATER);
    expect(out.session.blocks).toBe(file.session.blocks);
    expect(out.session.blocks[0]?.updatedAt).toBe(T0);
    expect(out.session.blocks[0]?.sets[0]?.updatedAt).toBe(T0);
    expect(file.session.updatedAt).toBe(T0);
  });

  it('uses max(now, previous + 1 ms) for updatedAt', () => {
    expect(setSessionFields(base(), { notes: 'x' }, earlier).session.updatedAt).toBe(T0_PLUS_1);
  });

  it('label null removes the label, notes null removes the notes', () => {
    const out = valid(setSessionFields(base(), { label: null, notes: null }, later));
    expect('label' in out.session).toBe(false);
    expect('notes' in out.session).toBe(false);
  });

  it('an empty notes string removes the notes too', () => {
    const out = valid(setSessionFields(base(), { notes: '   ' }, later));
    expect('notes' in out.session).toBe(false);
  });

  it('leaves fields that are not given alone', () => {
    const out = setSessionFields(base(), { tags: ['x'] }, later);
    expect(out.session.label).toBe('pull');
    expect(out.session.notes).toBe('old');
    expect(out.session.date).toBe('2030-01-01');
  });

  it('dateExact true removes dateUncertain; without it the flag stays even when the date changes', () => {
    const migrated = sessionFile(session([], { source: 'migrated', dateUncertain: true }));
    const exact = valid(setSessionFields(migrated, { dateExact: true }, later));
    expect('dateUncertain' in exact.session).toBe(false);
    const moved = valid(setSessionFields(migrated, { date: '2030-01-02' }, later));
    expect(moved.session.dateUncertain).toBe(true);
    expect(moved.session.date).toBe('2030-01-02');
  });

  it('drops empty tags and trims the rest', () => {
    const out = valid(setSessionFields(base(), { tags: [' sick ', '', '  '] }, later));
    expect(out.session.tags).toEqual(['sick']);
  });

  it('throws EditError on a date that is not a calendar date', () => {
    expect(() => setSessionFields(base(), { date: '2030-02-29' }, later)).toThrow(EditError);
  });
});

describe('deleteSession / undeleteSession', () => {
  it('tombstones only the session and round-trips through undelete', () => {
    const file = sessionFile(session([block(ladder([5]))]));
    const deleted = valid(deleteSession(file, later));
    expect(deleted.session.deletedAt).toBe(LATER);
    expect(deleted.session.updatedAt).toBe(LATER);
    expect(deleted.session.blocks).toBe(file.session.blocks);
    expect(deleted.session.blocks[0]?.deletedAt).toBeUndefined();

    const restored = valid(undeleteSession(deleted, new Date('2030-01-01T12:00:00.000Z')));
    expect('deletedAt' in restored.session).toBe(false);
    expect(restored.session.updatedAt).toBe('2030-01-01T12:00:00.000Z');
    expect(restored.session.blocks).toBe(file.session.blocks);
  });

  it('undelete moves updatedAt past the tombstone even on a slow clock', () => {
    const deleted = deleteSession(sessionFile(), later);
    expect(undeleteSession(deleted, earlier).session.updatedAt).toBe('2030-01-01T11:00:00.001Z');
  });
});

describe('addBlock', () => {
  it('appends a block with order = nextOrder over every sibling, deleted ones included, updatedAt = now', () => {
    const dead = block([], { order: 7, deletedAt: T0 });
    const file = sessionFile(session([block([], { order: 0 }), dead]));
    const { file: out, blockId } = addBlock(file, 'dips', later);
    valid(out);
    const added = out.session.blocks.find((b) => b.id === blockId);
    expect(added).toEqual({ id: blockId, order: 8, exerciseId: 'dips', sets: [], updatedAt: LATER });
    expect(out.session.blocks).toHaveLength(3);
    expect(out.session.updatedAt).toBe(T0);
    expect(file.session.blocks).toHaveLength(2);
  });

  it('starts at order 0 in an empty session and takes a given id', () => {
    const id = uuid();
    const { file: out, blockId } = addBlock(sessionFile(), 'dips', later, id);
    expect(blockId).toBe(id);
    expect(out.session.blocks[0]?.order).toBe(0);
    valid(out);
  });

  it('throws EditError on an exercise id that is not a slug', () => {
    expect(() => addBlock(sessionFile(), 'Dips Rings', later)).toThrow(EditError);
    expect(() => addBlock(sessionFile(), '', later)).toThrow(EditError);
  });
});

describe('setBlockNote', () => {
  const file = (): SessionFile => sessionFile(session([block(ladder([5]), { note: 'old' }), block([])]));

  it('sets the note and touches only that block', () => {
    const f = file();
    const id = f.session.blocks[0]!.id;
    const out = valid(setBlockNote(f, id, 'deep', later));
    expect(out.session.blocks[0]?.note).toBe('deep');
    expect(out.session.blocks[0]?.updatedAt).toBe(LATER);
    expect(out.session.blocks[0]?.sets).toBe(f.session.blocks[0]!.sets);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
  });

  it('null or an empty string removes the note', () => {
    const f = file();
    const id = f.session.blocks[0]!.id;
    expect('note' in valid(setBlockNote(f, id, null, later)).session.blocks[0]!).toBe(false);
    expect('note' in valid(setBlockNote(f, id, '  ', later)).session.blocks[0]!).toBe(false);
  });

  it('throws EditError on an unknown block', () => {
    expect(() => setBlockNote(file(), uuid(), 'x', later)).toThrow(EditError);
  });
});

describe('deleteBlock / undeleteBlock', () => {
  it('tombstones only the block, keeps its sets, and round-trips', () => {
    const f = sessionFile(session([block(ladder([5, 4])), block([])]));
    const id = f.session.blocks[0]!.id;
    const deleted = valid(deleteBlock(f, id, later));
    expect(deleted.session.blocks[0]?.deletedAt).toBe(LATER);
    expect(deleted.session.blocks[0]?.updatedAt).toBe(LATER);
    expect(deleted.session.blocks[0]?.sets).toBe(f.session.blocks[0]!.sets);
    expect(deleted.session.blocks[0]?.sets[0]?.deletedAt).toBeUndefined();
    expect(deleted.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(deleted.session.updatedAt).toBe(T0);

    const restored = valid(undeleteBlock(deleted, id, earlier));
    expect('deletedAt' in restored.session.blocks[0]!).toBe(false);
    expect(restored.session.blocks[0]?.updatedAt).toBe('2030-01-01T11:00:00.001Z');
    expect(restored.session.updatedAt).toBe(T0);
  });

  it('throws EditError on an unknown block', () => {
    expect(() => deleteBlock(sessionFile(), uuid(), later)).toThrow(EditError);
    expect(() => undeleteBlock(sessionFile(), uuid(), later)).toThrow(EditError);
  });
});

describe('moveBlock', () => {
  const three = (): SessionFile =>
    sessionFile(
      session([
        block([], { order: 0, exerciseId: 'a' }),
        block([], { order: 1, exerciseId: 'b' }),
        block([], { order: 2, exerciseId: 'c' }),
      ]),
    );
  const ids = (f: SessionFile): string[] => liveBlocks(f.session).map((b) => b.exerciseId);

  it('up: the block gets the midpoint between its two predecessors and nothing else is renumbered', () => {
    const f = three();
    const c = f.session.blocks[2]!;
    const out = valid(moveBlock(f, c.id, 'up', later));
    expect(ids(out)).toEqual(['a', 'c', 'b']);
    const moved = out.session.blocks.find((b) => b.id === c.id)!;
    expect(moved.order).toBe(0.5);
    expect(moved.updatedAt).toBe(LATER);
    expect(out.session.blocks[0]).toBe(f.session.blocks[0]);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
  });

  it('down: the block gets the midpoint between its two successors', () => {
    const f = three();
    const a = f.session.blocks[0]!;
    const out = valid(moveBlock(f, a.id, 'down', later));
    expect(ids(out)).toEqual(['b', 'a', 'c']);
    expect(out.session.blocks.find((b) => b.id === a.id)!.order).toBe(1.5);
  });

  it('moving to the very first or very last place steps 1 beyond the neighbour', () => {
    const f = three();
    const up = moveBlock(f, f.session.blocks[1]!.id, 'up', later);
    expect(ids(up)).toEqual(['b', 'a', 'c']);
    expect(up.session.blocks[1]!.order).toBe(-1);
    const down = moveBlock(f, f.session.blocks[1]!.id, 'down', later);
    expect(ids(down)).toEqual(['a', 'c', 'b']);
    expect(down.session.blocks[1]!.order).toBe(3);
  });

  it('is a no-op (same file object) at the edge', () => {
    const f = three();
    expect(moveBlock(f, f.session.blocks[0]!.id, 'up', later)).toBe(f);
    expect(moveBlock(f, f.session.blocks[2]!.id, 'down', later)).toBe(f);
  });

  it('skips tombstoned neighbours', () => {
    const f = sessionFile(
      session([
        block([], { order: 0, exerciseId: 'a' }),
        block([], { order: 1, exerciseId: 'dead', deletedAt: T0 }),
        block([], { order: 2, exerciseId: 'b' }),
      ]),
    );
    const out = valid(moveBlock(f, f.session.blocks[2]!.id, 'up', later));
    expect(ids(out)).toEqual(['b', 'a']);
    expect(out.session.blocks[2]!.order).toBe(-1);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    const single = sessionFile(session([block([], { order: 0, deletedAt: T0 }), block([], { order: 1 })]));
    expect(moveBlock(single, single.session.blocks[1]!.id, 'up', later)).toBe(single);
  });

  it('follows the canonical order (id breaks ties), not array position', () => {
    const f = sessionFile(
      session([
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 0, exerciseId: 'second' }),
        block([], { id: '00000000-0000-4000-8000-00000000000a', order: 0, exerciseId: 'first' }),
      ]),
    );
    expect(ids(f)).toEqual(['first', 'second']);
    const out = moveBlock(f, f.session.blocks[0]!.id, 'up', later);
    expect(ids(out)).toEqual(['second', 'first']);
    expect(out.session.blocks[0]!.order).toBe(-1);
  });

  it('steps past a run of equal orders (two devices each appended) so the move shows', () => {
    const tied = sessionFile(
      session([
        block([], { id: '00000000-0000-4000-8000-00000000000a', order: 0, exerciseId: 'a' }),
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 0, exerciseId: 'b' }),
        block([], { id: '00000000-0000-4000-8000-00000000000c', order: 0, exerciseId: 'c' }),
      ]),
    );
    expect(ids(tied)).toEqual(['a', 'b', 'c']);
    const up = valid(moveBlock(tied, tied.session.blocks[2]!.id, 'up', later));
    expect(ids(up)).toEqual(['c', 'a', 'b']);
    expect(up.session.blocks[2]!.order).toBe(-1);
    expect(up.session.blocks[0]).toBe(tied.session.blocks[0]);
    expect(up.session.blocks[1]).toBe(tied.session.blocks[1]);
    const down = valid(moveBlock(tied, tied.session.blocks[0]!.id, 'down', later));
    expect(ids(down)).toEqual(['b', 'c', 'a']);
    expect(down.session.blocks[0]!.order).toBe(1);
  });

  it('takes the midpoint to the next distinct order beyond a tied run', () => {
    const f = sessionFile(
      session([
        block([], { order: 0, exerciseId: 'a' }),
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 1, exerciseId: 'b' }),
        block([], { id: '00000000-0000-4000-8000-00000000000c', order: 1, exerciseId: 'c' }),
        block([], { order: 2, exerciseId: 'd' }),
      ]),
    );
    const out = valid(moveBlock(f, f.session.blocks[3]!.id, 'up', later));
    expect(ids(out)).toEqual(['a', 'd', 'b', 'c']);
    expect(out.session.blocks[3]!.order).toBe(0.5);
  });

  it('throws EditError instead of writing a non-move when no order fits between the neighbours', () => {
    // 1 - 2^-53 and 1 are adjacent doubles; their midpoint rounds to 1, the neighbour's own order.
    const f = sessionFile(
      session([
        block([], { id: '00000000-0000-4000-8000-00000000000a', order: 1 - 2 ** -53, exerciseId: 'a' }),
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 1, exerciseId: 'b' }),
        block([], { id: '00000000-0000-4000-8000-00000000000c', order: 2, exerciseId: 'c' }),
      ]),
    );
    expect(() => moveBlock(f, f.session.blocks[2]!.id, 'up', later)).toThrow(EditError);
  });

  it('throws EditError on an unknown or tombstoned block', () => {
    const f = three();
    expect(() => moveBlock(f, uuid(), 'up', later)).toThrow(EditError);
    const dead = deleteBlock(f, f.session.blocks[1]!.id, later);
    expect(() => moveBlock(dead, f.session.blocks[1]!.id, 'up', later)).toThrow(EditError);
  });
});

describe('findBlock', () => {
  it('finds live and tombstoned blocks by id, undefined otherwise', () => {
    const dead = block([], { deletedAt: T0 });
    const live = block([]);
    const s = session([live, dead]);
    expect(findBlock(s, live.id)).toBe(live);
    expect(findBlock(s, dead.id)).toBe(dead);
    expect(findBlock(s, uuid())).toBeUndefined();
  });
});

describe('findSet', () => {
  it('finds a set in any block, tombstoned ones included, with its block', () => {
    const dead = set({ deletedAt: T0 });
    const live = set();
    const b1 = block([live]);
    const b2 = block([dead], { deletedAt: T0 });
    const s = session([b1, b2]);
    expect(findSet(s, live.id)).toEqual({ block: b1, set: live });
    expect(findSet(s, dead.id)).toEqual({ block: b2, set: dead });
    expect(findSet(s, uuid())).toBeUndefined();
  });
});

describe('addSet', () => {
  const bw: SetInput = { reps: 10, loadType: 'bodyweight', loadKg: 0 };
  const twoBlocks = (): SessionFile => sessionFile(session([block(ladder([17, 16])), block([])]));

  it('appends to the named block with order = nextOrder over every sibling (deleted included), updatedAt = now', () => {
    const f = sessionFile(session([block([set({ order: 0 }), set({ order: 4, deletedAt: T0 })]), block([])]));
    const blockId = f.session.blocks[0]!.id;
    const { file: out, setId } = addSet(f, blockId, bw, later);
    valid(out);
    const added = out.session.blocks[0]!.sets.find((s) => s.id === setId);
    expect(added).toEqual({ id: setId, order: 5, reps: 10, loadType: 'bodyweight', loadKg: 0, updatedAt: LATER });
    expect(out.session.blocks[0]!.sets).toHaveLength(3);
    expect(out.session.blocks[0]!.updatedAt).toBe(T0);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
    expect(f.session.blocks[0]!.sets).toHaveLength(2);
  });

  it('starts at order 0 in an empty block and takes a given id', () => {
    const f = twoBlocks();
    const id = uuid();
    const { file: out, setId } = addSet(f, f.session.blocks[1]!.id, bw, later, id);
    expect(setId).toBe(id);
    expect(out.session.blocks[1]!.sets[0]?.order).toBe(0);
    valid(out);
  });

  it('carries no completedAt when none is given (session page) and keeps a given one (Log tab)', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    const plain = valid(addSet(f, blockId, bw, later).file);
    expect('completedAt' in plain.session.blocks[1]!.sets[0]!).toBe(false);
    const live = valid(addSet(f, blockId, { ...bw, completedAt: LATER }, later).file);
    expect(live.session.blocks[1]!.sets[0]!.completedAt).toBe(LATER);
  });

  it('stores a seconds set and a trimmed note', () => {
    const f = twoBlocks();
    const out = valid(addSet(f, f.session.blocks[1]!.id, { seconds: 45, loadType: 'external', loadKg: 35, note: ' slow ' }, later).file);
    expect(out.session.blocks[1]!.sets[0]).toEqual({
      id: out.session.blocks[1]!.sets[0]!.id,
      order: 0,
      seconds: 45,
      loadType: 'external',
      loadKg: 35,
      note: 'slow',
      updatedAt: LATER,
    });
    const blank = valid(addSet(f, f.session.blocks[1]!.id, { ...bw, note: '  ' }, later).file);
    expect('note' in blank.session.blocks[1]!.sets[0]!).toBe(false);
  });

  it('normalises added/assist at 0 kg to bodyweight and refuses bad loads', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    const out = valid(addSet(f, blockId, { reps: 8, loadType: 'added', loadKg: 0 }, later).file);
    expect(out.session.blocks[1]!.sets[0]).toMatchObject({ loadType: 'bodyweight', loadKg: 0 });
    expect(() => addSet(f, blockId, { reps: 8, loadType: 'added', loadKg: -1 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { reps: 8, loadType: 'bodyweight', loadKg: 3 }, later)).toThrow(EditError);
  });

  it('throws EditError on amount <= 0 or not a number (D18)', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    expect(() => addSet(f, blockId, { ...bw, reps: 0 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { ...bw, reps: -2 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { ...bw, reps: Number.NaN }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { seconds: 0, loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
  });

  it('throws EditError on both or neither of reps / seconds', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    expect(() => addSet(f, blockId, { reps: 5, seconds: 30, loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
  });

  it('throws EditError when the metric mixes with the live sets already in the block', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[0]!.id;
    expect(() => addSet(f, blockId, { seconds: 30, loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
    const onlyDeadTimed = sessionFile(session([block([timedSet({ deletedAt: T0 })])]));
    valid(addSet(onlyDeadTimed, onlyDeadTimed.session.blocks[0]!.id, bw, later).file);
  });

  it('throws EditError on an unknown block or a bad completedAt', () => {
    const f = twoBlocks();
    expect(() => addSet(f, uuid(), bw, later)).toThrow(EditError);
    expect(() => addSet(f, f.session.blocks[1]!.id, { ...bw, completedAt: '2030-01-01T11:00:00Z' }, later)).toThrow(EditError);
  });
});

describe('setSetFields', () => {
  const target = (): { file: SessionFile; set: WorkoutSet } => {
    const s = set({ order: 1, reps: 12, loadType: 'added', loadKg: 11.5, completedAt: T0, note: 'old' });
    return { file: sessionFile(session([block([set({ order: 0 }), s]), block([])])), set: s };
  };

  it('changes the amount and touches only that set', () => {
    const { file: f, set: s } = target();
    const out = valid(setSetFields(f, s.id, { reps: 13 }, later));
    const edited = findSet(out.session, s.id)!.set;
    expect(edited).toEqual({ ...s, reps: 13, updatedAt: LATER });
    expect(out.session.blocks[0]!.sets[0]).toBe(f.session.blocks[0]!.sets[0]);
    expect(out.session.blocks[0]!.updatedAt).toBe(T0);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
    expect(amountOf(findSet(f.session, s.id)!.set)).toBe(12);
  });

  it('never touches completedAt, whatever changes', () => {
    const { file: f, set: s } = target();
    const out = setSetFields(f, s.id, { reps: 1, loadType: 'external', loadKg: 20, note: null }, later);
    expect(findSet(out.session, s.id)!.set.completedAt).toBe(T0);
    const untimed = sessionFile(session([block([set()])]));
    const id = untimed.session.blocks[0]!.sets[0]!.id;
    expect('completedAt' in findSet(setSetFields(untimed, id, { reps: 2 }, later).session, id)!.set).toBe(false);
  });

  it('uses max(now, previous + 1 ms)', () => {
    const { file: f, set: s } = target();
    expect(findSet(setSetFields(f, s.id, { reps: 13 }, earlier).session, s.id)!.set.updatedAt).toBe(T0_PLUS_1);
  });

  it('changes the load through normalizeLoad, merging with the stored load', () => {
    const { file: f, set: s } = target();
    const kgOnly = valid(setSetFields(f, s.id, { loadKg: 15 }, later));
    expect(findSet(kgOnly.session, s.id)!.set).toMatchObject({ loadType: 'added', loadKg: 15 });
    const toZero = valid(setSetFields(f, s.id, { loadKg: 0 }, later));
    expect(findSet(toZero.session, s.id)!.set).toMatchObject({ loadType: 'bodyweight', loadKg: 0 });
    const toExternal = valid(setSetFields(f, s.id, { loadType: 'external' }, later));
    expect(findSet(toExternal.session, s.id)!.set).toMatchObject({ loadType: 'external', loadKg: 11.5 });
    const toBand = valid(setSetFields(f, s.id, { loadType: 'band', loadKg: 50 }, later));
    expect(findSet(toBand.session, s.id)!.set).toMatchObject({ loadType: 'band', loadKg: 50 });
    expect(() => setSetFields(f, s.id, { loadKg: -1 }, later)).toThrow(EditError);
  });

  it('switching to bodyweight without a kg zeroes the stored kg (the sheet need not pass both)', () => {
    const { file: f, set: s } = target();
    const out = valid(setSetFields(f, s.id, { loadType: 'bodyweight' }, later));
    expect(findSet(out.session, s.id)!.set).toMatchObject({ loadType: 'bodyweight', loadKg: 0 });
    expect(() => setSetFields(f, s.id, { loadType: 'bodyweight', loadKg: 3 }, later)).toThrow(EditError);
  });

  it('note: a string sets it, null or blank removes it', () => {
    const { file: f, set: s } = target();
    expect(findSet(valid(setSetFields(f, s.id, { note: 'deep' }, later)).session, s.id)!.set.note).toBe('deep');
    expect('note' in findSet(valid(setSetFields(f, s.id, { note: null }, later)).session, s.id)!.set).toBe(false);
    expect('note' in findSet(valid(setSetFields(f, s.id, { note: ' ' }, later)).session, s.id)!.set).toBe(false);
  });

  it('throws EditError on amount <= 0, on a metric switch and on both metrics', () => {
    const { file: f, set: s } = target();
    expect(() => setSetFields(f, s.id, { reps: 0 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { reps: -1 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { reps: Number.POSITIVE_INFINITY }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { seconds: 30 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { reps: 5, seconds: 30 }, later)).toThrow(EditError);
    const timed = sessionFile(session([block([timedSet()])]));
    const id = timed.session.blocks[0]!.sets[0]!.id;
    expect(() => setSetFields(timed, id, { reps: 5 }, later)).toThrow(EditError);
    expect(findSet(valid(setSetFields(timed, id, { seconds: 40 }, later)).session, id)!.set).toMatchObject({ seconds: 40 });
  });

  it('throws EditError on an unknown set', () => {
    expect(() => setSetFields(target().file, uuid(), { reps: 5 }, later)).toThrow(EditError);
  });

  it('lets a migrated aggregate set change only its note', () => {
    const agg = set({ reps: 100, aggregate: true });
    const f = sessionFile(session([block([agg])], { source: 'migrated' }));
    expect(findSet(valid(setSetFields(f, agg.id, { note: 'n' }, later)).session, agg.id)!.set.note).toBe('n');
    expect(() => setSetFields(f, agg.id, { reps: 90 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, agg.id, { loadKg: 5, loadType: 'added' }, later)).toThrow(EditError);
  });
});

describe('deleteSet / undeleteSet', () => {
  it('tombstones only the set and round-trips', () => {
    const f = sessionFile(session([block(ladder([5, 4])), block([])]));
    const s = f.session.blocks[0]!.sets[1]!;
    const deleted = valid(deleteSet(f, s.id, later));
    const dead = findSet(deleted.session, s.id)!.set;
    expect(dead.deletedAt).toBe(LATER);
    expect(dead.updatedAt).toBe(LATER);
    expect(amountOf(dead)).toBe(4);
    expect(deleted.session.blocks[0]!.sets[0]).toBe(f.session.blocks[0]!.sets[0]);
    expect(deleted.session.blocks[0]!.updatedAt).toBe(T0);
    expect(deleted.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(deleted.session.updatedAt).toBe(T0);

    const restored = valid(undeleteSet(deleted, s.id, earlier));
    const back = findSet(restored.session, s.id)!.set;
    expect('deletedAt' in back).toBe(false);
    expect(back.updatedAt).toBe('2030-01-01T11:00:00.001Z');
    expect(restored.session.blocks[0]!.updatedAt).toBe(T0);
  });

  it('throws EditError on an unknown set', () => {
    expect(() => deleteSet(sessionFile(), uuid(), later)).toThrow(EditError);
    expect(() => undeleteSet(sessionFile(), uuid(), later)).toThrow(EditError);
  });
});

describe('edits refuse a tombstoned session or block (a write no view would show)', () => {
  const input: SetInput = { reps: 5, loadType: 'bodyweight', loadKg: 0 };

  it('every edit of a deleted block throws EditError; its undelete still works', () => {
    const f = sessionFile(session([block(ladder([5]), { deletedAt: T0, order: 0 }), block([], { order: 1 })]));
    const id = f.session.blocks[0]!.id;
    const setId = f.session.blocks[0]!.sets[0]!.id;
    expect(() => addSet(f, id, input, later)).toThrow(/block was deleted/);
    expect(() => setSetFields(f, setId, { reps: 6 }, later)).toThrow(EditError);
    expect(() => deleteSet(f, setId, later)).toThrow(EditError);
    expect(() => setBlockNote(f, id, 'x', later)).toThrow(EditError);
    expect(() => deleteBlock(f, id, later)).toThrow(EditError);
    expect(() => moveBlock(f, id, 'down', later)).toThrow(EditError);
    expect(valid(undeleteBlock(f, id, later)).session.blocks[0]?.deletedAt).toBeUndefined();
    expect(valid(undeleteSet(f, setId, later)).session.blocks[0]?.sets[0]?.updatedAt).toBe(LATER);
  });

  it('every edit inside a deleted session throws EditError; its undelete still works', () => {
    const f = sessionFile(session([block(ladder([5]), { order: 0 }), block([], { order: 1 })], { deletedAt: T0 }));
    const id = f.session.blocks[0]!.id;
    const setId = f.session.blocks[0]!.sets[0]!.id;
    expect(() => addSet(f, id, input, later)).toThrow(/session was deleted/);
    expect(() => setSetFields(f, setId, { reps: 6 }, later)).toThrow(EditError);
    expect(() => deleteSet(f, setId, later)).toThrow(EditError);
    expect(() => addBlock(f, 'dips', later)).toThrow(EditError);
    expect(() => setBlockNote(f, id, 'x', later)).toThrow(EditError);
    expect(() => deleteBlock(f, id, later)).toThrow(EditError);
    expect(() => moveBlock(f, id, 'down', later)).toThrow(EditError);
    expect(valid(undeleteSession(f, later)).session.deletedAt).toBeUndefined();
  });
});
