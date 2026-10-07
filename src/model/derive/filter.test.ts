import { describe, expect, it } from 'vitest';
import { chipOf, matchesChip, sessionChips } from './filter';
import { T0, block, exercise, ladder, session } from '../test-fixtures';

const catalog = [
  exercise(),
  exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }),
  exercise({ id: 'knee-raises', name: 'Knee Raises', pattern: 'core' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs', deletedAt: T0 }),
];

describe('chipOf', () => {
  it('maps push, pull, legs to themselves and everything else to other', () => {
    expect(chipOf('push')).toBe('push');
    expect(chipOf('legs')).toBe('legs');
    expect(chipOf('shoulders')).toBe('other');
    expect(chipOf('conditioning')).toBe('other');
  });
});

describe('sessionChips and matchesChip (spec §7 day-list filter)', () => {
  it('uses each block\'s exercise pattern, not the session label', () => {
    const s = session([block(ladder([5]), { exerciseId: 'dips-bar' }), block(ladder([10]), { order: 1, exerciseId: 'knee-raises' })], { label: 'pull' });
    expect([...sessionChips(s, catalog)].sort()).toEqual(['other', 'push']);
    expect(matchesChip(s, catalog, 'push')).toBe(true);
    expect(matchesChip(s, catalog, 'pull')).toBe(false);
    expect(matchesChip(s, catalog, 'all')).toBe(true);
  });

  it('ignores deleted blocks', () => {
    const s = session([block(ladder([5]), { exerciseId: 'dips-bar', deletedAt: T0 })]);
    expect(matchesChip(s, catalog, 'push')).toBe(false);
  });

  it('a tombstoned session matches no chip, not even all', () => {
    const dead = session([block(ladder([5]), { exerciseId: 'dips-bar' })], { deletedAt: T0 });
    expect(matchesChip(dead, catalog, 'all')).toBe(false);
    expect(matchesChip(dead, catalog, 'push')).toBe(false);
  });

  it('uses a tombstoned exercise\'s pattern', () => {
    expect(matchesChip(session([block(ladder([5]), { exerciseId: 'squats' })]), catalog, 'legs')).toBe(true);
  });

  it('files an unknown exercise under other so the session stays findable', () => {
    expect(matchesChip(session([block(ladder([5]), { exerciseId: 'nope' })]), catalog, 'other')).toBe(true);
  });
});
