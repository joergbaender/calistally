import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertCell, lastRow, readWorkbook } from './grid';
import { gridOf, writeWorkbook } from './test-fixtures';

describe('convertCell', () => {
  it('drops empty and blank cells', () => {
    expect(convertCell(null)).toBeUndefined();
    expect(convertCell(undefined as never)).toBeUndefined();
    expect(convertCell('   ')).toBeUndefined();
  });

  it('keeps text as written, including inner newlines and outer spaces', () => {
    expect(convertCell(' 11,5kg 22x 23x')).toEqual({ kind: 'text', value: ' 11,5kg 22x 23x' });
    expect(convertCell('a\nb')).toEqual({ kind: 'text', value: 'a\nb' });
  });

  it('takes the calendar day from the UTC fields', () => {
    expect(convertCell(new Date('2030-01-19T00:00:00.000Z'))).toEqual({ kind: 'date', value: '2030-01-19' });
    expect(convertCell(new Date('2030-01-19T23:30:00.000Z'))).toEqual({ kind: 'date', value: '2030-01-19' });
  });

  it('stringifies numbers and booleans, flattens rich text, uses formula results and hyperlink text', () => {
    expect(convertCell(42)).toEqual({ kind: 'text', value: '42' });
    expect(convertCell(true)).toEqual({ kind: 'text', value: 'true' });
    expect(convertCell({ richText: [{ text: 'Pullups ' }, { text: '5x 5x' }] })).toEqual({ kind: 'text', value: 'Pullups 5x 5x' });
    expect(convertCell({ formula: 'A1', result: 'x' })).toEqual({ kind: 'text', value: 'x' });
    expect(convertCell({ text: 'linked', hyperlink: 'https://example.invalid' })).toEqual({ kind: 'text', value: 'linked' });
  });
});

describe('readWorkbook', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-grid-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a synthetic workbook into a Grid', async () => {
    const file = path.join(dir, 'synthetic.xlsx');
    const cells = { A6: { date: '2030-01-19' }, B6: '6kg 15x 12x', A7: '25.01.30', B7: 'Pullups 5x 5x', C7: '   ' };
    await writeWorkbook(file, cells);
    const grid = await readWorkbook(file);
    const expected = gridOf({ A6: { date: '2030-01-19' }, B6: '6kg 15x 12x', A7: '25.01.30', B7: 'Pullups 5x 5x' });
    expect([...grid.entries()].sort()).toEqual([...expected.entries()].sort());
    expect(grid.has('C7')).toBe(false);
    expect(lastRow(grid)).toBe(7);
  });

  it('rejects a workbook without a worksheet', async () => {
    await expect(readWorkbook(path.join(dir, 'missing.xlsx'))).rejects.toThrow();
  });
});

describe('gridOf', () => {
  it('fills the header row by default and can leave it out', () => {
    expect(gridOf({}).get('B2')).toEqual({ kind: 'text', value: 'Australian Pull Ups' });
    expect(gridOf({}, false).size).toBe(0);
    expect(lastRow(gridOf({}, false))).toBe(0);
  });
});
