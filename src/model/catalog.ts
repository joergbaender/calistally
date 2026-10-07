import { touch, undelete } from './record';
import { normalizeName, slugify } from './slug';
import type { Exercise, Session } from './types';

/** Finds entry by normalized name, preferring non-deleted matches (spec §3: names are unique only among non-deleted). */
export function findByName(catalog: readonly Exercise[], name: string): Exercise | undefined {
  const wanted = normalizeName(name);
  return catalog.find((e) => e.deletedAt === undefined && normalizeName(e.name) === wanted) ??
         catalog.find((e) => normalizeName(e.name) === wanted);
}

/** The slug, or slug-2, slug-3 … if a different name already owns it (tombstones count). */
export function assignExerciseId(name: string, catalog: readonly Exercise[]): string {
  const base = slugify(name);
  const wanted = normalizeName(name);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const owner = byId.get(candidate);
    if (owner === undefined || normalizeName(owner.name) === wanted) return candidate;
  }
}

export type NewExerciseFields = Pick<Exercise, 'pattern' | 'metric' | 'perSide' | 'defaultLoadType'> &
  Partial<Pick<Exercise, 'family' | 'cues'>>;

export interface CreateExerciseResult {
  catalog: Exercise[];
  exercise: Exercise;
  /** true: an entry with that name already existed and was returned (undeleted / unarchived if needed). */
  existing: boolean;
}

/** Spec §3 "Name uniqueness": creating an existing name never makes a second record. */
export function createExercise(
  name: string,
  fields: NewExerciseFields,
  catalog: readonly Exercise[],
  now: Date = new Date(),
): CreateExerciseResult {
  const found = findByName(catalog, name);
  if (found !== undefined) {
    let revived = found;
    if (revived.deletedAt !== undefined) revived = undelete(revived, now);
    if (revived.archived) revived = touch({ ...revived, archived: false }, now);
    const next = revived === found ? [...catalog] : catalog.map((e) => (e === found ? revived : e));
    return { catalog: next, exercise: revived, existing: true };
  }
  const exercise: Exercise = {
    id: assignExerciseId(name, catalog),
    name: name.trim(),
    ...fields,
    archived: false,
    updatedAt: now.toISOString(),
  };
  return { catalog: [...catalog, exercise], exercise, existing: false };
}

/** Spec §3: a tombstoned exercise referenced by a live block of a live session is restored as archived. */
export function restoreReferenced(catalog: readonly Exercise[], sessions: readonly Session[], now: Date = new Date()): Exercise[] {
  const referenced = new Set<string>();
  for (const s of sessions) {
    if (s.deletedAt !== undefined) continue;
    for (const b of s.blocks) if (b.deletedAt === undefined) referenced.add(b.exerciseId);
  }
  // undelete already bumps updatedAt; setting archived in the same copy keeps it to one bump.
  return catalog.map((e) =>
    e.deletedAt !== undefined && referenced.has(e.id) ? { ...undelete(e, now), archived: true } : e,
  );
}
