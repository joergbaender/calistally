import { describe, expect, it } from 'vitest';
import { EditError } from './edit';
import {
  deleteExercise,
  emptyExercisesFile,
  isReferenced,
  restoreClash,
  setArchived,
  undeleteExercise,
  updateExercise,
  type ExerciseFields,
} from './edit-catalog';
import { MODEL_VERSION } from './schema';
import { T0, block, exercise, exercisesFile, session, set } from './test-fixtures';
import type { ExercisesFile } from './types';
import { validateForWrite } from './validate';

const later = new Date('2030-01-01T11:00:00.000Z');
const LATER = '2030-01-01T11:00:00.000Z';
const earlier = new Date('2030-01-01T09:00:00.000Z');
const T0_PLUS_1 = '2030-01-01T10:00:00.001Z';

const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const GONE = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: T0 });
const OLD = exercise({ id: 'kipping', name: 'Kipping', archived: true });

/** Every edit result must be writable as it is. */
function valid(file: ExercisesFile): ExercisesFile {
  const result = validateForWrite('exercises', file);
  expect(result.issues).toEqual([]);
  expect(result.ok).toBe(true);
  return file;
}

function updated(file: ExercisesFile, id: string, fields: ExerciseFields, now: Date = later): ExercisesFile {
  const r = updateExercise(file, id, fields, now);
  if (!r.ok) throw new Error(`unexpected clash with ${r.clash.id}`);
  return valid(r.file);
}

describe('emptyExercisesFile', () => {
  it('is the current version with no exercises, and valid', () => {
    expect(valid(emptyExercisesFile())).toEqual({ schemaVersion: MODEL_VERSION, exercises: [] });
  });
});

describe('updateExercise', () => {
  it('renames keeping the id, trims the name, and touches only that entry', () => {
    const input = exercisesFile([PULL, PUSH]);
    const file = updated(input, 'pull-ups', { name: '  Strict Pull-ups ' });
    expect(file.exercises).toEqual([{ ...PULL, name: 'Strict Pull-ups', updatedAt: LATER }, PUSH]);
    expect(file.exercises[1]).toBe(PUSH);
  });

  it('changes family, pattern, default load type and cues; blank or null removes family and cues', () => {
    const withCues = exercise({ ...PULL, cues: 'scapula first' });
    const a = updated(exercisesFile([withCues]), 'pull-ups', { family: ' row ', pattern: 'other', defaultLoadType: 'added', cues: ' hollow body ' });
    expect(a.exercises[0]).toEqual({ ...withCues, family: 'row', pattern: 'other', defaultLoadType: 'added', cues: 'hollow body', updatedAt: LATER });
    const b = updated(exercisesFile([withCues]), 'pull-ups', { family: null, cues: '   ' });
    expect(b.exercises[0]).not.toHaveProperty('family');
    expect(b.exercises[0]).not.toHaveProperty('cues');
  });

  it('never changes id, metric or perSide, even when a caller sneaks them in', () => {
    const sneaky = { name: 'Chin-ups', id: 'chin-ups', metric: 'seconds', perSide: true } as unknown as ExerciseFields;
    const file = updated(exercisesFile([PULL]), 'pull-ups', sneaky);
    expect(file.exercises[0]).toMatchObject({ id: 'pull-ups', name: 'Chin-ups', metric: 'reps', perSide: false });
  });

  it('a name another live or archived entry has is a clash and changes nothing', () => {
    const input = exercisesFile([PULL, PUSH, GONE, OLD]);
    for (const [name, other] of [[' push-UPS ', PUSH], ['KIPPING', OLD]] as const) {
      const r = updateExercise(input, 'pull-ups', { name, cues: 'x' }, later);
      expect(r).toEqual({ ok: false, clash: other });
    }
  });

  it('a tombstoned entry\'s name is a clash too and changes nothing (spec 1 §3: tombstoned names count)', () => {
    const input = exercisesFile([PULL, GONE]);
    const r = updateExercise(input, 'pull-ups', { name: ' ring ROWS ', cues: 'x' }, later);
    expect(r).toEqual({ ok: false, clash: GONE });
    expect(input.exercises).toEqual([PULL, GONE]);
  });

  it('a name held by a non-deleted entry and a tombstone returns the non-deleted one', () => {
    const twin = exercise({ id: 'push-ups-2', name: 'Push-ups', deletedAt: T0 });
    const r = updateExercise(exercisesFile([PULL, twin, PUSH]), 'pull-ups', { name: 'Push-ups' }, later);
    expect(r).toEqual({ ok: false, clash: PUSH });
  });

  it('the entry\'s own name in another case is no clash', () => {
    const file = updated(exercisesFile([PULL, PUSH]), 'pull-ups', { name: 'PULL-UPS' });
    expect(file.exercises[0]?.name).toBe('PULL-UPS');
  });

  it('returns the same file when nothing changes', () => {
    const input = exercisesFile([PULL]);
    const r = updateExercise(input, 'pull-ups', { name: 'Pull-ups', family: 'pull-up', pattern: 'pull' }, later);
    expect(r).toEqual({ ok: true, file: input });
    if (r.ok) expect(r.file).toBe(input);
  });

  it('keeps updatedAt increasing when the clock is behind', () => {
    const file = updated(exercisesFile([PULL]), 'pull-ups', { cues: 'x' }, earlier);
    expect(file.exercises[0]?.updatedAt).toBe(T0_PLUS_1);
  });

  it('refuses an unknown id, a blank name, and a pattern or load type outside the schema', () => {
    const input = exercisesFile([PULL]);
    expect(() => updateExercise(input, 'nope', { cues: 'x' }, later)).toThrow(EditError);
    expect(() => updateExercise(input, 'pull-ups', { name: '   ' }, later)).toThrow(EditError);
    expect(() => updateExercise(input, 'pull-ups', { pattern: 'arms' } as unknown as ExerciseFields, later)).toThrow(EditError);
    expect(() => updateExercise(input, 'pull-ups', { defaultLoadType: 'kettlebell' } as unknown as ExerciseFields, later)).toThrow(EditError);
  });

  it('does not mutate the input file', () => {
    const input = exercisesFile([PULL, PUSH]);
    const copy = structuredClone(input);
    updateExercise(input, 'pull-ups', { name: 'Chin-ups' }, later);
    expect(input).toEqual(copy);
  });
});

