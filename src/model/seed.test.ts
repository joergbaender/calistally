import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { Strict } from './schema';
import { SEED, mergeSeed } from './seed';
import { slugify } from './slug';
import { T0, exercise } from './test-fixtures';

const SEED_TIME = '2026-10-06T00:00:00.000Z';

describe('seed-exercises.json', () => {
  it('has 24 entries that all validate', () => {
    expect(SEED).toHaveLength(24);
    for (const e of SEED) expect(Value.Check(Strict.Exercise, e), e.id).toBe(true);
  });

  it('every id equals slugify(name), and ids and names are unique', () => {
    for (const e of SEED) expect(e.id, e.name).toBe(slugify(e.name));
    expect(new Set(SEED.map((e) => e.id)).size).toBe(SEED.length);
    expect(new Set(SEED.map((e) => e.name.toLowerCase())).size).toBe(SEED.length);
  });

  it('carries the fixed seed time, metric reps and archived false on every entry', () => {
    for (const e of SEED) {
      expect(e.updatedAt).toBe(SEED_TIME);
      expect(e.metric).toBe('reps');
      expect(e.archived).toBe(false);
      expect(e.deletedAt).toBeUndefined();
    }
  });

  it('marks exactly the confirmed per-side exercises (spec §5)', () => {
    expect(SEED.filter((e) => e.perSide).map((e) => e.id).sort()).toEqual(['single-leg-rdl', 'single-leg-rdl-band', 'split-squats']);
  });

  it('classifies the single-leg RDL dumbbell load as external', () => {
    expect(SEED.find((e) => e.id === 'single-leg-rdl')?.defaultLoadType).toBe('external');
  });
});

describe('mergeSeed', () => {
  it('adds entries whose id is missing, copied verbatim', () => {
    const r = mergeSeed([], SEED);
    expect(r.catalog).toHaveLength(24);
    expect(r.added).toHaveLength(24);
    expect(r.catalog[0]).toEqual(SEED[0]);
    expect(r.catalog[0]).not.toBe(SEED[0]);
  });

  it('never modifies an existing entry, even if the seed differs', () => {
    const mine = exercise({ id: 'pull-ups', name: 'Pull-ups', cues: 'my cues', updatedAt: T0 });
    const r = mergeSeed([mine], SEED);
    expect(r.catalog.find((e) => e.id === 'pull-ups')).toBe(mine);
    expect(r.added).toHaveLength(23);
  });

  it('never re-adds a tombstoned or archived id', () => {
    const dead = exercise({ id: 'pull-ups', deletedAt: T0 });
    const archived = exercise({ id: 'dips-bar', name: 'Dips (Bar)', archived: true });
    const r = mergeSeed([dead, archived], SEED);
    expect(r.catalog.filter((e) => e.id === 'pull-ups')).toEqual([dead]);
    expect(r.catalog.filter((e) => e.id === 'dips-bar')).toEqual([archived]);
    expect(r.added).toHaveLength(22);
  });
});
