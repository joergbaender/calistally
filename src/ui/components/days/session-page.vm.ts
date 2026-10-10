import {
  blockIndicator,
  blockTotals,
  exerciseIndicator,
  liveBlocks,
  liveSets,
  setIntervals,
  type AmountIndicator,
  type BlockIndicator,
} from '../../../model/derive';
import type { Block, Exercise, Session, WorkoutSet } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { formatAmount, formatClock, formatDayLong, formatLabel, formatLoad, formatLoadShort } from '../../format';

export interface SetRow {
  setId: string;
  amount: string;
  /** formatLoadShort when it differs from the block's first live set. */
  load: string | undefined;
  note: string | undefined;
  /** '+1:02' from setIntervals (an interval, not rest). */
  interval: string | undefined;
  /** The interval read aloud: 'interval 1:02 since the previous set'. */
  intervalLabel: string | undefined;
  /** 'rest 120 s' from restSec. */
  rest: string | undefined;
  /** The stated rest read aloud: 'stated rest 120 s'. */
  restLabel: string | undefined;
  aggregate: boolean;
  completedAt: string | undefined;
}

export interface BlockRow {
  blockId: string;
  exerciseId: string;
  name: string;
  archived: boolean;
  unknownExercise: boolean;
  note: string | undefined;
  /** The block's load (formatLoad of its first live set) unless that is plain bodyweight; the set rows show only differences from it. */
  load: string | undefined;
  sets: SetRow[];
  noteOnly: boolean;
  /** '143 · 14 sets' or '100 total, set count unknown'. */
  totals: string;
  marks: BlockIndicator;
  exerciseMark: AmountIndicator;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface SessionPageVm {
  title: string;
  uncertain: boolean;
  /** The label as display text ('Pull', formatLabel). */
  label: string | undefined;
  tags: string[];
  notes: string | undefined;
  migrated: boolean;
  readOnly: { reason: string } | undefined;
  blocks: BlockRow[];
  deleted: boolean;
}

export interface SessionPageInput {
  session: Session;
  /** The live sessions the indicators compare against. */
  allSessions: readonly Session[];
  catalog: ReadonlyMap<string, Exercise>;
  readOnlyReason: string | undefined;
}

const sameLoad = (a: WorkoutSet, b: WorkoutSet): boolean => a.loadType === b.loadType && a.loadKg === b.loadKg;

function totalsText(block: Block): string {
  const t = blockTotals(block);
  if (t.hasAggregate) return `${formatAmount(t.amount)} total, set count unknown`;
  return `${formatAmount(t.amount)} · ${t.setCount} ${t.setCount === 1 ? 'set' : 'sets'}`;
}

function setRow(s: WorkoutSet, first: WorkoutSet | undefined, intervals: ReadonlyMap<string, number>): SetRow {
  const interval = intervals.get(s.id);
  return {
    setId: s.id,
    amount: formatAmount('reps' in s ? s.reps : s.seconds),
    load: first === undefined || sameLoad(s, first) ? undefined : formatLoadShort(s.loadType, s.loadKg),
    note: s.note,
    interval: interval === undefined ? undefined : `+${formatClock(interval)}`,
    intervalLabel: interval === undefined ? undefined : `interval ${formatClock(interval)} since the previous set`,
    rest: s.restSec === undefined ? undefined : `rest ${formatAmount(s.restSec)} s`,
    restLabel: s.restSec === undefined ? undefined : `stated rest ${formatAmount(s.restSec)} s`,
    aggregate: s.aggregate === true,
    completedAt: s.completedAt,
  };
}

/** Spec 4 §5 "Session page": the header and the blocks in canonical order, with the derived values of spec 1 §7. */
export function sessionPageVm(input: SessionPageInput): SessionPageVm {
  const { session, allSessions, catalog } = input;
  const intervals = setIntervals(session);
  const live = liveBlocks(session);
  const blocks = live.map((b, i): BlockRow => {
    const exercise = catalog.get(b.exerciseId);
    const sets = liveSets(b);
    const first = sets[0];
    return {
      blockId: b.id,
      exerciseId: b.exerciseId,
      name: exercise?.name ?? b.exerciseId,
      archived: exercise?.archived ?? false,
      unknownExercise: exercise === undefined,
      note: b.note,
      load: first === undefined || first.loadType === 'bodyweight' ? undefined : formatLoad(first.loadType, first.loadKg),
      sets: sets.map((s) => setRow(s, first, intervals)),
      noteOnly: sets.length === 0 && b.note !== undefined,
      totals: totalsText(b),
      marks: blockIndicator(allSessions, session, b),
      exerciseMark: exerciseIndicator(allSessions, session, b.exerciseId),
      canMoveUp: i > 0,
      canMoveDown: i < live.length - 1,
    };
  });
  return {
    title: formatDayLong(session.date),
    uncertain: session.dateUncertain === true,
    label: session.label === undefined ? undefined : formatLabel(session.label),
    tags: [...session.tags],
    notes: session.notes,
    migrated: session.source === 'migrated',
    readOnly: input.readOnlyReason === undefined ? undefined : { reason: input.readOnlyReason },
    blocks,
    deleted: session.deletedAt !== undefined,
  };
}

/** The read-only banner's reason (the Sync tab's card titles, spec 4 §7). */
export function readOnlyReason(row: FileRow): string {
  if (row.duplicateOf !== undefined) return `Duplicate file: the same session as ${row.duplicateOf}`;
  switch (row.status) {
    case 'read-only':
      return 'Read-only: written by a newer app version';
    case 'needs-update':
      return 'Needs a newer app to change this session';
    case 'quarantined':
      return 'Quarantined: this file failed validation';
    case 'ok':
      return 'Read-only';
  }
}

const normalNotes = (text: string | undefined): string | undefined => {
  const t = (text ?? '').trim();
  return t === '' ? undefined : t;
};

/**
 * Whether saving `draft` as the notes would change them: both sides go through the normalisation
 * `setSessionFields` applies (trim, blank removes), so a migrated note with surrounding whitespace is
 * never rewritten by a save that did not change its words.
 */
export function notesChanged(stored: string | undefined, draft: string): boolean {
  return normalNotes(draft) !== normalNotes(stored);
}
