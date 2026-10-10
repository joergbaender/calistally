import { proposeReference, recentSessions, sessionExerciseIds } from '../../../model/derive';
import type { Exercise, Session } from '../../../model/types';
import { formatDay } from '../../format';

/** Spec 4 §4 "Start": one line per candidate reference session. */
export interface PickerRow {
  sessionId: string;
  title: string; // 'Thu 07 Mar'
  label: string | undefined;
  exercises: string; // names joined ' · '
  proposed: boolean;
}

export interface StartPickerVm {
  rows: PickerRow[];
  /** "No reference" is always the last line. */
  hasNone: true;
}

function rowOf(s: Session, catalog: ReadonlyMap<string, Exercise>, proposed: boolean): PickerRow {
  return {
    sessionId: s.id,
    title: formatDay(s.date),
    label: s.label,
    exercises: sessionExerciseIds(s).map((id) => catalog.get(id)?.name ?? id).join(' · '),
    proposed,
  };
}

/** The ten most recent live sessions, newest first; the proposal on top and marked. A proposal
 *  older than those ten (proposeReference looks at every session) still goes on top, above the ten. */
export function startPickerVm(sessions: readonly Session[], catalog: ReadonlyMap<string, Exercise>, excludeId: string | undefined): StartPickerVm {
  const recent = recentSessions(sessions, excludeId, 10);
  const proposal = proposeReference(sessions, [...catalog.values()], excludeId);
  const rest = recent.filter((s) => s.id !== proposal?.id).map((s) => rowOf(s, catalog, false));
  return { rows: proposal === undefined ? rest : [rowOf(proposal, catalog, true), ...rest], hasNone: true };
}
