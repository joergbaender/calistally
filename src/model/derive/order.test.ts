import { describe, expect, it } from 'vitest';
import { compareSessions, liveBlocks, liveSets, sessionTimeKey, sortSessions } from './order';
import { T0, block, session, set } from '../test-fixtures';

const at = (hhmm: string) => `2030-01-01T${hhmm}:00.000Z`;

describe('liveSets (spec §7 sibling order)', () => {
  it('sorts by order, then completedAt with absent last, then id, and drops deleted sets', () => {
    const a = set({ id: '00000000-0000-4000-8000-00000000000b', order: 1 });
    const b = set({ id: '00000000-0000-4000-8000-00000000000a', order: 1 });
    const c = set({ order: 1, completedAt: at('10:05') });
    const d = set({ order: 1, completedAt: at('10:01') });
    const e = set({ order: 0, deletedAt: T0 });
    const f = set({ order: 0.5 });
    expect(liveSets(block([a, b, c, d, e, f])).map((s) => s.id)).toEqual([f.id, d.id, c.id, b.id, a.id]);
  });

  it('ignores array position', () => {
    const first = set({ order: 0 });
    const second = set({ order: 1 });
    expect(liveSets(block([second, first]))[0]).toBe(first);
  });

  it('ignores children of a tombstoned parent block (spec §7)', () => {
    const live = set({ order: 0 });
    expect(liveSets(block([live], { deletedAt: T0 }))).toEqual([]);
  });
});

describe('liveBlocks', () => {
  it('sorts by order then id and drops deleted blocks', () => {
    const b1 = block([], { order: 2 });
    const b2 = block([], { order: 1 });
    const b3 = block([], { order: 1, deletedAt: T0 });
    expect(liveBlocks(session([b1, b2, b3]))).toEqual([b2, b1]);
  });

  it('ignores children of a tombstoned parent session (spec §7)', () => {
    const live = block([], { order: 0 });
    expect(liveBlocks(session([live], { deletedAt: T0 }))).toEqual([]);
  });
});

describe('session order (spec §7)', () => {
  it('time key is startedAt, else the earliest completedAt, else undefined', () => {
    expect(sessionTimeKey(session([], { startedAt: at('09:00') }))).toBe(at('09:00'));
    const s = session([block([set({ completedAt: at('10:30'), order: 0 }), set({ completedAt: at('10:10'), order: 1 })])]);
    expect(sessionTimeKey(s)).toBe(at('10:10'));
    expect(sessionTimeKey(session())).toBeUndefined();
  });

  it('ignores deleted sets and sets in tombstoned blocks (spec §9)', () => {
    const deletedSet = set({ completedAt: at('10:00'), order: 0, deletedAt: T0 });
    const liveSet = set({ completedAt: at('10:10'), order: 1 });
    const deletedBlock = block([set({ completedAt: at('09:00'), order: 0 })], { deletedAt: T0 });
    const s = session([block([deletedSet, liveSet]), deletedBlock]);
    expect(sessionTimeKey(s)).toBe(at('10:10'));
  });

  it('orders by date before time key', () => {
    const earlyDateLateClock = session([], { date: '2030-01-01', startedAt: '2030-01-05T20:00:00.000Z' });
    const lateDateEarlyClock = session([], { date: '2030-01-02', startedAt: '2030-01-02T06:00:00.000Z' });
    expect(compareSessions(earlyDateLateClock, lateDateEarlyClock)).toBeLessThan(0);
  });

  it('on one date: no time key first, then time key, then id', () => {
    const none = session([], { id: '00000000-0000-4000-8000-0000000000ff' });
    const none2 = session([], { id: '00000000-0000-4000-8000-0000000000aa' });
    const early = session([], { startedAt: at('08:00') });
    const late = session([], { startedAt: at('09:00') });
    expect(sortSessions([late, none, early, none2])).toEqual([none2, none, early, late]);
  });

  it('is total: a reversed input sorts the same, and deleted sessions are dropped', () => {
    const list = [session(), session([], { startedAt: at('08:00') }), session([], { date: '2029-12-31' })];
    const dead = session([], { deletedAt: T0 });
    const all = [...list, dead];
    const sorted = sortSessions(all);
    expect(sorted).not.toContain(dead);
    expect(sortSessions([...all].reverse())).toEqual(sorted);
  });
});
