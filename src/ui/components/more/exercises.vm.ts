import { liveBlocks, sortSessions } from '../../../model/derive';
import type { Exercise, Session } from '../../../model/types';
import { formatDayYear } from '../../format';

export interface ExerciseListRow { id: string; name: string; lastDate: string | undefined /* formatDayYear of the latest live block's session (the year only outside today's) */ }
export interface ExerciseGroup { family: string /* family or the name itself */; rows: ExerciseListRow[] }
export interface ExercisesVm { live: ExerciseGroup[]; archived: ExerciseGroup[] }

const byText = (a: string, b: string): number => a.localeCompare(b, 'en');

/** Exercise id → date of the latest live session with a live block of it. */
function lastDates(sessions: readonly Session[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const s of sortSessions(sessions)) {
    for (const b of liveBlocks(s)) last.set(b.exerciseId, s.date);
  }
  return last;
}

function group(entries: readonly Exercise[], last: ReadonlyMap<string, string>, today: string): ExerciseGroup[] {
  const groups = new Map<string, ExerciseListRow[]>();
  for (const e of entries) {
    const family = e.family ?? e.name;
    const date = last.get(e.id);
    const row: ExerciseListRow = { id: e.id, name: e.name, lastDate: date === undefined ? undefined : formatDayYear(date, today) };
    const rows = groups.get(family);
    if (rows === undefined) groups.set(family, [row]);
    else rows.push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([family, rows]) => ({ family, rows: rows.sort((a, b) => byText(a.name, b.name)) }));
}

/** Spec 4 §6: every exercise grouped by family, live first, archived apart; tombstoned entries omitted.
 *  `today` (local 'YYYY-MM-DD') adds the year to a last date in another year. */
export function exercisesVm(catalog: readonly Exercise[], sessions: readonly Session[], today: string): ExercisesVm {
  const present = catalog.filter((e) => e.deletedAt === undefined);
  const last = lastDates(sessions);
  return {
    live: group(present.filter((e) => !e.archived), last, today),
    archived: group(present.filter((e) => e.archived), last, today),
  };
}
