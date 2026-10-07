import type { Session } from '../types';
import { completedStamps, liveBlocks, liveSets } from './order';

export const SESSION_OPEN_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Spec §7 "Set interval": seconds from the previous timestamped set, keyed by set id. Within a
 * block the previous set is the canonical predecessor; for a block's first set it is the latest
 * earlier timestamp anywhere else in the session (the block's own sets excluded, so a reversed
 * order inside the block shows nothing). Missing or reversed timestamps give no entry.
 */
export function setIntervals(session: Session): Map<string, number> {
  const out = new Map<string, number>();
  const blocks = liveBlocks(session);
  for (const block of blocks) {
    const sets = liveSets(block);
    sets.forEach((set, i) => {
      const at = set.completedAt;
      if (at === undefined) return;
      let previous: string | undefined;
      if (i === 0) {
        const earlier = blocks
          .filter((b) => b !== block)
          .flatMap(liveSets)
          .flatMap((s) => (s.completedAt !== undefined && s.completedAt < at ? [s.completedAt] : []));
        previous = earlier.length === 0 ? undefined : earlier.reduce((a, b) => (a > b ? a : b));
      } else {
        previous = sets[i - 1]?.completedAt;
      }
      if (previous === undefined) return;
      const ms = Date.parse(at) - Date.parse(previous);
      if (ms > 0) out.set(set.id, ms / 1000);
    });
  }
  return out;
}

/** Spec §7 "Session open/closed". Never stored. */
export function isSessionOpen(session: Session, allSessions: readonly Session[], now: Date): boolean {
  if (session.deletedAt !== undefined || session.startedAt === undefined) return false;
  const started = session.startedAt;
  const latest = completedStamps(session).reduce((a, b) => (a > b ? a : b), started);
  if (now.getTime() - Date.parse(latest) >= SESSION_OPEN_WINDOW_MS) return false;
  return !allSessions.some(
    (s) => s.id !== session.id && s.deletedAt === undefined && s.startedAt !== undefined && s.startedAt > started,
  );
}
