import { describe, expect, it } from 'vitest';
import { headerOf, leadingDate, splitRows } from './rows';
import { gridOf } from './test-fixtures';

describe('leadingDate', () => {
  it('splits a leading date off an Extra cell', () => {
    expect(leadingDate('07.06.2030 Pullups 2x die 5er Pyramide')).toEqual({ dateText: '07.06.2030', rest: 'Pullups 2x die 5er Pyramide' });
    expect(leadingDate('06.07. 100x Dipbar Knee Raises')).toEqual({ dateText: '06.07.', rest: '100x Dipbar Knee Raises' });
    expect(leadingDate(' 15.07.2030 Burpees')).toEqual({ dateText: '15.07.2030', rest: 'Burpees' });
  });

  it('leaves cells without a leading date alone', () => {
    expect(leadingDate('Lat Raise Bands 10kg 22x 22x')).toBeUndefined();
    expect(leadingDate('100x Dipbar Knee Raises')).toBeUndefined();
    expect(leadingDate('20x 15x')).toBeUndefined();
  });
});

describe('splitRows', () => {
  const grid = gridOf({
    A6: { date: '2030-02-01' }, B6: '20x', C6: '30kg 20x',
    B8: '20x',
    F6: { date: '2030-02-03' }, G6: 'Dips 10x', J6: 'Lat Raise Bands 10kg 22x 22x',
    F7: '05.06.2030', G7: 'Dips 10x', J7: '07.06.2030 Pullups 5er Pyramide',
    L6: { date: '2030-01-30' },
  });
  const rows = splitRows(grid);

  it('yields one row per session, column block by column block, Extra sessions after their host', () => {
    expect(rows.map((r) => r.key)).toEqual(['Pull!6', 'Pull!8', 'Push!6', 'Push!7', 'J7', 'Legs!6']);
    expect(rows.map((r) => r.label)).toEqual(['pull', 'pull', 'push', 'push', 'other', 'legs']);
  });

  it('collects exercise cells with their headers, in column order', () => {
    const pull = rows[0]!;
    expect(pull).toMatchObject({ block: 'Pull', row: 6, dateAddress: 'A6', dateCell: { kind: 'date', value: '2030-02-01' } });
    expect(pull.cells).toEqual([
      { address: 'B6', header: 'Australian Pull Ups', text: '20x' },
      { address: 'C6', header: 'Bicep Curls', text: '30kg 20x' },
    ]);
    expect(pull.noteCells).toEqual(pull.cells);
    expect(pull.hostKey).toBeUndefined();
  });

  it('keeps an undated row and a row with a date only', () => {
    expect(rows[1]).toMatchObject({ key: 'Pull!8', dateCell: undefined, cells: [{ address: 'B8', header: 'Australian Pull Ups', text: '20x' }] });
    expect(rows[5]).toMatchObject({ key: 'Legs!6', cells: [], dateCell: { kind: 'date', value: '2030-01-30' } });
  });

  it('adds an Extra cell without a leading date to the push row', () => {
    expect(rows[2]?.cells.map((c) => [c.address, c.header])).toEqual([['G6', 'Dips'], ['J6', 'Extra']]);
  });

  it('turns an Extra cell with a leading date into its own session and keeps it out of the push row', () => {
    expect(rows[3]?.cells.map((c) => c.address)).toEqual(['G7']);
    expect(rows[4]).toEqual({
      key: 'J7', block: 'Extra', row: 7, label: 'other', dateAddress: 'J7',
      dateCell: { kind: 'text', value: '07.06.2030' },
      cells: [{ address: 'J7', header: 'Extra', text: 'Pullups 5er Pyramide' }],
      noteCells: [{ address: 'J7', header: 'Extra', text: '07.06.2030 Pullups 5er Pyramide' }],
      hostKey: 'Push!7',
    });
  });

  it('turns a date-only Extra cell into an Extra session without cells', () => {
    const only = splitRows(gridOf({ F6: { date: '2030-06-05' }, G6: 'Dips 10x', J6: '07.06.2030' }));
    expect(only.find((r) => r.key === 'J6')).toEqual({
      key: 'J6', block: 'Extra', row: 6, label: 'other', dateAddress: 'J6',
      dateCell: { kind: 'text', value: '07.06.2030' },
      cells: [],
      noteCells: [{ address: 'J6', header: 'Extra', text: '07.06.2030' }],
      hostKey: 'Push!6',
    });
  });

  it('ignores the header rows and empty rows', () => {
    expect(splitRows(gridOf({}))).toEqual([]);
  });
});

describe('headerOf', () => {
  it('reads row 2 and falls back to the column letter', () => {
    expect(headerOf(gridOf({}), 'M')).toBe('Single Leg RDL');
    expect(headerOf(gridOf({}, false), 'M')).toBe('M');
  });
});
