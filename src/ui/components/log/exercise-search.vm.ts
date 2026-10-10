import { normalizeName } from '../../../model/slug';
import type { Exercise } from '../../../model/types';

export interface ExerciseSearchVm {
  live: Exercise[];
  archived: Exercise[];
  canCreate: boolean;
}

/** By family (entries without one last), then by name. */
function byFamilyThenName(a: Exercise, b: Exercise): number {
  const fa = a.family;
  const fb = b.family;
  if (fa !== fb) {
    if (fa === undefined) return 1;
    if (fb === undefined) return -1;
    return fa.localeCompare(fb);
  }
  return a.name.localeCompare(b.name);
}

/** Spec 4 §4 "Exercises": the catalog filtered by name as typed (trimmed, spaces collapsed, any case);
 *  live entries first, archived ones in their own group; tombstones never show. Create is offered
 *  when the query is not blank and no *live* entry (not deleted, not archived) has exactly that
 *  name (spec 4 §4). For an archived or deleted name, Create goes through createExercise, which
 *  returns that entry unarchived or undeleted (spec 1 §3 "Name uniqueness"). */
export function exerciseSearchVm(catalog: readonly Exercise[], query: string): ExerciseSearchVm {
  const wanted = normalizeName(query);
  const matching = catalog.filter((e) => e.deletedAt === undefined && normalizeName(e.name).includes(wanted));
  const liveExact = catalog.some((e) => e.deletedAt === undefined && !e.archived && normalizeName(e.name) === wanted);
  return {
    live: matching.filter((e) => !e.archived).sort(byFamilyThenName),
    archived: matching.filter((e) => e.archived).sort(byFamilyThenName),
    canCreate: wanted !== '' && !liveExact,
  };
}
