import type { Block, Exercise, LoadType, Session, WorkoutSet } from '../types';
import { chipOf, type Chip } from './filter';
import { compareSessions, completedStamps, liveBlocks, liveSets, sessionTimeKey, sortSessions } from './order';
import { amountOf } from './totals';

/** Spec 4 §4 proposal rule: the chip most live blocks have; tie → the chip of the first block in
 *  canonical order; undefined without live blocks. An unknown exercise counts as 'other'. */
export function dayType(session: Session, catalog: readonly Exercise[]): Chip | undefined {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const chips = liveBlocks(session).map((b) => {
    const ex = byId.get(b.exerciseId);
    return ex === undefined ? 'other' : chipOf(ex.pattern);
  });
  const counts = new Map<Chip, number>();
  for (const c of chips) counts.set(c, (counts.get(c) ?? 0) + 1);
  // Walking the chips in block order and only replacing on a strictly higher count keeps the
  // earliest chip on a tie.
  let best: Chip | undefined;
  let bestCount = 0;
  for (const c of chips) {
    const n = counts.get(c) ?? 0;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** Live sessions other than `excludeId`, in session order, newest first, at most `limit`. */
export function recentSessions(sessions: readonly Session[], excludeId: string | undefined, limit = 10): Session[] {
  return sortSessions(sessions)
    .filter((s) => s.id !== excludeId)
    .reverse()
    .slice(0, limit);
}

/** Spec 4 §4: per day type its most recent session; of those the one lowest in session order
 *  (oldest date; on equal dates the lower). Sessions without a day type never qualify. */
export function proposeReference(sessions: readonly Session[], catalog: readonly Exercise[], excludeId: string | undefined): Session | undefined {
  const latestByType = new Map<Chip, Session>();
  // Ascending session order: a later session of the same type simply overwrites the earlier one.
  for (const s of sortSessions(sessions)) {
    if (s.id === excludeId) continue;
    const type = dayType(s, catalog);
    if (type !== undefined) latestByType.set(type, s);
  }
  let proposal: Session | undefined;
  for (const s of latestByType.values()) {
    if (proposal === undefined || compareSessions(s, proposal) < 0) proposal = s;
  }
  return proposal;
}

export interface CardPair {
  exerciseId: string;
  reference: Block | undefined;
  today: Block | undefined;
}

/** Spec 4 §4 cards (U13): the reference's live blocks in canonical order, the k-th block of
 *  exercise X paired with the k-th live block of X in today; today's unpaired blocks follow in
 *  canonical order. Without a reference there are only today's cards. */
export function pairCards(today: Session, reference: Session | undefined): CardPair[] {
  const todayBlocks = liveBlocks(today);
  const paired = new Set<string>();
  const seen = new Map<string, number>();
  const cards: CardPair[] = [];
  for (const ref of reference === undefined ? [] : liveBlocks(reference)) {
    const k = seen.get(ref.exerciseId) ?? 0;
    seen.set(ref.exerciseId, k + 1);
    const match = todayBlocks.filter((b) => b.exerciseId === ref.exerciseId)[k];
    if (match !== undefined) paired.add(match.id);
    cards.push({ exerciseId: ref.exerciseId, reference: ref, today: match });
  }
  for (const b of todayBlocks) {
    if (!paired.has(b.id)) cards.push({ exerciseId: b.exerciseId, reference: undefined, today: b });
  }
  return cards;
}

export function stepFor(metric: 'reps' | 'seconds'): number {
  return metric === 'reps' ? 1 : 5;
}

const setsOf = (block: Block | undefined): WorkoutSet[] => (block === undefined ? [] : liveSets(block));

/** A migrated aggregate set holds a total of unknown sets ("100 total"), never one set's amount. */
const single = (s: WorkoutSet | undefined): WorkoutSet | undefined => (s === undefined || s.aggregate === true ? undefined : s);

/** Spec 4 §4 stepper: the reference set at position (today's live set count + 1), else today's
 *  last live set, else undefined. An aggregate set never proposes: it is a total, not the set at
 *  that position (spec 4 §4). */
export function proposedAmount(todayBlock: Block | undefined, referenceBlock: Block | undefined): number | undefined {
  const today = setsOf(todayBlock);
  const candidate = single(setsOf(referenceBlock)[today.length]) ?? single(today[today.length - 1]);
  return candidate === undefined ? undefined : amountOf(candidate);
}

export interface StickyLoad {
  loadType: LoadType;
  loadKg: number;
  /** added/assist without a weight: the load sheet opens before the first write (spec 1 §5). */
  needsKg: boolean;
}

function sticky(loadType: LoadType, loadKg: number): StickyLoad {
  return { loadType, loadKg, needsKg: (loadType === 'added' || loadType === 'assist') && loadKg <= 0 };
}

/** Spec 4 §4: today's last live set → the reference's first live set → the exercise default at 0 kg. */
export function stickyLoad(todayBlock: Block | undefined, referenceBlock: Block | undefined, exercise: Exercise | undefined): StickyLoad {
  const today = setsOf(todayBlock);
  const last = today[today.length - 1];
  if (last !== undefined) return sticky(last.loadType, last.loadKg);
  const first = setsOf(referenceBlock)[0];
  if (first !== undefined) return sticky(first.loadType, first.loadKg);
  return sticky(exercise?.defaultLoadType ?? 'bodyweight', 0);
}

/** The counter source: the latest completedAt of a live set in a live block. */
export function latestCompletedAt(session: Session): string | undefined {
  const stamps = completedStamps(session);
  return stamps.length === 0 ? undefined : stamps.reduce((a, b) => (a > b ? a : b));
}

/** startedAt (else the earliest completedAt) → the latest completedAt, only when both exist and
 *  the span is positive. */
export function sessionSpan(session: Session): { from: string; to: string; seconds: number } | undefined {
  const from = sessionTimeKey(session);
  const to = latestCompletedAt(session);
  if (from === undefined || to === undefined) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  return ms > 0 ? { from, to, seconds: ms / 1000 } : undefined;
}

/** The last live block in canonical order (spec 4 §4: the current block after a reload). */
export function defaultCurrentBlock(session: Session): Block | undefined {
  const blocks = liveBlocks(session);
  return blocks[blocks.length - 1];
}

/** The session's exercises in canonical block order, de-duplicated (the picker line). */
export function sessionExerciseIds(session: Session): string[] {
  return [...new Set(liveBlocks(session).map((b) => b.exerciseId))];
}
