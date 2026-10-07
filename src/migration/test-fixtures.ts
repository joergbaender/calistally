import ExcelJS from 'exceljs';
import type { Grid } from './grid';

/** Row 2 of the real sheet. Header strings are not training data. */
export const HEADERS: Readonly<Record<string, string>> = {
  A2: 'Date',
  B2: 'Australian Pull Ups',
  C2: 'Bicep Curls',
  D2: 'Face Pulls',
  F2: 'Date',
  G2: 'Dips',
  H2: 'Push Ups',
  I2: 'Triceps Pulldowns',
  J2: 'Extra',
  L2: 'Date',
  M2: 'Single Leg RDL',
  N2: 'Split Squats',
  O2: 'Calf Raises',
};

export type CellSpec = string | { date: string };

/** A Grid from `{ A6: '01.02.30', B6: '20x 15x', A7: { date: '2030-02-07' } }`, with the real headers in row 2. */
export function gridOf(cells: Record<string, CellSpec>, headers: boolean = true): Grid {
  const grid: Grid = new Map();
  if (headers) for (const [address, value] of Object.entries(HEADERS)) grid.set(address, { kind: 'text', value });
  for (const [address, spec] of Object.entries(cells)) {
    grid.set(address, typeof spec === 'string' ? { kind: 'text', value: spec } : { kind: 'date', value: spec.date });
  }
  return grid;
}

/** Writes a synthetic workbook with exceljs; `{ date }` specs become real date cells. */
export async function writeWorkbook(file: string, cells: Record<string, CellSpec>, headers: boolean = true): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Calisthenics Plan');
  const all: Record<string, CellSpec> = { ...(headers ? HEADERS : {}), ...cells };
  for (const [address, spec] of Object.entries(all)) {
    sheet.getCell(address).value = typeof spec === 'string' ? spec : new Date(`${spec.date}T00:00:00.000Z`);
  }
  await workbook.xlsx.writeFile(file);
}
