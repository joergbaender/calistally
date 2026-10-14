import { amountOf, blockLoad, blocksOf, blockTotals, compareBlockPair, liveSets, metricOf, sortSessions, type BlockIndicator, type BlockLoad } from '../../../model/derive';
import type { Block, Exercise, Session, WorkoutSet } from '../../../model/types';
import { formatAmount, formatDay, formatLoadShort } from '../../format';

export interface HistoryRow {
  sessionId: string;
  blockId: string;
  day: string /* formatDay */;
  uncertain: boolean;
  run: number /* 1 for the first block of X in that session, 2 … */;
  sets: string /* amounts joined by ' ', aggregate as '100*' */;
  note: string | undefined;
  noteOnly: boolean;
  totals: string /* '143 · 14 sets' */;
  marks: BlockIndicator;
  load: string /* formatLoadShort of blockLoad's group/kg; '' when no sets */;
  /** The session's year ('2030'), for the year headings of spec 4 §6 (the rows themselves show no year). */
  year: string;
  /** The block belongs to the open session: its marks are provisional, shown dimmed (spec 4 §14). */
  open: boolean;
}
export interface ExerciseHistoryVm { name: string; archived: boolean; unknown: boolean; metric: 'reps' | 'seconds'; rows: HistoryRow[] }

/** Spec 4 §6 block load: blockLoad's body group is one signed axis (bw at 0, +added, −assist). */
function loadText(load: BlockLoad | undefined): string {
  if (load === undefined) return '';
  switch (load.group) {
    case 'body':
      if (load.kg === 0) return formatLoadShort('bodyweight', 0);
      return load.kg > 0 ? formatLoadShort('added', load.kg) : formatLoadShort('assist', -load.kg);
    case 'external':
      return formatLoadShort('external', load.kg);
    case 'band':
      return formatLoadShort('band', load.kg);
  }
}

/** '143 · 14 sets'; an aggregate marks the total with '*' and is not a set; '' for an empty block. */
function totalsText(block: Block): string {
  const t = blockTotals(block);
  if (t.isEmpty) return '';
  const parts = [`${formatAmount(t.amount)}${t.hasAggregate ? '*' : ''}`];
  if (t.setCount > 0) parts.push(`${t.setCount} ${t.setCount === 1 ? 'set' : 'sets'}`);
  return parts.join(' · ');
}

function row(session: Session, block: Block, run: number, marks: BlockIndicator, open: boolean): HistoryRow {
  const sets = liveSets(block);
  return {
    sessionId: session.id,
    blockId: block.id,
    day: formatDay(session.date),
    uncertain: session.dateUncertain === true,
    run,
    sets: sets.map((s) => `${formatAmount(amountOf(s))}${s.aggregate === true ? '*' : ''}`).join(' '),
    note: block.note,
    noteOnly: sets.length === 0 && block.note !== undefined,
    totals: totalsText(block),
    marks,
    load: loadText(blockLoad(block)),
    year: session.date.slice(0, 4),
    open,
  };
}

/**
 * Spec 4 §6: every live block of the exercise, newest session first; within a session by run. The
 * marks are `blockIndicator`'s (spec 1 §7: block n of X against block n of X in the most recent
 * earlier session that has n blocks of X), computed in one walk from the oldest session, keeping
 * the last block per run, instead of sorting all sessions again for every row. `openSessionId`
 * marks the open session's rows provisional.
 */
export function exerciseHistoryVm(
  exerciseId: string,
  sessions: readonly Session[],
  catalog: ReadonlyMap<string, Exercise>,
  openSessionId?: string | undefined,
): ExerciseHistoryVm {
  const lastByRun: Block[] = [];
  const perSession: HistoryRow[][] = [];
  let firstSet: WorkoutSet | undefined;
  for (const s of sortSessions(sessions)) {
    const blocks = blocksOf(s, exerciseId);
    if (blocks.length === 0) continue;
    perSession.push(blocks.map((b, i) => row(s, b, i + 1, compareBlockPair(b, lastByRun[i]), s.id === openSessionId)));
    blocks.forEach((b, i) => {
      lastByRun[i] = b;
    });
    firstSet ??= blocks.flatMap(liveSets)[0];
  }
  const exercise = catalog.get(exerciseId);
  return {
    name: exercise?.name ?? exerciseId,
    archived: exercise?.archived ?? false,
    unknown: exercise === undefined,
    metric: exercise?.metric ?? (firstSet === undefined ? 'reps' : metricOf(firstSet)),
    rows: perSession.reverse().flat(),
  };
}
