import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Block, Exercise, Session } from '../../../model/types';
import { formatAmount, formatTime } from '../../format';
import { logScreenVm, readRestStop, resolveReference, tapRestStop, type RestStop } from './log-screen.vm';

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

const vmOf = (today: Session, reference: Session | undefined, over: { currentBlockId?: string; now?: Date; online?: boolean; restStop?: RestStop | undefined } = {}) =>
  logScreenVm({ today, reference, catalog: CATALOG, currentBlockId: over.currentBlockId, now: over.now ?? NOW, online: over.online ?? true, restStop: over.restStop });

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
    expect(vmOf(f.today, f.reference).counter).toEqual({ text: '17:00', stopped: false });
    expect(vmOf(f.today, f.reference, { now: new Date('2030-03-07T10:13:48.000Z') }).counter).toEqual({ text: '0:48', stopped: false });
    expect(vmOf({ ...f.today, blocks: [block([], { exerciseId: 'push-ups' })] }, undefined).counter).toBeUndefined();
  });

  // The last push-up set of the fixture completed at 10:13.
  const LATEST = '2030-03-07T10:13:00.000Z';
  const STOP: RestStop = { after: LATEST, pausedMs: 0, stoppedAt: '2030-03-07T10:14:30.000Z' };
  const at = (time: string): Date => new Date(`2030-03-07T${time}.000Z`);

  it('a stop after the latest set freezes the counter on the rest taken, whatever now says', () => {
    const f = fixture();
    expect(vmOf(f.today, f.reference, { restStop: STOP }).counter).toEqual({ text: '1:30', stopped: true });
    expect(vmOf(f.today, f.reference, { restStop: STOP, now: new Date('2030-03-07T11:00:00.000Z') }).counter).toEqual({ text: '1:30', stopped: true });
  });

  it('a tap while running stops it at the tap time with no pause yet', () => {
    expect(tapRestStop(undefined, LATEST, at('10:14:30'))).toEqual(STOP);
  });

  it('a second tap continues from the frozen value: the paused time never counts', () => {
    const f = fixture();
    // Stopped at 1:30 (10:14:30), continued at 10:20:00: 5:30 paused.
    const resumed = tapRestStop(STOP, LATEST, at('10:20:00'));
    expect(resumed).toEqual({ after: LATEST, pausedMs: 330000 });
    expect(vmOf(f.today, f.reference, { restStop: resumed, now: at('10:20:00') }).counter).toEqual({ text: '1:30', stopped: false });
    // now 10:30: 17:00 since the set, less 5:30 paused.
    expect(vmOf(f.today, f.reference, { restStop: resumed }).counter).toEqual({ text: '11:30', stopped: false });
  });

  it('stop and continue repeat, and every pause is left out', () => {
    const f = fixture();
    const second = tapRestStop(tapRestStop(STOP, LATEST, at('10:20:00')), LATEST, at('10:21:00'));
    // 8:00 since the set at the second stop, less the first pause of 5:30.
    expect(second).toEqual({ after: LATEST, pausedMs: 330000, stoppedAt: '2030-03-07T10:21:00.000Z' });
    expect(vmOf(f.today, f.reference, { restStop: second }).counter).toEqual({ text: '2:30', stopped: true });
    const again = tapRestStop(second, LATEST, at('10:25:00'));
    expect(again).toEqual({ after: LATEST, pausedMs: 570000 });
    // now 10:30: 17:00 less both pauses (5:30 + 4:00).
    expect(vmOf(f.today, f.reference, { restStop: again }).counter).toEqual({ text: '7:30', stopped: false });
  });

  it('a stored record after a continue (no stoppedAt) still leaves the pause out after a reload', () => {
    const f = fixture();
    const stored: unknown = JSON.parse(JSON.stringify(tapRestStop(STOP, LATEST, at('10:20:00'))));
    expect(vmOf(f.today, f.reference, { restStop: readRestStop(stored) }).counter).toEqual({ text: '11:30', stopped: false });
  });

  it('a tap after a stop recorded for another set starts a fresh stop with no pause', () => {
    const other: RestStop = { after: '2030-03-07T10:12:00.000Z', pausedMs: 60000 };
    expect(tapRestStop(other, LATEST, at('10:14:30'))).toEqual(STOP);
  });

  it('a tap with the clock behind the latest set stops at that set, so a continue runs at once from 0:00', () => {
    const f = fixture();
    // The device clock reads 10:12, a minute before the latest set's completedAt.
    const stop = tapRestStop(undefined, LATEST, at('10:12:00'));
    expect(stop).toEqual({ after: LATEST, pausedMs: 0, stoppedAt: LATEST });
    expect(vmOf(f.today, f.reference, { restStop: stop }).counter).toEqual({ text: '0:00', stopped: true });
    const resumed = tapRestStop(stop, LATEST, at('10:14:00'));
    expect(resumed).toEqual({ after: LATEST, pausedMs: 60000 });
    expect(vmOf(f.today, f.reference, { restStop: resumed, now: at('10:14:30') }).counter).toEqual({ text: '0:30', stopped: false });
  });

  it('runs again from the next set once one is added after the stop, with no pause', () => {
    const f = fixture();
    const push: Block = { ...f.todayPush, sets: [...f.todayPush.sets, set({ reps: 13, order: 4, completedAt: '2030-03-07T10:20:00.000Z' })] };
    const today: Session = { ...f.today, blocks: [f.todayDips, push] };
    expect(vmOf(today, f.reference, { restStop: STOP }).counter).toEqual({ text: '10:00', stopped: false });
    expect(vmOf(today, f.reference, { restStop: { after: LATEST, pausedMs: 330000 } }).counter).toEqual({ text: '10:00', stopped: false });
  });

  it('runs from the earlier set when the latest is deleted after the stop; restoring it freezes it again', () => {
    const f = fixture();
    const sets = f.todayPush.sets.map((s, i) => (i === 3 ? { ...s, deletedAt: '2030-03-07T10:15:00.000Z' } : s));
    const deleted: Session = { ...f.today, blocks: [f.todayDips, { ...f.todayPush, sets }] };
    // The set before completed at 10:12; now 10:30 → 18:00.
    expect(vmOf(deleted, f.reference, { restStop: STOP }).counter).toEqual({ text: '18:00', stopped: false });
    expect(vmOf(f.today, f.reference, { restStop: STOP }).counter).toEqual({ text: '1:30', stopped: true });
  });

  it('ignores a stop recorded after another set', () => {
    const f = fixture();
    const old: RestStop = { after: '2030-03-07T10:12:00.000Z', pausedMs: 0, stoppedAt: '2030-03-07T10:12:40.000Z' };
    expect(vmOf(f.today, f.reference, { restStop: old }).counter).toEqual({ text: '17:00', stopped: false });
    expect(vmOf(f.today, f.reference, { restStop: { after: '2030-03-07T10:12:00.000Z', pausedMs: 60000 } }).counter).toEqual({ text: '17:00', stopped: false });
  });

  it('is hidden while the current block has no set yet, also after another exercise’s sets', () => {
    const f = fixture();
    const fresh = block([], { exerciseId: 'diamond-push-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [f.todayDips, f.todayPush, fresh] };
    const vm = vmOf(today, f.reference);
    expect(vm.current?.blockId).toBe(fresh.id);
    expect(vm.counter).toBeUndefined();
    expect(vmOf(today, f.reference, { restStop: STOP }).counter).toBeUndefined();
  });

  it('shows again from the current block’s first set', () => {
    const f = fixture();
    const first = block([set({ reps: 20, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'diamond-push-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [f.todayDips, f.todayPush, first] };
    expect(vmOf(today, f.reference).counter).toEqual({ text: '10:00', stopped: false });
  });

  it('a finished card made current shows the session-wide counter', () => {
    const f = fixture();
    // Dips (10:01–10:03) made current; the latest set of the session is the push-ups' at 10:13.
    expect(vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id }).counter).toEqual({ text: '17:00', stopped: false });
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

describe('readRestStop', () => {
  const AFTER = '2030-03-07T10:13:00.000Z';
  const AT = '2030-03-07T10:14:30.000Z';

  it('reads a stopped and a continued record', () => {
    expect(readRestStop({ after: AFTER, pausedMs: 0, stoppedAt: AT })).toEqual({ after: AFTER, pausedMs: 0, stoppedAt: AT });
    expect(readRestStop({ after: AFTER, pausedMs: 330000 })).toEqual({ after: AFTER, pausedMs: 330000 });
  });

  it('reads the earlier { after, at } record as stopped at `at` with no pause', () => {
    expect(readRestStop({ after: AFTER, at: AT })).toEqual({ after: AFTER, pausedMs: 0, stoppedAt: AT });
    const { today, reference } = fixture();
    expect(vmOf(today, reference, { restStop: readRestStop({ after: AFTER, at: AT }) }).counter).toEqual({ text: '1:30', stopped: true });
  });

  it.each([
    ['undefined (a resume of the earlier build)', undefined],
    ['null', null],
    ['a string', 'stopped'],
    ['an object with only after', { after: AFTER }],
    ['an after that is not a timestamp', { after: 'later', pausedMs: 0 }],
    ['a negative pausedMs', { after: AFTER, pausedMs: -1 }],
    ['a pausedMs that is not finite', { after: AFTER, pausedMs: Infinity }],
    ['a pausedMs that is a string', { after: AFTER, pausedMs: '0' }],
    ['a stoppedAt that is not a timestamp', { after: AFTER, pausedMs: 0, stoppedAt: 'soon' }],
    ['a stoppedAt that is not a string', { after: AFTER, pausedMs: 0, stoppedAt: 12 }],
    ['an earlier record whose at is not a timestamp', { after: AFTER, at: 'soon' }],
  ])('reads %s as running', (_name, stored) => {
    expect(readRestStop(stored)).toBeUndefined();
  });
});
