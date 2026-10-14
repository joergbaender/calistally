import { describe, expect, it } from 'vitest';
import type { NewExerciseFields } from '../../../model/catalog';
import { exercise } from '../../../model/test-fixtures';
import { createClash } from './create-clash';

const REPS: NewExerciseFields = { pattern: 'core', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight' };
const SECONDS: NewExerciseFields = { ...REPS, metric: 'seconds' };

describe('createClash', () => {
  it('asks nothing for a live entry with the same metric and per side', () => {
    expect(createClash(exercise({ name: 'Plank' }), REPS, { askOnRevive: true })).toBeUndefined();
  });

  it('names a metric or per-side difference, whatever the entry state', () => {
    expect(createClash(exercise({ name: 'Plank' }), SECONDS, { askOnRevive: false })).toBe(
      'It is measured in reps, not seconds. Use it as it is, or cancel and pick another name for the new one.',
    );
    expect(createClash(exercise({ name: 'Plank', perSide: true }), REPS, { askOnRevive: false })).toBe(
      'It is per side. Use it as it is, or cancel and pick another name for the new one.',
    );
    expect(createClash(exercise({ name: 'Plank', archived: true, perSide: true }), { ...SECONDS, perSide: false }, { askOnRevive: false })).toBe(
      'It is archived, measured in reps, not seconds, per side. Use it as it is, or cancel and pick another name for the new one.',
    );
    expect(createClash(exercise({ name: 'Plank' }), { ...REPS, perSide: true }, { askOnRevive: false })).toBe(
      'It is not per side. Use it as it is, or cancel and pick another name for the new one.',
    );
  });

  it('with askOnRevive, asks before bringing back an archived or deleted entry even when it matches', () => {
    expect(createClash(exercise({ name: 'Plank', archived: true }), REPS, { askOnRevive: true })).toBe('It is archived. Use it to bring it back.');
    expect(createClash(exercise({ name: 'Plank', deletedAt: '2030-01-01T10:00:00.000Z' }), REPS, { askOnRevive: true })).toBe(
      'It is deleted. Use it to bring it back.',
    );
    expect(createClash(exercise({ name: 'Plank', archived: true }), REPS, { askOnRevive: false })).toBeUndefined();
  });
});
