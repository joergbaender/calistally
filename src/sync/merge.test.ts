import { describe, expect, it } from 'vitest';
import { tombstone, touch, undelete } from '../model/record';
import { validateForWrite } from '../model/validate';
import { block, bodyweight, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile, set, T0 } from '../model/test-fixtures';
import type { Block, Session, SessionFile, WorkoutSet } from '../model/types';
import { canonicalJson, mergeBlock, mergeById, mergeFile, mergeSession, pickWinner, sameContent, sameRecords } from './merge';

const T1 = '2030-01-01T11:00:00.000Z';
const T2 = '2030-01-01T12:00:00.000Z';

describe('canonicalJson', () => {
  it('sorts keys at every level and leaves arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(sameContent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameContent([1, 2], [2, 1])).toBe(false);
  });
});

describe('sameRecords', () => {
  const ids = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c'] as const;
  const s = session([
    block([set({ id: ids[1], order: 0 }), set({ id: ids[0], order: 1 })], { id: ids[2], order: 0 }),
    block([], { id: ids[0], order: 1 }),
  ], { tags: ['push', 'pull'] });

  it('ignores the position of records (objects with an id) at every level', () => {
    const [b1, b2] = s.blocks as [Block, Block];
    const reordered: Session = { ...s, blocks: [b2, { ...b1, sets: [...b1.sets].reverse() }] };
    expect(sameContent(reordered, s)).toBe(false);
    expect(sameRecords(sessionFile(reordered), sessionFile(s))).toBe(true);
    expect(sameRecords(exercisesFile([exercise({ id: 'b' }), exercise({ id: 'a' })]), exercisesFile([exercise({ id: 'a' }), exercise({ id: 'b' })]))).toBe(true);
    expect(sameRecords({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
  });

  it('keeps every other array positional, tags included', () => {
    expect(sameRecords({ ...s, tags: ['pull', 'push'] }, s)).toBe(false);
    expect(sameRecords([1, 2], [2, 1])).toBe(false);
  });

  it('still sees a changed field inside a moved record', () => {
    const [b1, b2] = s.blocks as [Block, Block];
    expect(sameRecords({ ...s, blocks: [b2, { ...b1, exerciseId: 'dips-bar' }] }, s)).toBe(false);
    expect(sameRecords({ ...s, blocks: [b2] }, s)).toBe(false);
  });
});

describe('pickWinner', () => {
  const base = set({ id: '00000000-0000-4000-8000-00000000aaaa', reps: 10 });

  it('lets the newer updatedAt supply the own fields', () => {
    const newer = { ...base, reps: 11, updatedAt: T1 };
    expect(pickWinner(base, newer)).toBe(newer);
    expect(pickWinner(newer, base)).toBe(newer);
  });

  it('lets a tombstone win on equal updatedAt', () => {
    const dead = { ...base, reps: 11, deletedAt: T0 };
    expect(pickWinner(base, dead)).toBe(dead);
    expect(pickWinner(dead, base)).toBe(dead);
  });

  it('lets the newer live copy beat an older tombstone (undelete wins)', () => {
    const dead = tombstone(base, new Date(T1));
    const revived = undelete(dead, new Date(T2));
    expect(pickWinner(dead, revived)).toBe(revived);
  });

  it('breaks a full tie by canonical JSON, the same way from both sides', () => {
    const a = { ...base, reps: 10 };
    const b = { ...base, reps: 12 };
    expect(pickWinner(a, b)).toBe(b);
    expect(pickWinner(b, a)).toBe(b);
  });

  it('ignores child arrays when breaking the tie', () => {
    const a = block(ladder([1, 2, 3]), { id: '00000000-0000-4000-8000-00000000bbbb', note: 'b' });
    const b = { ...a, note: 'a', sets: ladder([9, 9, 9]) };
    expect(pickWinner(a, b, 'sets')).toBe(a);
    expect(pickWinner(b, a, 'sets')).toBe(a);
  });
});

describe('mergeById', () => {
  it('keeps records seen on one side only and sorts by id', () => {
    const a = set({ id: '00000000-0000-4000-8000-000000000003' });
    const b = set({ id: '00000000-0000-4000-8000-000000000001' });
    const out = mergeById([a], [b], pickWinner);
    expect(out.map((s) => s.id)).toEqual([b.id, a.id]);
  });
});

describe('mergeSession', () => {
  it('merges own fields, blocks and sets independently', () => {
    const s1 = set({ id: '00000000-0000-4000-8000-000000000011', reps: 10 });
    const s2 = set({ id: '00000000-0000-4000-8000-000000000012', reps: 9 });
    const b1 = block([s1, s2], { id: '00000000-0000-4000-8000-000000000021' });
    const local = session([b1], { id: '00000000-0000-4000-8000-000000000031', notes: 'old' });
    // Device A edited the session note; device B logged a third set and changed set 2.
    const a: Session = touch({ ...local, notes: 'new' }, new Date(T1));
    const s3 = set({ id: '00000000-0000-4000-8000-000000000013', reps: 8, updatedAt: T1 });
    const b: Session = { ...local, blocks: [{ ...b1, sets: [s1, { ...s2, reps: 7, updatedAt: T1 }, s3] }] };
    const merged = mergeSession(a, b);
    expect(merged.notes).toBe('new');
    expect(merged.updatedAt).toBe(a.updatedAt);
    expect(merged.blocks[0]?.sets.map((s) => (s as { reps?: number }).reps)).toEqual([10, 7, 8]);
    expect(sameContent(mergeSession(b, a), merged)).toBe(true);
  });

  it('keeps a tombstoned parent and its untouched children', () => {
    const b1 = block(ladder([5, 4]), { id: '00000000-0000-4000-8000-000000000041' });
    const live = session([b1], { id: '00000000-0000-4000-8000-000000000051' });
    const dead = tombstone(live, new Date(T1));
    const merged = mergeSession(live, dead);
    expect(merged.deletedAt).toBe(dead.deletedAt);
    expect(merged.blocks).toHaveLength(1);
    expect(merged.blocks[0]?.sets).toHaveLength(2);
  });

  it('is idempotent for tombstones: merging with itself or an older copy changes nothing', () => {
    const live = session([block(ladder([3]))], { id: '00000000-0000-4000-8000-000000000061' });
    const dead = tombstone(live, new Date(T1));
    expect(sameContent(mergeSession(dead, dead), dead)).toBe(true);
    expect(sameContent(mergeSession(dead, live), mergeSession(live, dead))).toBe(true);
    expect(sameContent(mergeSession(mergeSession(dead, live), live), mergeSession(dead, live))).toBe(true);
  });
});

describe('mergeFile', () => {
  it('merges exercises by id', () => {
    const a = exercisesFile([exercise({ id: 'pull-ups', name: 'Pull-ups' })]);
    const b = exercisesFile([exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }), exercise({ id: 'pull-ups', name: 'Pull-Ups', updatedAt: T1 })]);
    const out = mergeFile('exercises', a, b);
    expect(out.exercises.map((e) => [e.id, e.name])).toEqual([['dips-bar', 'Dips (Bar)'], ['pull-ups', 'Pull-Ups']]);
    expect(validateForWrite('exercises', out).ok).toBe(true);
  });

  it('merges bodyweight entries by id', () => {
    const e = bodyweight({ id: '00000000-0000-4000-8000-000000000071', kg: 80 });
    const out = mergeFile('bodyweight', bodyweightFile([e]), bodyweightFile([{ ...e, kg: 81, updatedAt: T1 }]));
    expect(out.entries[0]?.kg).toBe(81);
    expect(validateForWrite('bodyweight', out).ok).toBe(true);
  });

  it('refuses two different sessions', () => {
    expect(() => mergeFile('session', sessionFile(session([], { id: '00000000-0000-4000-8000-000000000081' })), sessionFile(session([], { id: '00000000-0000-4000-8000-000000000082' })))).toThrow(/cannot merge/);
  });
});

/** A small seeded generator, so the property tests are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const STAMPS = [T0, T1, T2, '2030-01-01T13:00:00.000Z'];
const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function randomSet(r: () => number, blockN: number, n: number): WorkoutSet {
  const base = set({ id: idOf(100 + blockN * 10 + n), order: n, reps: 1 + Math.floor(r() * 20), updatedAt: STAMPS[Math.floor(r() * 4)] as string });
  return r() < 0.2 ? { ...base, deletedAt: base.updatedAt } : base;
}

function randomBlock(r: () => number, n: number): Block {
  const count = Math.floor(r() * 4);
  const sets = [...Array(count).keys()].filter(() => r() < 0.8).map((i) => randomSet(r, n, i));
  const b = block(sets, { id: idOf(200 + n), order: n, updatedAt: STAMPS[Math.floor(r() * 4)] as string, ...(r() < 0.5 ? { note: `n${Math.floor(r() * 3)}` } : {}) });
  return r() < 0.15 ? { ...b, deletedAt: b.updatedAt } : b;
}

/** One of several "device copies" of the same session: shared ids, independently varied fields. */
function randomCopy(r: () => number): SessionFile {
  const blocks = [0, 1, 2].filter(() => r() < 0.8).map((i) => randomBlock(r, i));
  const s = session(blocks, { id: idOf(300), updatedAt: STAMPS[Math.floor(r() * 4)] as string, ...(r() < 0.5 ? { notes: `s${Math.floor(r() * 3)}` } : {}) });
  return sessionFile(r() < 0.1 ? { ...s, deletedAt: s.updatedAt } : s);
}

describe('merge properties', () => {
  it('is symmetric, idempotent and associative over random device copies, and the result validates', () => {
    const r = rng(42);
    for (let round = 0; round < 200; round += 1) {
      const a = randomCopy(r);
      const b = randomCopy(r);
      const c = randomCopy(r);
      const ab = mergeFile('session', a, b);
      expect(canonicalJson(mergeFile('session', b, a))).toBe(canonicalJson(ab));
      expect(sameContent(mergeFile('session', a, a), a)).toBe(true); // the fixture's arrays are already in id order
      expect(canonicalJson(mergeFile('session', ab, b))).toBe(canonicalJson(ab));
      expect(canonicalJson(mergeFile('session', ab, c))).toBe(canonicalJson(mergeFile('session', a, mergeFile('session', b, c))));
      expect(validateForWrite('session', ab).ok).toBe(true);
    }
  });

  it('never loses a record: every id on either side is in the result', () => {
    const r = rng(7);
    for (let round = 0; round < 100; round += 1) {
      const a = randomCopy(r);
      const b = randomCopy(r);
      const out = mergeFile('session', a, b);
      const ids = (f: SessionFile): string[] => f.session.blocks.flatMap((bl) => [bl.id, ...bl.sets.map((s) => s.id)]);
      const got = new Set(ids(out));
      for (const id of [...ids(a), ...ids(b)]) expect(got.has(id)).toBe(true);
    }
  });
});

describe('mergeBlock', () => {
  it('takes the winner\'s note and the union of sets', () => {
    const a = block(ladder([1]), { id: '00000000-0000-4000-8000-000000000091', note: 'a' });
    const b: Block = { ...a, note: 'b', updatedAt: T1, sets: [...a.sets, set({ id: '00000000-0000-4000-8000-000000000092', reps: 2 })] };
    const out = mergeBlock(a, b);
    expect(out.note).toBe('b');
    expect(out.sets).toHaveLength(2);
  });
});
