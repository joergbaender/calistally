import { describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { MODEL_VERSION } from '../model/schema';
import { checkCatalogRules, validateForWrite } from '../model/validate';
import { buildSessions, loadOf } from './build';
import type { Decisions } from './decisions';
import { uuidV5 } from './ids';
import { outsideCells, splitRows } from './rows';
import { gridOf, type CellSpec } from './test-fixtures';

const STAMP = '2030-10-07T00:00:00.000Z';
const OPTIONS = { year: 2030, stamp: STAMP, bodyweightKg: 73 };
const build = (cells: Record<string, CellSpec>, decisions: Decisions = {}) => buildSessions(splitRows(gridOf(cells)), decisions, SEED, OPTIONS);
const d = (date: string) => ({ date });
const seed = (id: string) => SEED.find((e) => e.id === id)!;
const repsOf = (x: object): number | undefined => ('reps' in x ? (x.reps as number) : undefined);

describe('buildSessions: one session per row', () => {
  const r = build({ A6: d('2030-02-01'), B6: '6kg 15x 12x', C6: '35kg 16x 14x' });
  const s = r.sessions[0]!;

  it('fills the session fields from the row', () => {
    expect(r.sessions).toHaveLength(1);
    expect(s).toMatchObject({ id: uuidV5('session/Pull!6'), date: '2030-02-01', label: 'pull', source: 'migrated', tags: [], updatedAt: STAMP });
    expect(s.dateUncertain).toBeUndefined();
    expect(s.notes).toBe('Australian Pull Ups: 6kg 15x 12x\nBicep Curls: 35kg 16x 14x');
    expect(r.review).toEqual([]);
  });

  it('builds blocks and sets in column order with deterministic ids and per-set loads', () => {
    expect(s.blocks.map((b) => [b.exerciseId, b.order, b.id])).toEqual([
      ['australian-pull-ups-rings', 0, uuidV5('session/Pull!6/block/0')],
      ['bicep-curls-band', 1, uuidV5('session/Pull!6/block/1')],
    ]);
    expect(s.blocks[0]?.sets[0]).toEqual({ updatedAt: STAMP, id: uuidV5('session/Pull!6/block/0/set/0'), order: 0, reps: 15, loadType: 'added', loadKg: 6 });
    expect(s.blocks[1]?.sets.map((x) => [repsOf(x), x.loadType, x.loadKg])).toEqual([[16, 'band', 35], [14, 'band', 35]]);
    expect(s.blocks[0]?.note).toBeUndefined();
  });

  it('emits the seed as catalog and one estimated bodyweight entry at the earliest date', () => {
    expect(r.catalog).toEqual([...SEED]);
    expect(r.bodyweight).toEqual([{ updatedAt: STAMP, id: uuidV5('bodyweight/initial'), date: '2030-02-01', kg: 73, note: 'estimated, constant 73 kg through 2030 (migration)' }]);
  });
});

describe('buildSessions: load types', () => {
  it('maps kg and its absence by exercise kind, with explicit bodyweight winning', () => {
    expect(loadOf({ reps: 1, kg: 6, bodyweight: false }, seed('dips-bar'), false)).toEqual({ loadType: 'added', loadKg: 6, missing: false });
    expect(loadOf({ reps: 1, bodyweight: false }, seed('dips-bar'), false)).toEqual({ loadType: 'bodyweight', loadKg: 0, missing: false });
    expect(loadOf({ reps: 1, kg: 17.4, bodyweight: false }, seed('single-leg-rdl'), false)).toEqual({ loadType: 'external', loadKg: 17.4, missing: false });
    expect(loadOf({ reps: 1, bodyweight: true }, seed('single-leg-rdl'), false)).toEqual({ loadType: 'bodyweight', loadKg: 0, missing: false });
    expect(loadOf({ reps: 1, bodyweight: false }, seed('single-leg-rdl'), false)).toEqual({ loadType: 'external', loadKg: 0, missing: true });
    expect(loadOf({ reps: 1, kg: 50, bodyweight: false }, seed('single-leg-rdl-band'), true)).toEqual({ loadType: 'band', loadKg: 50, missing: false });
    expect(loadOf({ reps: 1, kg: 12.346, bodyweight: false }, seed('squats'), false).loadKg).toBe(12.35);
  });

  it('raises load-missing once per block and still emits the sets', () => {
    const r = build({ L6: d('2030-07-22'), M6: 'Lateral raises 30x 30x 29x 25x', L7: d('2030-07-28'), M7: '20x 2 ohne weil erkältet' });
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['load-missing', 'M6']]);
    expect(r.sessions[0]?.blocks[0]?.sets.map((x) => x.loadType)).toEqual(['band', 'band', 'band', 'band']);
    expect(r.sessions[1]?.blocks[0]?.sets.map((x) => [x.loadType, x.loadKg])).toEqual([['bodyweight', 0], ['bodyweight', 0]]);
    expect(r.sessions[1]?.tags).toEqual(['sick']);
  });
});

