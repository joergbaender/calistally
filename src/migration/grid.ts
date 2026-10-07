import ExcelJS from 'exceljs';

/** One non-empty cell. A date cell's value is the calendar day `YYYY-MM-DD` (UTC fields). */
export interface Cell {
  kind: 'text' | 'date';
  value: string;
}

/** The sheet as a map from cell address (`A6`) to cell. Empty cells are absent. */
export type Grid = Map<string, Cell>;

function text(value: string): Cell | undefined {
  return value.trim() === '' ? undefined : { kind: 'text', value };
}

/** exceljs cell value → Cell. Spec 2 §3 "Grid". */
export function convertCell(value: ExcelJS.CellValue): Cell | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return { kind: 'date', value: value.toISOString().slice(0, 10) };
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number' || typeof value === 'boolean') return text(String(value));
  if (typeof value === 'object') {
    if ('richText' in value) return text(value.richText.map((t) => t.text).join(''));
    if ('result' in value) return convertCell(value.result as ExcelJS.CellValue);
    if ('text' in value) return typeof value.text === 'string' ? text(value.text) : convertCell(value.text as ExcelJS.CellValue);
  }
  return undefined;
}

export function lastRow(grid: Grid): number {
  let max = 0;
  for (const address of grid.keys()) {
    const row = Number(/\d+$/.exec(address)?.[0] ?? 0);
    if (row > max) max = row;
  }
  return max;
}

/** The first worksheet of the workbook as a Grid. The only input-side I/O of the migration. */
export async function readWorkbook(file: string): Promise<Grid> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new Error(`${file}: workbook has no worksheet`);
  const grid: Grid = new Map();
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const converted = convertCell(cell.value);
      if (converted !== undefined) grid.set(cell.address, converted);
    });
  });
  return grid;
}
