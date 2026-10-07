import { describe, expect, it } from 'vitest';
import { addDays, classifyDate, daysBetween, medianGap, parseDateText, resolveBlockDates, singleMonthEdit, type DateStatus } from './dates';

const Y = 2030;
const exact = (date: string): DateStatus => ({ kind: 'exact', date });
const missing: DateStatus = { kind: 'missing' };
const keyed = (statuses: DateStatus[]) => statuses.map((status, i) => ({ key: `r${i}`, status }));

describe('parseDateText', () => {
  it('accepts the plain forms without a repair', () => {
    expect(parseDateText('28.01.30', Y)).toEqual(exact('2030-01-28'));
    expect(parseDateText('07.02.2030', Y)).toEqual(exact('2030-02-07'));
    expect(parseDateText(' 7.2.2030 ', Y)).toEqual(exact('2030-02-07'));
  });

  it('repairs separators and a missing year, and reports the repair', () => {
    expect(parseDateText('01,05.2030', Y)).toEqual({ kind: 'repaired', date: '2030-05-01', repair: 'separator "," read as "."' });
    expect(parseDateText('02.07..2030', Y)).toEqual({ kind: 'repaired', date: '2030-07-02', repair: 'separator ".." read as "."' });
    expect(parseDateText('06.07.', Y)).toEqual({ kind: 'repaired', date: '2030-07-06', repair: 'year completed to 2030' });
  });

  it('reads a three-digit year as the sheet year but doubts it', () => {
    expect(parseDateText('28.04.203', Y)).toEqual({ kind: 'doubtful', date: '2030-04-28', reason: 'three-digit year "203" read as 2030' });
  });

  it('rejects anything else, including impossible dates', () => {
    expect(parseDateText('abc', Y)).toEqual({ kind: 'unreadable', text: 'abc' });
    expect(parseDateText('31.02.2030', Y)).toEqual({ kind: 'unreadable', text: '31.02.2030' });
    expect(parseDateText('2030-02-07', Y)).toEqual({ kind: 'unreadable', text: '2030-02-07' });
  });
});

describe('classifyDate', () => {
  it('handles missing, date and text cells', () => {
    expect(classifyDate(undefined, Y)).toEqual(missing);
    expect(classifyDate({ kind: 'date', value: '2030-04-24' }, Y)).toEqual(exact('2030-04-24'));
    expect(classifyDate({ kind: 'text', value: '25.04.2030' }, Y)).toEqual(exact('2030-04-25'));
  });
});

describe('date arithmetic', () => {
  it('adds days across month ends and measures gaps', () => {
    expect(addDays('2030-01-30', 3)).toBe('2030-02-02');
    expect(addDays('2030-02-01', -6)).toBe('2030-01-26');
    expect(daysBetween('2030-01-26', '2030-02-01')).toBe(6);
  });

  it('proposes exactly one month edit, or none', () => {
    expect(singleMonthEdit('2030-08-03', '2030-08-30', '2030-09-07')).toBe('2030-09-03');
    expect(singleMonthEdit('2030-06-25', '2030-05-21', '2030-05-29')).toBe('2030-05-25');
    expect(singleMonthEdit('2030-07-02', '2030-07-04', '2030-07-08')).toBeUndefined();
    expect(singleMonthEdit('2030-01-05', '2030-01-10', undefined)).toBeUndefined();
  });

  it('medianGap uses the first four dates, rounds, and falls back to 7', () => {
    expect(medianGap(['2030-02-01', '2030-02-07', '2030-02-13', '2030-02-17', '2030-03-30'])).toBe(6);
    expect(medianGap(['2030-02-01', '2030-02-07', '2030-02-11'])).toBe(5);
    expect(medianGap(['2030-02-01'])).toBe(7);
    expect(medianGap([])).toBe(7);
  });
});

