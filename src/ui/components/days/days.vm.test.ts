import { describe, expect, it } from 'vitest';
import { exerciseIndicator, sessionExerciseIds } from '../../../model/derive';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { formatMinutes } from '../../format';
import { daysVm, exerciseMarks, type DaysChip } from './days.vm';

const CATALOG: Exercise[] = [
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }),
  exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs' }),
  exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds' }),
];

function vm(over: { sessions?: Session[]; lockedSessions?: Session[]; chip?: DaysChip; openSessionId?: string } = {}) {
  return daysVm({
    sessions: over.sessions ?? [],
    lockedSessions: over.lockedSessions ?? [],
    catalog: CATALOG,
    chip: over.chip ?? 'all',
    openSessionId: over.openSessionId,
  });
}

const ids = (v: ReturnType<typeof vm>): string[] => v.months.flatMap((m) => m.rows.map((r) => r.sessionId));

describe('daysVm', () => {
  it('lists sessions newest first, grouped by month with a month title', () => {
    const a = session([block(ladder([5]))], { date: '2030-02-27' });
    const b = session([block(ladder([5]))], { date: '2030-03-04' });
    const c = session([block(ladder([5]))], { date: '2030-03-07' });
    const v = vm({ sessions: [a, c, b] });
    expect(v.months.map((m) => [m.key, m.title])).toEqual([['2030-03', 'March 2030'], ['2030-02', 'February 2030']]);
    expect(v.months[0]?.rows.map((r) => r.sessionId)).toEqual([c.id, b.id]);
    expect(v.months[1]?.rows.map((r) => r.sessionId)).toEqual([a.id]);
    expect(v.months[0]?.rows[0]?.day).toBe('Thu 07 Mar');
    expect(v.empty).toBe(false);
  });

  it('orders two sessions of one day by session order (start time), newest first', () => {
    const early = session([], { date: '2030-03-04', startedAt: '2030-03-04T08:00:00.000Z' });
    const late = session([], { date: '2030-03-04', startedAt: '2030-03-04T18:00:00.000Z' });
    expect(ids(vm({ sessions: [early, late] }))).toEqual([late.id, early.id]);
  });

  it('leaves tombstoned sessions out', () => {
    const gone = session([block(ladder([5]))], { date: '2030-03-04', deletedAt: '2030-03-05T10:00:00.000Z' });
    expect(vm({ sessions: [gone] }).empty).toBe(true);
  });

  it('offers All · Push · Pull · Legs · Other with the active one marked', () => {
    const v = vm({ chip: 'pull' });
    expect(v.chips.map((c) => [c.id, c.label, c.active])).toEqual([
      ['all', 'All', false], ['push', 'Push', false], ['pull', 'Pull', true], ['legs', 'Legs', false], ['other', 'Other', false],
    ]);
  });

  it('filters by the blocks’ exercise pattern, never by the label', () => {
    const pullDay = session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-04', label: 'push' });
    const mixed = session([block(ladder([5]), { exerciseId: 'dips' }), block(ladder([5]), { exerciseId: 'squats', order: 1 })], { date: '2030-03-05', label: 'pull' });
    const core = session([block([timedSet()], { exerciseId: 'plank' })], { date: '2030-03-06' });
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'pull' }))).toEqual([pullDay.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'push' }))).toEqual([mixed.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'legs' }))).toEqual([mixed.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'other' }))).toEqual([core.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'all' }))).toEqual([core.id, mixed.id, pullDay.id]);
  });

  it('marks an uncertain date and passes the label through as display text', () => {
    const s = session([], { date: '2030-03-04', dateUncertain: true, label: 'mixed' });
    const t = session([], { date: '2030-03-05' });
    const rows = vm({ sessions: [s, t] }).months[0]?.rows ?? [];
    expect(rows.map((r) => [r.uncertain, r.label])).toEqual([[false, undefined], [true, 'Mixed']]);
  });

  it('lists the exercises in block order, de-duplicated, with the per-exercise mark against all sessions', () => {
    const before = session([block(ladder([5, 5]), { exerciseId: 'pull-ups' }), block(ladder([10]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-01' });
    const now = session([
      block(ladder([6, 6]), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([10]), { exerciseId: 'dips', order: 1 }),
      block(ladder([1]), { exerciseId: 'pull-ups', order: 2 }),
      block(ladder([5]), { exerciseId: 'gone-exercise', order: 3 }),
    ], { date: '2030-03-04' });
    const row = vm({ sessions: [before, now], chip: 'push' }).months[0]?.rows[0];
    expect(row?.sessionId).toBe(now.id);
    expect(row?.exercises).toEqual([
      { id: 'pull-ups', name: 'Pull-ups', mark: 'up' },
      { id: 'dips', name: 'Dips', mark: 'same' },
      { id: 'gone-exercise', name: 'gone-exercise', mark: 'none' },
    ]);
  });

  it('computes marks against all live sessions even when the chip hides the earlier one', () => {
    const before = session([block(ladder([5]), { exerciseId: 'squats' }), block(ladder([10]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-01' });
    // Against the filtered list squats would compare with `before` (5 → 8, up); against all sessions with `legsOnly` (9 → 8, down).
    const legsOnly = session([block(ladder([9]), { exerciseId: 'squats' })], { date: '2030-03-02' });
    const now = session([block(ladder([8]), { exerciseId: 'squats' }), block(ladder([11]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-04' });
    const v = vm({ sessions: [before, legsOnly, now], chip: 'pull' });
    expect(ids(v)).toEqual([now.id, before.id]);
    expect(v.months[0]?.rows[0]?.exercises.map((e) => e.mark)).toEqual(['down', 'up']);
  });

  it('shows the span for a live session and nothing for a migrated one', () => {
    const live = session([block([
      set({ order: 0, completedAt: '2030-03-04T10:05:00.000Z' }),
      set({ order: 1, completedAt: '2030-03-04T10:48:00.000Z' }),
    ])], { date: '2030-03-04', startedAt: '2030-03-04T10:00:00.000Z' });
    const migrated = session([block(ladder([5]))], { date: '2030-03-03', source: 'migrated' });
    const rows = vm({ sessions: [live, migrated] }).months[0]?.rows ?? [];
    expect(rows[0]?.span).toBe(formatMinutes(48 * 60));
    expect(rows[1]?.span).toBeUndefined();
  });

  it('flags the open session only', () => {
    const a = session([], { date: '2030-03-04', startedAt: '2030-03-04T10:00:00.000Z' });
    const b = session([], { date: '2030-03-03' });
    const rows = vm({ sessions: [a, b], openSessionId: a.id }).months[0]?.rows ?? [];
    expect(rows.map((r) => r.open)).toEqual([true, false]);
  });

  it('merges locked sessions into the order, marks them locked, filters them by chip and never as open', () => {
    const ok = session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-04' });
    const locked = session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-03-05' });
    const all = vm({ sessions: [ok], lockedSessions: [locked], openSessionId: locked.id });
    expect(all.months[0]?.rows.map((r) => [r.sessionId, r.locked, r.open])).toEqual([[locked.id, true, false], [ok.id, false, false]]);
    expect(ids(vm({ sessions: [ok], lockedSessions: [locked], chip: 'pull' }))).toEqual([ok.id]);
  });

  it('is empty when no session matches', () => {
    const s = session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-04' });
    const v = vm({ sessions: [s], chip: 'legs' });
    expect(v.months).toEqual([]);
    expect(v.empty).toBe(true);
  });
});

describe('exerciseMarks', () => {
  it('gives every live session the same per-exercise marks as exerciseIndicator against all live sessions', () => {
    const sessions: Session[] = [
      session([block(ladder([5, 5]), { exerciseId: 'pull-ups' }), block(ladder([10]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-01' }),
      // empty, note-less block of pull-ups: no evidence, skipped as a comparison base
      session([block([], { exerciseId: 'pull-ups' }), block(ladder([9]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-02' }),
      // note-only block: evidence, unknown total → 'none' for the next one
      session([block([], { exerciseId: 'dips', note: 'felt off' })], { date: '2030-03-03' }),
      // two sessions on one day: ordered by start time
      session([block(ladder([6, 6]), { exerciseId: 'pull-ups' })], { date: '2030-03-04', startedAt: '2030-03-04T18:00:00.000Z' }),
      session([block(ladder([7]), { exerciseId: 'pull-ups' }), block(ladder([8]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-04', startedAt: '2030-03-04T08:00:00.000Z' }),
      session([block(ladder([4]), { exerciseId: 'squats' }), block(ladder([3]), { exerciseId: 'pull-ups', order: 1 }), block(ladder([3]), { exerciseId: 'pull-ups', order: 2 })], { date: '2030-03-06' }),
      session([block([set({ reps: 100, aggregate: true })], { exerciseId: 'squats' })], { date: '2030-03-07', source: 'migrated' }),
      session([block(ladder([20]), { exerciseId: 'squats' })], { date: '2030-03-08' }),
      session([block(ladder([1]), { exerciseId: 'dips' })], { date: '2030-03-09', deletedAt: '2030-03-09T12:00:00.000Z' }),
      session([block(ladder([12]), { exerciseId: 'dips' })], { date: '2030-03-10' }),
      session([block(ladder([6, 6]), { exerciseId: 'dips' })], { date: '2030-03-11' }),
    ];
    const marks = exerciseMarks(sessions);
    const live = sessions.filter((s) => s.deletedAt === undefined);
    expect([...marks.keys()].sort()).toEqual(live.map((s) => s.id).sort());
    for (const s of live) {
      const expected = new Map(sessionExerciseIds(s).map((id) => [id, exerciseIndicator(sessions, s, id)]));
      expect(marks.get(s.id)).toEqual(expected);
    }
    // the fixture really exercises every branch
    const all = live.flatMap((s) => [...(marks.get(s.id)?.values() ?? [])]);
    expect(new Set(all)).toEqual(new Set(['up', 'down', 'same', 'none']));
  });
});

describe('daysVm with precomputed marks', () => {
  it('takes the marks of a live session from `marks` when given (DaysTab computes them once per data change)', () => {
    const s = session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-03-04' });
    const v = daysVm({ sessions: [s], lockedSessions: [], catalog: CATALOG, chip: 'all', openSessionId: undefined, marks: new Map([[s.id, new Map([['dips', 'up' as const]])]]) });
    expect(v.months[0]?.rows[0]?.exercises).toEqual([{ id: 'dips', name: 'Dips', mark: 'up' }]);
  });
});