describe('setArchived', () => {
  it('archives and unarchives, touching only that entry', () => {
    const archived = valid(setArchived(exercisesFile([PULL, PUSH]), 'pull-ups', true, later));
    expect(archived.exercises).toEqual([{ ...PULL, archived: true, updatedAt: LATER }, PUSH]);
    const back = valid(setArchived(exercisesFile([OLD]), 'kipping', false, later));
    expect(back.exercises[0]).toEqual({ ...OLD, archived: false, updatedAt: LATER });
  });

  it('returns the same file when the entry already has that state', () => {
    const input = exercisesFile([PULL]);
    expect(setArchived(input, 'pull-ups', false, later)).toBe(input);
  });

  it('refuses an unknown id', () => {
    expect(() => setArchived(exercisesFile([PULL]), 'nope', true, later)).toThrow(EditError);
  });
});

describe('isReferenced', () => {
  it('counts only live blocks of live sessions', () => {
    const live = session([block([set()], { exerciseId: 'pull-ups' })]);
    expect(isReferenced('pull-ups', [live])).toBe(true);
    expect(isReferenced('push-ups', [live])).toBe(false);
    const deletedBlock = session([block([set()], { exerciseId: 'pull-ups', deletedAt: T0 })]);
    const deletedSession = session([block([set()], { exerciseId: 'pull-ups' })], { deletedAt: T0 });
    expect(isReferenced('pull-ups', [deletedBlock, deletedSession])).toBe(false);
  });

  it('a live block without sets still references the exercise', () => {
    expect(isReferenced('pull-ups', [session([block([], { exerciseId: 'pull-ups' })])])).toBe(true);
  });
});

describe('deleteExercise', () => {
  it('tombstones an unreferenced entry, touching only it', () => {
    const sessions = [session([block([set()], { exerciseId: 'push-ups' })])];
    const file = valid(deleteExercise(exercisesFile([PULL, PUSH]), 'pull-ups', sessions, later));
    expect(file.exercises).toEqual([{ ...PULL, updatedAt: LATER, deletedAt: LATER }, PUSH]);
  });

  it('refuses a referenced entry (spec 1 §3: archive, never delete)', () => {
    const sessions = [session([block([set()], { exerciseId: 'pull-ups' })])];
    expect(() => deleteExercise(exercisesFile([PULL]), 'pull-ups', sessions, later)).toThrow(EditError);
    expect(() => deleteExercise(exercisesFile([PULL]), 'pull-ups', sessions, later)).toThrow(/archive/);
  });

  it('refuses an unknown id', () => {
    expect(() => deleteExercise(exercisesFile([PULL]), 'nope', [], later)).toThrow(EditError);
  });
});

describe('undeleteExercise', () => {
  it('removes the tombstone, touching only that entry', () => {
    const file = valid(undeleteExercise(exercisesFile([GONE, PUSH]), 'ring-rows', later));
    expect(file.exercises[0]).not.toHaveProperty('deletedAt');
    expect(file.exercises[0]?.updatedAt).toBe(LATER);
    expect(file.exercises[1]).toBe(PUSH);
  });

  it('refuses an unknown id', () => {
    expect(() => undeleteExercise(exercisesFile([PULL]), 'nope', later)).toThrow(EditError);
  });

  it('refuses when a live or archived entry holds the name (the offline race spec 1 §3 accepts)', () => {
    const renamed = exercise({ id: 'rows', name: 'ring  ROWS' });
    expect(() => undeleteExercise(exercisesFile([GONE, renamed]), 'ring-rows', later)).toThrow(/an exercise named “ring {2}ROWS” exists/);
    expect(() => undeleteExercise(exercisesFile([GONE, { ...renamed, archived: true }]), 'ring-rows', later)).toThrow(EditError);
  });

  it('another tombstone with the same name is no clash', () => {
    const twin = exercise({ id: 'ring-rows-2', name: 'Ring Rows', deletedAt: T0 });
    const file = valid(undeleteExercise(exercisesFile([GONE, twin]), 'ring-rows', later));
    expect(file.exercises[0]).not.toHaveProperty('deletedAt');
  });
});

describe('restoreClash', () => {
  it('names the non-deleted entry that holds the name of the one to restore', () => {
    const renamed = exercise({ id: 'rows', name: 'Ring Rows' });
    expect(restoreClash(exercisesFile([GONE, PUSH, renamed]), 'ring-rows')).toBe(renamed);
    expect(restoreClash(exercisesFile([GONE, PUSH, { ...renamed, archived: true }]), 'ring-rows')?.id).toBe('rows');
  });

  it('is undefined without a clash, for a deleted twin, and for an unknown id', () => {
    expect(restoreClash(exercisesFile([GONE, PUSH]), 'ring-rows')).toBeUndefined();
    expect(restoreClash(exercisesFile([GONE, { ...PUSH, name: 'Ring Rows', deletedAt: T0 }]), 'ring-rows')).toBeUndefined();
    expect(restoreClash(exercisesFile([GONE]), 'nope')).toBeUndefined();
  });
});
