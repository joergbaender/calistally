import { describe, expect, it } from 'vitest';
import { cellLines, parseCell } from './parse-cell';

const ids = (text: string, header: string) => parseCell(text, header).blocks.map((b) => b.exerciseId);
const reps = (text: string, header: string) => parseCell(text, header).blocks.map((b) => b.sets.map((s) => s.reps));

describe('cellLines', () => {
  it('trims, drops empty lines and accepts CRLF', () => {
    expect(cellLines('a \n\n b \r\nc')).toEqual(['a', 'b', 'c']);
    expect(cellLines('   ')).toEqual([]);
  });
});

describe('parseCell', () => {
  it('falls back to the column header', () => {
    const r = parseCell('20x 15x', 'Australian Pull Ups');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ line: 1, rawLine: '20x 15x', exerciseId: 'australian-pull-ups-rings', exerciseRaw: 'Australian Pull Ups', orderFirst: false, bands: false });
    expect(r.blocks[0]?.note).toBeUndefined();
    expect(r.issues).toEqual([]);
  });

  it('makes one block per line, each with its own exercise, and a header fallback for lines without one', () => {
    const text = 'Pullups 1x 2x 3x\nDips Downs 15x 14x 10x\n\n20x 2 mit 12,4 kg';
    expect(ids(text, 'Single Leg RDL')).toEqual(['pull-ups', 'dips-bar', 'single-leg-rdl']);
    expect(parseCell(text, 'Single Leg RDL').blocks.map((b) => b.line)).toEqual([1, 2, 3]);
    expect(ids('Pullups 5x 5x 4x\nAust Pullups 10kg 17x 14x', 'Australian Pull Ups')).toEqual(['pull-ups', 'australian-pull-ups-rings']);
  });

  it('a line with only an exercise name is filled by the next line', () => {
    const r = parseCell('Overhead Press Bands\n10kg 15x 15x easy', 'Extra');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ exerciseId: 'overhead-press-band', bands: true, note: 'easy', line: 1 });
    expect(r.blocks[0]?.sets).toEqual([{ reps: 15, kg: 10, bodyweight: false }, { reps: 15, kg: 10, bodyweight: false }]);
    expect(r.issues).toEqual([]);
  });

  it('`dann` on a new line opens a second block of the same exercise', () => {
    const r = parseCell('Pullups 1x 2x 3x 4x 5x 4x 3x 2x 5x\ndann 8x 7x 6x', 'Bicep Curls');
    expect(r.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups', 'pull-ups']);
    expect(r.blocks.map((b) => b.line)).toEqual([1, 2]);
    expect(reps('Pullups 1x 2x dann 5x 5x', 'Bicep Curls')).toEqual([[1, 2], [5, 5]]);
  });

  it('`plus` continues the current block', () => {
    const r = parseCell('Dips Downs 15x Start with 1m Rest\nplus 10x 3', 'Dips');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.sets.map((s) => s.reps)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 10, 10, 10]);
    expect(r.blocks[0]).toMatchObject({ restSec: 60, note: 'Start with 1m Rest' });
  });

  it('a note line attaches to the preceding block and yields tags', () => {
    const r = parseCell('9,1kg 20,5x 14,5x\nnach Essen, voller Bauch', 'Australian Pull Ups');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.note).toBe('voller Bauch');
    expect(r.tags).toEqual(['after-meal']);
    expect(r.unrecognised).toEqual(['voller', 'Bauch']);
    const cues = parseCell('11,5kg 20x 19x\nsauber (Ellbogen), langsam, gestreckt', 'Australian Pull Ups');
    expect(cues.blocks[0]?.note).toBeUndefined();
    expect(cues.cuesDropped).toEqual(['sauber (Ellbogen)', 'langsam', 'gestreckt']);
  });

  it('inline notes, bands and refinements land on the block', () => {
    expect(parseCell('10kg 20x 16,5x Deeep', 'Dips').blocks[0]?.note).toBe('Deeep');
    expect(ids('Bands 50kg 20x 60kg 15x x2', 'Single Leg RDL')).toEqual(['single-leg-rdl-band']);
    expect(ids('Aust Pullups Stange 20x 20x', 'Australian Pull Ups')).toEqual(['australian-pull-ups-bar']);
    expect(ids('15kg Maschine 23x 2', 'Face Pulls')).toEqual(['face-pulls-cable']);
    expect(ids('10kg SZ Hantel 17x 15,5x', 'Bicep Curls')).toEqual(['bicep-curls-ez-bar']);
  });

  it('`vor den Australians` marks the block to go first', () => {
    expect(parseCell('Pullups 1x 2x 3x vor den Australians', 'Bicep Curls').blocks[0]?.orderFirst).toBe(true);
  });

  it('an unparseable line becomes a note-only block with the raw line and an issue', () => {
    const r = parseCell('mit\n20x 20x', 'Dips');
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]).toMatchObject({ sets: [], note: 'mit', line: 1 });
    expect(r.blocks[1]?.sets.map((s) => s.reps)).toEqual([20, 20]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ kind: 'unparsed-line', line: 1, rawLine: 'mit' });
  });

  it('`nichts` yields no block and no issue', () => {
    expect(parseCell('nichts', 'Triceps Pulldowns')).toEqual({ blocks: [], tags: [], cuesDropped: [], unrecognised: [], issues: [] });
  });

  it('flags a line without alias in the Extra column as unknown-exercise', () => {
    const r = parseCell('20x 20x', 'Extra');
    expect(r.blocks[0]?.exerciseId).toBeUndefined();
    expect(r.issues.map((i) => i.kind)).toEqual(['unknown-exercise']);
  });

  it('note-only aliases become one block each', () => {
    const r = parseCell('Burpees, Pyramide Pullups', 'Extra');
    expect(r.blocks.map((b) => [b.exerciseId, b.note, b.sets.length])).toEqual([['burpees', 'Burpees', 0], ['pull-ups', 'Pyramide Pullups', 0]]);
    expect(r.issues.map((i) => i.kind)).toEqual(['note-only', 'note-only']);
  });

  it('aggregates, pyramids and parenthesised numbers pass their issues through with the line', () => {
    expect(parseCell('100 Diamonds', 'Push Ups').blocks[0]).toMatchObject({ aggregate: true, exerciseId: 'diamond-push-ups' });
    expect(parseCell('Pullups 2x die 5er Pyramide', 'Extra').blocks).toHaveLength(2);
    const paren = parseCell('25x 2 mit 17,4 kg (R 1x 20)', 'Single Leg RDL');
    expect(paren.issues).toEqual([{ kind: 'parenthesised-numbers', line: 1, rawLine: '25x 2 mit 17,4 kg (R 1x 20)', detail: '(R 1x 20)' }]);
    expect(paren.blocks[0]?.sets).toHaveLength(2);
  });
});
