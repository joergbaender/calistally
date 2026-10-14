import { describe, expect, it } from 'vitest';
import { blockIndicator } from '../../../model/derive';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Exercise } from '../../../model/types';
import { formatAmount, formatDay } from '../../format';
import { exerciseHistoryVm } from './exercise-history.vm';

const pullUps = exercise({ id: 'pull-ups', name: 'Pull-ups' });
const plank = exercise({ id: 'plank', name: 'Plank', metric: 'seconds', pattern: 'core', archived: true });
const catalog = new Map<string, Exercise>([[pullUps.id, pullUps], [plank.id, plank]]);
const n = formatAmount;

describe('exerciseHistoryVm', () => {
  it('lists live blocks newest session first, runs numbered within a session', () => {
    const older = session([block(ladder([5, 4]), { id: 'b-old' })], { id: 's-old', date: '2030-03-01' });
    const newer = session(
      [
        block(ladder([8, 7]), { id: 'b-first', order: 0 }),
        block(ladder([3]), { id: 'b-dips', order: 1, exerciseId: 'dips' }),
        block(ladder([6]), { id: 'b-second', order: 2 }),
      ],
      { id: 's-new', date: '2030-03-04', dateUncertain: true },
    );
    const vm = exerciseHistoryVm('pull-ups', [older, newer], catalog);
    expect(vm).toMatchObject({ name: 'Pull-ups', archived: false, unknown: false, metric: 'reps' });
    expect(vm.rows.map((r) => [r.sessionId, r.blockId, r.run])).toEqual([
      ['s-new', 'b-first', 1],
      ['s-new', 'b-second', 2],
      ['s-old', 'b-old', 1],
    ]);
    const first = vm.rows[0];
    expect(first).toMatchObject({ day: formatDay('2030-03-04'), uncertain: true, sets: `${n(8)} ${n(7)}`, totals: `${n(15)} · 2 sets`, noteOnly: false, load: 'bw' });
    expect(first?.note).toBeUndefined();
    expect(first?.marks).toEqual({ amount: 'up', load: 'hidden' });
    expect(vm.rows[1]?.marks).toEqual({ amount: 'none', load: 'none' });
    expect(vm.rows[2]).toMatchObject({ uncertain: false, totals: `${n(9)} · 2 sets` });
  });

  it('leaves out tombstoned sessions, blocks and sets', () => {
    const s = session(
      [
        block([set({ reps: 5 }), set({ reps: 9, order: 1, deletedAt: '2030-03-02T10:00:00.000Z' })], { id: 'b-live' }),
        block(ladder([4]), { id: 'b-gone', order: 1, deletedAt: '2030-03-02T10:00:00.000Z' }),
      ],
      { date: '2030-03-02' },
    );
    const gone = session([block(ladder([4]))], { date: '2030-03-03', deletedAt: '2030-03-03T10:00:00.000Z' });
    const vm = exerciseHistoryVm('pull-ups', [s, gone], catalog);
    expect(vm.rows.map((r) => [r.blockId, r.sets, r.totals])).toEqual([['b-live', n(5), `${n(5)} · 1 set`]]);
  });

  it('shows an aggregate set as 100* and a note-only block by its note', () => {
    const s = session(
      [
        block([set({ reps: 100, aggregate: true })], { id: 'b-agg' }),
        block([], { id: 'b-note', order: 1, note: 'some pull-ups' }),
      ],
      { date: '2030-03-02', source: 'migrated' },
    );
    const vm = exerciseHistoryVm('pull-ups', [s], catalog);
    expect(vm.rows[0]).toMatchObject({ sets: `${n(100)}*`, totals: `${n(100)}*`, noteOnly: false, load: 'bw' });
    expect(vm.rows[1]).toMatchObject({ sets: '', totals: '', note: 'some pull-ups', noteOnly: true, load: '' });
  });

  it('writes the block load for each group: bw, added, assist, external, band', () => {
    const loads = [
      block([set({ loadType: 'added', loadKg: 11.5 })], { id: 'added' }),
      block([set({ loadType: 'assist', loadKg: 10 })], { id: 'assist' }),
      block([set({ loadType: 'external', loadKg: 35 })], { id: 'external' }),
      block([set({ loadType: 'band', loadKg: 50 })], { id: 'band' }),
      block([set({ loadType: 'added', loadKg: 0 }), set({ order: 1 })], { id: 'zero' }),
    ];
    const sessions = loads.map((b, i) => session([b], { date: `2030-03-1${i}` }));
    const vm = exerciseHistoryVm('pull-ups', sessions, catalog);
    const byBlock = new Map(vm.rows.map((r) => [r.blockId, r.load]));
    expect(byBlock.get('added')).toBe(`+${n(11.5)}`);
    expect(byBlock.get('assist')).toBe(`−${n(10)}`);
    expect(byBlock.get('external')).toBe(`${n(35)} kg`);
    expect(byBlock.get('band')).toBe(`band ${n(50)}`);
    expect(byBlock.get('zero')).toBe('bw');
  });

  it('carries the metric and the archived flag of the exercise', () => {
    const s = session([block([timedSet({ seconds: 45 })], { exerciseId: 'plank' })], { date: '2030-03-02' });
    const vm = exerciseHistoryVm('plank', [s], catalog);
    expect(vm).toMatchObject({ name: 'Plank', archived: true, unknown: false, metric: 'seconds' });
    expect(vm.rows[0]?.sets).toBe(n(45));
  });

  it('names an unknown exercise by its id', () => {
    const s = session([block([timedSet({ seconds: 30 })], { exerciseId: 'l-sit' })], { date: '2030-03-02' });
    const vm = exerciseHistoryVm('l-sit', [s], catalog);
    expect(vm).toMatchObject({ name: 'l-sit', archived: false, unknown: true, metric: 'seconds' });
    expect(vm.rows).toHaveLength(1);
    expect(exerciseHistoryVm('nothing', [], catalog)).toEqual({ name: 'nothing', archived: false, unknown: true, metric: 'reps', rows: [] });
  });

  it('flags the rows of the open session, so their marks render provisional (spec 4 §14)', () => {
    const older = session([block(ladder([5]), { id: 'b-old' })], { id: 's-old', date: '2030-03-01' });
    const open = session([block(ladder([6]), { id: 'b-open' })], { id: 's-open', date: '2030-03-04' });
    const vm = exerciseHistoryVm('pull-ups', [older, open], catalog, 's-open');
    expect(vm.rows.map((r) => [r.blockId, r.open])).toEqual([['b-open', true], ['b-old', false]]);
    expect(exerciseHistoryVm('pull-ups', [older, open], catalog, undefined).rows.every((r) => !r.open)).toBe(true);
  });

  it('carries the year of each row, for the year headings', () => {
    const a = session([block(ladder([5]))], { date: '2029-12-30' });
    const b = session([block(ladder([6]))], { date: '2030-01-02' });
    expect(exerciseHistoryVm('pull-ups', [a, b], catalog).rows.map((r) => r.year)).toEqual(['2030', '2029']);
  });

  it('compares each run with the previous occurrence of that run (spec 1 §7), as blockIndicator does', () => {
    // Run 2 of the newest session skips the middle session, which has only one run.
    const s1 = session([block(ladder([5]), { id: 'a1' }), block(ladder([4]), { id: 'a2', order: 1 })], { id: 's1', date: '2030-03-01' });
    const s2 = session([block(ladder([6]), { id: 'b1' })], { id: 's2', date: '2030-03-02' });
    const s3 = session([block(ladder([7]), { id: 'c1' }), block(ladder([3]), { id: 'c2', order: 1 })], { id: 's3', date: '2030-03-03' });
    const sessions = [s3, s1, s2];
    const vm = exerciseHistoryVm('pull-ups', sessions, catalog);
    expect(vm.rows.map((r) => [r.blockId, r.marks.amount])).toEqual([['c1', 'up'], ['c2', 'down'], ['b1', 'up'], ['a1', 'none'], ['a2', 'none']]);
    for (const r of vm.rows) {
      const s = sessions.find((x) => x.id === r.sessionId);
      const b = s?.blocks.find((x) => x.id === r.blockId);
      if (s === undefined || b === undefined) throw new Error('row without its block');
      expect(r.marks).toEqual(blockIndicator(sessions, s, b));
    }
  });
});
