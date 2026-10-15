import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatTime } from '../../format';
import { calendarSessionLine, calendarVm, reuseMonths, type CalendarDay, type CalendarMonth } from './calendar.vm';

const CATALOG = [
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }),
  exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs' }),
  exercise({ id: 'l-sit', name: 'L-sit', pattern: 'core', metric: 'seconds' }),
];

const on = (date: string, exerciseIds: string[], over: Partial<Session> = {}): Session =>
  session(exerciseIds.map((id, i) => block(ladder([5]), { exerciseId: id, order: i })), { date, ...over });

function month(vm: { months: CalendarMonth[] }, key: string): CalendarMonth {
  const m = vm.months.find((x) => x.key === key);
  if (m === undefined) throw new Error(`no month ${key}`);
  return m;
}

function day(m: CalendarMonth, date: string): CalendarDay {
  const d = m.weeks.flat().find((x) => x.date === date && x.inMonth);
  if (d === undefined) throw new Error(`no day ${date}`);
  return d;
}

describe('calendarVm grid', () => {
  it('builds Monday-first weeks of seven with leading and trailing days outside the month', () => {
    // March 2030: the 1st is a Friday, the 31st a Sunday.
    const vm = calendarVm([], CATALOG, '2030-03-15');
    const m = month(vm, '2030-03');
    expect(m.title).toBe('March 2030');
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
    expect(m.weeks).toHaveLength(5);
    const first = m.weeks[0] ?? [];
    expect(first.map((d) => d.date)).toEqual(['2030-02-25', '2030-02-26', '2030-02-27', '2030-02-28', '2030-03-01', '2030-03-02', '2030-03-03']);
    expect(first.map((d) => d.inMonth)).toEqual([false, false, false, false, true, true, true]);
    const last = m.weeks[4] ?? [];
    expect(last[6]).toMatchObject({ date: '2030-03-31', inMonth: true });
  });

  it('adds trailing days after the last of the month up to Sunday', () => {
    // April 2030: the 30th is a Tuesday.
    const vm = calendarVm([], CATALOG, '2030-04-10');
    const m = month(vm, '2030-04');
    const last = m.weeks[m.weeks.length - 1] ?? [];
    expect(last.map((d) => d.date)).toEqual(['2030-04-29', '2030-04-30', '2030-05-01', '2030-05-02', '2030-05-03', '2030-05-04', '2030-05-05']);
    expect(last.map((d) => d.inMonth)).toEqual([true, true, false, false, false, false, false]);
  });

  it('days outside the month carry no dots or sessions', () => {
    const s = on('2030-03-01', ['dips']);
    const vm = calendarVm([s, on('2030-02-10', ['dips'])], CATALOG, '2030-03-15');
    const feb = month(vm, '2030-02');
    const trailing = feb.weeks.flat().find((d) => d.date === '2030-03-01');
    expect(trailing).toMatchObject({ inMonth: false, dots: [], sessionIds: [], hollow: false });
    expect(day(month(vm, '2030-03'), '2030-03-01').sessionIds).toEqual([s.id]);
  });
});

