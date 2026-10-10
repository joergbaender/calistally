import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatClock,
  formatDay,
  formatDayLong,
  formatLoad,
  formatLoadShort,
  formatMinutes,
  formatMonth,
  formatTime,
  glyph,
  glyphLabel,
  formatLabel,
  localDate,
  parseLocalDate,
} from './format';
import { SESSION_LABELS } from '../model/schema';

/** The device locale's rendering of a number, the same call format.ts makes (spec 4 §8: decimals use the device locale). */
const num = (n: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
const pad2 = (n: number): string => String(n).padStart(2, '0');

describe('localDate', () => {
  it('uses the local calendar day, not the UTC one, late in the evening', () => {
    // 23:30 local; in any zone east of UTC the UTC date is already the 5th.
    expect(localDate(new Date(2030, 2, 4, 23, 30))).toBe('2030-03-04');
  });

  it('uses the local calendar day early in the morning', () => {
    expect(localDate(new Date(2030, 0, 1, 0, 15))).toBe('2030-01-01');
  });

  it('pads month and day', () => {
    expect(localDate(new Date(2030, 10, 9, 12, 0))).toBe('2030-11-09');
  });
});

describe('parseLocalDate', () => {
  it('returns local midnight of that day', () => {
    const d = parseLocalDate('2030-03-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2030, 2, 4, 0, 0]);
  });

  it('round-trips with localDate', () => {
    expect(localDate(parseLocalDate('2030-12-31'))).toBe('2030-12-31');
    expect(localDate(parseLocalDate('2030-01-01'))).toBe('2030-01-01');
  });
});

describe('formatDay', () => {
  it('shows weekday, zero-padded day and short month in English', () => {
    expect(formatDay('2030-03-07')).toBe('Thu 07 Mar');
    expect(formatDay('2030-03-04')).toBe('Mon 04 Mar');
  });

  it('covers the other weekdays and months', () => {
    expect(formatDay('2030-11-30')).toBe('Sat 30 Nov');
    expect(formatDay('2030-01-01')).toBe('Tue 01 Jan');
  });
});

describe('formatDayLong', () => {
  it('shows the weekday and the ISO date', () => {
    expect(formatDayLong('2030-03-07')).toBe('Thu 2030-03-07');
    expect(formatDayLong('2030-11-30')).toBe('Sat 2030-11-30');
  });
});

describe('formatMonth', () => {
  it('shows the full English month name and the year', () => {
    expect(formatMonth('2030-03-04')).toBe('March 2030');
    expect(formatMonth('2030-11-30')).toBe('November 2030');
  });
});

describe('formatLabel', () => {
  it('shows a session label as capitalised display text', () => {
    expect(formatLabel('push')).toBe('Push');
    expect(formatLabel('mixed')).toBe('Mixed');
    expect(SESSION_LABELS.map(formatLabel)).toEqual(['Pull', 'Push', 'Legs', 'Mixed', 'Other']);
  });
});

describe('formatTime', () => {
  it('shows the local 24 h clock of an ISO instant', () => {
    const d = new Date(2030, 2, 4, 23, 30, 0);
    expect(formatTime(d.toISOString())).toBe(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    expect(formatTime(d.toISOString())).toBe('23:30');
  });

  it('pads single-digit hours and minutes', () => {
    const d = new Date(2030, 2, 4, 7, 5, 59);
    expect(formatTime(d.toISOString())).toBe('07:05');
  });
});

describe('formatClock', () => {
  it('shows m:ss below an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(3599)).toBe('59:59');
  });

  it('switches to h:mm:ss from 3600 seconds', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(36000)).toBe('10:00:00');
  });

  it('drops fractional seconds', () => {
    expect(formatClock(59.9)).toBe('0:59');
  });
});

describe('formatMinutes', () => {
  it('shows whole minutes under an hour', () => {
    expect(formatMinutes(48 * 60)).toBe('48 min');
    expect(formatMinutes(48 * 60 + 59)).toBe('48 min');
    expect(formatMinutes(30)).toBe('0 min');
  });

  it('shows hours and minutes from an hour', () => {
    expect(formatMinutes(72 * 60)).toBe('1 h 12 min');
    expect(formatMinutes(3600)).toBe('1 h 0 min');
    expect(formatMinutes(2 * 3600 + 5 * 60)).toBe('2 h 5 min');
  });
});

describe('formatAmount', () => {
  it('matches the device locale with up to two decimals', () => {
    expect(formatAmount(11.5)).toBe(num(11.5));
    expect(formatAmount(12)).toBe(num(12));
    expect(formatAmount(0.125)).toBe(num(0.125));
  });

  it('rounds to two decimals and keeps integers plain', () => {
    expect(formatAmount(0.125)).toBe(formatAmount(0.13));
    expect(formatAmount(10)).toBe(num(10));
    expect(formatAmount(10)).toHaveLength(2);
  });
});

describe('formatLoad', () => {
  it('names bodyweight and external load', () => {
    expect(formatLoad('bodyweight', 0)).toBe('bodyweight');
    expect(formatLoad('external', 35)).toBe(`${num(35)} kg`);
  });

  it('signs added and assist, assist with U+2212 and the word assist', () => {
    expect(formatLoad('added', 11.5)).toBe(`+${num(11.5)} kg`);
    expect(formatLoad('assist', 10)).toBe(`−10 kg assist`.replace('10', num(10)));
    expect(formatLoad('assist', 10).charAt(0)).toBe('−');
  });

  it('shows the band grade without a unit', () => {
    expect(formatLoad('band', 50)).toBe(`band ${num(50)}`);
  });
});

describe('formatLoadShort', () => {
  it('abbreviates bodyweight and drops the unit on added and assist', () => {
    expect(formatLoadShort('bodyweight', 0)).toBe('bw');
    expect(formatLoadShort('added', 11.5)).toBe(`+${num(11.5)}`);
    expect(formatLoadShort('assist', 10)).toBe(`−${num(10)}`);
  });

  it('keeps the unit on external and the band word', () => {
    expect(formatLoadShort('external', 35)).toBe(`${num(35)} kg`);
    expect(formatLoadShort('band', 50)).toBe(`band ${num(50)}`);
  });
});

describe('glyph', () => {
  it('maps the trend indicators', () => {
    expect(glyph('up')).toBe('↑');
    expect(glyph('down')).toBe('↓');
    expect(glyph('same')).toBe('=');
  });

  it('maps the load-only indicators', () => {
    expect(glyph('incomparable')).toBe('≠');
    expect(glyph('none')).toBe('–');
    expect(glyph('hidden')).toBe('');
  });
});

describe('glyphLabel', () => {
  it('gives a screen-reader text for every indicator', () => {
    expect(glyphLabel('up')).toBe('more');
    expect(glyphLabel('down')).toBe('less');
    expect(glyphLabel('same')).toBe('same');
    expect(glyphLabel('incomparable')).toBe('not comparable');
    expect(glyphLabel('none')).toBe('no comparison');
  });

  it('is empty for hidden', () => {
    expect(glyphLabel('hidden')).toBe('');
  });
});
