import { describe, expect, it } from 'vitest';
import {
  dayType,
  defaultCurrentBlock,
  latestCompletedAt,
  pairCards,
  proposeReference,
  proposedAmount,
  recentSessions,
  sessionExerciseIds,
  sessionSpan,
  stepFor,
  stickyLoad,
} from './live';
import { T0, block, exercise, ladder, session, set, timedSet } from '../test-fixtures';

const catalog = [
  exercise(),
  exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }),
  exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs' }),
  exercise({ id: 'knee-raises', name: 'Knee Raises', pattern: 'core' }),
];

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('dayType (spec 4 §4 proposal rule)', () => {
  it('is the chip most live blocks have', () => {
    const s = session([
      block([], { order: 0, exerciseId: 'pull-ups' }),
      block([], { order: 1, exerciseId: 'dips-bar' }),
      block([], { order: 2, exerciseId: 'push-ups' }),
    ]);
    expect(dayType(s, catalog)).toBe('push');
  });

  it('on a tie the first block in canonical order wins, not the first in the array', () => {
    const s = session([
      block([], { order: 1, exerciseId: 'pull-ups' }),
      block([], { order: 0, exerciseId: 'dips-bar' }),
    ]);
    expect(dayType(s, catalog)).toBe('push');
  });

  it('counts an unknown exercise as other', () => {
    const s = session([block([], { order: 0, exerciseId: 'ghost' })]);
    expect(dayType(s, catalog)).toBe('other');
    const core = session([block([], { order: 0, exerciseId: 'knee-raises' })]);
    expect(dayType(core, catalog)).toBe('other');
  });

  it('is undefined without live blocks and ignores tombstoned blocks', () => {
    expect(dayType(session([]), catalog)).toBeUndefined();
    const s = session([
      block([], { order: 0, exerciseId: 'dips-bar', deletedAt: T0 }),
      block([], { order: 1, exerciseId: 'dips-bar', deletedAt: T0 }),
      block([], { order: 2, exerciseId: 'pull-ups' }),
    ]);
    expect(dayType(s, catalog)).toBe('pull');
    expect(dayType(session([block()], { deletedAt: T0 }), catalog)).toBeUndefined();
  });
});