describe('calendarVm dots', () => {
  it('colours a day by the chips of its sessions in the fixed order push pull legs other', () => {
    const a = on('2030-03-04', ['squats', 'pull-ups'], { startedAt: '2030-03-04T08:00:00.000Z' });
    const b = on('2030-03-04', ['dips'], { startedAt: '2030-03-04T18:00:00.000Z' });
    const vm = calendarVm([b, a], CATALOG, '2030-03-15');
    const d = day(month(vm, '2030-03'), '2030-03-04');
    expect(d.dots).toEqual(['push', 'pull', 'legs']);
    expect(d.sessionIds).toEqual([a.id, b.id]);
    expect(d.hollow).toBe(false);
  });

  it('shows at most three dots', () => {
    const s = on('2030-03-04', ['l-sit', 'squats', 'pull-ups', 'dips']);
    const d = day(month(calendarVm([s], CATALOG, '2030-03-15'), '2030-03'), '2030-03-04');
    expect(d.dots).toEqual(['push', 'pull', 'legs']);
  });

  it('counts an unknown exercise as other and gives a session without blocks no dot', () => {
    const s1 = on('2030-03-05', ['nope']);
    const s2 = on('2030-03-06', []);
    const m = month(calendarVm([s1, s2], CATALOG, '2030-03-15'), '2030-03');
    expect(day(m, '2030-03-05').dots).toEqual(['other']);
    expect(day(m, '2030-03-06')).toMatchObject({ dots: [], sessionIds: [s2.id] });
  });

  it('is hollow only when every session of the day has an uncertain date', () => {
    const u1 = on('2030-03-04', ['dips'], { dateUncertain: true });
    const u2 = on('2030-03-04', ['pull-ups'], { dateUncertain: true });
    const u3 = on('2030-03-05', ['dips'], { dateUncertain: true });
    const c3 = on('2030-03-05', ['dips']);
    const m = month(calendarVm([u1, u2, u3, c3], CATALOG, '2030-03-15'), '2030-03');
    expect(day(m, '2030-03-04').hollow).toBe(true);
    expect(day(m, '2030-03-05').hollow).toBe(false);
    expect(day(m, '2030-03-06').hollow).toBe(false);
  });

  it('ignores tombstoned sessions and blocks', () => {
    const gone = on('2030-03-04', ['dips'], { deletedAt: '2030-03-04T12:00:00.000Z' });
    const s = session(
      [
        block(ladder([5]), { exerciseId: 'dips', deletedAt: '2030-03-05T12:00:00.000Z' }),
        block(ladder([5]), { exerciseId: 'pull-ups', order: 1 }),
      ],
      { date: '2030-03-05' },
    );
    const vm = calendarVm([gone, s], CATALOG, '2030-03-15');
    const m = month(vm, '2030-03');
    expect(day(m, '2030-03-04')).toMatchObject({ dots: [], sessionIds: [] });
    expect(day(m, '2030-03-05').dots).toEqual(['pull']);
    expect(m.sessions).toBe(1);
  });
});

describe('calendarVm months', () => {
  it('lists months newest first from the current month back to the first live session', () => {
    const vm = calendarVm([on('2029-11-20', ['dips']), on('2030-01-02', ['dips'])], CATALOG, '2030-03-15');
    expect(vm.months.map((m) => m.key)).toEqual(['2030-03', '2030-02', '2030-01', '2029-12', '2029-11']);
    expect(vm.months.map((m) => m.title)).toEqual(['March 2030', 'February 2030', 'January 2030', 'December 2029', 'November 2029']);
  });

  it('shows the current month alone without sessions, and a tombstone does not extend the range', () => {
    expect(calendarVm([], CATALOG, '2030-03-15').months.map((m) => m.key)).toEqual(['2030-03']);
    const gone = on('2029-06-01', ['dips'], { deletedAt: '2029-06-01T12:00:00.000Z' });
    expect(calendarVm([gone], CATALOG, '2030-03-15').months.map((m) => m.key)).toEqual(['2030-03']);
  });

  it('starts at a later month when a session is dated after today', () => {
    const vm = calendarVm([on('2030-04-02', ['dips'])], CATALOG, '2030-03-15');
    expect(vm.months.map((m) => m.key)).toEqual(['2030-04', '2030-03']);
  });

  it('counts sessions and training days per month', () => {
    const vm = calendarVm(
      [on('2030-03-04', ['dips']), on('2030-03-04', ['pull-ups']), on('2030-03-09', ['dips']), on('2030-02-28', ['dips'])],
      CATALOG,
      '2030-03-15',
    );
    expect(month(vm, '2030-03')).toMatchObject({ sessions: 3, trainingDays: 2 });
    expect(month(vm, '2030-02')).toMatchObject({ sessions: 1, trainingDays: 1 });
  });
});

