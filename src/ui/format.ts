/**
 * Display formatting for the UI (spec 4 §8 "Text"): English names fixed,
 * local calendar days and local times, durations as m:ss / h:mm:ss, and the
 * device locale for decimals only. Pure; no DOM.
 */
import type { AmountIndicator, LoadIndicator } from '../model/derive/compare';
import type { LoadType, SessionLabel } from '../model/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** U+2212 MINUS SIGN, used for assist loads. */
const MINUS = '−';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of `now` in the local zone. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Local midnight of a 'YYYY-MM-DD' day. */
export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function weekdayOf(date: string): string {
  return WEEKDAYS[parseLocalDate(date).getDay()] ?? '';
}

/** 'Thu 07 Mar' */
export function formatDay(date: string): string {
  const d = parseLocalDate(date);
  return `${weekdayOf(date)} ${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()] ?? ''}`;
}

/** 'Thu 2030-03-07' */
export function formatDayLong(date: string): string {
  return `${weekdayOf(date)} ${date}`;
}

/** 'March 2030' */
export function formatMonth(date: string): string {
  const d = parseLocalDate(date);
  return `${MONTHS_LONG[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** A session label as display text: 'push' → 'Push'. Shared by the Days list, the session page and its label select. */
export function formatLabel(label: SessionLabel): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Local 'HH:MM' (24 h) of an ISO instant. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 'm:ss' below an hour, 'h:mm:ss' from 3600 seconds; fractions dropped. */
export function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** '48 min' below an hour, '1 h 12 min' from an hour; whole minutes. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const amountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Up to two decimals in the device locale (display only; files store JSON numbers). */
export function formatAmount(n: number): string {
  return amountFormat.format(n);
}

/** 'bodyweight' | '+11.5 kg' | '−10 kg assist' | '35 kg' | 'band 50' */
export function formatLoad(loadType: LoadType, loadKg: number): string {
  switch (loadType) {
    case 'bodyweight':
      return 'bodyweight';
    case 'added':
      return `+${formatAmount(loadKg)} kg`;
    case 'assist':
      return `${MINUS}${formatAmount(loadKg)} kg assist`;
    case 'external':
      return `${formatAmount(loadKg)} kg`;
    case 'band':
      return `band ${formatAmount(loadKg)}`;
  }
}

/** 'bw' | '+11.5' | '−10' | '35 kg' | 'band 50' */
export function formatLoadShort(loadType: LoadType, loadKg: number): string {
  switch (loadType) {
    case 'bodyweight':
      return 'bw';
    case 'added':
      return `+${formatAmount(loadKg)}`;
    case 'assist':
      return `${MINUS}${formatAmount(loadKg)}`;
    case 'external':
      return `${formatAmount(loadKg)} kg`;
    case 'band':
      return `band ${formatAmount(loadKg)}`;
  }
}

/** The indicator glyph (spec 4 §8): ↑ ↓ = ≠ –, and nothing for hidden. */
export function glyph(ind: AmountIndicator | LoadIndicator): string {
  switch (ind) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'same':
      return '=';
    case 'incomparable':
      return '≠';
    case 'none':
      return '–';
    case 'hidden':
      return '';
  }
}

/** The screen-reader text for an indicator glyph. */
export function glyphLabel(ind: AmountIndicator | LoadIndicator): string {
  switch (ind) {
    case 'up':
      return 'more';
    case 'down':
      return 'less';
    case 'same':
      return 'same';
    case 'incomparable':
      return 'not comparable';
    case 'none':
      return 'no comparison';
    case 'hidden':
      return '';
  }
}
