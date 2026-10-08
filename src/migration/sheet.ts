import type { SessionLabel } from '../model/types';

export type BlockName = 'Pull' | 'Push' | 'Legs';

export interface ColumnBlock {
  name: BlockName;
  label: SessionLabel;
  dateCol: string;
  exerciseCols: readonly string[];
  /** The "Extra" column (Push only). */
  extraCol?: string;
}

/** Spec 2 §4 "Column blocks". */
export const COLUMN_BLOCKS: readonly ColumnBlock[] = [
  { name: 'Pull', label: 'pull', dateCol: 'A', exerciseCols: ['B', 'C', 'D'] },
  { name: 'Push', label: 'push', dateCol: 'F', exerciseCols: ['G', 'H', 'I'], extraCol: 'J' },
  { name: 'Legs', label: 'legs', dateCol: 'L', exerciseCols: ['M', 'N', 'O'] },
];

export const HEADER_ROW = 2;
export const FIRST_DATA_ROW = 3;

/** The only year in the workbook; used to complete `06.07.` and to read `206` (spec 2 §4). */
export const SHEET_YEAR = 2026;

/** Every migrated record's updatedAt (spec 2 §8). Older than anything the owner will do in the app. */
export const MIGRATION_STAMP = '2026-10-07T00:00:00.000Z';

/** Spec 2 §8 "Bodyweight" (decision M15): the value comes from `--bodyweight` (spec 3 §10), never from the repo. */
export function parseBodyweight(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const kg = Number(value.replace(',', '.'));
  return Number.isFinite(kg) && kg > 0 ? kg : undefined;
}
