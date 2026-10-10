import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { formatAmount, formatDayLong, formatLoad, formatLoadShort } from '../../format';
import { notesChanged, readOnlyReason, sessionPageVm } from './session-page.vm';

const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push', archived: true });
const catalogOf = (...xs: Exercise[]): Map<string, Exercise> => new Map(xs.map((x) => [x.id, x]));
const CATALOG = catalogOf(PULL, DIPS);

const vmOf = (s: Session, all: Session[] = [s], readOnlyReasonText?: string) =>
  sessionPageVm({ session: s, allSessions: all, catalog: CATALOG, readOnlyReason: readOnlyReasonText });

describe('sessionPageVm: header', () => {
  it('title, label, tags, notes, flags', () => {
    const s = session([], { date: '2030-03-07', label: 'pull', tags: ['deload'], notes: 'raw row', dateUncertain: true, source: 'migrated' });
    const vm = vmOf(s);
    expect(vm).toMatchObject({
      title: formatDayLong('2030-03-07'),
      uncertain: true,
      label: 'Pull',
      tags: ['deload'],
      notes: 'raw row',
      migrated: true,
      readOnly: undefined,
      deleted: false,
      blocks: [],
    });
  });

  it('an app session without extras', () => {
    const vm = vmOf(session([], { date: '2030-03-07' }));
    expect(vm).toMatchObject({ uncertain: false, label: undefined, notes: undefined, migrated: false, deleted: false });
  });

  it('read-only reason and deleted', () => {
    const s = session([], { deletedAt: '2030-03-08T10:00:00.000Z' });
    const vm = vmOf(s, [], 'Quarantined');
    expect(vm.readOnly).toEqual({ reason: 'Quarantined' });
    expect(vm.deleted).toBe(true);
  });
});

