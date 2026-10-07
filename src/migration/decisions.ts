import { isCalendarDate } from '../model/validate';
import { cellLines } from './parse-cell';

/** Spec 2 §9 "Decisions file". */
export interface Decision {
  text?: string;
  date?: string;
  dateExact?: true;
  accept?: true;
  skip?: true;
  why?: string;
}

export type Decisions = Readonly<Record<string, Decision>>;

const KEY = /^[A-Z]+\d+(#\d+)?$/;
const FIELDS = new Set(['text', 'date', 'dateExact', 'accept', 'skip', 'why']);

/** Parse and check the decisions file. Throws with the offending key on any shape error. */
export function parseDecisions(json: string): Decisions {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('decisions file must hold a JSON object');
  const out: Record<string, Decision> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY.test(key)) throw new Error(`decision key "${key}" is not a cell address like G9 or M27#3`);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`decision ${key} must be an object`);
    const d = value as Record<string, unknown>;
    for (const field of Object.keys(d)) if (!FIELDS.has(field)) throw new Error(`decision ${key}: unknown field "${field}"`);
    if (d['text'] !== undefined && typeof d['text'] !== 'string') throw new Error(`decision ${key}: text must be a string`);
    if (d['date'] !== undefined && (typeof d['date'] !== 'string' || !isCalendarDate(d['date']))) {
      throw new Error(`decision ${key}: date must be YYYY-MM-DD`);
    }
    for (const flag of ['dateExact', 'accept', 'skip'] as const) {
      if (d[flag] !== undefined && d[flag] !== true) throw new Error(`decision ${key}: ${flag} must be true or absent`);
    }
    if (d['why'] !== undefined && typeof d['why'] !== 'string') throw new Error(`decision ${key}: why must be a string`);
    out[key] = d as Decision;
  }
  return out;
}

export interface AppliedCell {
  /** undefined: the whole cell was skipped. */
  text: string | undefined;
  /** Decision keys that changed something. */
  used: string[];
  /** Decision keys present for this cell (used or not). */
  seen: string[];
}

/** Apply `text` and `skip` decisions to one cell: cell-level first, then per non-empty line (`A1#n`). */
export function applyCellDecisions(address: string, original: string, decisions: Decisions): AppliedCell {
  const used: string[] = [];
  const seen: string[] = [];
  const cell = decisions[address];
  if (cell !== undefined) seen.push(address);
  if (cell?.skip) return { text: undefined, used: [address], seen };
  let lines = cellLines(original);
  if (cell?.text !== undefined) {
    const replaced = cellLines(cell.text);
    if (replaced.join('\n') !== lines.join('\n')) used.push(address);
    lines = replaced;
  }
  const kept: string[] = [];
  lines.forEach((line, i) => {
    const key = `${address}#${i + 1}`;
    const d = decisions[key];
    if (d === undefined) {
      kept.push(line);
      return;
    }
    seen.push(key);
    if (d.skip) {
      used.push(key);
      return;
    }
    if (d.text !== undefined && d.text.trim() !== line) {
      used.push(key);
      kept.push(d.text.trim());
      return;
    }
    kept.push(line);
  });
  return { text: kept.join('\n'), used, seen };
}
