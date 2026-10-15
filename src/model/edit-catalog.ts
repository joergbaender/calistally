import { findByName } from './catalog';
import { EditError } from './edit';
import { tombstone, touch, undelete } from './record';
import { LOAD_TYPES, MODEL_VERSION, PATTERNS } from './schema';
import { normalizeName } from './slug';
import type { Exercise, ExercisesFile, LoadType, Pattern, Session } from './types';

/**
 * Pure edits over `exercises.json` (spec 4 §6 "Catalog", spec 1 §3): rename and the other mutable
 * fields, archive, and delete of an unused entry. Each returns a new file with `updatedAt` moved on
 * the edited entry only (the same file object when nothing changes); `now` is always passed in.
 * `id`, `metric` and `perSide` never change here. Every result passes
 * `validateForWrite('exercises', …)` when the input did.
 */
export interface ExerciseFields {
  name?: string;
  family?: string | null;
  pattern?: Pattern;
  defaultLoadType?: LoadType;
  cues?: string | null;
}

export type UpdateExerciseResult = { ok: true; file: ExercisesFile } | { ok: false; clash: Exercise };

export function emptyExercisesFile(): ExercisesFile {
  return { schemaVersion: MODEL_VERSION, exercises: [] };
}

function requireExercise(file: ExercisesFile, id: string): Exercise {
  const found = file.exercises.find((e) => e.id === id);
  if (found === undefined) throw new EditError(`unknown exercise ${id}`);
  return found;
}

function replaceExercise(file: ExercisesFile, next: Exercise): ExercisesFile {
  return { ...file, exercises: file.exercises.map((e) => (e.id === next.id ? next : e)) };
}

/** Trimmed text, or undefined when the field is to be removed (null, empty or blank). */
function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A copy of `e` with an optional text field set to `value`, or without it when `value` is undefined. */
function withOptional(e: Exercise, field: 'family' | 'cues', value: string | undefined): Exercise {
  const { [field]: _removed, ...rest } = e;
  return value === undefined ? rest : { ...rest, [field]: value };
}

function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((x) => x === value);
  if (found === undefined) throw new EditError(`not a ${what}: ${value}`);
  return found;
}

/** Changes the mutable fields of one entry. A name that any other entry already has (live, archived
 *  or tombstoned) is a clash: nothing changes and that entry is returned, a non-deleted one first.
 *  Spec 1 §3: tombstoned names count, and a name that exists never makes a second record; the app
 *  offers the existing entry instead (a deleted one can then be restored). */
export function updateExercise(file: ExercisesFile, id: string, fields: ExerciseFields, now: Date): UpdateExerciseResult {
  const current = requireExercise(file, id);
  let next: Exercise = { ...current };
  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (name === '') throw new EditError('the name must not be blank');
    // findByName prefers a non-deleted match, then falls back to a tombstone.
    const clash = findByName(file.exercises.filter((e) => e.id !== id), name);
    if (clash !== undefined) return { ok: false, clash };
    next.name = name;
  }
  if (fields.pattern !== undefined) next.pattern = oneOf(PATTERNS, fields.pattern, 'pattern');
  if (fields.defaultLoadType !== undefined) next.defaultLoadType = oneOf(LOAD_TYPES, fields.defaultLoadType, 'load type');
  if (fields.family !== undefined) next = withOptional(next, 'family', optionalText(fields.family));
  if (fields.cues !== undefined) next = withOptional(next, 'cues', optionalText(fields.cues));
  const unchanged =
    next.name === current.name &&
    next.pattern === current.pattern &&
    next.defaultLoadType === current.defaultLoadType &&
    next.family === current.family &&
    next.cues === current.cues;
  if (unchanged) return { ok: true, file };
  return { ok: true, file: replaceExercise(file, touch(next, now)) };
}

export function setArchived(file: ExercisesFile, id: string, archived: boolean, now: Date): ExercisesFile {
  const current = requireExercise(file, id);
  if (current.archived === archived) return file;
  return replaceExercise(file, touch({ ...current, archived }, now));
}

/** The live sessions with at least one live block of the exercise. */
export function referencingSessions(exerciseId: string, sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.deletedAt === undefined && s.blocks.some((b) => b.deletedAt === undefined && b.exerciseId === exerciseId));
}

/** Live blocks of live sessions that reference the exercise. */
export function isReferenced(exerciseId: string, sessions: readonly Session[]): boolean {
  return referencingSessions(exerciseId, sessions).length > 0;
}

/** EditError when referenced (spec 1 §3: archive, never delete); else a tombstone. */
export function deleteExercise(file: ExercisesFile, id: string, sessions: readonly Session[], now: Date): ExercisesFile {
  const current = requireExercise(file, id);
  const used = referencingSessions(id, sessions).length;
  if (used > 0) throw new EditError(`${current.name} is used in ${used} session${used === 1 ? '' : 's'}; archive it instead`);
  return replaceExercise(file, tombstone(current, now));
}

/** The non-deleted entry (live or archived) other than `id` that holds `id`'s name: bringing `id`
 *  back would make two non-deleted entries with one name (spec 1 §3). A rename never takes a deleted
 *  entry's name (`updateExercise`), so this guards only the offline race spec 1 §3 accepts (two
 *  devices naming entries alike before they sync). */
export function restoreClash(file: ExercisesFile, id: string): Exercise | undefined {
  const entry = file.exercises.find((e) => e.id === id);
  if (entry === undefined) return undefined;
  const wanted = normalizeName(entry.name);
  return file.exercises.find((e) => e.id !== id && e.deletedAt === undefined && normalizeName(e.name) === wanted);
}

/** EditError when another non-deleted entry holds the name meanwhile (`restoreClash`); screens check first. */
export function undeleteExercise(file: ExercisesFile, id: string, now: Date): ExercisesFile {
  const current = requireExercise(file, id);
  const clash = restoreClash(file, id);
  if (clash !== undefined) throw new EditError(`an exercise named “${clash.name}” exists; rename it first`);
  return replaceExercise(file, undelete(current, now));
}
