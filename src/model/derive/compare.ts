import type { Block, Session } from '../types';
import { compareSessions, liveBlocks, liveSets, sortSessions } from './order';
import { blockLoad, blockTotals, exerciseSessionTotal } from './totals';

export type Trend = 'up' | 'down' | 'same';
/** 'none' is the spec's "–": nothing to compare. */
export type AmountIndicator = Trend | 'none';
export type LoadIndicator = Trend | 'incomparable' | 'hidden' | 'none';

export interface BlockIndicator {
  amount: AmountIndicator;
  load: LoadIndicator;
}

const NONE: BlockIndicator = { amount: 'none', load: 'none' };

function trend(current: number, previous: number): Trend {
  return current > previous ? 'up' : current < previous ? 'down' : 'same';
}

/** Every live set is plain bodyweight (no added, assist, external or band set). */
function isPlainBodyweight(block: Block): boolean {
  return liveSets(block).every((s) => s.loadType === 'bodyweight');
}

/** Live blocks of one exercise in canonical order; index + 1 is the block's n. */
export function blocksOf(session: Session, exerciseId: string): Block[] {
  return liveBlocks(session).filter((b) => b.exerciseId === exerciseId);
}

/** Live sessions strictly before `session` in session order, most recent first. */
export function earlierSessions(sessions: readonly Session[], session: Session): Session[] {
  return sortSessions(sessions)
    .filter((s) => s.id !== session.id && compareSessions(s, session) < 0)
    .reverse();
}

/** Block n of exercise X in the most recent earlier session that has at least n blocks of X. */
export function previousOccurrence(sessions: readonly Session[], session: Session, exerciseId: string, n: number): Block | undefined {
  for (const s of earlierSessions(sessions, session)) {
    const blocks = blocksOf(s, exerciseId);
    if (blocks.length >= n) return blocks[n - 1];
  }
  return undefined;
}

export function compareBlockPair(current: Block, previous: Block | undefined): BlockIndicator {
  if (previous === undefined) return NONE;
  const c = blockTotals(current);
  const p = blockTotals(previous);
  if (c.isEmpty || p.isEmpty || c.hasAggregate || p.hasAggregate) return NONE;
  const cl = blockLoad(current);
  const pl = blockLoad(previous);
  if (cl === undefined || pl === undefined) return NONE;
  let load: LoadIndicator;
  if (cl.group !== pl.group) load = 'incomparable';
  else if (isPlainBodyweight(current) && isPlainBodyweight(previous)) load = 'hidden';
  else load = trend(cl.kg, pl.kg);
  return { amount: trend(c.amount, p.amount), load };
}

export function blockIndicator(sessions: readonly Session[], session: Session, block: Block): BlockIndicator {
  const n = blocksOf(session, block.exerciseId).findIndex((b) => b.id === block.id) + 1;
  if (n === 0) return NONE;
  return compareBlockPair(block, previousOccurrence(sessions, session, block.exerciseId, n));
}

/** Spec §7 ↑↓ per exercise: session total against the most recent earlier session with that exercise. */
export function exerciseIndicator(sessions: readonly Session[], session: Session, exerciseId: string): AmountIndicator {
  const previous = earlierSessions(sessions, session).find((s) => blocksOf(s, exerciseId).length > 0);
  if (previous === undefined) return 'none';
  const c = exerciseSessionTotal(session, exerciseId);
  const p = exerciseSessionTotal(previous, exerciseId);
  if (c.unknown || p.unknown) return 'none';
  return trend(c.amount, p.amount);
}
