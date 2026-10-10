import { describe, expect, it } from 'vitest';
import { block, exercise, session } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { startPickerVm } from './start-picker.vm';

const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const LEGS = exercise({ id: 'squats', name: 'Squats', pattern: 'legs' });
const CATALOG: ReadonlyMap<string, Exercise> = new Map([PUSH, PULL, DIPS, LEGS].map((e) => [e.id, e]));

const day = (date: string, ...exerciseIds: string[]): Session =>
  session(exerciseIds.map((id, i) => block([], { exerciseId: id, order: i })), { date });

describe('startPickerVm', () => {
  it('lists recent sessions newest first with the proposal moved to the top and marked', () => {
    // push 03-01, pull 03-03, legs 03-05: the rotation proposes push (oldest of the latest per type).
    const push = day('2030-03-01', 'push-ups');
    const pull = day('2030-03-03', 'pull-ups');
    const legs = day('2030-03-05', 'squats');
    const vm = startPickerVm([push, pull, legs], CATALOG, undefined);
    expect(vm.rows.map((r) => r.sessionId)).toEqual([push.id, legs.id, pull.id]);
    expect(vm.rows.map((r) => r.proposed)).toEqual([true, false, false]);
    expect(vm.hasNone).toBe(true);
  });

  it('formats the title, keeps the label and joins de-duplicated exercise names in block order', () => {
    const s = session(
      [
        block([], { exerciseId: 'dips-bar', order: 0 }),
        block([], { exerciseId: 'push-ups', order: 1 }),
        block([], { exerciseId: 'dips-bar', order: 2 }),
      ],
      { date: '2030-03-07', label: 'push' },
    );
    const [row] = startPickerVm([s], CATALOG, undefined).rows;
    expect(row).toEqual({ sessionId: s.id, title: 'Thu 07 Mar', label: 'push', exercises: 'Dips (Bar) · Push-ups', proposed: true });
  });

  it('shows the raw id for an exercise missing from the catalog and no label when none is set', () => {
    const s = day('2030-03-07', 'muscle-ups');
    const [row] = startPickerVm([s], CATALOG, undefined).rows;
    expect(row?.exercises).toBe('muscle-ups');
    expect(row?.label).toBeUndefined();
  });

  it('shows at most ten recent sessions', () => {
    const sessions = Array.from({ length: 14 }, (_, i) => day(`2030-03-${String(i + 1).padStart(2, '0')}`, 'push-ups'));
    const vm = startPickerVm(sessions, CATALOG, undefined);
    // The proposal (the latest push day) is among the ten, so there are exactly ten rows.
    expect(vm.rows).toHaveLength(10);
    expect(vm.rows[0]?.sessionId).toBe(sessions[13]?.id);
    expect(vm.rows[9]?.sessionId).toBe(sessions[4]?.id);
  });

  it('puts a proposal older than the ten recent sessions on top, above the ten', () => {
    const legs = day('2030-02-01', 'squats');
    const push = Array.from({ length: 10 }, (_, i) => day(`2030-03-${String(i + 1).padStart(2, '0')}`, 'push-ups'));
    const vm = startPickerVm([legs, ...push], CATALOG, undefined);
    expect(vm.rows).toHaveLength(11);
    expect(vm.rows[0]).toMatchObject({ sessionId: legs.id, proposed: true });
  });

  it('leaves out the excluded session, also as a proposal', () => {
    const push = day('2030-03-01', 'push-ups');
    const pull = day('2030-03-03', 'pull-ups');
    const vm = startPickerVm([push, pull], CATALOG, push.id);
    expect(vm.rows.map((r) => r.sessionId)).toEqual([pull.id]);
    expect(vm.rows[0]?.proposed).toBe(true);
  });

  it('marks nothing when no session has a day type', () => {
    const empty = day('2030-03-01');
    const vm = startPickerVm([empty], CATALOG, undefined);
    expect(vm.rows).toEqual([{ sessionId: empty.id, title: 'Fri 01 Mar', label: undefined, exercises: '', proposed: false }]);
  });
});
