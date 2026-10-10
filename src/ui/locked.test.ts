import { describe, expect, it } from 'vitest';
import { block, ladder, session, sessionFile } from '../model/test-fixtures';
import type { FileRow } from '../sync/store';
import { lockedSessionRows, lockedSessionsOf } from './locked';

const row = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
  path: '/sessions/2030/2030-03-04_00000000.json', kind: 'session', rev: 'r1', content, status: 'quarantined', issues: [], version: 1, ...over,
});

describe('lockedSessionsOf', () => {
  it('takes the session of refused session rows whose content parses as a session', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    expect(lockedSessionsOf([row(sessionFile(s))])).toEqual([s]);
  });

  it('skips rows of other kinds and content that is not a session', () => {
    expect(lockedSessionsOf([
      row({ schemaVersion: 1 }),
      row({ session: 'nope' }),
      row({ session: { id: 'x', date: '2030-03-04' } }),
      row({ session: { id: 'x', date: '2030-03-04', blocks: 'no' } }),
      row({ session: { id: 'x', date: '2030-03-04', tags: [], blocks: [{ id: 'b', exerciseId: 'dips' }] } }),
      row(null),
      row({ schemaVersion: 1, exercises: [] }, { kind: 'exercises', path: '/exercises.json' }),
    ])).toEqual([]);
  });

  it('skips a session the page could not render: tags missing, or a set without a numeric amount', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const { tags: _tags, ...noTags } = s;
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noTags })])).toEqual([]);
    const noAmount = { ...s, blocks: [{ ...s.blocks[0], sets: [{ id: 'x', order: 0 }] }] };
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noAmount })])).toEqual([]);
  });

  it('checks the lenient session schema: a wrong label, a non-string tag or a bad load type keeps the file off the list', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const file = sessionFile(s);
    const b0 = s.blocks[0];
    const set0 = b0?.sets[0];
    if (b0 === undefined || set0 === undefined) throw new Error('fixture');
    for (const bad of [
      { ...s, label: 5 },
      { ...s, label: null },
      { ...s, label: 'Push' },
      { ...s, tags: ['ok', 7] },
      { ...s, notes: { text: 'x' } },
      { ...s, blocks: [{ ...b0, sets: [{ ...set0, loadType: 'chains' }] }] },
    ]) {
      expect(lockedSessionsOf([row({ ...file, session: bad })])).toEqual([]);
    }
  });

  it('lists a file a newer app wrote (unknown fields, newer schemaVersion) and one that fails only a hard rule', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const newer = { schemaVersion: 99, session: { ...s, mood: 'good' } };
    expect(lockedSessionsOf([row(newer, { status: 'needs-update' })])).toEqual([newer.session]);
    // 30 February matches the date pattern; only the hard rules refuse it (display does not care).
    const hard = sessionFile({ ...s, date: '2030-02-30' });
    expect(lockedSessionsOf([row(hard)])).toEqual([hard.session]);
  });

  it('leaves out the loser of a duplicate pair: spec 3 §6 hides it from views, its content is merged into the ok twin', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const loser = row(sessionFile(s), { status: 'ok', duplicateOf: '/sessions/2030/2030-03-04_aaaaaaaa.json', path: '/sessions/2030/2030-03-04_bbbbbbbb.json' });
    expect(lockedSessionsOf([loser], new Set([s.id]))).toEqual([]);
    // Even before the twin's row is known: a duplicate is never listed on its own.
    expect(lockedSessionsOf([loser])).toEqual([]);
  });

  it('leaves out a refused session whose id an ok session or an earlier refused row already holds (the route could not reach it)', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const first = row(sessionFile(s), { status: 'needs-update', path: '/sessions/2030/2030-03-04_first.json' });
    const second = row(sessionFile(s), { status: 'quarantined', path: '/sessions/2030/2030-03-04_second.json' });
    expect(lockedSessionsOf([first], new Set([s.id]))).toEqual([]);
    expect(lockedSessionRows([first, second], new Set())).toEqual([{ row: first, session: s }]);
  });
});

describe('lockedSessionRows', () => {
  it('pairs each listed session with its row, so the session page reads the same row and its reason', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const r: FileRow = { path: '/sessions/2030/2030-03-04_x.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'read-only', issues: [], version: 1 };
    expect(lockedSessionRows([r], new Set())).toEqual([{ row: r, session: s }]);
  });
});
