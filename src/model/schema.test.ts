import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { Lenient, MODEL_VERSION, Strict } from './schema';
import { T0, bodyweight, bodyweightFile, block, exercise, exercisesFile, ladder, session, sessionFile, set, timedSet } from './test-fixtures';

describe('model version', () => {
  it('starts at 1', () => {
    expect(MODEL_VERSION).toBe(1);
  });
});

describe('Exercise schema', () => {
  it('accepts a complete exercise', () => {
    expect(Value.Check(Strict.Exercise, exercise())).toBe(true);
  });

  it('accepts a tombstone and optional fields', () => {
    const e = exercise({ deletedAt: T0, family: 'Pull-ups', cues: 'slow' });
    expect(Value.Check(Strict.Exercise, e)).toBe(true);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['an uppercase id', { id: 'Pull-Ups' }],
    ['a double hyphen in the id', { id: 'pull--ups' }],
    ['a leading hyphen in the id', { id: '-pull-ups' }],
    ['an unknown pattern', { pattern: 'arms' }],
    ['an unknown metric', { metric: 'distance' }],
    ['an unknown load type', { defaultLoadType: 'chains' }],
    ['a timestamp without milliseconds', { updatedAt: '2030-01-01T10:00:00Z' }],
    ['a timestamp with an offset', { updatedAt: '2030-01-01T10:00:00.000+02:00' }],
    ['an empty family', { family: '' }],
    ['a missing archived flag', { archived: undefined }],
    ['an unknown property', { colour: 'red' }],
  ])('rejects %s', (_label, over) => {
    const value = JSON.parse(JSON.stringify({ ...exercise(), ...over }));
    expect(Value.Check(Strict.Exercise, value)).toBe(false);
  });

  it('ignores unknown properties in lenient mode', () => {
    expect(Value.Check(Lenient.Exercise, { ...exercise(), colour: 'red' })).toBe(true);
  });

  it('still rejects invalid known fields in lenient mode', () => {
    expect(Value.Check(Lenient.Exercise, { ...exercise(), name: '' })).toBe(false);
  });
});

describe('BodyweightEntry schema', () => {
  it('accepts an entry', () => {
    expect(Value.Check(Strict.BodyweightEntry, bodyweight())).toBe(true);
  });

  it.each([
    ['kg of 0', { kg: 0 }],
    ['a negative kg', { kg: -1 }],
    ['a date without zero padding', { date: '2030-1-1' }],
    ['an uppercase uuid', { id: '00000000-0000-4000-8000-00000000000A' }],
    ['an empty note', { note: '' }],
  ])('rejects %s', (_label, over) => {
    expect(Value.Check(Strict.BodyweightEntry, { ...bodyweight(), ...over })).toBe(false);
  });
});

describe('file wrappers', () => {
  it('accepts valid files', () => {
    expect(Value.Check(Strict.ExercisesFile, exercisesFile([exercise()]))).toBe(true);
    expect(Value.Check(Strict.BodyweightFile, bodyweightFile([bodyweight()]))).toBe(true);
  });

  it.each([
    ['version 0', 0],
    ['a fractional version', 1.5],
    ['a string version', '1'],
  ])('rejects %s', (_label, schemaVersion) => {
    expect(Value.Check(Strict.ExercisesFile, { ...exercisesFile(), schemaVersion })).toBe(false);
  });

  it('rejects an unknown top-level property', () => {
    expect(Value.Check(Strict.ExercisesFile, { ...exercisesFile(), extra: 1 })).toBe(false);
  });
});

describe('WorkoutSet schema', () => {
  it('accepts a reps set and a timed set', () => {
    expect(Value.Check(Strict.WorkoutSet, set())).toBe(true);
    expect(Value.Check(Strict.WorkoutSet, timedSet())).toBe(true);
  });

  it('accepts decimal reps', () => {
    expect(Value.Check(Strict.WorkoutSet, set({ reps: 16.5 }))).toBe(true);
  });

  it('accepts every optional field', () => {
    const s = set({ completedAt: T0, note: 'deep' });
    expect(Value.Check(Strict.WorkoutSet, s)).toBe(true);
    expect(Value.Check(Strict.WorkoutSet, set({ restSec: 120, aggregate: true }))).toBe(true);
  });

  it.each([
    ['both reps and seconds', { ...set(), seconds: 30 }],
    ['neither reps nor seconds', { ...set(), reps: undefined }],
    ['0 reps', set({ reps: 0 })],
    ['negative loadKg', set({ loadKg: -1 })],
    ['aggregate: false', { ...set(), aggregate: false }],
    ['an unknown load type', { ...set(), loadType: 'chains' }],
    ['a side field', { ...set(), side: 'L' }],
    ['an unknown property', { ...set(), colour: 'red' }],
  ])('rejects %s', (_label, value) => {
    // JSON round trip: `reps: undefined` becomes a missing key, as it would in the file.
    expect(Value.Check(Strict.WorkoutSet, JSON.parse(JSON.stringify(value)))).toBe(false);
  });

  it('ignores an unknown property in lenient mode', () => {
    expect(Value.Check(Lenient.WorkoutSet, { ...set(), colour: 'red' })).toBe(true);
  });

  it('rejects a set with both reps and seconds in lenient mode', () => {
    expect(Value.Check(Lenient.WorkoutSet, { ...set(), seconds: 30 })).toBe(false);
  });
});

describe('Session schema', () => {
  it('accepts a ladder session', () => {
    const s = session([block(ladder([17, 16, 15, 10]))], { startedAt: T0, label: 'pull', notes: 'sick', tags: ['sick'] });
    expect(Value.Check(Strict.Session, s)).toBe(true);
    expect(Value.Check(Strict.SessionFile, sessionFile(s))).toBe(true);
  });

  it('accepts an empty session and an empty block', () => {
    expect(Value.Check(Strict.Session, session())).toBe(true);
    expect(Value.Check(Strict.Session, session([block()]))).toBe(true);
  });

  it.each([
    ['dateUncertain: "yes"', { dateUncertain: 'yes' }],
    ['a non-timestamp startedAt', { startedAt: '2030-01-01' }],
    ['an unknown label', { label: 'arms' }],
    ['an unknown source', { source: 'live' }],
    ['an empty tag', { tags: [''] }],
    ['missing tags', { tags: undefined }],
    ['an unknown property', { colour: 'red' }],
  ])('rejects %s', (_label, over) => {
    const value = JSON.parse(JSON.stringify({ ...session(), ...over }));
    expect(Value.Check(Strict.Session, value)).toBe(false);
  });

  it('rejects an unknown property on a block', () => {
    expect(Value.Check(Strict.Session, session([{ ...block(), colour: 'red' } as never]))).toBe(false);
  });
});