describe('buildSessions: blocks', () => {
  it('moves `vor den Australians` blocks to the front', () => {
    const r = build({ A6: d('2030-05-28'), B6: '11,5kg 20x', C6: 'Pullups 1x 2x 3x vor den Australians' });
    expect(r.sessions[0]?.blocks.map((b) => [b.exerciseId, b.order])).toEqual([['pull-ups', 0], ['australian-pull-ups-rings', 1]]);
  });

  it('carries restSec, aggregate and block notes, and drops cue phrases', () => {
    const r = build({ F6: d('2030-05-29'), G6: 'Dips Downs 15x Start with 1m Rest', H6: '100 Diamonds', A6: d('2030-05-28'), B6: '11,5kg 20x 19x\nsauber (Ellbogen), langsam, gestreckt' });
    const push = r.sessions.find((s) => s.label === 'push')!;
    expect(push.blocks[0]?.sets).toHaveLength(15);
    expect(push.blocks[0]?.sets.every((x) => x.restSec === 60)).toBe(true);
    expect(push.blocks[0]?.note).toBe('Start with 1m Rest');
    expect(push.blocks[1]?.sets).toEqual([{ updatedAt: STAMP, id: uuidV5('session/Push!6/block/1/set/0'), order: 0, reps: 100, loadType: 'bodyweight', loadKg: 0, aggregate: true }]);
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['aggregate', 'H6']]);
    expect(r.report).toContainEqual({ kind: 'dropped', where: 'B6', detail: 'cues dropped: sauber (Ellbogen), langsam, gestreckt' });
  });

  it('drops a block without an exercise and flags it', () => {
    const r = build({ F6: d('2030-05-29'), G6: 'Dips 10x', J6: '20x 20x' });
    expect(r.sessions[0]?.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar']);
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['unknown-exercise', 'J6']]);
  });

  it('a date with no cells is an empty session and a review item', () => {
    const r = build({ A6: d('2030-02-01') });
    expect(r.sessions[0]?.blocks).toEqual([]);
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['empty-row', 'A6']]);
  });
});

describe('buildSessions: Extra column', () => {
  const r = build({
    F6: d('2030-06-05'), G6: 'Dips 10x', J6: '07.06.2030 Pullups 5er Pyramide',
    F7: d('2030-06-11'), G7: 'Dips 10x', J7: 'Lat Raise Bands 10kg 22x 22x',
  });

  it('makes a dated Extra cell its own session and keeps it out of the push row', () => {
    expect(r.sessions.map((s) => [s.date, s.label])).toEqual([['2030-06-05', 'push'], ['2030-06-07', 'other'], ['2030-06-11', 'push']]);
    const extra = r.sessions[1]!;
    expect(extra.id).toBe(uuidV5('session/J6'));
    expect(extra.notes).toBe('Extra: 07.06.2030 Pullups 5er Pyramide');
    expect(extra.blocks[0]?.sets.map(repsOf)).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
    expect(r.sessions[0]?.notes).toBe('Dips: Dips 10x');
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['pyramid-expanded', 'J6']]);
  });

  it('adds an undated Extra cell to the push session after the I block', () => {
    expect(r.sessions[2]?.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'lateral-raises-band']);
    expect(r.sessions[2]?.blocks[1]?.sets[0]).toMatchObject({ loadType: 'band', loadKg: 10 });
    expect(r.sessions[2]?.notes).toBe('Dips: Dips 10x\nExtra: Lat Raise Bands 10kg 22x 22x');
  });
});

