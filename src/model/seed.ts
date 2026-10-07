import { findByName } from './catalog';
import seedJson from './seed-exercises.json';
import type { Exercise } from './types';

/** The developer seed (spec §5). Validated by seed.test.ts; the json import is typed loosely. */
export const SEED: readonly Exercise[] = seedJson as unknown as readonly Exercise[];

export interface SeedMergeResult {
  catalog: Exercise[];
  added: Exercise[];
  /** Seed entries not added because their name already exists under a different id. */
  skipped: { seed: Exercise; existing: Exercise }[];
}

/** Adds seed entries, copied verbatim (fixed updatedAt included). An id already in the catalog
 *  (live, archived or tombstoned) is never touched or re-added, and is not reported. A seed
 *  entry whose id is missing but whose name (normalizeName; live, archived and tombstoned all
 *  count) matches a catalog entry is skipped and reported, so a renamed user exercise does not
 *  gain a live duplicate. `existing` prefers a non-deleted match. */
export function mergeSeed(catalog: readonly Exercise[], seed: readonly Exercise[] = SEED): SeedMergeResult {
  const present = new Set(catalog.map((e) => e.id));
  const added: Exercise[] = [];
  const skipped: { seed: Exercise; existing: Exercise }[] = [];
  for (const e of seed) {
    if (present.has(e.id)) continue;
    const existing = findByName(catalog, e.name);
    if (existing) skipped.push({ seed: e, existing });
    else added.push({ ...e });
  }
  return { catalog: [...catalog, ...added], added, skipped };
}
