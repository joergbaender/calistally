import { describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { buildSessions } from './build';
import { decisionSkeleton, renderReport, renderReview } from './review';
import { splitRows } from './rows';
import { gridOf } from './test-fixtures';
import type { ReviewItem } from './types';

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  kind: 'date-proposed', key: 'A3', block: 'Pull', row: 3, date: '2030-01-14', raw: '', proposal: 'using proposed 2030-01-14, flagged dateUncertain', detail: 'no date in the sheet', ...over,
});

describe('decisionSkeleton', () => {
  it('offers the fields that answer each kind', () => {
    expect(decisionSkeleton(item({}))).toContain('"A3": { "date": "YYYY-MM-DD" }');
    expect(decisionSkeleton(item({ kind: 'date-out-of-order', key: 'A49' }))).toContain('"dateExact": true');
    expect(decisionSkeleton(item({ kind: 'load-missing', key: 'M33', raw: 'Lateral raises 30x' }))).toContain('"M33": { "text": "Lateral raises 30x" }');
    expect(decisionSkeleton(item({ kind: 'aggregate', key: 'H37', raw: '100 Diamonds' }))).toContain('"H37": { "accept": true }');
    expect(decisionSkeleton(item({ kind: 'stale-decision', key: 'Z9' }))).toContain('remove');
    expect(decisionSkeleton(item({ kind: 'empty-row', key: 'A6' }))).toContain('"accept": true');
  });
});

describe('renderReview', () => {
  it('says so when nothing is open', () => {
    expect(renderReview([])).toContain('0 open items');
  });

  it('groups items by column block and shows raw text, problem, proposal and the answer', () => {
    const md = renderReview([item({}), item({ kind: 'aggregate', key: 'H37', block: 'Push', row: 37, raw: '100 Diamonds', proposal: 'diamond-push-ups: 100 (aggregate)', detail: '100 total' })]);
    expect(md).toContain('2 open items');
    expect(md.indexOf('## Pull')).toBeLessThan(md.indexOf('## Push'));
    expect(md).toContain('### A3 · date-proposed · row 3 · 2030-01-14');
    expect(md).toContain('- cell text: (empty)');
    expect(md).toContain('- cell text: `100 Diamonds`');
    expect(md).toContain('- problem: 100 total');
    expect(md).toContain('- done for now: diamond-push-ups: 100 (aggregate)');
    expect(md).toContain('"H37": { "accept": true }');
  });
});

describe('renderReport', () => {
  const result = buildSessions(splitRows(gridOf({ B3: '20x', A6: { date: '2030-02-01' }, B6: '6kg 15x', C6: '35kg 16x', F6: '01,02.2030', G6: 'Dips 10x' })), {}, SEED, { year: 2030, stamp: '2030-10-07T00:00:00.000Z', bodyweightKg: 73 });

  it('heads the report FINAL or NOT FINAL and counts everything', () => {
    const md = renderReport(result, { final: false, xlsx: 'synthetic.xlsx', decisionCount: 0 });
    expect(md.startsWith('# Migration report — NOT FINAL')).toBe(true);
    expect(md).toContain('Source: synthetic.xlsx. Decisions applied: 0. 1 open review item(s).');
    expect(md).toContain('| sessions | 3 |');
    expect(md).toContain('| sessions labelled pull | 2 |');
    expect(md).toContain('| blocks | 4 |');
    expect(md).toContain('| sets | 4 |');
    expect(md).toContain('| sessions with dateUncertain | 1 |');
    expect(md).toContain('| open: date-proposed | 1 |');
    expect(md).toContain('F6: date "01,02.2030" → 2030-02-01 (separator "," read as ".")');
    expect(md).toContain('- australian-pull-ups-rings');
    expect(renderReport({ ...result, review: [] }, { final: true, xlsx: 'x.xlsx', decisionCount: 2 }).startsWith('# Migration report — FINAL')).toBe(true);
  });

  it('writes "none" for empty sections', () => {
    expect(renderReport(result, { final: false, xlsx: 'x', decisionCount: 0 })).toMatch(/## Accepted items\n\n- none/);
  });
});
