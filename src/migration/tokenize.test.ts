import { describe, expect, it } from 'vitest';
import { isNumeric, parseNumber, tokenize } from './tokenize';

const types = (line: string) => tokenize(line).map((t) => t.type);

describe('tokenize', () => {
  it('reads loads, reps, bare numbers and x in every spelling of the sheet', () => {
    expect(tokenize('25kg x 20 x3')).toEqual([
      { type: 'load', kg: 25, raw: '25kg' },
      { type: 'x', raw: 'x' },
      { type: 'num', value: 20, raw: '20' },
      { type: 'xsets', sets: 3, raw: 'x3' },
    ]);
    expect(tokenize('25x2')).toEqual([{ type: 'repsxsets', reps: 25, sets: 2, raw: '25x2' }]);
    expect(tokenize('10Kg 30x')).toEqual([{ type: 'load', kg: 10, raw: '10Kg' }, { type: 'reps', reps: 30, raw: '30x' }]);
  });

  it('uses the decimal comma and glues `12,4 kg`', () => {
    expect(tokenize('16,5x 12,4 kg 28.9kg')).toEqual([
      { type: 'reps', reps: 16.5, raw: '16,5x' },
      { type: 'load', kg: 12.4, raw: '12,4kg' },
      { type: 'load', kg: 28.9, raw: '28.9kg' },
    ]);
    expect(parseNumber('17,2')).toBe(17.2);
  });

  it('ignores extra whitespace and a lone slash', () => {
    expect(types('  20x  15x / 12x ')).toEqual(['reps', 'reps', 'reps']);
  });

  it('lowercases words, strips trailing commas and remembers parentheses', () => {
    expect(tokenize('Burpees, (schräger) Ellbogen),')).toEqual([
      { type: 'word', text: 'burpees', raw: 'Burpees,', paren: false },
      { type: 'word', text: 'schräger', raw: '(schräger)', paren: true },
      { type: 'word', text: 'ellbogen', raw: 'Ellbogen),', paren: true },
    ]);
  });

  it('reads minutes and keeps `5er` as a word', () => {
    expect(tokenize('1m 5er')).toEqual([
      { type: 'minutes', minutes: 1, raw: '1m' },
      { type: 'word', text: '5er', raw: '5er', paren: false },
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(tokenize('   ')).toEqual([]);
  });

  it('classifies numeric tokens', () => {
    expect(tokenize('6kg 15x 3 x 25x2 x2 1m mit').map(isNumeric)).toEqual([true, true, true, false, true, true, false, false]);
  });
});
