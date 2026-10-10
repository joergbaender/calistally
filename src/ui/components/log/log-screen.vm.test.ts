import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Block, Exercise, Session } from '../../../model/types';
import { formatAmount, formatTime } from '../../format';
import { logScreenVm, resolveReference } from './log-screen.vm';

const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push', defaultLoadType: 'added' });
const DIAMOND = exercise({ id: 'diamond-push-ups', name: 'Diamond Push-ups', pattern: 'push', archived: true });
const PLANK = exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds' });
const CATALOG: ReadonlyMap<string, Exercise> = new Map([PUSH, DIPS, DIAMOND, PLANK].map((e) => [e.id, e]));

const STARTED = '2030-03-07T10:00:00.000Z';
const NOW = new Date('2030-03-07T10:30:00.000Z');

/** Sets with completedAt one minute apart from `from`. */
function timed(reps: number[], from: string, over: Parameters<typeof ladder>[1] = {}) {
  const t0 = Date.parse(from);
  return ladder(reps, over).map((s, i) => ({ ...s, completedAt: new Date(t0 + i * 60000).toISOString() }));
}

function fixture() {
  const refDips = block(ladder([8, 8, 8], { loadType: 'added', loadKg: 11.5 }), { exerciseId: 'dips-bar', order: 0 });
  const refPush = block(ladder([17, 16, 15, 14, 13, 12]), { exerciseId: 'push-ups', order: 1 });
  const refDiamond = block(ladder([20, 20]), { exerciseId: 'diamond-push-ups', order: 2 });
  const reference = session([refDips, refPush, refDiamond], { date: '2030-02-28' });
  const todayDips = block(timed([8, 8, 8], '2030-03-07T10:01:00.000Z', { loadType: 'added', loadKg: 12 }), { exerciseId: 'dips-bar', order: 0 });
  const todayPush = block(timed([17, 16, 15, 14], '2030-03-07T10:10:00.000Z'), { exerciseId: 'push-ups', order: 1 });
  const today = session([todayDips, todayPush], { date: '2030-03-07', startedAt: STARTED });
  return { reference, today, refDips, refPush, refDiamond, todayDips, todayPush };
}

const vmOf = (today: Session, reference: Session | undefined, over: { currentBlockId?: string; now?: Date; online?: boolean } = {}) =>
  logScreenVm({ today, reference, catalog: CATALOG, currentBlockId: over.currentBlockId, now: over.now ?? NOW, online: over.online ?? true });

describe('logScreenVm header', () => {
  it('shows the long date, the start time and the reference day', () => {
    const { today, reference } = fixture();
    expect(vmOf(today, reference).header).toEqual({ date: 'Thu 2030-03-07', startedAt: formatTime(STARTED), reference: 'vs Thu 28 Feb', offline: false });
  });

  it('has no reference text without a reference and flags offline', () => {
    const { today } = fixture();
    const header = vmOf(today, undefined, { online: false }).header;
    expect(header.reference).toBeUndefined();
    expect(header.offline).toBe(true);
  });
});

