import { describe, expect, it } from 'vitest';
import { exercise } from '../../../model/test-fixtures';
import { exerciseSearchVm } from './exercise-search.vm';

const CATALOG = [
  exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push', family: 'push-up' }),
  exercise({ id: 'diamond-push-ups', name: 'Diamond Push-ups', pattern: 'push', family: 'push-up' }),
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' }),
  exercise({ id: 'chin-ups', name: 'Chin-ups', pattern: 'pull', family: 'pull-up' }),
  exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }),
  exercise({ id: 'old-push-ups', name: 'Old Push-ups', pattern: 'push', family: 'push-up', archived: true }),
  exercise({ id: 'gone-push-ups', name: 'Gone Push-ups', pattern: 'push', deletedAt: '2030-01-02T10:00:00.000Z' }),
];

const ids = (list: { id: string }[]): string[] => list.map((e) => e.id);

describe('exerciseSearchVm', () => {
  it('an empty query lists every live entry, by family then name, families without a name last', () => {
    const vm = exerciseSearchVm(CATALOG, '');
    expect(ids(vm.live)).toEqual(['chin-ups', 'pull-ups', 'diamond-push-ups', 'push-ups', 'dips-bar']);
    expect(ids(vm.archived)).toEqual(['old-push-ups']);
    expect(vm.canCreate).toBe(false);
  });

  it('filters by name, case-insensitively; tombstones never show', () => {
    const vm = exerciseSearchVm(CATALOG, 'PUSH');
    expect(ids(vm.live)).toEqual(['diamond-push-ups', 'push-ups']);
    expect(ids(vm.archived)).toEqual(['old-push-ups']);
  });

  it('offers Create when no entry has the typed name', () => {
    expect(exerciseSearchVm(CATALOG, 'Ring Rows').canCreate).toBe(true);
    expect(exerciseSearchVm(CATALOG, '  ').canCreate).toBe(false);
    expect(exerciseSearchVm(CATALOG, 'push').canCreate).toBe(true);
  });

  it('no Create for the exact name of a live entry', () => {
    expect(exerciseSearchVm(CATALOG, ' push-UPS ').canCreate).toBe(false);
  });

  it('Create for the exact name of an archived or deleted entry (createExercise unarchives or undeletes it)', () => {
    expect(exerciseSearchVm(CATALOG, 'Old Push-ups').canCreate).toBe(true);
    expect(exerciseSearchVm(CATALOG, ' gone  PUSH-UPS ').canCreate).toBe(true);
  });

  it('trims and collapses spaces in the query', () => {
    expect(ids(exerciseSearchVm(CATALOG, '  diamond   push ').live)).toEqual(['diamond-push-ups']);
  });
});