describe('recentSessions', () => {
  const a = session([], { id: id(901), date: '2030-03-01' });
  const b = session([], { id: id(902), date: '2030-03-02' });
  const dead = session([], { id: id(903), date: '2030-03-03', deletedAt: T0 });
  const c = session([], { id: id(904), date: '2030-03-04' });
  const today = session([], { id: id(905), date: '2030-03-05' });

  it('excludes the given id, drops tombstones and lists newest first', () => {
    expect(recentSessions([a, today, dead, c, b], today.id).map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it('respects the limit and defaults to 10', () => {
    expect(recentSessions([a, b, c, today], undefined, 2).map((s) => s.id)).toEqual([today.id, c.id]);
    const many = Array.from({ length: 12 }, (_, i) => session([], { id: id(800 + i), date: `2030-04-${String(i + 1).padStart(2, '0')}` }));
    expect(recentSessions(many, undefined)).toHaveLength(10);
    expect(recentSessions(many, undefined)[0]?.id).toBe(id(811));
  });
});

describe('proposeReference (spec 4 §4 proposal rule)', () => {
  const push = (over: Partial<ReturnType<typeof session>>) => session([block([], { exerciseId: 'dips-bar' })], over);
  const pull = (over: Partial<ReturnType<typeof session>>) => session([block([], { exerciseId: 'pull-ups' })], over);
  const legs = (over: Partial<ReturnType<typeof session>>) => session([block([], { exerciseId: 'squats' })], over);

  it('with a push/pull/legs rotation proposes the day type gone longest without', () => {
    const sessions = [
      push({ id: id(911), date: '2030-03-01' }),
      pull({ id: id(912), date: '2030-03-02' }),
      legs({ id: id(913), date: '2030-03-03' }),
      push({ id: id(914), date: '2030-03-04' }),
    ];
    expect(proposeReference(sessions, catalog, undefined)?.id).toBe(id(912));
  });

  it('with one day type only proposes its most recent session', () => {
    const sessions = [pull({ id: id(921), date: '2030-03-01' }), pull({ id: id(922), date: '2030-03-03' }), pull({ id: id(923), date: '2030-03-02' })];
    expect(proposeReference(sessions, catalog, undefined)?.id).toBe(id(922));
  });

  it('returns undefined with no sessions, with only tombstones and with only empty sessions', () => {
    expect(proposeReference([], catalog, undefined)).toBeUndefined();
    expect(proposeReference([pull({ id: id(931), date: '2030-03-01', deletedAt: T0 })], catalog, undefined)).toBeUndefined();
    expect(proposeReference([session([], { id: id(932), date: '2030-03-01' })], catalog, undefined)).toBeUndefined();
  });

  it("excludes today's session id", () => {
    const today = push({ id: id(941), date: '2030-03-05' });
    const sessions = [pull({ id: id(942), date: '2030-03-02' }), push({ id: id(943), date: '2030-03-04' }), today];
    // Without the exclusion push's most recent is today (03-05) and pull (03-02) still wins; the
    // exclusion matters when today is the only session of its type.
    const onlyToday = [pull({ id: id(944), date: '2030-03-06' }), today];
    expect(proposeReference(sessions, catalog, today.id)?.id).toBe(id(942));
    expect(proposeReference(onlyToday, catalog, today.id)?.id).toBe(id(944));
  });

  it('on equal dates picks the lower in session order', () => {
    const lower = push({ id: id(951), date: '2030-03-05' });
    const higher = pull({ id: id(952), date: '2030-03-05' });
    expect(proposeReference([higher, lower], catalog, undefined)?.id).toBe(lower.id);
    const earlyStart = pull({ id: id(953), date: '2030-03-05', startedAt: '2030-03-05T08:00:00.000Z' });
    const lateStart = push({ id: id(950), date: '2030-03-05', startedAt: '2030-03-05T18:00:00.000Z' });
    expect(proposeReference([lateStart, earlyStart], catalog, undefined)?.id).toBe(earlyStart.id);
  });
});

describe('pairCards (spec 4 §4 cards, U13)', () => {
  it('pairs two runs of one exercise positionally', () => {
    const r1 = block(ladder([10, 10]), { order: 0, exerciseId: 'pull-ups' });
    const rDips = block(ladder([8]), { order: 1, exerciseId: 'dips-bar' });
    const r2 = block(ladder([6, 6]), { order: 2, exerciseId: 'pull-ups' });
    const reference = session([r2, rDips, r1]);
    const t1 = block(ladder([11]), { order: 0, exerciseId: 'pull-ups' });
    const t2 = block(ladder([7]), { order: 1, exerciseId: 'pull-ups' });
    const today = session([t2, t1]);
    expect(pairCards(today, reference)).toEqual([
      { exerciseId: 'pull-ups', reference: r1, today: t1 },
      { exerciseId: 'dips-bar', reference: rDips, today: undefined },
      { exerciseId: 'pull-ups', reference: r2, today: t2 },
    ]);
  });

  it("appends today's new exercise and third run after the reference cards, in canonical order", () => {
    const r1 = block(ladder([10]), { order: 0, exerciseId: 'pull-ups' });
    const reference = session([r1]);
    const t1 = block(ladder([11]), { order: 0, exerciseId: 'pull-ups' });
    const tNew = block(ladder([20]), { order: 1, exerciseId: 'push-ups' });
    const t2 = block(ladder([5]), { order: 2, exerciseId: 'pull-ups' });
    const today = session([t2, tNew, t1]);
    expect(pairCards(today, reference)).toEqual([
      { exerciseId: 'pull-ups', reference: r1, today: t1 },
      { exerciseId: 'push-ups', reference: undefined, today: tNew },
      { exerciseId: 'pull-ups', reference: undefined, today: t2 },
    ]);
  });

  it("with No reference shows today's blocks only, in canonical order, tombstones out", () => {
    const b0 = block([], { order: 0, exerciseId: 'dips-bar' });
    const b1 = block([], { order: 1, exerciseId: 'pull-ups' });
    const dead = block([], { order: 2, exerciseId: 'squats', deletedAt: T0 });
    expect(pairCards(session([b1, dead, b0]), undefined)).toEqual([
      { exerciseId: 'dips-bar', reference: undefined, today: b0 },
      { exerciseId: 'pull-ups', reference: undefined, today: b1 },
    ]);
  });

  it('a reference block without a today block has today undefined; an empty today gives reference cards only', () => {
    const r = block(ladder([10]), { order: 0, exerciseId: 'pull-ups' });
    expect(pairCards(session([]), session([r]))).toEqual([{ exerciseId: 'pull-ups', reference: r, today: undefined }]);
  });
});

describe('stepFor', () => {
  it('steps reps by 1 and seconds by 5', () => {
    expect(stepFor('reps')).toBe(1);
    expect(stepFor('seconds')).toBe(5);
  });
});

describe('proposedAmount (spec 4 §4 stepper)', () => {
  const reference = block(ladder([17, 16, 15, 14, 13]));

  it("takes the reference set at position today's live set count + 1", () => {
    expect(proposedAmount(undefined, reference)).toBe(17);
    expect(proposedAmount(block(ladder([17, 16])), reference)).toBe(15);
  });

  it('ignores tombstoned sets in today when counting the position', () => {
    const today = block([set({ reps: 17, order: 0 }), set({ reps: 16, order: 1, deletedAt: T0 })]);
    expect(proposedAmount(today, reference)).toBe(16);
  });

  it("falls back to today's last set in canonical order when the reference runs out or is absent", () => {
    const today = block([set({ reps: 9, order: 1 }), set({ reps: 12, order: 0 })]);
    expect(proposedAmount(today, block(ladder([10])))).toBe(9);
    expect(proposedAmount(today, undefined)).toBe(9);
  });

  it('is undefined when both are empty', () => {
    expect(proposedAmount(undefined, undefined)).toBeUndefined();
    expect(proposedAmount(block([]), block([]))).toBeUndefined();
  });

  it("never proposes a migrated aggregate set's total: falls back to today's last set, else nothing", () => {
    const aggregateRef = block([set({ reps: 100, aggregate: true, order: 0 })]);
    expect(proposedAmount(undefined, aggregateRef)).toBeUndefined();
    expect(proposedAmount(block([set({ reps: 12 })]), block([set({ reps: 10, order: 0 }), set({ reps: 100, aggregate: true, order: 1 })]))).toBe(12);
    // A late entry in a migrated block (no reference) does not start from the aggregate either.
    expect(proposedAmount(aggregateRef, undefined)).toBeUndefined();
  });

  it('works for seconds', () => {
    const ref = block([timedSet({ seconds: 30, order: 0 }), timedSet({ seconds: 45, order: 1 })]);
    expect(proposedAmount(block([timedSet({ seconds: 30 })]), ref)).toBe(45);
    expect(proposedAmount(block([timedSet({ seconds: 25 })]), undefined)).toBe(25);
  });
});

describe('stickyLoad (spec 4 §4 entry area)', () => {
  it("uses today's last live set", () => {
    const today = block([
      set({ order: 0, loadType: 'added', loadKg: 10 }),
      set({ order: 1, loadType: 'added', loadKg: 11.5 }),
      set({ order: 2, loadType: 'external', loadKg: 40, deletedAt: T0 }),
    ]);
    const ref = block([set({ loadType: 'band', loadKg: 50 })]);
    expect(stickyLoad(today, ref, exercise())).toEqual({ loadType: 'added', loadKg: 11.5, needsKg: false });
  });

  it("uses the reference's first live set when today has none", () => {
    const ref = block([set({ order: 1, loadType: 'assist', loadKg: 20 }), set({ order: 0, loadType: 'assist', loadKg: 10 })]);
    expect(stickyLoad(undefined, ref, exercise())).toEqual({ loadType: 'assist', loadKg: 10, needsKg: false });
    expect(stickyLoad(block([]), ref, exercise())).toEqual({ loadType: 'assist', loadKg: 10, needsKg: false });
  });

  it('falls back to the exercise default with 0 kg; added and assist need a kg', () => {
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'added' }))).toEqual({ loadType: 'added', loadKg: 0, needsKg: true });
    expect(stickyLoad(undefined, block([]), exercise({ defaultLoadType: 'assist' }))).toEqual({ loadType: 'assist', loadKg: 0, needsKg: true });
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'bodyweight' }))).toEqual({ loadType: 'bodyweight', loadKg: 0, needsKg: false });
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'external' }))).toEqual({ loadType: 'external', loadKg: 0, needsKg: false });
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'band' }))).toEqual({ loadType: 'band', loadKg: 0, needsKg: false });
  });

  it('an undefined exercise falls back to bodyweight 0', () => {
    expect(stickyLoad(undefined, undefined, undefined)).toEqual({ loadType: 'bodyweight', loadKg: 0, needsKg: false });
  });
});

