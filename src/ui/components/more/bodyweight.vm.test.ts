import { describe, expect, it } from 'vitest';
import { bodyweight } from '../../../model/test-fixtures';
import { formatAmount } from '../../format';
import { bodyweightChanges, bodyweightLine, bodyweightProblem, bodyweightRows, type BodyweightDraft } from './bodyweight.vm';

const DEL = '2030-01-09T10:00:00.000Z';

describe('bodyweightLine', () => {
  it('is undefined with no entries and with one entry', () => {
    expect(bodyweightLine([], 100, 50)).toBeUndefined();
    expect(bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 })], 100, 50)).toBeUndefined();
  });

  it('is undefined when only one entry is live (tombstones out)', () => {
    const entries = [bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-02', kg: 81, deletedAt: DEL, updatedAt: DEL })];
    expect(bodyweightLine(entries, 100, 50)).toBeUndefined();
  });

  it('spans two entries from pad to width - pad, heavier higher (y inverted)', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-11', kg: 82 })], 100, 50);
    expect(line?.points).toEqual([
      { x: 8, y: 42, date: '2030-01-01', kg: 80 },
      { x: 92, y: 8, date: '2030-01-11', kg: 82 },
    ]);
    expect(line?.polyline).toBe('8,42 92,8');
    expect(line?.min).toEqual({ kg: 80, y: 42 });
    expect(line?.max).toEqual({ kg: 82, y: 8 });
  });

  it('takes the pad argument', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 82 }), bodyweight({ date: '2030-01-02', kg: 80 })], 100, 50, 0);
    expect(line?.polyline).toBe('0,0 100,50');
  });

  it('places x by days between dates and sorts points by date', () => {
    const entries = [
      bodyweight({ date: '2030-01-31', kg: 81 }),
      bodyweight({ date: '2030-01-01', kg: 80 }),
      bodyweight({ date: '2030-01-04', kg: 82 }),
    ];
    const line = bodyweightLine(entries, 316, 50);
    expect(line?.points.map((p) => p.date)).toEqual(['2030-01-01', '2030-01-04', '2030-01-31']);
    // 30 days over 300 px: 10 px a day.
    expect(line?.points.map((p) => p.x)).toEqual([8, 38, 308]);
    expect(line?.points.map((p) => p.y)).toEqual([42, 8, 25]);
  });

  it('draws equal weights as a flat line in the middle', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-03', kg: 80 })], 100, 50);
    expect(line?.points.map((p) => p.y)).toEqual([25, 25]);
    expect(line?.min).toEqual({ kg: 80, y: 25 });
    expect(line?.max).toEqual({ kg: 80, y: 25 });
  });

  it('puts entries that are all on one day in the horizontal middle, still heavier higher', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-01', kg: 81 })], 100, 50);
    expect(line?.points.map((p) => p.x)).toEqual([50, 50]);
    expect(line?.min).toEqual({ kg: 80, y: 42 });
    expect(line?.max).toEqual({ kg: 81, y: 8 });
    expect(line?.polyline).toBe('50,42 50,8');
  });

  it('rounds the polyline to one decimal', () => {
    const entries = [
      bodyweight({ date: '2030-01-01', kg: 80 }),
      bodyweight({ date: '2030-01-04', kg: 81 }),
      bodyweight({ date: '2030-01-07', kg: 83 }),
    ];
    const line = bodyweightLine(entries, 100, 50);
    // x: 8, 50, 92; y: 42, 42 - 34/3 = 30.666…, 8
    expect(line?.points[1]?.y).toBeCloseTo(30.6667, 3);
    expect(line?.polyline).toBe('8,42 50,30.7 92,8');
  });

  it('handles many entries, all within the box', () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      bodyweight({ date: `2030-02-${String((i % 28) + 1).padStart(2, '0')}`, kg: 78 + (i % 7) * 0.5 }),
    );
    const line = bodyweightLine(entries, 200, 80);
    expect(line?.points).toHaveLength(40);
    for (const p of line?.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(192);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.y).toBeLessThanOrEqual(72);
    }
    expect(line?.polyline.split(' ')).toHaveLength(40);
    expect(line?.min.kg).toBe(78);
    expect(line?.max.kg).toBe(81);
  });
});

