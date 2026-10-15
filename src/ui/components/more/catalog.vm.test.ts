import { describe, expect, it } from 'vitest';
import { T0, block, exercise, session, set } from '../../../model/test-fixtures';
import type { FileRow } from '../../../sync/store';
import { EXERCISES_PATH } from '../../../sync/paths';
import { catalogRefusedReason, catalogVm, exerciseFormVm } from './catalog.vm';

const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const CHIN = exercise({ id: 'chin-ups', name: 'Chin-ups', pattern: 'pull', family: 'pull-up' });
const LUNGE = exercise({ id: 'lunges', name: 'Lunges', pattern: 'legs', perSide: true, defaultLoadType: 'external' });
const PLANK = exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds', family: 'core' });
const OLD = exercise({ id: 'kipping', name: 'Kipping', archived: true, family: 'pull-up' });
const AARDVARK = exercise({ id: 'aardvark', name: 'Aardvark', archived: true });
const GONE = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: T0 });

describe('catalogVm', () => {
  it('groups live entries by family (the name when none), sorted, with archived entries apart by name and tombstones left out', () => {
    const vm = catalogVm([PULL, LUNGE, OLD, PLANK, CHIN, GONE, AARDVARK], undefined);
    expect(vm.live.map((g) => [g.family, g.rows.map((r) => r.id)])).toEqual([
      ['core', ['plank']],
      ['Lunges', ['lunges']],
      ['pull-up', ['chin-ups', 'pull-ups']],
    ]);
    expect(vm.archived.map((r) => r.id)).toEqual(['aardvark', 'kipping']);
    expect(vm.readOnly).toBeUndefined();
  });

  it('meta reads pattern · metric · per side (only when true) · default load type', () => {
    const vm = catalogVm([PULL, LUNGE, PLANK], undefined);
    const rows = vm.live.flatMap((g) => g.rows);
    expect(rows.find((r) => r.id === 'pull-ups')).toEqual({ id: 'pull-ups', name: 'Pull-ups', meta: 'pull · reps · bodyweight' });
    expect(rows.find((r) => r.id === 'lunges')?.meta).toBe('legs · reps · per side · external');
    expect(rows.find((r) => r.id === 'plank')?.meta).toBe('core · seconds · bodyweight');
  });

  it('is read-only with the reason when the catalog row is refused, and when it is missing', () => {
    const refused = catalogVm(undefined, 'quarantined');
    expect(refused).toEqual({ live: [], archived: [], readOnly: 'exercises.json is quarantined; the catalog cannot be changed here. See the Sync tab.' });
    const missing = catalogVm(undefined, undefined);
    expect(missing.readOnly).toBe('The exercise catalog is not here yet; it arrives with the first sync.');
  });
});

describe('exerciseFormVm', () => {
  it('holds the editable fields as text, metric and per side locked', () => {
    const withCues = exercise({ ...LUNGE, cues: 'knee over toe' });
    expect(exerciseFormVm(withCues, [])).toEqual({
      name: 'Lunges', family: '', pattern: 'legs', defaultLoadType: 'external', cues: 'knee over toe',
      metric: 'reps', perSide: true, locked: true, archived: false, canDelete: true, deleteReason: undefined,
    });
    expect(exerciseFormVm(PULL, [])).toMatchObject({ family: 'pull-up', cues: '' });
  });

  it('cannot delete an entry used by live blocks of live sessions, and says in how many sessions', () => {
    const one = session([block([set()], { exerciseId: 'pull-ups' }), block([set()], { exerciseId: 'pull-ups' })]);
    const two = session([block([set()], { exerciseId: 'pull-ups' })]);
    const deleted = session([block([set()], { exerciseId: 'pull-ups' })], { deletedAt: T0 });
    expect(exerciseFormVm(PULL, [one, two, deleted])).toMatchObject({ canDelete: false, deleteReason: 'used in 2 sessions; archive instead' });
    expect(exerciseFormVm(PULL, [one])).toMatchObject({ canDelete: false, deleteReason: 'used in 1 session; archive instead' });
    const deadBlock = session([block([set()], { exerciseId: 'pull-ups', deletedAt: T0 })]);
    expect(exerciseFormVm(PULL, [deadBlock, deleted])).toMatchObject({ canDelete: true, deleteReason: undefined });
  });

  it('carries the archived state', () => {
    expect(exerciseFormVm(OLD, []).archived).toBe(true);
  });
});

describe('catalogRefusedReason', () => {
  const row = (over: Partial<FileRow>): FileRow => ({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: {}, status: 'ok', issues: [], version: 1, ...over });

  it('names the status of the refused catalog row, a duplicate as such, and nothing for other rows', () => {
    expect(catalogRefusedReason([row({ status: 'quarantined' })])).toBe('quarantined');
    expect(catalogRefusedReason([row({ status: 'needs-update' })])).toBe('needs-update');
    expect(catalogRefusedReason([row({ duplicateOf: '/other.json' })])).toBe('a duplicate');
    expect(catalogRefusedReason([row({ path: '/bodyweight.json', kind: 'bodyweight', status: 'quarantined' })])).toBeUndefined();
    expect(catalogRefusedReason([])).toBeUndefined();
  });
});
