import { referencingSessions } from '../../../model/edit-catalog';
import type { Exercise, LoadType, Pattern, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import type { FileRow } from '../../../sync/store';

export interface CatalogRow { id: string; name: string; meta: string /* 'pull · reps · per side · bodyweight' (per side only when true) */ }
export interface CatalogVm { live: { family: string; rows: CatalogRow[] }[]; archived: CatalogRow[]; readOnly: string | undefined /* reason when the catalog row is refused or missing */ }

const byText = (a: string, b: string): number => a.localeCompare(b, 'en');

function rowOf(e: Exercise): CatalogRow {
  const meta = [e.pattern, e.metric, ...(e.perSide ? ['per side'] : []), e.defaultLoadType].join(' · ');
  return { id: e.id, name: e.name, meta };
}

/** The refused catalog row's reason in plain words, or undefined when the catalog row is not refused. */
export function catalogRefusedReason(refusedRows: readonly FileRow[]): string | undefined {
  const row = refusedRows.find((r) => r.path === EXERCISES_PATH);
  if (row === undefined) return undefined;
  return row.duplicateOf !== undefined ? 'a duplicate' : row.status;
}

/** The read-only banner text (spec 1 §5): the catalog row is refused, or there is none yet. */
export function catalogReadOnly(catalog: readonly Exercise[] | undefined, refusedReason: string | undefined): string | undefined {
  if (refusedReason !== undefined) return `exercises.json is ${refusedReason}; the catalog cannot be changed here. See the Sync tab.`;
  if (catalog === undefined) return 'The exercise catalog is not here yet; it arrives with the first sync.';
  return undefined;
}

/**
 * Spec 4 §6 "Catalog": every exercise, live entries by family (the name when it has none), then the
 * archived ones by name; tombstoned entries are left out. `refusedReason` is the refused catalog
 * row's reason in plain words ('quarantined', 'read-only', 'a duplicate' …); with it, or without a
 * catalog, the screen is read-only (spec 1 §5).
 */
export function catalogVm(catalog: readonly Exercise[] | undefined, refusedReason: string | undefined): CatalogVm {
  const present = (catalog ?? []).filter((e) => e.deletedAt === undefined);
  const groups = new Map<string, Exercise[]>();
  for (const e of present.filter((x) => !x.archived)) {
    const family = e.family ?? e.name;
    const list = groups.get(family);
    if (list === undefined) groups.set(family, [e]);
    else list.push(e);
  }
  const live = [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([family, list]) => ({ family, rows: [...list].sort((a, b) => byText(a.name, b.name)).map(rowOf) }));
  const archived = present.filter((x) => x.archived).sort((a, b) => byText(a.name, b.name)).map(rowOf);
  return { live, archived, readOnly: catalogReadOnly(catalog, refusedReason) };
}

export interface ExerciseFormVm {
  name: string;
  family: string;
  pattern: Pattern;
  defaultLoadType: LoadType;
  cues: string;
  metric: 'reps' | 'seconds';
  perSide: boolean;
  locked: true;
  archived: boolean;
  canDelete: boolean;
  deleteReason: string | undefined /* 'used in N sessions; archive instead' */;
}

/** Spec 4 §6 edit form: the editable fields as text, metric and per side locked (spec 1 §3); Delete
 *  only while no live block of a live session uses the exercise. */
export function exerciseFormVm(exercise: Exercise, sessions: readonly Session[]): ExerciseFormVm {
  const used = referencingSessions(exercise.id, sessions).length;
  return {
    name: exercise.name,
    family: exercise.family ?? '',
    pattern: exercise.pattern,
    defaultLoadType: exercise.defaultLoadType,
    cues: exercise.cues ?? '',
    metric: exercise.metric,
    perSide: exercise.perSide,
    locked: true,
    archived: exercise.archived,
    canDelete: used === 0,
    deleteReason: used === 0 ? undefined : `used in ${used} session${used === 1 ? '' : 's'}; archive instead`,
  };
}
