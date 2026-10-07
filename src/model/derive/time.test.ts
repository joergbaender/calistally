import { describe, expect, it } from 'vitest';
import { isSessionOpen, setIntervals } from './time';
import { T0, block, session, set } from '../test-fixtures';

const at = (hhmmss: string) => `2030-01-01T${hhmmss}.000Z`;

describe('setIntervals (spec §7)', () => {
  it('is the gap between consecutive timestamped sets of a block, in seconds', () => {
    const a = set({ order: 0, completedAt: at('10:00:00') });
    const b = set({ order: 1, completedAt: at('10:01:30') });
    const c = set({ order: 2 });
    const d = set({ order: 3, completedAt: at('10:05:00') });
    const m = setIntervals(session([block([a, b, c, d])]));
    expect(m.get(a.id)).toBeUndefined();
    expect(m.get(b.id)).toBe(90);
    expect(m.get(c.id)).toBeUndefined();
    expect(m.get(d.id)).toBeUndefined();
  });

  it('for the first set of a block uses the latest earlier timestamp anywhere in the session', () => {
    const a = set({ order: 0, completedAt: at('10:00:00') });
    const b = set({ order: 0, completedAt: at('10:03:00') });
    const m = setIntervals(session([block([a], { order: 0 }), block([b], { order: 1 })]));
    expect(m.get(b.id)).toBe(180);
  });

  it('handles two interleaved blocks', () => {
    const p1 = set({ order: 0, completedAt: at('10:00:00') });
    const d1 = set({ order: 0, completedAt: at('10:01:00') });
    const p2 = set({ order: 1, completedAt: at('10:02:00') });
    const m = setIntervals(session([block([p1, p2], { order: 0 }), block([d1], { order: 1, exerciseId: 'dips' })]));
    expect(m.get(p2.id)).toBe(120);
    expect(m.get(d1.id)).toBe(60);
  });

  it('shows nothing for a reversed pair and skips deleted sets', () => {
    const a = set({ order: 0, completedAt: at('10:05:00') });
    const b = set({ order: 1, completedAt: at('10:00:00') });
    const dead = set({ order: 2, completedAt: at('10:06:00'), deletedAt: T0 });
    const c = set({ order: 3, completedAt: at('10:07:00') });
    const m = setIntervals(session([block([a, b, dead, c])]));
    expect(m.get(a.id)).toBeUndefined();
    expect(m.get(b.id)).toBeUndefined();
    expect(m.get(c.id)).toBe(420);
  });

  it('does not measure a block\'s first set against the block\'s own later sets', () => {
    const a = set({ order: 0, completedAt: at('10:05:00') });
    const b = set({ order: 1, completedAt: at('10:00:00') });
    const m = setIntervals(session([block([a, b])]));
    expect(m.get(a.id)).toBeUndefined();
    expect(m.size).toBe(0);
  });

  it('spans midnight', () => {
    const a = set({ order: 0, completedAt: '2030-01-01T23:59:00.000Z' });
    const b = set({ order: 1, completedAt: '2030-01-02T00:01:00.000Z' });
    expect(setIntervals(session([block([a, b])])).get(b.id)).toBe(120);
  });
});

describe('isSessionOpen (spec §7)', () => {
  const started = session([block([set({ completedAt: at('10:30:00') })])], { startedAt: at('10:00:00') });

  it('is false without startedAt', () => {
    expect(isSessionOpen(session([block([set({ completedAt: at('10:30:00') })])]), [], new Date(at('10:31:00')))).toBe(false);
  });

  it('is open within 3 h of the latest timestamp and closed at 3 h', () => {
    expect(isSessionOpen(started, [started], new Date(at('13:29:59')))).toBe(true);
    expect(isSessionOpen(started, [started], new Date(at('13:30:00')))).toBe(false);
  });

  it('closes when a newer session was started, unless that session is deleted', () => {
    const newer = session([], { startedAt: at('11:00:00') });
    expect(isSessionOpen(started, [started, newer], new Date(at('11:01:00')))).toBe(false);
    const deletedNewer = session([], { startedAt: at('11:00:00'), deletedAt: T0 });
    expect(isSessionOpen(started, [started, deletedNewer], new Date(at('11:01:00')))).toBe(true);
  });
});
