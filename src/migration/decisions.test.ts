import { describe, expect, it } from 'vitest';
import { applyCellDecisions, parseDecisions } from './decisions';

describe('parseDecisions', () => {
  it('accepts the documented vocabulary', () => {
    const d = parseDecisions(JSON.stringify({
      G9: { text: '8,5kg 17x 17x', why: 'twice' },
      A49: { date: '2030-09-03' },
      A34: { dateExact: true },
      A3: { accept: true },
      'M27#3': { skip: true },
    }));
    expect(Object.keys(d)).toEqual(['G9', 'A49', 'A34', 'A3', 'M27#3']);
    expect(d['G9']).toEqual({ text: '8,5kg 17x 17x', why: 'twice' });
    expect(parseDecisions('{}')).toEqual({});
  });

  it('M2: strips a leading UTF-8 byte order mark', () => {
    expect(parseDecisions('﻿{"A3": {"accept": true}}')).toEqual({ A3: { accept: true } });
  });

  it.each([
    ['[]', /JSON object/],
    ['{"g9": {}}', /cell address/],
    ['{"G9": "x"}', /must be an object/],
    ['{"G9": {"foo": 1}}', /unknown field "foo"/],
    ['{"G9": {"text": 3}}', /text must be a string/],
    ['{"G9": {"date": "2030-02-30"}}', /date must be YYYY-MM-DD/],
    ['{"G9": {"date": "30.02.2030"}}', /date must be YYYY-MM-DD/],
    ['{"G9": {"accept": false}}', /accept must be true/],
    ['{"G9": {"why": 1}}', /why must be a string/],
  ])('rejects %s', (json, message) => {
    expect(() => parseDecisions(json)).toThrow(message);
  });
});

describe('applyCellDecisions', () => {
  const original = 'a\nb\n\nc';

  it('returns the cell unchanged without a decision', () => {
    expect(applyCellDecisions('M27', original, {})).toEqual({ text: 'a\nb\nc', used: [], seen: [] });
  });

  it('replaces the whole cell and records the key as used only if the text changed', () => {
    expect(applyCellDecisions('G9', '8,5kg 17,2x', { G9: { text: '8,5kg 17x 17x' } })).toEqual({ text: '8,5kg 17x 17x', used: ['G9'], seen: ['G9'] });
    expect(applyCellDecisions('G9', '8,5kg 17,2x', { G9: { text: ' 8,5kg 17,2x ' } })).toEqual({ text: '8,5kg 17,2x', used: [], seen: ['G9'] });
  });

  it('skips a cell', () => {
    expect(applyCellDecisions('G9', 'x', { G9: { skip: true } })).toEqual({ text: undefined, used: ['G9'], seen: ['G9'] });
  });

  it('replaces or skips one non-empty line by its 1-based index', () => {
    expect(applyCellDecisions('M27', original, { 'M27#3': { text: 'z' } })).toEqual({ text: 'a\nb\nz', used: ['M27#3'], seen: ['M27#3'] });
    expect(applyCellDecisions('M27', original, { 'M27#2': { skip: true } })).toEqual({ text: 'a\nc', used: ['M27#2'], seen: ['M27#2'] });
    expect(applyCellDecisions('M27', original, { 'M27#1': { text: 'a' } })).toEqual({ text: 'a\nb\nc', used: [], seen: ['M27#1'] });
  });

  it('applies the cell text first, then line decisions on the result', () => {
    expect(applyCellDecisions('M27', original, { M27: { text: 'p\nq' }, 'M27#2': { text: 'r' } })).toEqual({ text: 'p\nr', used: ['M27', 'M27#2'], seen: ['M27', 'M27#2'] });
  });
});
