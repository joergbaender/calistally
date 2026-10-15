import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import { formatDay } from '../../format';
import { exercisesVm } from './exercises.vm';

const pullUps = exercise({ id: 'pull-ups', name: 'Pull-ups', family: 'Pull-up' });
const chinUps = exercise({ id: 'chin-ups', name: 'Chin-ups', family: 'Pull-up' });
const dips = exercise({ id: 'dips', name: 'Dips', pattern: 'push' });
const rows = exercise({ id: 'rows', name: 'Rows', archived: true });
const gone = exercise({ id: 'gone', name: 'Gone', deletedAt: '2030-01-02T10:00:00.000Z' });
const TODAY = '2030-03-10';

describe('exercisesVm', () => {
  it('groups live entries by family (the name when none), sorted by family then name', () => {
    const vm = exercisesVm([pullUps, dips, chinUps], [], TODAY);
    expect(vm.live.map((g) => g.family)).toEqual(['Dips', 'Pull-up']);
    expect(vm.live[1]?.rows.map((r) => r.name)).toEqual(['Chin-ups', 'Pull-ups']);
    expect(vm.archived).toEqual([]);
  });

  it('puts archived entries in their own groups and omits tombstoned ones', () => {
    const vm = exercisesVm([pullUps, rows, gone], [], TODAY);
    expect(vm.live.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['pull-ups']);
    expect(vm.archived).toEqual([{ family: 'Rows', rows: [{ id: 'rows', name: 'Rows', lastDate: undefined }] }]);
  });

  it('shows the date of the latest live block, ignoring tombstoned sessions and blocks', () => {
    const sessions = [
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-01' }),
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-05' }),
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-09', deletedAt: '2030-03-09T12:00:00.000Z' }),
      session([block(ladder([5]), { exerciseId: 'pull-ups', deletedAt: '2030-03-08T12:00:00.000Z' })], { date: '2030-03-08' }),
      session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-03-07' }),
    ];
    const vm = exercisesVm([pullUps, dips, chinUps], sessions, TODAY);
    const byId = new Map(vm.live.flatMap((g) => g.rows).map((r) => [r.id, r]));
    expect(byId.get('pull-ups')?.lastDate).toBe(formatDay('2030-03-05'));
    expect(byId.get('dips')?.lastDate).toBe(formatDay('2030-03-07'));
    expect(byId.get('chin-ups')?.lastDate).toBeUndefined();
  });

  it('adds the year to a last date outside the current year, so an old one does not look recent', () => {
    const sessions = [
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2029-03-05' }),
      session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-01-07' }),
    ];
    const vm = exercisesVm([pullUps, dips], sessions, TODAY);
    const byId = new Map(vm.live.flatMap((g) => g.rows).map((r) => [r.id, r]));
    expect(byId.get('pull-ups')?.lastDate).toBe(`${formatDay('2029-03-05')} 2029`);
    expect(byId.get('dips')?.lastDate).toBe(formatDay('2030-01-07'));
  });
});
