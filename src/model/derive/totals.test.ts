import { describe, expect, it } from 'vitest';
import { blockLoad, blockTotals, exerciseSessionTotal, round2 } from './totals';
import { T0, block, ladder, session, set, timedSet } from '../test-fixtures';

describe('blockTotals (spec §7)', () => {
  it('sums a ladder and counts sets', () => {
    expect(blockTotals(block(ladder([17, 16, 15, 10])))).toEqual({ metric: 'reps', amount: 58, setCount: 4, hasAggregate: false, isEmpty: false });
  });

  it('rounds decimal reps to 2 places so 16.5 + 17.2 is exactly 33.7', () => {
    expect(blockTotals(block(ladder([16.5, 17.2]))).amount).toBe(33.7);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('counts aggregate sets in the amount but not in setCount', () => {
    const t = blockTotals(block([set({ reps: 100, aggregate: true })]));
    expect(t).toMatchObject({ amount: 100, setCount: 0, hasAggregate: true });
  });

  it('ignores deleted sets and reports empty blocks', () => {
    expect(blockTotals(block([set({ deletedAt: T0 })]))).toMatchObject({ amount: 0, setCount: 0, isEmpty: true });
  });

  it('uses seconds for timed blocks', () => {
    expect(blockTotals(block([timedSet({ seconds: 30, order: 0 }), timedSet({ seconds: 45, order: 1 })]))).toMatchObject({ metric: 'seconds', amount: 75 });
  });
});

describe('blockLoad (spec §7)', () => {
  it('is undefined for an empty block and body/0 for plain bodyweight', () => {
    expect(blockLoad(block())).toBeUndefined();
    expect(blockLoad(block(ladder([5, 4])))).toEqual({ group: 'body', kg: 0 });
  });

  it('takes the max signed kg over the main group', () => {
    const b = block(ladder([30, 30, 20], { loadType: 'added', loadKg: 17.4 }));
    b.sets[1] = { ...b.sets[1]!, loadKg: 28.9 };
    expect(blockLoad(b)).toEqual({ group: 'body', kg: 28.9 });
  });

  it('treats assist as negative kg on the body axis', () => {
    const b = block(ladder([5, 5, 5], { loadType: 'assist', loadKg: 20 }));
    b.sets[2] = { ...b.sets[2]!, loadType: 'assist', loadKg: 15 };
    expect(blockLoad(b)).toEqual({ group: 'body', kg: -15 });
  });

  it('picks the group of most sets, and the first set\'s group on a tie', () => {
    const majority = block([
      set({ order: 0, loadType: 'external', loadKg: 35 }),
      set({ order: 1, loadType: 'external', loadKg: 40 }),
      set({ order: 2, loadType: 'bodyweight', loadKg: 0 }),
    ]);
    expect(blockLoad(majority)).toEqual({ group: 'external', kg: 40 });
    const tie = block([set({ order: 0, loadType: 'band', loadKg: 50 }), set({ order: 1, loadType: 'external', loadKg: 35 })]);
    expect(blockLoad(tie)).toEqual({ group: 'band', kg: 50 });
  });
});

describe('exerciseSessionTotal (spec §7)', () => {
  it('sums the blocks of one exercise and ignores other exercises', () => {
    const s = session([
      block(ladder([1, 2, 3, 4, 5]), { order: 0 }),
      block(ladder([5]), { order: 1, exerciseId: 'dips' }),
      block(ladder([8, 7, 6, 5]), { order: 2 }),
    ]);
    expect(exerciseSessionTotal(s, 'pull-ups')).toEqual({ amount: 41, unknown: false });
  });

  it('is unknown for a migrated note-only block, but not for an empty app block', () => {
    const migrated = session([block([], { note: 'Pyramide' })], { source: 'migrated' });
    expect(exerciseSessionTotal(migrated, 'pull-ups').unknown).toBe(true);
    expect(exerciseSessionTotal(session([block()]), 'pull-ups').unknown).toBe(false);
  });
});
