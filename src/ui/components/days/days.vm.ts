import {
  blocksOf,
  compareSessions,
  exerciseIndicator,
  exerciseSessionTotal,
  liveSets,
  matchesChip,
  sessionExerciseIds,
  sessionSpan,
  sortSessions,
  type AmountIndicator,
  type Chip,
} from '../../../model/derive';
import type { Block, Exercise, Session } from '../../../model/types';
import { formatDay, formatLabel, formatMinutes, formatMonth } from '../../format';

/** Spec 4 §5 "Days list": chips, rows newest first, month groups. Pure. */

export type DaysChip = Chip | 'all';

export interface DayRow {
  sessionId: string;
  /** 'Thu 07 Mar' */
  day: string;
  uncertain: boolean;
  /** The session label as display text ('Push'); display only, never a filter. */
  label: string | undefined;
  exercises: { id: string; name: string; mark: AmountIndicator }[];
  /** formatMinutes of sessionSpan; undefined for migrated and past sessions. */
  span: string | undefined;
  open: boolean;
  locked: boolean;
}

export interface MonthGroup {
  /** 'YYYY-MM' */
  key: string;
  /** formatMonth */
  title: string;
  rows: DayRow[];
}

export interface DaysVm {
  chips: { id: DaysChip; label: string; active: boolean }[];
  months: MonthGroup[];
  empty: boolean;
}

export const DAYS_CHIPS: ReadonlyArray<{ id: DaysChip; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'legs', label: 'Legs' },
  { id: 'other', label: 'Other' },
];

export function isDaysChip(value: unknown): value is DaysChip {
  return DAYS_CHIPS.some((c) => c.id === value);
}

export function daysVm(input: {
  sessions: readonly Session[];
  lockedSessions: readonly Session[];
  catalog: readonly Exercise[];
  chip: DaysChip;
  openSessionId: string | undefined;
  /** `exerciseMarks(sessions)`, when the caller keeps it across chip changes; computed here otherwise. */
  marks?: ExerciseMarks | undefined;
}): DaysVm {
  const live = sortSessions(input.sessions);
  const marks = input.marks ?? exerciseMarks(live);
  const locked = new Set<Session>(input.lockedSessions);
  const names = new Map(input.catalog.map((e) => [e.id, e.name]));
  const shown = sortSessions([...live, ...input.lockedSessions])
    .reverse()
    .filter((s) => matchesChip(s, input.catalog, input.chip));

  const months: MonthGroup[] = [];
  for (const s of shown) {
    const isLocked = locked.has(s);
    const span = sessionSpan(s);
    const row: DayRow = {
      sessionId: s.id,
      day: formatDay(s.date),
      uncertain: s.dateUncertain === true,
      label: s.label === undefined ? undefined : formatLabel(s.label),
      exercises: sessionExerciseIds(s).map((id) => ({
        id,
        name: names.get(id) ?? id,
        // Locked sessions are not among the live ones, so they are compared one by one (few rows).
        mark: (isLocked ? undefined : marks.get(s.id)?.get(id)) ?? exerciseIndicator(live, s, id),
      })),
      span: span === undefined ? undefined : formatMinutes(span.seconds),
      open: !isLocked && s.id === input.openSessionId,
      locked: isLocked,
    };
    const key = s.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last !== undefined && last.key === key) last.rows.push(row);
    else months.push({ key, title: formatMonth(s.date), rows: [row] });
  }

  return {
    chips: DAYS_CHIPS.map((c) => ({ ...c, active: c.id === input.chip })),
    months,
    empty: months.length === 0,
  };
}

/** Per live session id, per exercise id: the per-exercise indicator (spec 1 §7). */
export type ExerciseMarks = ReadonlyMap<string, ReadonlyMap<string, AmountIndicator>>;

/** A live block of X that is evidence of training X (as in compare.ts): live sets or a note. */
function hasEvidence(b: Block): boolean {
  return liveSets(b).length > 0 || b.note !== undefined;
}

/**
 * `exerciseIndicator(sessions, s, id)` for every live session and each of its exercises, in one pass
 * over the session order instead of a sort per call (600 sessions took ~80 ms the other way).
 * A test holds it equal to `exerciseIndicator`.
 */
export function exerciseMarks(sessions: readonly Session[]): Map<string, Map<string, AmountIndicator>> {
  const out = new Map<string, Map<string, AmountIndicator>>();
  /** Per exercise: the earlier sessions with evidence of it, in session order. */
  const evidence = new Map<string, Session[]>();
  for (const s of sortSessions(sessions)) {
    const ids = sessionExerciseIds(s);
    const marks = new Map<string, AmountIndicator>();
    for (const id of ids) {
      const earlier = evidence.get(id) ?? [];
      let previous: Session | undefined;
      for (let i = earlier.length - 1; i >= 0; i--) {
        const e = earlier[i];
        if (e !== undefined && e.id !== s.id && compareSessions(e, s) < 0) {
          previous = e;
          break;
        }
      }
      marks.set(id, previous === undefined ? 'none' : trendOf(s, previous, id));
    }
    out.set(s.id, marks);
    for (const id of ids) {
      if (!blocksOf(s, id).some(hasEvidence)) continue;
      const list = evidence.get(id);
      if (list === undefined) evidence.set(id, [s]);
      else list.push(s);
    }
  }
  return out;
}

function trendOf(current: Session, previous: Session, exerciseId: string): AmountIndicator {
  const c = exerciseSessionTotal(current, exerciseId);
  const p = exerciseSessionTotal(previous, exerciseId);
  if (c.unknown || p.unknown) return 'none';
  return c.amount > p.amount ? 'up' : c.amount < p.amount ? 'down' : 'same';
}
