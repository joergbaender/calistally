import type { Exercise, Pattern, Session } from '../types';
import { liveBlocks } from './order';

export type Chip = 'push' | 'pull' | 'legs' | 'other';

export function chipOf(pattern: Pattern): Chip {
  return pattern === 'push' || pattern === 'pull' || pattern === 'legs' ? pattern : 'other';
}

/** The chips a session matches (spec §7 day-list filter). The catalog must include tombstoned
 *  entries; an exercise that still can't be resolved counts as 'other' so the session stays findable. */
export function sessionChips(session: Session, catalog: readonly Exercise[]): Set<Chip> {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  return new Set(
    liveBlocks(session).map((b) => {
      const ex = byId.get(b.exerciseId);
      return ex === undefined ? 'other' : chipOf(ex.pattern);
    }),
  );
}

export function matchesChip(session: Session, catalog: readonly Exercise[], chip: Chip | 'all'): boolean {
  return chip === 'all' || sessionChips(session, catalog).has(chip);
}
