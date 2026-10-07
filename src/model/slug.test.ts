import { describe, expect, it } from 'vitest';
import { normalizeName, slugify } from './slug';

describe('slugify (spec §3 slug rule)', () => {
  it.each([
    ['Pull-ups', 'pull-ups'],
    ['Australian Pull-ups (Bar)', 'australian-pull-ups-bar'],
    ['Bicep Curls (EZ Bar)', 'bicep-curls-ez-bar'],
    ['Single-leg RDL', 'single-leg-rdl'],
    ['  Dips  ', 'dips'],
    ['--Dips--', 'dips'],
    ['Klimmzüge', 'klimmzuege'],
    ['Überzüge', 'ueberzuege'],
    ['Straße', 'strasse'],
    ['Café Curls', 'cafe-curls'],
    ['Push-ups +', 'push-ups'],
    ['???', 'exercise'],
    ['', 'exercise'],
  ])('%j -> %j', (name, slug) => expect(slugify(name)).toBe(slug));
});

describe('normalizeName', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeName('  Pull   ups ')).toBe('pull ups');
    expect(normalizeName('Pull Ups')).toBe(normalizeName('pull ups'));
  });
});
