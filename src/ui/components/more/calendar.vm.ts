/**
 * Spec 4 §6 "Calendar": month grids newest first, day dots by chip, per-month counts and the
 * streak of calendar weeks. Pure: dates are 'YYYY-MM-DD' strings and all arithmetic is on UTC
 * calendar days, so the local zone and DST never shift a day.
 */
import { dayType, sessionChips, sortSessions, type Chip } from '../../../model/derive';
import type { Exercise, Session } from '../../../model/types';
import { formatLabel, formatMonth, formatTime } from '../../format';

export interface CalendarDay {
  date: string;
  inMonth: boolean;
  /** At most 3, order push pull legs other. */
  dots: Chip[];
  hollow: boolean;
  sessionIds: string[];
}

export interface CalendarMonth {
  /** 'YYYY-MM' */
  key: string;
  /** formatMonth */
  title: string;
  /** Monday-first rows of 7. */
  weeks: CalendarDay[][];
  sessions: number;
  trainingDays: number;
}

export interface CalendarVm {
  streakWeeks: number;
  /** Newest first, from the current month back to the month of the first live session. */
  months: CalendarMonth[];
}

const CHIP_ORDER: readonly Chip[] = ['push', 'pull', 'legs', 'other'];
const MAX_DOTS = 3;
const DAY_MS = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, '0');

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
}

function fromUtc(d: Date): string {
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(date: string, n: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + n * DAY_MS));
}

/** The Monday of the ISO week (Monday to Sunday) holding `date`. */
function mondayOf(date: string): string {
  const weekday = toUtc(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function previousMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const year = y ?? 0;
  const month = m ?? 1;
  return month === 1 ? `${String(year - 1).padStart(4, '0')}-12` : `${String(year).padStart(4, '0')}-${pad2(month - 1)}`;
}

function lastDayOf(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return fromUtc(new Date(Date.UTC(y ?? 0, m ?? 1, 0)));
}

function buildDay(date: string, inMonth: boolean, sessions: readonly Session[], catalog: readonly Exercise[]): CalendarDay {
  if (!inMonth || sessions.length === 0) return { date, inMonth, dots: [], hollow: false, sessionIds: [] };
  const chips = new Set<Chip>();
  for (const s of sessions) for (const c of sessionChips(s, catalog)) chips.add(c);
  return {
    date,
    inMonth,
    dots: CHIP_ORDER.filter((c) => chips.has(c)).slice(0, MAX_DOTS),
    hollow: sessions.every((s) => s.dateUncertain === true),
    sessionIds: sessions.map((s) => s.id),
  };
}

function buildMonth(key: string, byDate: ReadonlyMap<string, Session[]>, catalog: readonly Exercise[]): CalendarMonth {
  const first = `${key}-01`;
  const last = lastDayOf(key);
  const weeks: CalendarDay[][] = [];
  let sessions = 0;
  let trainingDays = 0;
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const inMonth = monthKey(date) === key;
      const onDay = inMonth ? (byDate.get(date) ?? []) : [];
      if (onDay.length > 0) {
        sessions += onDay.length;
        trainingDays += 1;
      }
      week.push(buildDay(date, inMonth, onDay, catalog));
    }
    weeks.push(week);
  }
  return { key, title: formatMonth(first), weeks, sessions, trainingDays };
}

/** Consecutive weeks with a live session, ending with the current week, or with last week when the current week is still empty. */
function streak(live: readonly Session[], today: string): number {
  const weeks = new Set(live.filter((s) => s.date <= today).map((s) => mondayOf(s.date)));
  let monday = mondayOf(today);
  if (!weeks.has(monday)) monday = addDays(monday, -7);
  let n = 0;
  while (weeks.has(monday)) {
    n += 1;
    monday = addDays(monday, -7);
  }
  return n;
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * One line of the day sheet: the label (else the day type), capitalised like the Days list and the
 * session page, the start time, and the uncertain-date mark.
 */
export function calendarSessionLine(session: Session, catalog: readonly Exercise[]): string {
  const parts = [session.label !== undefined ? formatLabel(session.label) : capitalise(dayType(session, catalog) ?? 'no exercises')];
  if (session.startedAt !== undefined) parts.push(formatTime(session.startedAt));
  if (session.dateUncertain === true) parts.push('date uncertain');
  return parts.join(' · ');
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameDay(a: CalendarDay, b: CalendarDay): boolean {
  return a.date === b.date && a.inMonth === b.inMonth && a.hollow === b.hollow && sameList(a.dots, b.dots) && sameList(a.sessionIds, b.sessionIds);
}

function sameMonth(a: CalendarMonth, b: CalendarMonth): boolean {
  if (a.key !== b.key || a.title !== b.title || a.sessions !== b.sessions || a.trainingDays !== b.trainingDays) return false;
  if (a.weeks.length !== b.weeks.length) return false;
  return a.weeks.every((week, w) => {
    const other = b.weeks[w];
    return other !== undefined && week.length === other.length && week.every((d, i) => {
      const o = other[i];
      return o !== undefined && sameDay(d, o);
    });
  });
}

/**
 * `next` with every month whose content equals the one in `prev` (same key) replaced by the `prev`
 * object, so the page's month components, which compare by identity, skip the months a session
 * change did not touch (a pull of one session re-renders one month, not the whole history).
 * Comparing 42 cells is far cheaper than re-diffing a grid.
 */
export function reuseMonths(prev: readonly CalendarMonth[], next: readonly CalendarMonth[]): CalendarMonth[] {
  const byKey = new Map(prev.map((m) => [m.key, m]));
  return next.map((m) => {
    const old = byKey.get(m.key);
    return old !== undefined && sameMonth(old, m) ? old : m;
  });
}

export function calendarVm(sessions: readonly Session[], catalog: readonly Exercise[], today: string): CalendarVm {
  const live = sortSessions(sessions);
  const byDate = new Map<string, Session[]>();
  for (const s of live) {
    const list = byDate.get(s.date);
    if (list === undefined) byDate.set(s.date, [s]);
    else list.push(s);
  }

  // A session dated after today still gets its month, so nothing is hidden.
  const dates = live.map((s) => s.date);
  const newest = [monthKey(today), ...dates.map(monthKey)].reduce((a, b) => (b > a ? b : a));
  const oldest = [monthKey(today), ...dates.map(monthKey)].reduce((a, b) => (b < a ? b : a));

  const months: CalendarMonth[] = [];
  for (let key = newest; key >= oldest; key = previousMonth(key)) months.push(buildMonth(key, byDate, catalog));

  return { streakWeeks: streak(live, today), months };
}
