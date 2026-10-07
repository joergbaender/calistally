import type { Block, Session, WorkoutSet } from '../types';

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Canonical set order: order, then completedAt (absent last), then id. */
export function compareSets(a: WorkoutSet, b: WorkoutSet): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.completedAt !== b.completedAt) {
    if (a.completedAt === undefined) return 1;
    if (b.completedAt === undefined) return -1;
    return a.completedAt < b.completedAt ? -1 : 1;
  }
  return byId(a, b);
}

/** Canonical block order: order, then id. */
export function compareBlocks(a: Block, b: Block): number {
  return a.order !== b.order ? a.order - b.order : byId(a, b);
}

/** Non-deleted sets in a non-deleted block, in canonical order. */
export function liveSets(block: Block): WorkoutSet[] {
  if (block.deletedAt !== undefined) return [];
  return block.sets.filter((s) => s.deletedAt === undefined).sort(compareSets);
}

/** Non-deleted blocks in a non-deleted session, in canonical order. */
export function liveBlocks(session: Session): Block[] {
  if (session.deletedAt !== undefined) return [];
  return session.blocks.filter((b) => b.deletedAt === undefined).sort(compareBlocks);
}

/** startedAt, else the earliest completedAt among live sets, else undefined. */
export function sessionTimeKey(session: Session): string | undefined {
  if (session.startedAt !== undefined) return session.startedAt;
  const stamps = liveBlocks(session)
    .flatMap(liveSets)
    .flatMap((s) => (s.completedAt === undefined ? [] : [s.completedAt]));
  return stamps.length === 0 ? undefined : stamps.reduce((a, b) => (a < b ? a : b));
}

/** Total session order: date, then time key (none first), then id. */
export function compareSessions(a: Session, b: Session): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ka = sessionTimeKey(a);
  const kb = sessionTimeKey(b);
  if (ka !== kb) {
    if (ka === undefined) return -1;
    if (kb === undefined) return 1;
    return ka < kb ? -1 : 1;
  }
  return byId(a, b);
}

export function sortSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.deletedAt === undefined).sort(compareSessions);
}