describe('latestCompletedAt (the counter source)', () => {
  it('is the latest completedAt of a live set in a live block', () => {
    const s = session([
      block([set({ order: 0, completedAt: '2030-03-04T14:10:00.000Z' }), set({ order: 1, completedAt: '2030-03-04T14:20:00.000Z' })], { order: 0 }),
      block([set({ order: 0, completedAt: '2030-03-04T14:15:00.000Z' })], { order: 1 }),
    ]);
    expect(latestCompletedAt(s)).toBe('2030-03-04T14:20:00.000Z');
  });

  it('ignores tombstoned sets and blocks, and is undefined without a stamp', () => {
    const s = session([
      block([set({ order: 0, completedAt: '2030-03-04T14:10:00.000Z' }), set({ order: 1, completedAt: '2030-03-04T14:20:00.000Z', deletedAt: T0 })], { order: 0 }),
      block([set({ order: 0, completedAt: '2030-03-04T14:30:00.000Z' })], { order: 1, deletedAt: T0 }),
    ]);
    expect(latestCompletedAt(s)).toBe('2030-03-04T14:10:00.000Z');
    expect(latestCompletedAt(session([block([set()])]))).toBeUndefined();
  });
});

describe('sessionSpan', () => {
  it('runs from startedAt to the latest completedAt with the seconds', () => {
    const s = session([block([set({ order: 0, completedAt: '2030-03-04T14:53:00.000Z' })])], { startedAt: '2030-03-04T14:05:00.000Z' });
    expect(sessionSpan(s)).toEqual({ from: '2030-03-04T14:05:00.000Z', to: '2030-03-04T14:53:00.000Z', seconds: 48 * 60 });
  });

  it('uses the earliest completedAt when startedAt is absent', () => {
    const s = session([
      block([set({ order: 0, completedAt: '2030-03-04T14:20:00.000Z' })], { order: 0 }),
      block([set({ order: 0, completedAt: '2030-03-04T14:10:00.000Z' }), set({ order: 1, completedAt: '2030-03-04T14:40:30.000Z' })], { order: 1 }),
    ]);
    expect(sessionSpan(s)).toEqual({ from: '2030-03-04T14:10:00.000Z', to: '2030-03-04T14:40:30.000Z', seconds: 30 * 60 + 30 });
  });

  it('is undefined without a completedAt, when the only stamp equals startedAt and for one untimed set', () => {
    expect(sessionSpan(session([block([set()])], { startedAt: '2030-03-04T14:05:00.000Z' }))).toBeUndefined();
    expect(sessionSpan(session([block([set({ completedAt: '2030-03-04T14:05:00.000Z' })])], { startedAt: '2030-03-04T14:05:00.000Z' }))).toBeUndefined();
    expect(sessionSpan(session([block([set({ completedAt: '2030-03-04T14:05:00.000Z' })])]))).toBeUndefined();
    expect(sessionSpan(session([]))).toBeUndefined();
  });
});

