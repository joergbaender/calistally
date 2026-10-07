import { describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { ALIASES, HEADER_EXERCISES, allTargetIds, resolveExercise } from './exercises';
import { HEADERS } from './test-fixtures';

const none = { bands: false, refinements: [] as const };

describe('resolveExercise', () => {
  it('uses the alias when there is one, else the column header', () => {
    expect(resolveExercise('pull-ups', 'Bicep Curls', none)).toBe('pull-ups');
    expect(resolveExercise(undefined, 'Bicep Curls', none)).toBe('bicep-curls-band');
    expect(resolveExercise(undefined, '  Single  Leg RDL ', none)).toBe('single-leg-rdl');
  });

  it('has no fallback for the Extra column', () => {
    expect(resolveExercise(undefined, 'Extra', none)).toBeUndefined();
    expect(resolveExercise('burpees', 'Extra', none)).toBe('burpees');
  });

  it('switches to the band variant of the header family on `Bands`, where one exists', () => {
    expect(resolveExercise(undefined, 'Single Leg RDL', { bands: true, refinements: [] })).toBe('single-leg-rdl-band');
    expect(resolveExercise(undefined, 'Calf Raises', { bands: true, refinements: [] })).toBe('calf-raises-band');
    expect(resolveExercise(undefined, 'Face Pulls', { bands: true, refinements: [] })).toBe('face-pulls-band');
    expect(resolveExercise('lateral-raises-band', 'Extra', { bands: true, refinements: [] })).toBe('lateral-raises-band');
  });

  it('applies the refinements only to their own family', () => {
    expect(resolveExercise('australian-pull-ups-rings', 'Australian Pull Ups', { bands: false, refinements: ['stange'] })).toBe('australian-pull-ups-bar');
    expect(resolveExercise(undefined, 'Bicep Curls', { bands: false, refinements: ['ez-bar'] })).toBe('bicep-curls-ez-bar');
    expect(resolveExercise(undefined, 'Face Pulls', { bands: false, refinements: ['maschine'] })).toBe('face-pulls-cable');
    expect(resolveExercise('pull-ups', 'Bicep Curls', { bands: false, refinements: ['stange', 'ez-bar', 'maschine'] })).toBe('pull-ups');
  });
});

describe('alias and header tables', () => {
  it('only ever emit seed ids', () => {
    const seedIds = new Set(SEED.map((e) => e.id));
    for (const id of allTargetIds()) expect(seedIds.has(id), id).toBe(true);
  });

  it('cover every exercise header of the real sheet', () => {
    for (const [address, header] of Object.entries(HEADERS)) {
      if (header === 'Date' || header === 'Extra') continue;
      expect(resolveExercise(undefined, header, none), `${address} ${header}`).toBeDefined();
    }
    expect(Object.keys(HEADER_EXERCISES)).toHaveLength(9);
  });

  it('spells every alias word in lowercase without punctuation', () => {
    for (const a of ALIASES) for (const w of a.words) expect(w).toMatch(/^[a-zäöü0-9]+$/);
  });
});
