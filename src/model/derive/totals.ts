import type { Block, LoadType, Session, WorkoutSet } from '../types';
import { liveBlocks, liveSets } from './order';

/** All totals and loads are rounded to 2 decimals before comparison (spec §7). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function amountOf(set: WorkoutSet): number {
  return 'reps' in set ? set.reps : set.seconds;
}

export function metricOf(set: WorkoutSet): 'reps' | 'seconds' {
  return 'reps' in set ? 'reps' : 'seconds';
}

export interface BlockTotals {
  /** 'reps' or 'seconds'; meaningless when isEmpty (defaults to 'reps'). */
  metric: 'reps' | 'seconds';
  /** totalReps or totalSeconds; for perSide exercises in per-side units as logged, never doubled. */
  amount: number;
  /** Non-aggregate live sets. */
  setCount: number;
  hasAggregate: boolean;
  isEmpty: boolean;
}

export function blockTotals(block: Block): BlockTotals {
  const sets = liveSets(block);
  const first = sets[0];
  return {
    metric: first === undefined ? 'reps' : metricOf(first),
    amount: round2(sets.reduce((sum, s) => sum + amountOf(s), 0)),
    setCount: sets.filter((s) => s.aggregate !== true).length,
    hasAggregate: sets.some((s) => s.aggregate === true),
    isEmpty: sets.length === 0,
  };
}

/** bodyweight, added and assist share one signed axis; external and band stand alone. */
export type LoadGroup = 'body' | 'external' | 'band';

export function loadGroupOf(loadType: LoadType): LoadGroup {
  return loadType === 'external' ? 'external' : loadType === 'band' ? 'band' : 'body';
}

export function signedKg(set: WorkoutSet): number {
  return set.loadType === 'assist' ? -set.loadKg : set.loadKg;
}

export interface BlockLoad {
  group: LoadGroup;
  /** Max signed kg over the live sets of the main group. */
  kg: number;
}

export function blockLoad(block: Block): BlockLoad | undefined {
  const sets = liveSets(block);
  const first = sets[0];
  if (first === undefined) return undefined;
  const counts = new Map<LoadGroup, number>();
  for (const s of sets) {
    const g = loadGroupOf(s.loadType);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  // Start with the first set's group so a tie keeps it.
  let main = loadGroupOf(first.loadType);
  let best = counts.get(main) ?? 0;
  for (const [g, c] of counts) {
    if (c > best) {
      main = g;
      best = c;
    }
  }
  const kg = Math.max(...sets.filter((s) => loadGroupOf(s.loadType) === main).map(signedKg));
  return { group: main, kg: round2(kg) };
}

export interface ExerciseTotal {
  amount: number;
  /** true when a migrated note-only block (a note and no live sets) makes the real number unknown. */
  unknown: boolean;
}

export function exerciseSessionTotal(session: Session, exerciseId: string): ExerciseTotal {
  const blocks = liveBlocks(session).filter((b) => b.exerciseId === exerciseId);
  const unknown = session.source === 'migrated' && blocks.some((b) => b.note !== undefined && liveSets(b).length === 0);
  return { amount: round2(blocks.reduce((sum, b) => sum + blockTotals(b).amount, 0)), unknown };
}
