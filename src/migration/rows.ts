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
  const rest = text.slice(m[0].length);
  // M3: `12,5 kg …` and `12.5 x 3` are a load and reps, not a date.
  if (/^(?:kg|x)(?![a-z])/i.test(rest)) return undefined;
  return { dateText: m[1]!, rest };
}

export interface OutsideCell {
  address: string;
  row: number;
  text: string;
}

/** Spec 2 §1/§9 (F5): data cells (row ≥ FIRST_DATA_ROW) in no date, exercise or Extra column, by row then column. */
export function outsideCells(grid: Grid): OutsideCell[] {
  const known = new Set<string>();
  for (const b of COLUMN_BLOCKS) {
    known.add(b.dateCol);
    for (const c of b.exerciseCols) known.add(c);
    if (b.extraCol !== undefined) known.add(b.extraCol);
  }
  const out: (OutsideCell & { col: string })[] = [];
  for (const [address, cell] of grid) {
    const m = /^([A-Z]+)(\d+)$/.exec(address);
    if (!m) continue;
    const col = m[1]!;
    const row = Number(m[2]);
    if (row < FIRST_DATA_ROW || known.has(col)) continue;
    out.push({ address, row, text: cell.value, col });
  }
  out.sort((a, b) => a.row - b.row || a.col.length - b.col.length || (a.col < b.col ? -1 : a.col > b.col ? 1 : 0));
  return out.map(({ address, row, text }) => ({ address, row, text }));
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
              cells: lead.rest.trim() === '' ? [] : [{ address, header, text: lead.rest }],
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
