import type { BodyweightEntry } from '../../../model/types';
import { isCalendarDate } from '../../../model/validate';
import { formatAmount, formatDay } from '../../format';

/** Spec 4 §6 "Bodyweight": the line above the list and the list rows, from plain entries. */
export interface LinePoint { x: number; y: number; date: string; kg: number }
export interface BodyweightLine {
  points: LinePoint[];
  /** 'x1,y1 x2,y2 …' rounded to 1 decimal. */
  polyline: string;
  min: { kg: number; y: number };
  max: { kg: number; y: number };
}
export interface BodyweightRow { entryId: string; day: string; kg: string; note: string | undefined }

const DAY_MS = 86_400_000;

/** Whole days since the epoch for a 'YYYY-MM-DD' (UTC arithmetic, so no DST hour creeps in). */
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / DAY_MS;
}

/** Oldest first: date, then updatedAt, then id (stable). */
function byDate(a: BodyweightEntry, b: BodyweightEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function live(entries: readonly BodyweightEntry[]): BodyweightEntry[] {
  return entries.filter((e) => e.deletedAt === undefined).sort(byDate);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Live entries by date in a `width` × `height` box with `pad` around it; undefined below two
 * entries. x is proportional to days, y is inverted (heavier is higher); equal weights draw a
 * flat line through the middle, and entries all on one day sit in the horizontal middle.
 */
export function bodyweightLine(entries: readonly BodyweightEntry[], width: number, height: number, pad = 8): BodyweightLine | undefined {
  const sorted = live(entries);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length < 2 || first === undefined || last === undefined) return undefined;
  const day0 = dayNumber(first.date);
  const days = dayNumber(last.date) - day0;
  const kgs = sorted.map((e) => e.kg);
  const minKg = Math.min(...kgs);
  const maxKg = Math.max(...kgs);
  const x = (date: string): number => (days === 0 ? width / 2 : pad + ((dayNumber(date) - day0) / days) * (width - 2 * pad));
  const y = (kg: number): number => (maxKg === minKg ? height / 2 : pad + ((maxKg - kg) / (maxKg - minKg)) * (height - 2 * pad));
  const points = sorted.map((e) => ({ x: x(e.date), y: y(e.kg), date: e.date, kg: e.kg }));
  return {
    points,
    polyline: points.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' '),
    min: { kg: minKg, y: y(minKg) },
    max: { kg: maxKg, y: y(maxKg) },
  };
}

/** Live entries, newest first (date, then updatedAt). */
export function bodyweightRows(entries: readonly BodyweightEntry[]): BodyweightRow[] {
  return live(entries)
    .reverse()
    .map((e) => ({ entryId: e.id, day: formatDay(e.date), kg: `${formatAmount(e.kg)} kg`, note: e.note }));
}

/** What the add/edit sheet holds: the kg from the pad, the date field and the note field (untrimmed). */
export interface BodyweightDraft { kg: number | undefined; date: string; note: string }

/**
 * Why the sheet cannot save, or undefined (spec 4 §6: "kg (positive, one decimal)"). The one-decimal
 * rule applies only to a new entry or a changed kg, so a migrated two-decimal entry can still get a
 * new note or date. `opened` is the entry the sheet opened with; undefined when adding.
 */
export function bodyweightProblem(draft: BodyweightDraft, opened: BodyweightEntry | undefined): string | undefined {
  const { kg } = draft;
  if (kg === undefined) return 'Enter the weight';
  if (!Number.isFinite(kg) || kg <= 0) return 'More than 0 kg';
  if ((opened === undefined || kg !== opened.kg) && Number(kg.toFixed(1)) !== kg) return 'One decimal at most';
  if (!isCalendarDate(draft.date)) return 'Pick a date';
  return undefined;
}

/**
 * The fields the owner changed, compared against the values the sheet opened with, so a
 * field another device changed meanwhile is never written back; `{}` when nothing changed. A blank
 * note removes it (`null`); the note is compared trimmed, as the model stores it.
 */
export function bodyweightChanges(
  draft: { kg: number; date: string; note: string },
  opened: BodyweightEntry,
): { date?: string; kg?: number; note?: string | null } {
  const changes: { date?: string; kg?: number; note?: string | null } = {};
  if (draft.date !== opened.date) changes.date = draft.date;
  if (draft.kg !== opened.kg) changes.kg = draft.kg;
  const note = draft.note.trim();
  if (note !== (opened.note ?? '')) changes.note = note === '' ? null : note;
  return changes;
}