describe('sessionPageVm: blocks and sets', () => {
  it('blocks in canonical order with names, archived and unknown marks, move flags', () => {
    const s = session([
      block(ladder([5]), { exerciseId: 'mystery', order: 2 }),
      block(ladder([8]), { exerciseId: 'dips-bar', order: 1 }),
      block(ladder([10]), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([3]), { exerciseId: 'pull-ups', order: 3, deletedAt: '2030-03-07T11:00:00.000Z' }),
    ]);
    const blocks = vmOf(s).blocks;
    expect(blocks.map((b) => [b.name, b.archived, b.unknownExercise, b.canMoveUp, b.canMoveDown])).toEqual([
      ['Pull-ups', false, false, false, true],
      ['Dips (Bar)', true, false, true, true],
      ['mystery', false, true, true, false],
    ]);
  });

  it('set rows: amount, load only where it differs from the first set, note, rest, completedAt', () => {
    const s = session([
      block(
        [
          set({ order: 0, reps: 8, loadType: 'added', loadKg: 10 }),
          set({ order: 1, reps: 7.5, loadType: 'added', loadKg: 10, note: 'slow', restSec: 120 }),
          set({ order: 2, reps: 6, loadType: 'added', loadKg: 5, completedAt: '2030-03-07T10:10:00.000Z' }),
          set({ order: 3, reps: 99, deletedAt: '2030-03-07T11:00:00.000Z' }),
        ],
        { exerciseId: 'pull-ups' },
      ),
    ]);
    const rows = vmOf(s).blocks[0]?.sets ?? [];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.amount)).toEqual([formatAmount(8), formatAmount(7.5), formatAmount(6)]);
    expect(rows.map((r) => r.load)).toEqual([undefined, undefined, formatLoadShort('added', 5)]);
    expect(rows[1]).toMatchObject({
      note: 'slow',
      rest: `rest ${formatAmount(120)} s`,
      restLabel: `stated rest ${formatAmount(120)} s`,
      aggregate: false,
      completedAt: undefined,
    });
    expect(rows[0]).toMatchObject({ note: undefined, rest: undefined, restLabel: undefined });
    expect(rows[2]?.completedAt).toBe('2030-03-07T10:10:00.000Z');
    expect(vmOf(s).blocks[0]?.load).toBe(formatLoad('added', 10));
  });

  it('a plain bodyweight block shows no block load', () => {
    const s = session([block(ladder([8, 9]), { exerciseId: 'pull-ups' })]);
    expect(vmOf(s).blocks[0]?.load).toBeUndefined();
  });

  it('interval labels from setIntervals', () => {
    const s = session([
      block(
        [
          set({ order: 0, reps: 8, completedAt: '2030-03-07T10:00:00.000Z' }),
          set({ order: 1, reps: 8, completedAt: '2030-03-07T10:01:02.000Z' }),
          set({ order: 2, reps: 8 }),
        ],
        { exerciseId: 'pull-ups' },
      ),
    ]);
    expect(vmOf(s).blocks[0]?.sets.map((r) => r.interval)).toEqual([undefined, '+1:02', undefined]);
    // Read aloud as an interval, never as rest (spec 4 §5).
    expect(vmOf(s).blocks[0]?.sets.map((r) => r.intervalLabel)).toEqual([undefined, 'interval 1:02 since the previous set', undefined]);
  });

  it('totals text', () => {
    const s = session([block(ladder([8, 7, 6]), { exerciseId: 'pull-ups' }), block(ladder([10]), { exerciseId: 'dips-bar', order: 1 })]);
    expect(vmOf(s).blocks.map((b) => b.totals)).toEqual([`${formatAmount(21)} · 3 sets`, `${formatAmount(10)} · 1 set`]);
  });

  it('a migrated aggregate set: aggregate flag and "<n> total, set count unknown"', () => {
    const s = session([block([set({ reps: 100, aggregate: true })], { exerciseId: 'pull-ups' })], { source: 'migrated' });
    const b = vmOf(s).blocks[0];
    expect(b?.sets[0]?.aggregate).toBe(true);
    expect(b?.totals).toBe(`${formatAmount(100)} total, set count unknown`);
    expect(b?.noteOnly).toBe(false);
  });

  it('a note-only block', () => {
    const s = session([block([], { exerciseId: 'pull-ups', note: '3x max' }), block([], { exerciseId: 'dips-bar', order: 1 })], { source: 'migrated' });
    const [noteOnly, empty] = vmOf(s).blocks;
    expect(noteOnly).toMatchObject({ noteOnly: true, note: '3x max', sets: [] });
    expect(empty).toMatchObject({ noteOnly: false, note: undefined });
  });

  it('block marks and the exercise mark against earlier sessions', () => {
    const before = session([block(ladder([8, 8]), { exerciseId: 'pull-ups' })], { date: '2030-03-04' });
    const today = session([block(ladder([9, 8]), { exerciseId: 'pull-ups' })], { date: '2030-03-07' });
    const b = vmOf(today, [before, today]).blocks[0];
    expect(b?.marks).toEqual({ amount: 'up', load: 'hidden' });
    expect(b?.exerciseMark).toBe('up');
    const first = vmOf(before, [before, today]).blocks[0];
    expect(first?.marks).toEqual({ amount: 'none', load: 'none' });
    expect(first?.exerciseMark).toBe('none');
  });
});

describe('refused rows', () => {
  const row = (over: Partial<FileRow>): FileRow => ({
    path: 'sessions/2030/2030-03-07-x.json', kind: 'session', rev: 'r1', content: {}, status: 'ok', issues: [], version: 1, ...over,
  });

  it('readOnlyReason names the reason', () => {
    expect(readOnlyReason(row({ status: 'read-only' }))).toMatch(/newer app/);
    expect(readOnlyReason(row({ status: 'needs-update' }))).toMatch(/newer app/);
    expect(readOnlyReason(row({ status: 'quarantined' }))).toMatch(/Quarantined/);
    expect(readOnlyReason(row({ duplicateOf: 'sessions/2030/other.json' }))).toMatch(/Duplicate/);
  });
});

describe('notesChanged', () => {
  it('compares after the normalisation setSessionFields applies (trim, blank is none)', () => {
    expect(notesChanged('  raw row\n', '  raw row\n')).toBe(false);
    expect(notesChanged('  raw row\n', 'raw row')).toBe(false);
    expect(notesChanged(undefined, '   ')).toBe(false);
    expect(notesChanged(undefined, '')).toBe(false);
    expect(notesChanged('old', 'new')).toBe(true);
    expect(notesChanged('old', '  ')).toBe(true);
    expect(notesChanged(undefined, 'n')).toBe(true);
  });
});