describe('logScreenVm cards', () => {
  it('pairs reference and today blocks: finished, current, not-started', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference);
    expect(vm.cards.map((c) => [c.key, c.exerciseId, c.state, c.todayBlockId, c.referenceBlockId])).toEqual([
      [f.refDips.id, 'dips-bar', 'finished', f.todayDips.id, f.refDips.id],
      [f.refPush.id, 'push-ups', 'current', f.todayPush.id, f.refPush.id],
      [f.refDiamond.id, 'diamond-push-ups', 'not-started', undefined, f.refDiamond.id],
    ]);
    const diamond = vm.cards[2];
    expect(diamond?.name).toBe('Diamond Push-ups');
    expect(diamond?.archived).toBe(true);
    expect(diamond?.todaySets).toEqual([]);
    expect(diamond?.referenceSets.map((s) => s.id)).toEqual(f.refDiamond.sets.map((s) => s.id));
    expect(diamond?.totals).toBeUndefined();
    expect(diamond?.proposed).toBeUndefined();
  });

  it('appends today-only blocks keyed by their own id; without a reference only today cards', () => {
    const f = fixture();
    const extra = block([set({ reps: 5, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'muscle-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [...f.today.blocks, extra] };
    const withRef = vmOf(today, f.reference);
    const last = withRef.cards[3];
    expect(last).toMatchObject({ key: extra.id, exerciseId: 'muscle-ups', name: 'muscle-ups', archived: false, metric: 'reps', referenceBlockId: undefined, state: 'current' });
    const noRef = vmOf(today, undefined);
    expect(noRef.cards.map((c) => c.key)).toEqual([f.todayDips.id, f.todayPush.id, extra.id]);
  });

  it('makes the named block current when it is a live block of today', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id });
    expect(vm.cards.map((c) => c.state)).toEqual(['current', 'finished', 'not-started']);
    expect(vm.current?.blockId).toBe(f.todayDips.id);
  });

  it('falls back to the last live block when currentBlockId is unknown or deleted', () => {
    const f = fixture();
    expect(vmOf(f.today, f.reference, { currentBlockId: 'nope' }).current?.blockId).toBe(f.todayPush.id);
    const deleted: Block = { ...f.todayDips, deletedAt: '2030-03-07T10:05:00.000Z' };
    const today: Session = { ...f.today, blocks: [deleted, f.todayPush] };
    const vm = vmOf(today, f.reference, { currentBlockId: deleted.id });
    expect(vm.current?.blockId).toBe(f.todayPush.id);
    expect(vm.cards[0]?.state).toBe('not-started');
  });

  it('has no current card in an empty session', () => {
    const f = fixture();
    const today: Session = { ...f.today, blocks: [] };
    const vm = vmOf(today, f.reference);
    expect(vm.current).toBeUndefined();
    expect(vm.cards.every((c) => c.state === 'not-started')).toBe(true);
  });

  it('proposes the reference set at the next position and marks it in the reference chips', () => {
    const f = fixture();
    const push = vmOf(f.today, f.reference).cards[1];
    expect(push?.proposed).toBe(13);
    expect(push?.markIndex).toBe(4);
  });

  it('proposes today’s last set without a mark once the reference runs out', () => {
    const f = fixture();
    const dips = vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id }).cards[0];
    expect(dips?.proposed).toBe(8);
    expect(dips?.markIndex).toBeUndefined();
  });

  it('a migrated aggregate set at the next position is neither proposed nor marked', () => {
    const refPush = block([set({ reps: 100, aggregate: true, order: 0 })], { exerciseId: 'push-ups' });
    const reference = session([refPush], { date: '2030-02-28', source: 'migrated' });
    const todayPush = block([], { exerciseId: 'push-ups' });
    const today = session([todayPush], { date: '2030-03-07', startedAt: STARTED });
    const push = vmOf(today, reference).cards[0];
    expect(push?.state).toBe('current');
    expect(push?.proposed).toBeUndefined();
    expect(push?.markIndex).toBeUndefined();
  });

  it('gives proposed and markIndex only to the current card', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id });
    expect(vm.cards[1]?.proposed).toBeUndefined();
    expect(vm.cards[1]?.markIndex).toBeUndefined();
  });

  it('writes the totals text for today and last time', () => {
    const f = fixture();
    const push = vmOf(f.today, f.reference).cards[1];
    expect(push?.totals).toEqual({ today: `today ${formatAmount(62)} · 4 sets`, reference: `last ${formatAmount(87)} · 6 sets` });
  });

  it('says 1 set and leaves the reference text empty without a reference block', () => {
    const f = fixture();
    const extra = block([set({ reps: 5, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'push-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [...f.today.blocks, extra] };
    const card = vmOf(today, f.reference).cards[3];
    expect(card?.totals).toEqual({ today: 'today 5 · 1 set', reference: '' });
  });

  it('compares only finished cards that have both blocks', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference);
    // Dips: 24 = 24 reps, load +12 vs +11.5 kg.
    expect(vm.cards[0]?.marks).toEqual({ amount: 'same', load: 'up' });
    expect(vm.cards[1]?.marks).toBeUndefined(); // current
    expect(vm.cards[2]?.marks).toBeUndefined(); // not started
    const extra = block([set({ reps: 5, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'push-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [...f.today.blocks, extra] };
    const onlyToday = vmOf(today, f.reference, { currentBlockId: f.todayDips.id }).cards[3];
    expect(onlyToday?.state).toBe('finished');
    expect(onlyToday?.marks).toBeUndefined();
  });

  it('takes the load text from today’s last set, else the reference, else the exercise default', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference);
    expect(vm.cards[0]?.loadText).toBe(`+${formatAmount(12)} kg`);
    expect(vm.cards[2]?.loadText).toBe('bodyweight');
    const refDips = block(ladder([8], { loadType: 'added', loadKg: 11.5 }), { exerciseId: 'dips-bar' });
    const notStarted = vmOf({ ...f.today, blocks: [] }, session([refDips], { date: '2030-02-28' })).cards[0];
    expect(notStarted?.loadText).toBe(`+${formatAmount(11.5)} kg`);
    const fresh = block([], { exerciseId: 'dips-bar' });
    const own = vmOf({ ...f.today, blocks: [fresh] }, undefined).cards[0];
    expect(own?.loadText).toBe(`+${formatAmount(0)} kg`);
  });

  it('carries the block note of today’s block', () => {
    const f = fixture();
    const today: Session = { ...f.today, blocks: [f.todayDips, { ...f.todayPush, note: 'slow eccentrics' }] };
    expect(vmOf(today, f.reference).cards[1]?.blockNote).toBe('slow eccentrics');
    expect(vmOf(today, f.reference).cards[0]?.blockNote).toBeUndefined();
  });

  it('leaves out deleted sets and orders sets canonically', () => {
    const f = fixture();
    const sets = [set({ reps: 3, order: 2 }), set({ reps: 9, order: 1, deletedAt: '2030-03-07T10:02:00.000Z' }), set({ reps: 1, order: 0 })];
    const b = block(sets, { exerciseId: 'push-ups' });
    const card = vmOf({ ...f.today, blocks: [b] }, undefined).cards[0];
    expect(card?.todaySets.map((s) => 'reps' in s && s.reps)).toEqual([1, 3]);
  });
});

describe('logScreenVm counter and current', () => {
  it('counts from the latest completedAt; undefined before the first set', () => {
    const f = fixture();
    // The last push-up set completed at 10:13; now 10:30 → 17:00.
    expect(vmOf(f.today, f.reference).counter).toBe('17:00');
    expect(vmOf(f.today, f.reference, { now: new Date('2030-03-07T10:13:48.000Z') }).counter).toBe('0:48');
    expect(vmOf({ ...f.today, blocks: [block([], { exerciseId: 'push-ups' })] }, undefined).counter).toBeUndefined();
  });

  it('builds the entry data from the current card', () => {
    const f = fixture();
    expect(vmOf(f.today, f.reference).current).toEqual({
      blockId: f.todayPush.id,
      exerciseId: 'push-ups',
      name: 'Push-ups',
      metric: 'reps',
      setNumber: 5,
      proposed: 13,
      step: 1,
      load: { loadType: 'bodyweight', loadKg: 0, needsKg: false },
      loadText: 'bodyweight',
    });
  });

  it('steps by 5 for a timed exercise and asks for kg on a weighted default', () => {
    const f = fixture();
    const plank = block([timedSet({ seconds: 60, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'plank' });
    const current = vmOf({ ...f.today, blocks: [plank] }, undefined).current;
    expect(current).toMatchObject({ metric: 'seconds', step: 5, setNumber: 2, proposed: 60 });
    const dips = block([], { exerciseId: 'dips-bar' });
    expect(vmOf({ ...f.today, blocks: [dips] }, undefined).current?.load).toEqual({ loadType: 'added', loadKg: 0, needsKg: true });
  });
});

describe('resolveReference', () => {
  const catalog = [...CATALOG.values()];
  const pushOld = session([block([], { exerciseId: 'push-ups' })], { date: '2030-03-01' });
  const pushNew = session([block([], { exerciseId: 'push-ups' })], { date: '2030-03-05' });
  const today = session([], { date: '2030-03-07', startedAt: STARTED });
  const all = [pushOld, pushNew, today];

  it('uses the stored choice when it names a live session', () => {
    expect(resolveReference(pushOld.id, all, catalog, today.id)?.id).toBe(pushOld.id);
  });

  it('has no reference for none', () => {
    expect(resolveReference('none', all, catalog, today.id)).toBeUndefined();
  });

  it('re-proposes when the choice is missing, unknown (deleted) or today itself', () => {
    expect(resolveReference(undefined, all, catalog, today.id)?.id).toBe(pushNew.id);
    expect(resolveReference('gone', all, catalog, today.id)?.id).toBe(pushNew.id);
    expect(resolveReference(today.id, all, catalog, today.id)?.id).toBe(pushNew.id);
  });
});