describe('resolveBlockDates', () => {
  it('leaves an increasing sequence alone', () => {
    const out = resolveBlockDates(keyed([exact('2030-02-01'), exact('2030-02-07')]), Y);
    expect(out.map((o) => [o.date, o.uncertain, o.items.length])).toEqual([['2030-02-01', false, 0], ['2030-02-07', false, 0]]);
  });

  it('flags the lone outlier with a single-month proposal', () => {
    const out = resolveBlockDates(keyed(['2030-08-26', '2030-08-30', '2030-08-03', '2030-09-07', '2030-09-11'].map(exact)), Y);
    expect(out.map((o) => o.uncertain)).toEqual([false, false, true, false, false]);
    expect(out[2]?.date).toBe('2030-08-03');
    expect(out[2]?.items).toEqual([{ kind: 'date-out-of-order', detail: '2030-08-03 breaks the row order', proposal: '2030-09-03' }]);
  });

  it('flags a month typo that is also a duplicate, and the duplicate itself', () => {
    const out = resolveBlockDates(keyed(['2030-05-21', '2030-06-25', '2030-05-29', '2030-06-02', '2030-06-25'].map(exact)), Y);
    expect(out.map((o) => o.uncertain)).toEqual([false, true, false, false, true]);
    expect(out[1]?.items[0]).toEqual({ kind: 'date-out-of-order', detail: '2030-06-25 breaks the row order', proposal: '2030-05-25' });
    expect(out[4]?.items[0]).toEqual({ kind: 'date-out-of-order', detail: '2030-06-25 appears twice in this column block' });
  });

  it('flags both rows of a swap without a proposal', () => {
    const out = resolveBlockDates(keyed(['2030-06-24', '2030-07-04', '2030-07-02', '2030-07-08'].map(exact)), Y);
    expect(out.map((o) => o.uncertain)).toEqual([false, true, true, false]);
    for (const i of [1, 2]) {
      expect(out[i]?.items[0]?.kind).toBe('date-out-of-order');
      expect(out[i]?.items[0]?.proposal).toBeUndefined();
      expect(out[i]?.items[0]?.detail).toContain('either could be wrong');
    }
  });

  it('proposes dates for undated rows above the first dated one from the median gap', () => {
    const out = resolveBlockDates(keyed([missing, missing, missing, exact('2030-02-01'), exact('2030-02-07'), exact('2030-02-13'), exact('2030-02-17')]), Y);
    expect(out.slice(0, 3).map((o) => o.date)).toEqual(['2030-01-14', '2030-01-20', '2030-01-26']);
    expect(out.slice(0, 3).every((o) => o.uncertain)).toBe(true);
    expect(out[0]?.items).toEqual([{ kind: 'date-proposed', detail: 'no date in the sheet', proposal: '2030-01-14' }]);
    expect(out[3]?.uncertain).toBe(false);
  });

  it('proposes midpoints between dated rows and day steps after the last one', () => {
    expect(resolveBlockDates(keyed([exact('2030-02-01'), missing, exact('2030-02-07')]), Y)[1]?.date).toBe('2030-02-04');
    const two = resolveBlockDates(keyed([exact('2030-02-01'), missing, missing, exact('2030-02-07')]), Y);
    expect([two[1]?.date, two[2]?.date]).toEqual(['2030-02-03', '2030-02-05']);
    const after = resolveBlockDates(keyed([exact('2030-02-01'), missing, missing]), Y);
    expect([after[1]?.date, after[2]?.date]).toEqual(['2030-02-02', '2030-02-03']);
    expect(resolveBlockDates(keyed([missing]), Y)[0]?.date).toBe('2030-01-01');
  });

  it('treats an unreadable date as undated and says so', () => {
    const out = resolveBlockDates(keyed([exact('2030-02-01'), { kind: 'unreadable', text: 'x' }, exact('2030-02-07')]), Y);
    expect(out[1]?.date).toBe('2030-02-04');
    expect(out[1]?.uncertain).toBe(true);
    expect(out[1]?.items).toEqual([{ kind: 'date-unreadable', detail: '"x" is not a date', proposal: '2030-02-04' }]);
  });

  it('carries doubtful dates as uncertain items and repairs as report text', () => {
    const out = resolveBlockDates(keyed([{ kind: 'doubtful', date: '2030-04-28', reason: 'r' }, { kind: 'repaired', date: '2030-05-01', repair: 's' }]), Y);
    expect(out[0]).toEqual({ key: 'r0', date: '2030-04-28', uncertain: true, items: [{ kind: 'date-repaired-doubtful', detail: 'r' }], repairs: [] });
    expect(out[1]).toEqual({ key: 'r1', date: '2030-05-01', uncertain: false, items: [], repairs: ['s'] });
  });
});