describe('bodyweightRows', () => {
  it('lists live entries newest first, then by updatedAt, with day, kg and note', () => {
    const old = bodyweight({ date: '2030-03-01', kg: 80 });
    const sameDayEarly = bodyweight({ date: '2030-03-07', kg: 79.5, updatedAt: '2030-03-07T06:00:00.000Z' });
    const sameDayLate = bodyweight({ date: '2030-03-07', kg: 79.8, note: 'after lunch', updatedAt: '2030-03-07T13:00:00.000Z' });
    const gone = bodyweight({ date: '2030-03-08', kg: 70, deletedAt: DEL, updatedAt: DEL });
    expect(bodyweightRows([old, sameDayEarly, gone, sameDayLate])).toEqual([
      { entryId: sameDayLate.id, day: 'Thu 07 Mar', kg: `${formatAmount(79.8)} kg`, note: 'after lunch' },
      { entryId: sameDayEarly.id, day: 'Thu 07 Mar', kg: `${formatAmount(79.5)} kg`, note: undefined },
      { entryId: old.id, day: 'Fri 01 Mar', kg: `${formatAmount(80)} kg`, note: undefined },
    ]);
  });

  it('is empty without live entries', () => {
    expect(bodyweightRows([])).toEqual([]);
    expect(bodyweightRows([bodyweight({ deletedAt: DEL, updatedAt: DEL })])).toEqual([]);
  });
});

describe('bodyweightProblem', () => {
  const draft = (over: Partial<BodyweightDraft> = {}): BodyweightDraft => ({ kg: 80, date: '2030-03-01', note: '', ...over });

  it('asks for a weight more than 0 kg', () => {
    expect(bodyweightProblem(draft({ kg: undefined }), undefined)).toBe('Enter the weight');
    expect(bodyweightProblem(draft({ kg: 0 }), undefined)).toBe('More than 0 kg');
    expect(bodyweightProblem(draft({ kg: -1 }), undefined)).toBe('More than 0 kg');
    expect(bodyweightProblem(draft({ kg: Number.NaN }), undefined)).toBe('More than 0 kg');
    expect(bodyweightProblem(draft(), undefined)).toBeUndefined();
  });

  it('allows one decimal only for a new or changed kg', () => {
    expect(bodyweightProblem(draft({ kg: 80.25 }), undefined)).toBe('One decimal at most');
    const migrated = bodyweight({ date: '2030-03-01', kg: 80.25 });
    expect(bodyweightProblem(draft({ kg: 80.25, note: 'new note', date: '2030-03-02' }), migrated)).toBeUndefined();
    expect(bodyweightProblem(draft({ kg: 80.35 }), migrated)).toBe('One decimal at most');
    expect(bodyweightProblem(draft({ kg: 80.3 }), migrated)).toBeUndefined();
  });

  it('asks for a calendar date', () => {
    expect(bodyweightProblem(draft({ date: '' }), undefined)).toBe('Pick a date');
    expect(bodyweightProblem(draft({ date: '2030-02-30' }), undefined)).toBe('Pick a date');
  });
});

describe('bodyweightChanges', () => {
  const opened = bodyweight({ date: '2030-03-01', kg: 80.25, note: 'migrated' });

  it('is empty when nothing changed (a blank-padded note counts as the same)', () => {
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-01', note: ' migrated ' }, opened)).toEqual({});
    expect(bodyweightChanges({ kg: 80, date: '2030-03-01', note: '' }, bodyweight({ date: '2030-03-01', kg: 80 }))).toEqual({});
  });

  it('holds only the fields that differ from the values the sheet opened with', () => {
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-02', note: 'migrated' }, opened)).toEqual({ date: '2030-03-02' });
    expect(bodyweightChanges({ kg: 81, date: '2030-03-01', note: 'migrated' }, opened)).toEqual({ kg: 81 });
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-01', note: 'evening' }, opened)).toEqual({ note: 'evening' });
  });

  it('removes a cleared note with null', () => {
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-01', note: '  ' }, opened)).toEqual({ note: null });
  });
});
