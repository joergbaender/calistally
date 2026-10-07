import { describe, expect, it } from 'vitest';
import { isDeleted, nextOrder, nextUpdatedAt, orderBetween, tombstone, touch, undelete } from './record';
import { T0, block, ladder, session } from './test-fixtures';

const later = new Date('2030-01-01T11:00:00.000Z');
const earlier = new Date('2030-01-01T09:00:00.000Z');

describe('nextUpdatedAt', () => {
  it('uses the clock when there is no previous value', () => {
    expect(nextUpdatedAt(undefined, later)).toBe('2030-01-01T11:00:00.000Z');
  });

  it('uses the clock when it is ahead of the previous value', () => {
    expect(nextUpdatedAt(T0, later)).toBe('2030-01-01T11:00:00.000Z');
  });

  it('moves 1 ms past the previous value when the clock is behind or equal', () => {
    expect(nextUpdatedAt(T0, earlier)).toBe('2030-01-01T10:00:00.001Z');
    expect(nextUpdatedAt(T0, new Date(T0))).toBe('2030-01-01T10:00:00.001Z');
  });
});

describe('touch', () => {
  it('bumps updatedAt and leaves children untouched', () => {
    const s = session([block(ladder([5, 4]))]);
    const touched = touch(s, later);
    expect(touched.updatedAt).toBe('2030-01-01T11:00:00.000Z');
    expect(touched.blocks).toBe(s.blocks);
    expect(s.updatedAt).toBe(T0);
  });
});

describe('tombstone and undelete', () => {
  it('sets deletedAt and updatedAt to the same instant and keeps every field', () => {
    const b = block(ladder([5]), { note: 'steep' });
    const dead = tombstone(b, later);
    expect(dead.deletedAt).toBe('2030-01-01T11:00:00.000Z');
    expect(dead.updatedAt).toBe(dead.deletedAt);
    expect(dead.note).toBe('steep');
    expect(dead.sets).toBe(b.sets);
    expect(isDeleted(dead)).toBe(true);
    expect(isDeleted(b)).toBe(false);
  });

  it('undelete removes deletedAt (the key, not just the value) and bumps updatedAt', () => {
    const dead = tombstone(block(), later);
    const back = undelete(dead, earlier);
    expect('deletedAt' in back).toBe(false);
    expect(back.updatedAt).toBe('2030-01-01T11:00:00.001Z');
  });
});

describe('order helpers', () => {
  it('nextOrder is 0 for no siblings and max + 1 otherwise, deleted siblings included', () => {
    expect(nextOrder([])).toBe(0);
    expect(nextOrder([{ order: 2 }, { order: 5 }, { order: 0.5 }])).toBe(6);
    const siblings = [{ order: 2 }, { order: 7, deletedAt: T0 }, { order: 5 }];
    expect(nextOrder(siblings)).toBe(8);
  });

  it('orderBetween is the midpoint', () => {
    expect(orderBetween(1, 2)).toBe(1.5);
  });
});
