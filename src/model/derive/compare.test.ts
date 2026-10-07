import { describe, expect, it } from 'vitest';
import { blockIndicator, compareBlockPair, exerciseIndicator, previousOccurrence } from './compare';
import { T0, block, ladder, session, set, timedSet } from '../test-fixtures';

const day = (d: number) => `2030-01-${String(d).padStart(2, '0')}`;
const pullups = (reps: number[], order = 0) => block(ladder(reps), { order });

describe('compareBlockPair (spec §7 ↑↓ per block)', () => {
  it('amount: same, up (one more set), down', () => {
    expect(compareBlockPair(pullups([5, 4, 3]), pullups([5, 4, 3])).amount).toBe('same');
    expect(compareBlockPair(pullups([5, 4, 3, 2]), pullups([5, 4, 3])).amount).toBe('up');
    expect(compareBlockPair(pullups([5, 4]), pullups([5, 4, 3])).amount).toBe('down');
  });

  it('amount is same after rounding decimals', () => {
    expect(compareBlockPair(pullups([16.5, 17.2]), pullups([17.2, 16.5])).amount).toBe('same');
  });

  it('amount compares totalSeconds for timed exercises', () => {
    const plank = (secs: number[]) => block(secs.map((s, i) => timedSet({ seconds: s, order: i })), { exerciseId: 'plank' });
    expect(compareBlockPair(plank([30, 45]), plank([30, 40]))).toEqual({ amount: 'up', load: 'hidden' });
    expect(compareBlockPair(plank([30, 40]), plank([30, 45])).amount).toBe('down');
    expect(compareBlockPair(plank([40, 30]), plank([30, 40])).amount).toBe('same');
  });

  it('is none without a previous block, with an aggregate set, or with an empty block on either side', () => {
    expect(compareBlockPair(pullups([5]), undefined)).toEqual({ amount: 'none', load: 'none' });
    expect(compareBlockPair(block([set({ reps: 100, aggregate: true })]), pullups([5]))).toEqual({ amount: 'none', load: 'none' });
    expect(compareBlockPair(pullups([5]), block())).toEqual({ amount: 'none', load: 'none' });
  });

  it('load: hidden for plain bodyweight on both sides', () => {
    expect(compareBlockPair(pullups([5]), pullups([5])).load).toBe('hidden');
  });

  it('load: not hidden when bodyweight is mixed with assist, even at max signed kg 0', () => {
    const mixed = () => block([set({ order: 0 }), set({ order: 1, loadType: 'assist', loadKg: 10 })]);
    expect(compareBlockPair(mixed(), mixed()).load).toBe('same');
  });

  it('load: compares kg within one group, less assist is up, groups differing is incomparable', () => {
    const added = (kg: number) => block(ladder([10], { loadType: 'added', loadKg: kg }));
    expect(compareBlockPair(added(12), added(10)).load).toBe('up');
    expect(compareBlockPair(added(10), added(12)).load).toBe('down');
    expect(compareBlockPair(added(10), pullups([10])).load).toBe('up');
    const assist = (kg: number) => block(ladder([10], { loadType: 'assist', loadKg: kg }));
    expect(compareBlockPair(assist(15), assist(20)).load).toBe('up');
    const band = block(ladder([10], { loadType: 'band', loadKg: 50 }));
    const external = block(ladder([10], { loadType: 'external', loadKg: 35 }));
    expect(compareBlockPair(band, external).load).toBe('incomparable');
  });
});

describe('previousOccurrence (spec §7)', () => {
  it('finds block n in the most recent earlier session that has at least n blocks', () => {
    const s1 = session([pullups([1, 2, 3], 0), pullups([8, 7], 1)], { date: day(1) });
    const s2 = session([pullups([9, 8], 0)], { date: day(2) });
    const s3 = session([pullups([2, 3], 0), pullups([9, 9], 1)], { date: day(3) });
    const all = [s3, s1, s2];
    expect(previousOccurrence(all, s3, 'pull-ups', 1)).toBe(s2.blocks[0]);
    expect(previousOccurrence(all, s3, 'pull-ups', 2)).toBe(s1.blocks[1]);
    expect(previousOccurrence(all, s3, 'pull-ups', 3)).toBeUndefined();
    expect(previousOccurrence(all, s1, 'pull-ups', 1)).toBeUndefined();
  });

  it('ignores deleted sessions and deleted blocks, and uses the total session order', () => {
    const dead = session([pullups([99])], { date: day(2), deletedAt: T0 });
    const sameDayEarlier = session([pullups([7])], { date: day(3), startedAt: '2030-01-03T08:00:00.000Z' });
    const current = session([pullups([8])], { date: day(3), startedAt: '2030-01-03T10:00:00.000Z' });
    const withDeletedBlock = session([pullups([50]), block(ladder([60]), { order: 1, deletedAt: T0 })], { date: day(1) });
    const all = [current, dead, sameDayEarlier, withDeletedBlock];
    expect(previousOccurrence(all, current, 'pull-ups', 1)).toBe(sameDayEarlier.blocks[0]);
    expect(previousOccurrence(all, sameDayEarlier, 'pull-ups', 1)).toBe(withDeletedBlock.blocks[0]);
    expect(previousOccurrence(all, sameDayEarlier, 'pull-ups', 2)).toBeUndefined();
  });
});

describe('blockIndicator and exerciseIndicator', () => {
  const last = session([pullups([1, 2, 3, 4, 5], 0), pullups([8, 7, 6, 5, 4, 3, 2, 5], 1)], { date: day(1) });
  const today = session([pullups([8, 7, 6, 5, 4, 3, 2, 5], 0)], { date: day(2) });
  const all = [last, today];

  it('the positional block indicator compares today\'s only block with last time\'s first block', () => {
    expect(blockIndicator(all, today, today.blocks[0]!)).toEqual({ amount: 'up', load: 'hidden' });
  });

  it('the exercise indicator sees the session total drop', () => {
    expect(exerciseIndicator(all, today, 'pull-ups')).toBe('down');
  });

  it('a block with only deleted sets counts as block n and shows none', () => {
    const current = session([block([set({ deletedAt: T0 })], { order: 0 }), pullups([5], 1)], { date: day(3) });
    const everything = [...all, current];
    expect(blockIndicator(everything, current, current.blocks[0]!)).toEqual({ amount: 'none', load: 'none' });
    expect(blockIndicator(everything, current, current.blocks[1]!).amount).toBe('down');
  });

  it('exercise indicator is none without an earlier session or with a migrated note-only block', () => {
    expect(exerciseIndicator([today], today, 'pull-ups')).toBe('none');
    const noteOnly = session([block([], { note: 'Pyramide' })], { date: day(1), source: 'migrated' });
    expect(exerciseIndicator([noteOnly, today], today, 'pull-ups')).toBe('none');
  });

  it('blockIndicator is none for a block that is not in the session', () => {
    expect(blockIndicator(all, today, last.blocks[0]!)).toEqual({ amount: 'none', load: 'none' });
  });
});