describe('reuseMonths (the page re-renders only the months whose grid changed)', () => {
  const before = [on('2030-01-10', ['dips']), on('2030-03-04', ['dips'])];

  it('keeps the previous object of every month whose content is the same', () => {
    const prev = calendarVm(before, CATALOG, '2030-03-15').months;
    const next = calendarVm([...before, on('2030-03-05', ['pull-ups'])], CATALOG, '2030-03-15').months;
    const out = reuseMonths(prev, next);
    expect(out.map((m) => m.key)).toEqual(['2030-03', '2030-02', '2030-01']);
    expect(out[0]).toBe(next[0]);
    expect(out[0]).not.toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
    expect(out[2]).toBe(prev[2]);
  });

  it('a change of a session id, a dot, the hollow mark or a count is a change', () => {
    const prev = calendarVm(before, CATALOG, '2030-03-15').months;
    const swapped = [on('2030-01-10', ['dips']), on('2030-03-04', ['dips'], { id: 'c0c0c0c0-0000-4000-8000-000000000001' })];
    expect(reuseMonths(prev, calendarVm(swapped, CATALOG, '2030-03-15').months)[0]).not.toBe(prev[0]);
    const pulled = [on('2030-01-10', ['dips']), { ...before[1] as Session, blocks: [block(ladder([5]), { exerciseId: 'pull-ups' })] }];
    expect(reuseMonths(prev, calendarVm(pulled, CATALOG, '2030-03-15').months)[0]).not.toBe(prev[0]);
    const uncertain = [on('2030-01-10', ['dips']), { ...before[1] as Session, dateUncertain: true as const }];
    expect(reuseMonths(prev, calendarVm(uncertain, CATALOG, '2030-03-15').months)[0]).not.toBe(prev[0]);
  });

  it('a new month is the new object; without a previous list everything is new', () => {
    const prev = calendarVm(before, CATALOG, '2030-03-15').months;
    const next = calendarVm(before, CATALOG, '2030-04-01').months;
    const out = reuseMonths(prev, next);
    expect(out[0]).toBe(next[0]);
    expect(out[1]).toBe(prev[0]);
    expect(reuseMonths([], next)).toEqual(next);
  });
});

describe('calendarSessionLine', () => {
  it('names the session by its label, else its day type, capitalised like the Days list, with the start time and an uncertain date', () => {
    const started = '2030-03-04T08:05:00.000Z';
    expect(calendarSessionLine(on('2030-03-04', ['dips', 'dips', 'pull-ups'], { label: 'mixed' }), CATALOG)).toBe('Mixed');
    expect(calendarSessionLine(on('2030-03-04', ['dips', 'dips', 'pull-ups'], { startedAt: started }), CATALOG)).toBe(`Push · ${formatTime(started)}`);
    expect(calendarSessionLine(on('2030-03-04', [], { dateUncertain: true }), CATALOG)).toBe('No exercises · date uncertain');
  });
});

describe('calendarVm streak', () => {
  // 2030-03-11 is a Monday; today Wednesday 2030-03-13.
  const TODAY = '2030-03-13';

  it('is 0 without sessions', () => {
    expect(calendarVm([], CATALOG, TODAY).streakWeeks).toBe(0);
  });

  it('counts consecutive weeks ending with the current week', () => {
    const vm = calendarVm([on('2030-03-11', ['dips']), on('2030-03-10', ['dips']), on('2030-02-25', ['dips'])], CATALOG, TODAY);
    expect(vm.streakWeeks).toBe(3);
  });

  it('starts from last week when the current week has no session yet', () => {
    const vm = calendarVm([on('2030-03-10', ['dips']), on('2030-03-04', ['dips']), on('2030-02-26', ['dips']), on('2030-02-19', ['dips'])], CATALOG, TODAY);
    expect(vm.streakWeeks).toBe(3);
  });

  it('a week without a session ends it', () => {
    const vm = calendarVm([on('2030-03-12', ['dips']), on('2030-03-05', ['dips']), on('2030-02-20', ['dips'])], CATALOG, TODAY);
    expect(vm.streakWeeks).toBe(2);
  });

  it('is 0 when neither this week nor last week has a session', () => {
    expect(calendarVm([on('2030-03-01', ['dips'])], CATALOG, TODAY).streakWeeks).toBe(0);
  });

  it('crosses a year boundary inside one ISO week (2030-12-30 … 2031-01-05)', () => {
    const vm = calendarVm([on('2031-01-05', ['dips']), on('2030-12-31', ['dips']), on('2030-12-25', ['dips'])], CATALOG, '2031-01-08');
    expect(vm.streakWeeks).toBe(2);
    const vm2 = calendarVm([on('2031-01-02', ['dips']), on('2030-12-24', ['dips'])], CATALOG, '2031-01-04');
    expect(vm2.streakWeeks).toBe(2);
  });

  it('ignores tombstoned sessions and sessions after today', () => {
    const gone = on('2030-03-12', ['dips'], { deletedAt: '2030-03-12T12:00:00.000Z' });
    expect(calendarVm([gone], CATALOG, TODAY).streakWeeks).toBe(0);
    expect(calendarVm([on('2030-03-20', ['dips'])], CATALOG, TODAY).streakWeeks).toBe(0);
  });
});