describe('defaultCurrentBlock', () => {
  it('is the last live block in canonical order, by order then id, not array position', () => {
    const last = block([], { id: id(961), order: 2 });
    const dead = block([], { id: id(962), order: 5, deletedAt: T0 });
    const first = block([], { id: id(963), order: 0 });
    expect(defaultCurrentBlock(session([last, dead, first]))).toBe(last);
    const tieLow = block([], { id: id(964), order: 1 });
    const tieHigh = block([], { id: id(965), order: 1 });
    expect(defaultCurrentBlock(session([tieHigh, tieLow]))).toBe(tieHigh);
    expect(defaultCurrentBlock(session([]))).toBeUndefined();
  });
});

describe('sessionExerciseIds', () => {
  it('de-duplicates in block order and skips tombstoned blocks', () => {
    const s = session([
      block([], { order: 2, exerciseId: 'pull-ups' }),
      block([], { order: 0, exerciseId: 'dips-bar' }),
      block([], { order: 1, exerciseId: 'pull-ups' }),
      block([], { order: 3, exerciseId: 'squats', deletedAt: T0 }),
      block([], { order: 4, exerciseId: 'push-ups' }),
    ]);
    expect(sessionExerciseIds(s)).toEqual(['dips-bar', 'pull-ups', 'push-ups']);
    expect(sessionExerciseIds(session([]))).toEqual([]);
  });
});
