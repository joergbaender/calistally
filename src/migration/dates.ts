import { isCalendarDate } from '../model/validate';
import type { Cell } from './grid';
import type { ReviewKind } from './types';

export type DateStatus =
  | { kind: 'exact'; date: string }
  | { kind: 'repaired'; date: string; repair: string }
  | { kind: 'doubtful'; date: string; reason: string }
  | { kind: 'unreadable'; text: string }
  | { kind: 'missing' };

const TEXT_DATE = /^(\d{1,2})([.,]+)(\d{1,2})(?:([.,]+)(\d{2,4})?)?[.,]*$/;
const pad = (n: string | number): string => String(n).padStart(2, '0');

/** Spec 2 §4 "Dates": the accepted text forms and their repairs. */
export function parseDateText(text: string, year: number): DateStatus {
  const m = TEXT_DATE.exec(text.trim());
  if (!m) return { kind: 'unreadable', text };
  const [, day, sep1, month, sep2, yearText] = m;
  const repairs: string[] = [];
  if (sep1 !== '.') repairs.push(`separator "${sep1}" read as "."`);
  if (sep2 !== undefined && sep2 !== '.') repairs.push(`separator "${sep2}" read as "."`);
  let y: number;
  let doubtful: string | undefined;
  if (yearText === undefined) {
    y = year;
    repairs.push(`year completed to ${year}`);
  } else if (yearText.length === 2) y = 2000 + Number(yearText);
  else if (yearText.length === 3) {
    y = year;
    doubtful = `three-digit year "${yearText}" read as ${year}`;
  } else y = Number(yearText);
  const date = `${y}-${pad(month!)}-${pad(day!)}`;
  if (!isCalendarDate(date)) return { kind: 'unreadable', text };
  if (doubtful !== undefined) return { kind: 'doubtful', date, reason: doubtful };
  if (repairs.length > 0) return { kind: 'repaired', date, repair: repairs.join('; ') };
  return { kind: 'exact', date };
}

export function classifyDate(cell: Cell | undefined, year: number): DateStatus {
  if (cell === undefined) return { kind: 'missing' };
  if (cell.kind === 'date') return isCalendarDate(cell.value) ? { kind: 'exact', date: cell.value } : { kind: 'unreadable', text: cell.value };
  return parseDateText(cell.value, year);
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

/** The one month change that puts `date` strictly between its neighbours, if exactly one exists. */
export function singleMonthEdit(date: string, lower: string | undefined, upper: string | undefined): string | undefined {
  const candidates: string[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const candidate = `${date.slice(0, 4)}-${pad(m)}-${date.slice(8, 10)}`;
    if (candidate === date || !isCalendarDate(candidate)) continue;
    if ((lower === undefined || candidate > lower) && (upper === undefined || candidate < upper)) candidates.push(candidate);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

export interface DateItem {
  kind: ReviewKind;
  detail: string;
  proposal?: string;
}

export interface ResolvedDate {
  key: string;
  date: string;
  uncertain: boolean;
  items: DateItem[];
  repairs: string[];
}

const DEFAULT_GAP_DAYS = 7;

/** Median gap of the first four dated rows (spec 2 §4), whole days, at least 1; 7 when there is no gap to measure. */
export function medianGap(dates: readonly string[]): number {
  const first = dates.slice(0, 4);
  const gaps: number[] = [];
  for (let i = 1; i < first.length; i += 1) gaps.push(daysBetween(first[i - 1]!, first[i]!));
  if (gaps.length === 0) return DEFAULT_GAP_DAYS;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.max(1, Math.round(median));
}

/** Spec 2 §4: order and duplicate check, single-edit proposals, undated-row proposals, for one column block. */
export function resolveBlockDates(rows: readonly { key: string; status: DateStatus }[], year: number): ResolvedDate[] {
  const out: ResolvedDate[] = rows.map((r) => ({ key: r.key, date: '', uncertain: false, items: [], repairs: [] }));
  const known: { index: number; date: string }[] = [];
  rows.forEach((r, index) => {
    const o = out[index]!;
    if (r.status.kind === 'exact' || r.status.kind === 'repaired' || r.status.kind === 'doubtful') {
      o.date = r.status.date;
      known.push({ index, date: r.status.date });
    }
    if (r.status.kind === 'repaired') o.repairs.push(r.status.repair);
    if (r.status.kind === 'doubtful') {
      o.uncertain = true;
      o.items.push({ kind: 'date-repaired-doubtful', detail: r.status.reason });
    }
  });

  // Out-of-order: which of the two neighbours is the outlier? The one whose removal restores the order.
  const d = known.map((k) => k.date);
  const flagged = new Map<number, DateItem>();
  const fixable = (c: number): boolean => c === 0 || c === d.length - 1 || d[c - 1]! < d[c + 1]!;
  for (let i = 1; i < d.length; i += 1) {
    if (d[i]! > d[i - 1]!) continue;
    const candidates = [i - 1, i].filter(fixable);
    if (candidates.length === 1) {
      const c = candidates[0]!;
      const proposal = singleMonthEdit(d[c]!, c > 0 ? d[c - 1] : undefined, c < d.length - 1 ? d[c + 1] : undefined);
      const item: DateItem = { kind: 'date-out-of-order', detail: `${d[c]} breaks the row order` };
      if (proposal !== undefined) item.proposal = proposal;
      flagged.set(c, item);
    } else {
      for (const c of [i - 1, i]) {
        if (!flagged.has(c)) flagged.set(c, { kind: 'date-out-of-order', detail: `${d[c]} and its neighbour are out of order; either could be wrong` });
      }
    }
  }
  const counts = new Map<string, number>();
  for (const date of d) counts.set(date, (counts.get(date) ?? 0) + 1);
  d.forEach((date, c) => {
    if ((counts.get(date) ?? 0) > 1 && !flagged.has(c)) flagged.set(c, { kind: 'date-out-of-order', detail: `${date} appears twice in this column block` });
  });
  for (const [c, item] of flagged) {
    const o = out[known[c]!.index]!;
    o.uncertain = true;
    o.items.push(item);
  }

  // Undated rows: proposals (spec 2 §4).
  const gap = medianGap(d);
  rows.forEach((r, index) => {
    const o = out[index]!;
    if (o.date !== '') return;
    const before = [...known].reverse().find((k) => k.index < index);
    const after = known.find((k) => k.index > index);
    let proposal: string;
    if (before === undefined && after !== undefined) proposal = addDays(after.date, -(after.index - index) * gap);
    else if (before !== undefined && after !== undefined) {
      const undatedBetween = after.index - before.index - 1;
      const j = index - before.index;
      proposal = addDays(before.date, Math.floor((j * daysBetween(before.date, after.date)) / (undatedBetween + 1)));
    } else if (before !== undefined) proposal = addDays(before.date, index - before.index);
    else proposal = `${year}-01-01`;
    o.date = proposal;
    o.uncertain = true;
    if (r.status.kind === 'unreadable') o.items.push({ kind: 'date-unreadable', detail: `"${r.status.text}" is not a date`, proposal });
    else o.items.push({ kind: 'date-proposed', detail: 'no date in the sheet', proposal });
  });
  return out;
}
