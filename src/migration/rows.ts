import type { SessionLabel } from '../model/types';
import { lastRow, type Cell, type Grid } from './grid';
import { COLUMN_BLOCKS, FIRST_DATA_ROW, HEADER_ROW, type BlockName } from './sheet';

export interface SourceCell {
  address: string;
  header: string;
  text: string;
}

export interface SourceRow {
  /** `Pull!6`, or the J address for an Extra session (`J30`). */
  key: string;
  block: BlockName | 'Extra';
  row: number;
  label: SessionLabel;
  dateAddress: string;
  dateCell: Cell | undefined;
  /** Cells to parse (Extra: the J cell with its leading date removed). */
  cells: SourceCell[];
  /** Cells for the session notes, original text. */
  noteCells: SourceCell[];
  /** Extra sessions: the key of the push row on the same sheet row. */
  hostKey?: string;
}

const LEADING_DATE = /^\s*(\d{1,2}[.,]+\d{1,2}(?:[.,]+\d{2,4})?[.,]*)(?:\s+|$)/;

/** `12.06.2026 Pullups …` → the date text and the rest; undefined when the cell has no leading date. */
export function leadingDate(text: string): { dateText: string; rest: string } | undefined {
  const m = LEADING_DATE.exec(text);
  if (!m) return undefined;
  return { dateText: m[1]!, rest: text.slice(m[0].length) };
}

export function headerOf(grid: Grid, col: string): string {
  return grid.get(`${col}${HEADER_ROW}`)?.value.trim() ?? col;
}

/** Spec 2 §4 "Column blocks" and "Extra column": one SourceRow per session. */
export function splitRows(grid: Grid): SourceRow[] {
  const rows: SourceRow[] = [];
  const last = lastRow(grid);
  for (const block of COLUMN_BLOCKS) {
    for (let r = FIRST_DATA_ROW; r <= last; r += 1) {
      const dateAddress = `${block.dateCol}${r}`;
      const dateCell = grid.get(dateAddress);
      const cells: SourceCell[] = [];
      for (const col of block.exerciseCols) {
        const cell = grid.get(`${col}${r}`);
        if (cell !== undefined) cells.push({ address: `${col}${r}`, header: headerOf(grid, col), text: cell.value });
      }
      let extra: SourceRow | undefined;
      if (block.extraCol !== undefined) {
        const address = `${block.extraCol}${r}`;
        const cell = grid.get(address);
        if (cell !== undefined) {
          const header = headerOf(grid, block.extraCol);
          const lead = leadingDate(cell.value);
          if (lead === undefined) cells.push({ address, header, text: cell.value });
          else {
            extra = {
              key: address,
              block: 'Extra',
              row: r,
              label: 'other',
              dateAddress: address,
              dateCell: { kind: 'text', value: lead.dateText },
              cells: [{ address, header, text: lead.rest }],
              noteCells: [{ address, header, text: cell.value }],
              hostKey: `${block.name}!${r}`,
            };
          }
        }
      }
      if (dateCell !== undefined || cells.length > 0) {
        rows.push({ key: `${block.name}!${r}`, block: block.name, row: r, label: block.label, dateAddress, dateCell, cells, noteCells: [...cells] });
      }
      if (extra !== undefined) rows.push(extra);
    }
  }
  return rows;
}