describe('buildSessions: dates', () => {
  const undated = { B3: '20x 15x', B4: '6kg 15x', B5: '9kg 14x', A6: d('2030-02-01'), B6: 'Bodyweight 20x', A7: d('2030-02-07'), B7: 'Bodyweight 20x', A8: d('2030-02-13'), B8: 'Bodyweight 20x', A9: d('2030-02-17'), B9: 'Bodyweight 20x' };

  it('proposes dates for the undated rows, flags them, and starts the bodyweight there', () => {
    const r = build(undated);
    expect(r.sessions.slice(0, 3).map((s) => [s.date, s.dateUncertain])).toEqual([['2030-01-14', true], ['2030-01-20', true], ['2030-01-26', true]]);
    expect(r.sessions[3]?.dateUncertain).toBeUndefined();
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['date-proposed', 'A3'], ['date-proposed', 'A4'], ['date-proposed', 'A5']]);
    expect(r.review[0]?.proposal).toContain('2030-01-14');
    expect(r.bodyweight[0]?.date).toBe('2030-01-14');
  });

  it('keeps an out-of-order date as written, flags it and proposes the month fix', () => {
    const cells = { A6: d('2030-08-26'), B6: 'Pullups 5x', A7: d('2030-08-30'), B7: 'Pullups 5x', A8: '03.08.2030', B8: 'Pullups 5x', A9: d('2030-09-07'), B9: 'Pullups 5x' };
    const r = build(cells);
    const flagged = r.sessions.find((s) => s.date === '2030-08-03')!;
    expect(flagged.dateUncertain).toBe(true);
    expect(r.review).toHaveLength(1);
    expect(r.review[0]).toMatchObject({ kind: 'date-out-of-order', key: 'A8', date: '2030-08-03', raw: '03.08.2030' });
    expect(r.review[0]?.proposal).toContain('2030-09-03');
    const fixed = build(cells, { A8: { date: '2030-09-03' } });
    expect(fixed.review).toEqual([]);
    expect(fixed.sessions.map((s) => s.date)).toEqual(['2030-08-26', '2030-08-30', '2030-09-03', '2030-09-07']);
    expect(fixed.sessions.every((s) => s.dateUncertain === undefined)).toBe(true);
    const kept = build(cells, { A8: { dateExact: true } });
    expect(kept.review).toEqual([]);
    expect(kept.sessions.find((s) => s.date === '2030-08-03')?.dateUncertain).toBeUndefined();
  });

  it('reports repaired dates and treats an unreadable one as undated', () => {
    const r = build({ A6: '01,02.2030', B6: 'Pullups 5x', A7: 'foo', B7: 'Pullups 5x', A8: d('2030-02-13'), B8: 'Pullups 5x' });
    expect(r.report).toContainEqual({ kind: 'repair', where: 'A6', detail: 'date "01,02.2030" → 2030-02-01 (separator "," read as ".")' });
    expect(r.sessions[1]).toMatchObject({ date: '2030-02-07', dateUncertain: true });
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['date-unreadable', 'A7']]);
  });

  it('D3: skipping a dated Extra cell drops that Extra session', () => {
    const r = build({ F6: d('2030-06-05'), G6: 'Dips 10x', J6: '07.06.2030 Pullups 5x' }, { J6: { skip: true } });
    expect(r.sessions.map((s) => [s.date, s.label])).toEqual([['2030-06-05', 'push']]);
    expect(r.report).toContainEqual({ kind: 'skipped', where: 'J6', detail: 'cell skipped by decision: "Pullups 5x"' });
    expect(r.report).toContainEqual({ kind: 'skipped', where: 'J6', detail: 'Extra session dropped: its cell was skipped by decision' });
    expect(r.review).toEqual([]);
    const earlier = build({ F6: d('2030-06-05'), G6: 'Dips 10x', J6: '01.06.2030 Pullups 5x' }, { J6: { skip: true } });
    expect(earlier.bodyweight[0]?.date).toBe('2030-06-05');
    expect(earlier.review).toEqual([]);
  });

  it('a date decision also works on an Extra cell', () => {
    const r = build({ F6: d('2030-06-05'), G6: 'Dips 10x', J6: '07.06.2030 Pullups 5x' }, { J6: { date: '2030-06-08' } });
    expect(r.sessions[1]?.date).toBe('2030-06-08');
    expect(r.review).toEqual([]);
  });
});

