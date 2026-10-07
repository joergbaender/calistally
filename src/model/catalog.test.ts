import { describe, expect, it } from 'vitest';
import { assignExerciseId, createExercise, findByName, restoreReferenced } from './catalog';
import { T0, block, exercise, ladder, session } from './test-fixtures';

const later = new Date('2030-01-01T11:00:00.000Z');
const fields = { pattern: 'push', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight' } as const;

describe('findByName', () => {
  it('matches case- and whitespace-insensitively, tombstoned entries included', () => {
    const dead = exercise({ id: 'dips', name: 'Dips', deletedAt: T0 });
    expect(findByName([exercise(), dead], ' pull  UPS ')).toBeUndefined();
    expect(findByName([exercise(), dead], ' pull-UPS ')?.id).toBe('pull-ups');
    expect(findByName([exercise(), dead], 'dips')?.id).toBe('dips');
  });
});

describe('assignExerciseId', () => {
  it('uses the plain slug when free', () => {
    expect(assignExerciseId('Dips (Rings)', [exercise()])).toBe('dips-rings');
  });

  it('reuses the id when the same name already owns it', () => {
    expect(assignExerciseId('pull-ups', [exercise()])).toBe('pull-ups');
  });

  it('appends -2, -3 when a different name owns the slug, tombstones included', () => {
    const catalog = [
      exercise({ id: 'dips-bar', name: 'Bar Dips (weighted)' }),
      exercise({ id: 'dips-bar-2', name: 'Something else', deletedAt: T0 }),
    ];
    expect(assignExerciseId('Dips (Bar)', catalog)).toBe('dips-bar-3');
  });
});

describe('createExercise', () => {
  it('adds a new entry with slug id, archived false and the given time', () => {
    const r = createExercise('Dips (Rings)', fields, [exercise()], later);
    expect(r.existing).toBe(false);
    expect(r.exercise).toMatchObject({ id: 'dips-rings', name: 'Dips (Rings)', archived: false, updatedAt: '2030-01-01T11:00:00.000Z' });
    expect(r.catalog).toHaveLength(2);
  });

  it('returns the existing entry for a name that differs only in case', () => {
    const r = createExercise('pull-ups', fields, [exercise()], later);
    expect(r.existing).toBe(true);
    expect(r.catalog).toHaveLength(1);
    expect(r.exercise.updatedAt).toBe(T0);
  });

  it('undeletes a tombstoned entry with the same name', () => {
    const r = createExercise('pull-ups', fields, [exercise({ deletedAt: T0 })], later);
    expect(r.existing).toBe(true);
    expect('deletedAt' in r.exercise).toBe(false);
    expect(r.exercise.updatedAt).toBe('2030-01-01T11:00:00.000Z');
  });

  it('unarchives an archived entry with the same name', () => {
    const r = createExercise('pull-ups', fields, [exercise({ archived: true })], later);
    expect(r.exercise.archived).toBe(false);
    expect(r.exercise.updatedAt).toBe('2030-01-01T11:00:00.000Z');
  });
});

describe('restoreReferenced (spec §3: tombstoned exercise referenced by a live block)', () => {
  it('undeletes and archives referenced tombstones, leaves others alone', () => {
    const catalog = [
      exercise({ id: 'dips', name: 'Dips', deletedAt: T0 }),
      exercise({ id: 'rows', name: 'Rows', deletedAt: T0 }),
      exercise(),
    ];
    const sessions = [
      session([block(ladder([5]), { exerciseId: 'dips' })]),
      session([block(ladder([5]), { exerciseId: 'rows' })], { deletedAt: T0 }),
    ];
    const out = restoreReferenced(catalog, sessions, later);
    expect(out.find((e) => e.id === 'dips')).toMatchObject({ archived: true, updatedAt: '2030-01-01T11:00:00.000Z' });
    expect('deletedAt' in out.find((e) => e.id === 'dips')!).toBe(false);
    expect(out.find((e) => e.id === 'rows')?.deletedAt).toBe(T0);
    expect(out.find((e) => e.id === 'pull-ups')).toBe(catalog[2]);
  });
});
