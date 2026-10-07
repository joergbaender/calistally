import seedJson from './seed-exercises.json';
import type { Exercise } from './types';

/** The developer seed (spec §5). Validated by seed.test.ts; the json import is typed loosely. */
export const SEED: Exercise[] = seedJson as unknown as Exercise[];

export interface SeedMergeResult {
  catalog: Exercise[];
  added: Exercise[];
}

/** Adds seed entries whose id is missing from the catalog, copied verbatim (fixed updatedAt
 *  included). Existing, tombstoned and archived ids are never touched or re-added. */
export function mergeSeed(catalog: readonly Exercise[], seed: readonly Exercise[] = SEED): SeedMergeResult {
  const present = new Set(catalog.map((e) => e.id));
  const added = seed.filter((e) => !present.has(e.id)).map((e) => ({ ...e }));
  return { catalog: [...catalog, ...added], added };
}
