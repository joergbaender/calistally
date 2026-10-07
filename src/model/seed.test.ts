import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { Strict } from './schema';
import { SEED, mergeSeed } from './seed';
import { slugify } from './slug';
import { T0, exercise } from './test-fixtures';

const SEED_TIMES = ['2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z'];

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

  it('carries a fixed seed time, metric reps and archived false on every entry', () => {
    for (const e of SEED) {
      expect(SEED_TIMES, e.id).toContain(e.updatedAt);
      expect(e.metric).toBe('reps');
      expect(e.archived).toBe(false);
      expect(e.deletedAt).toBeUndefined();
    }
  });

  it('reflects the spec 2 §6 amendment: bands and rings, no cable curls or ring dips', () => {
    const ids = new Set(SEED.map((e) => e.id));
    for (const id of ['australian-pull-ups-rings', 'australian-pull-ups-bar', 'face-pulls-band', 'face-pulls-cable', 'bicep-curls-band', 'bicep-curls-ez-bar', 'triceps-pulldowns-band', 'lateral-raises-band', 'ring-deficit-push-ups', 'dips-bar']) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const id of ['bicep-curls-cable', 'triceps-pulldowns-cable', 'lateral-raises', 'dips-rings']) expect(ids.has(id), id).toBe(false);
    const rings = SEED.find((e) => e.id === 'australian-pull-ups-rings');
    expect(rings?.defaultLoadType).toBe('added');
    expect(rings?.cues).toBe('clean elbows, slow, full extension');
    expect(rings?.updatedAt).toBe('2026-10-07T00:00:00.000Z');
    for (const id of ['face-pulls-band', 'bicep-curls-band', 'triceps-pulldowns-band']) {
      expect(SEED.find((e) => e.id === id)?.defaultLoadType, id).toBe('band');
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
    expect(r.skipped).toEqual([]);
  });

  it('never modifies an existing entry, even if the seed differs', () => {
    const mine = exercise({ id: 'pull-ups', name: 'Pull-ups', cues: 'my cues', updatedAt: T0 });
    const r = mergeSeed([mine], SEED);
    expect(r.catalog.find((e) => e.id === 'pull-ups')).toBe(mine);
    expect(r.added).toHaveLength(23);
    expect(r.skipped).toEqual([]);
  });

  it('never re-adds a tombstoned or archived id', () => {
    const dead = exercise({ id: 'pull-ups', deletedAt: T0 });
    const archived = exercise({ id: 'dips-bar', name: 'Dips (Bar)', archived: true });
    const r = mergeSeed([dead, archived], SEED);
    expect(r.catalog.filter((e) => e.id === 'pull-ups')).toEqual([dead]);
    expect(r.catalog.filter((e) => e.id === 'dips-bar')).toEqual([archived]);
    expect(r.added).toHaveLength(22);
    expect(r.skipped).toEqual([]);
  });

  it('skips a seed entry whose name exists under a different id, and reports it', () => {
    const mine = exercise({ id: 'my-pulls', name: 'pull-UPS ' });
    const r = mergeSeed([mine], SEED);
    expect(r.added).toHaveLength(23);
    expect(r.catalog.some((e) => e.id === 'pull-ups')).toBe(false);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.seed.id).toBe('pull-ups');
    expect(r.skipped[0]?.existing.id).toBe('my-pulls');
  });

  it('applies the name block to archived and tombstoned entries under another id', () => {
    const archived = exercise({ id: 'my-pulls', name: 'Pull-ups', archived: true });
    const dead = exercise({ id: 'my-dips', name: 'Dips (Bar)', deletedAt: T0 });
    const r = mergeSeed([archived, dead], SEED);
    expect(r.added).toHaveLength(22);
    expect(r.skipped.map((s) => [s.seed.id, s.existing.id]).sort()).toEqual([
      ['dips-bar', 'my-dips'],
      ['pull-ups', 'my-pulls'],
    ]);
  });
});
