import {
  blockTotals,
  compareBlockPair,
  defaultCurrentBlock,
  latestCompletedAt,
  liveBlocks,
  liveSets,
  metricOf,
  pairCards,
  proposedAmount,
  proposeReference,
  stepFor,
  stickyLoad,
  type BlockIndicator,
  type CardPair,
  type StickyLoad,
} from '../../../model/derive';
import type { Block, Exercise, Session, WorkoutSet } from '../../../model/types';
import { formatAmount, formatClock, formatDay, formatDayLong, formatLoad, formatTime } from '../../format';

export type CardState = 'not-started' | 'current' | 'finished';

export interface CardVm {
  key: string; // reference block id, else today block id
  exerciseId: string;
  name: string;
  archived: boolean;
  metric: 'reps' | 'seconds';
  state: CardState;
  todayBlockId: string | undefined;
  referenceBlockId: string | undefined;
  todaySets: WorkoutSet[]; // liveSets, canonical order
  referenceSets: WorkoutSet[];
  loadText: string;
  proposed: number | undefined; // only for the current card
  markIndex: number | undefined; // only for the current card, when the reference has that position
  totals: { today: string; reference: string } | undefined; // undefined for not-started
  marks: BlockIndicator | undefined; // finished cards with both blocks
  blockNote: string | undefined;
}

export interface CurrentVm {
  blockId: string;
  exerciseId: string;
  name: string;
  metric: 'reps' | 'seconds';
  setNumber: number;
  proposed: number | undefined;
  step: number;
  load: StickyLoad;
  loadText: string;
}

export interface LogScreenVm {
  header: { date: string; startedAt: string; reference: string | undefined; offline: boolean };
  cards: CardVm[];
  counter: string | undefined;
  current: CurrentVm | undefined;
}

export interface LogScreenInput {
  today: Session;
  reference: Session | undefined;
  catalog: ReadonlyMap<string, Exercise>;
  currentBlockId: string | undefined;
  now: Date;
  online: boolean;
}

/** Spec 4 §4 "Resume": the stored choice when it names a live session other than today; 'none'
 *  means no reference; a missing or deleted choice is re-proposed. `sessions` are the live ones. */
export function resolveReference(chosen: string | undefined, sessions: readonly Session[], catalog: readonly Exercise[], todayId: string): Session | undefined {
  if (chosen === 'none') return undefined;
  const found = chosen === undefined || chosen === todayId ? undefined : sessions.find((s) => s.id === chosen && s.deletedAt === undefined);
  return found ?? proposeReference(sessions, catalog, todayId);
}

const sets = (block: Block | undefined): WorkoutSet[] => (block === undefined ? [] : liveSets(block));

function totalsText(prefix: string, block: Block): string {
  const t = blockTotals(block);
  return `${prefix} ${formatAmount(t.amount)} · ${t.setCount} ${t.setCount === 1 ? 'set' : 'sets'}`;
}

/** The exercise's metric; for an id missing from the catalog, the metric of the sets shown. */
function metricFor(exercise: Exercise | undefined, todaySets: WorkoutSet[], referenceSets: WorkoutSet[]): 'reps' | 'seconds' {
  if (exercise !== undefined) return exercise.metric;
  const first = todaySets[0] ?? referenceSets[0];
  return first === undefined ? 'reps' : metricOf(first);
}

function cardOf(pair: CardPair, exercise: Exercise | undefined, current: string | undefined): CardVm {
  const today = pair.today;
  const reference = pair.reference;
  const todaySets = sets(today);
  const referenceSets = sets(reference);
  const state: CardState = today === undefined ? 'not-started' : today.id === current ? 'current' : 'finished';
  const load = stickyLoad(today, reference, exercise);
  const isCurrent = state === 'current';
  const mark = todaySets.length;
  return {
    key: reference?.id ?? today?.id ?? pair.exerciseId,
    exerciseId: pair.exerciseId,
    name: exercise?.name ?? pair.exerciseId,
    archived: exercise?.archived ?? false,
    metric: metricFor(exercise, todaySets, referenceSets),
    state,
    todayBlockId: today?.id,
    referenceBlockId: reference?.id,
    todaySets,
    referenceSets,
    loadText: formatLoad(load.loadType, load.loadKg),
    proposed: isCurrent ? proposedAmount(today, reference) : undefined,
    // A migrated aggregate set is a total, not the set at that position: no mark (spec 4 §4).
    markIndex: isCurrent && mark < referenceSets.length && referenceSets[mark]?.aggregate !== true ? mark : undefined,
    totals: today === undefined ? undefined : { today: totalsText('today', today), reference: reference === undefined ? '' : totalsText('last', reference) },
    marks: state === 'finished' && today !== undefined && reference !== undefined ? compareBlockPair(today, reference) : undefined,
    blockNote: today?.note,
  };
}

/** Spec 4 §4 "The screen": the header, the cards, the counter and the entry area's data. */
export function logScreenVm(input: LogScreenInput): LogScreenVm {
  const { today, reference, catalog, now } = input;
  const named = input.currentBlockId;
  const effectiveCurrent =
    named !== undefined && liveBlocks(today).some((b) => b.id === named) ? named : defaultCurrentBlock(today)?.id;
  const pairs = pairCards(today, reference);
  const cards = pairs.map((p) => cardOf(p, catalog.get(p.exerciseId), effectiveCurrent));

  const latest = latestCompletedAt(today);
  const counter = latest === undefined ? undefined : formatClock(Math.max(0, (now.getTime() - Date.parse(latest)) / 1000));

  const index = cards.findIndex((c) => c.state === 'current');
  const card = cards[index];
  const pair = pairs[index];
  let current: CurrentVm | undefined;
  if (card !== undefined && pair !== undefined && card.todayBlockId !== undefined) {
    const load = stickyLoad(pair.today, pair.reference, catalog.get(card.exerciseId));
    current = {
      blockId: card.todayBlockId,
      exerciseId: card.exerciseId,
      name: card.name,
      metric: card.metric,
      setNumber: card.todaySets.length + 1,
      proposed: card.proposed,
      step: stepFor(card.metric),
      load,
      loadText: formatLoad(load.loadType, load.loadKg),
    };
  }

  return {
    header: {
      date: formatDayLong(today.date),
      startedAt: today.startedAt === undefined ? '' : formatTime(today.startedAt),
      reference: reference === undefined ? undefined : `vs ${formatDay(reference.date)}`,
      offline: !input.online,
    },
    cards,
    counter,
    current,
  };
}
