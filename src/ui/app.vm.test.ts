import { describe, expect, it } from 'vitest';
import { badgeVm, clockModeFor, tabOf } from './app.vm';
import type { Route } from './router';

const base = { issues: 0, softIssues: 0, heldBack: 0, connected: true, updateAvailable: false };

describe('badgeVm', () => {
  it('counts hard issues, soft issues and held-back writes', () => {
    expect(badgeVm({ ...base, issues: 2, softIssues: 1, heldBack: 3 })).toEqual({ count: 6, dot: false });
  });

  it('shows nothing when connected, up to date and clean', () => {
    expect(badgeVm(base)).toEqual({ count: 0, dot: false });
  });

  it('shows a dot alone when not connected or when an update waits', () => {
    expect(badgeVm({ ...base, connected: false })).toEqual({ count: 0, dot: true });
    expect(badgeVm({ ...base, updateAvailable: true })).toEqual({ count: 0, dot: true });
  });

  it('prefers the number over the dot', () => {
    expect(badgeVm({ ...base, issues: 1, connected: false, updateAvailable: true })).toEqual({ count: 1, dot: false });
  });
});

describe('clockModeFor', () => {
  it('ticks every second on the Log tab (the counter) and the Sync tab (the retry countdown), else every minute', () => {
    expect(clockModeFor({ tab: 'log' })).toBe('fast');
    expect(clockModeFor({ tab: 'sync' })).toBe('fast');
    expect(clockModeFor({ tab: 'days' })).toBe('slow');
    expect(clockModeFor({ tab: 'days', sessionId: 'abc' })).toBe('slow');
    expect(clockModeFor({ tab: 'more', page: 'calendar' })).toBe('slow');
  });
});

describe('tabOf', () => {
  const cases: ReadonlyArray<readonly [Route, ReturnType<typeof tabOf>]> = [
    [{ tab: 'log' }, 'log'],
    [{ tab: 'days' }, 'days'],
    [{ tab: 'days', sessionId: 'abc' }, 'days'],
    [{ tab: 'more' }, 'more'],
    [{ tab: 'more', page: 'exercises' }, 'more'],
    [{ tab: 'more', page: 'exercise', id: 'pull-up' }, 'more'],
    [{ tab: 'more', page: 'calendar' }, 'more'],
    [{ tab: 'more', page: 'bodyweight' }, 'more'],
    [{ tab: 'more', page: 'catalog' }, 'more'],
    [{ tab: 'more', page: 'catalog', id: 'ring-dip' }, 'more'],
    [{ tab: 'sync' }, 'sync'],
  ];
  it.each(cases)('%j → %s', (route, tab) => {
    expect(tabOf(route)).toBe(tab);
  });
});