describe('buildSessions: decisions', () => {
  const cells = { A6: d('2030-02-20'), C6: '8,5kg 17,2x 14,2x' };

  it('a text decision is parsed like a cell and leaves the notes untouched', () => {
    const r = build(cells, { C6: { text: '8,5kg 17x 17x 14x 14x', why: 'twice' } });
    expect(r.sessions[0]?.blocks[0]?.sets.map(repsOf)).toEqual([17, 17, 14, 14]);
    expect(r.sessions[0]?.notes).toBe('Bicep Curls: 8,5kg 17,2x 14,2x');
    expect(r.review).toEqual([]);
    expect(r.report).toContainEqual({ kind: 'decision', where: 'C6', detail: 'twice' });
    const two = build(cells, { C6: { text: 'Pullups 1x 2x\ndann 5x 5x' } });
    expect(two.sessions[0]?.blocks.map((b) => [b.exerciseId, b.sets.length])).toEqual([['pull-ups', 2], ['pull-ups', 2]]);
  });

  it('a decision that changes nothing is stale, and so is one without a cell', () => {
    const r = build(cells, { C6: { text: '8,5kg 17,2x 14,2x' }, Z9: { accept: true } });
    expect(r.review.map((i) => [i.kind, i.key, i.detail])).toEqual([
      ['stale-decision', 'C6', 'the decision changes nothing'],
      ['stale-decision', 'Z9', 'no cell or item has this key'],
    ]);
  });

  it('accept closes an item and reports it; skip drops a cell', () => {
    const r = build({ B3: '20x', A4: d('2030-02-01'), B4: '20x' }, { A3: { accept: true } });
    expect(r.review).toEqual([]);
    expect(r.sessions[0]?.dateUncertain).toBe(true);
    expect(r.report.some((e) => e.kind === 'accepted' && e.where === 'A3')).toBe(true);
    const skipped = build(cells, { C6: { skip: true } });
    expect(skipped.sessions[0]?.blocks).toEqual([]);
    expect(skipped.report).toContainEqual({ kind: 'skipped', where: 'C6', detail: 'cell skipped by decision: "8,5kg 17,2x 14,2x"' });
  });

  it('line decisions use address#line keys, as the review items do', () => {
    const lines = { A6: d('2030-07-22'), C6: 'Pullups 1x 2x\nLateral raises 30x 30x' };
    expect(build(lines).review.map((i) => i.key)).toEqual(['C6#2']);
    const r = build(lines, { 'C6#2': { text: 'Lateral raises 10kg 30x 30x' } });
    expect(r.review).toEqual([]);
    expect(r.sessions[0]?.blocks[1]?.sets[0]).toMatchObject({ loadType: 'band', loadKg: 10 });
  });
});

describe('buildSessions: final-review fixes', () => {
  it('F2: a partly used decision reports its unused fields as stale', () => {
    const r = build({ A4: d('2030-03-08'), B4: '20x' }, { B4: { text: '12x', date: '2030-03-09' } });
    expect(r.sessions[0]?.blocks[0]?.sets.map(repsOf)).toEqual([12]);
    expect(r.review.map((i) => [i.kind, i.key, i.detail])).toEqual([['stale-decision', 'B4', 'field "date" has no effect on this key']]);
    const two = build({ A4: d('2030-03-08'), B4: '20x' }, { B4: { text: '12x', date: '2030-03-09', dateExact: true } });
    expect(two.review.map((i) => [i.kind, i.key, i.detail])).toEqual([['stale-decision', 'B4', 'fields "date", "dateExact" have no effect on this key']]);
    expect(build({ A4: d('2030-03-08'), B4: '20x' }, { B4: { text: '12x', why: 'typo' } }).review).toEqual([]);
  });

  it('F3: a date decision on a doubtful date is used, even when it confirms the date', () => {
    const r = build({ A4: '28.04.203', B4: '20x' }, { A4: { date: '2030-04-28' } });
    expect(r.review).toEqual([]);
    expect(r.sessions[0]?.date).toBe('2030-04-28');
    expect(r.sessions[0]?.dateUncertain).toBeUndefined();
  });

  it('F4: an Extra line without exercise says it is dropped', () => {
    const r = build({ F3: d('2030-03-01'), G3: 'Dips 10x', J3: '10x 3 4' });
    expect(r.sessions[0]?.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar']);
    const j3 = r.review.filter((i) => i.key === 'J3');
    expect(j3.map((i) => i.kind)).toContain('unknown-exercise');
    expect(j3.find((i) => i.kind === 'unknown-exercise')?.proposal.startsWith('dropped')).toBe(true);
    expect(j3.every((i) => i.proposal.startsWith('dropped'))).toBe(true);
    expect(r.review.some((i) => i.proposal.includes('emitted'))).toBe(false);
    const note = build({ F3: d('2030-03-01'), G3: 'Dips 10x', J3: 'Deeep' });
    expect(note.review.map((i) => [i.kind, i.key])).toEqual([['note-only', 'J3'], ['unknown-exercise', 'J3']]);
    expect(note.review.every((i) => i.proposal === 'dropped: no exercise (Extra column)')).toBe(true);
  });

  it('F5: a cell outside the column blocks becomes an outside-blocks item that accept closes', () => {
    const withOutside = (c: Record<string, CellSpec>, decisions: Decisions = {}) => {
      const grid = gridOf(c);
      return buildSessions(splitRows(grid), decisions, SEED, OPTIONS, outsideCells(grid));
    };
    const cells = { A4: d('2030-03-08'), B4: '20x', E4: '50x Pullups' };
    const r = withOutside(cells);
    expect(r.review.map((i) => [i.kind, i.key, i.proposal])).toEqual([['outside-blocks', 'E4', 'ignored']]);
    expect(r.review[0]).toMatchObject({ raw: '50x Pullups', row: 4 });
    const closed = withOutside(cells, { E4: { accept: true } });
    expect(closed.review).toEqual([]);
    expect(closed.report.some((e) => e.kind === 'accepted' && e.where === 'E4')).toBe(true);
    expect(withOutside({ A4: d('2030-03-08'), B4: '20x', K1: 'title', P2: 'header' }).review).toEqual([]);
    expect(outsideCells(gridOf({ A4: d('2030-03-08'), E4: 'x', K9: 'y', AA3: 'z', J5: 'w', E2: 'h' }))).toEqual([
      { address: 'AA3', row: 3, text: 'z' },
      { address: 'E4', row: 4, text: 'x' },
      { address: 'K9', row: 9, text: 'y' },
    ]);
  });

  it('M1: session notes use \\n even when a cell has CRLF line breaks', () => {
    const r = build({ A6: d('2030-02-01'), B6: '6kg 15x\r\n12x' });
    expect(r.sessions[0]?.notes).toBe('Australian Pull Ups: 6kg 15x\n12x');
  });

  it('M4: every applied decision gets a decision report entry, with why when present', () => {
    const r = build({ A4: '28.04.203', B4: '20x', A5: d('2030-05-01'), B5: '20x 15x\n9x' }, {
      A4: { date: '2030-04-29' }, B4: { text: '12x', why: 'typo' }, 'B5#2': { skip: true },
    });
    expect(r.report).toContainEqual({ kind: 'decision', where: 'A4', detail: 'date 2030-04-29' });
    expect(r.report).toContainEqual({ kind: 'decision', where: 'B4', detail: 'typo' });
    expect(r.report).toContainEqual({ kind: 'decision', where: 'B4', detail: 'text "12x" — typo' });
    expect(r.report).toContainEqual({ kind: 'decision', where: 'B5#2', detail: 'skip' });
  });
});

describe('buildSessions: determinism and validity', () => {
  const cells = {
    B3: '20x 15x', A6: d('2030-02-01'), B6: '6kg 15x 12x', C6: 'Neg Pullups 10x 10x', D6: '25kg x 20 x3',
    F5: '28.01.30', G5: '21x 14x', H5: '19x', I5: 'nichts',
    F6: d('2030-02-03'), G6: '8,5kg 15x 13x', H6: '23x 19,5x', I6: '30kg 20 x 2', J6: 'Overhead Press Bands\n10kg 15x 15x easy',
    F7: '09.02.2030', G7: 'Rings Downs 15x Start with 1m Rest', J7: '15.07.2030 Burpees, Pyramide Pullups',
    L6: d('2030-01-30'), M6: 'Bands 50kg 20x 60kg 15x x2', N6: '20x ohne / 20x mit 12,4kg', O6: 'Bands 25kg 24x 35kg 25x 50kg 25x',
    L7: '05.02.2030', M7: '25x 2 mit 17,4 kg (R 1x 20)', N7: 'normal Squats 17,4kg 30x 28,9kg 30x 20x', O7: 'Knee Raises 25x 25x\nLateral Raises 30x 30x',
  };

  it('produces identical results on two runs', () => {
    expect(build(cells)).toEqual(build(cells));
  });

  it('passes the model validation for every file', () => {
    const r = build(cells);
    expect(r.sessions.length).toBeGreaterThan(6);
    for (const s of r.sessions) {
      expect(validateForWrite('session', { schemaVersion: MODEL_VERSION, session: s }).issues, s.notes).toEqual([]);
      expect(checkCatalogRules(s, r.catalog), s.notes).toEqual([]);
    }
    expect(validateForWrite('exercises', { schemaVersion: MODEL_VERSION, exercises: r.catalog }).ok).toBe(true);
    expect(validateForWrite('bodyweight', { schemaVersion: MODEL_VERSION, entries: r.bodyweight }).ok).toBe(true);
    expect(r.sessions.map((s) => s.date)).toEqual([...r.sessions.map((s) => s.date)].sort());
  });
});
