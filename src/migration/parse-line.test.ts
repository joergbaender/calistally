import { describe, expect, it } from 'vitest';
import { parseLine } from './parse-line';

/** `20@25 15@35 | 5 5` : segments separated by ` | `, sets as reps[@kg|@bw]. */
const show = (line: string): string =>
  parseLine(line)
    .segments.map((s) => s.sets.map((x) => `${x.reps}${x.kg !== undefined ? `@${x.kg}` : x.bodyweight ? '@bw' : ''}`).join(' '))
    .join(' | ');
const kinds = (line: string): string[] => parseLine(line).issues.map((i) => i.kind);

describe('parseLine: set-building rules of spec §5', () => {
  it('one set per REPS, at the current load', () => {
    expect(show('20x  15x 12x')).toBe('20 15 12');
    expect(show('6kg 15x 12x 12x')).toBe('15@6 12@6 12@6');
    expect(show('17,4kg 30x 28,9kg 30x 20x')).toBe('30@17.4 30@28.9 20@28.9');
    expect(show('9,1kg 20,5x 14,5x')).toBe('20.5@9.1 14.5@9.1');
  });

  it('NUM sets of REPS in all four spellings', () => {
    expect(show('20x 3')).toBe('20 20 20');
    expect(show('12 x 3')).toBe('12 12 12');
    expect(show('25x2')).toBe('25 25');
    expect(show('15x x2')).toBe('15 15');
    expect(show('30kg 20x 3')).toBe('20@30 20@30 20@30');
  });

  it('LOAD X NUM, optionally times sets', () => {
    expect(show('25kg x 20  35kg x 15  35kg x 15')).toBe('20@25 15@35 15@35');
    expect(show('25kg x 20 x3')).toBe('20@25 20@25 20@25');
    expect(show('25kg 20 x 3')).toBe('20@25 20@25 20@25');
  });

  it('`mit LOAD` loads every earlier set that has none yet and does not become the current load', () => {
    expect(show('20 x 3 mit 6kg')).toBe('20@6 20@6 20@6');
    expect(show('15 x 3 mit 6 kg')).toBe('15@6 15@6 15@6');
    expect(show('15x mit 17,4kg 20x mit 12,4kg')).toBe('15@17.4 20@12.4');
    expect(show('25x 20x mit 17,4 kg')).toBe('25@17.4 20@17.4');
  });

  it('`ohne` and `Bodyweight` make sets explicitly bodyweight', () => {
    expect(show('20x ohne / 20x mit 12,4kg')).toBe('20@bw 20@12.4');
    expect(show('30x 2 ohne')).toBe('30@bw 30@bw');
    expect(show('Bodyweight 20x 25x')).toBe('20@bw 25@bw');
    expect(show('20x 2 ohne weil erkältet')).toBe('20@bw 20@bw');
    expect(parseLine('20x 2 ohne weil erkältet').tags).toEqual(['sick']);
  });

  it('`Bands` is a flag, the kg stay per set', () => {
    const p = parseLine('Bands 50kg 20x 60kg 15x x2');
    expect(p.bands).toBe(true);
    expect(show('Bands 50kg 20x 60kg 15x x2')).toBe('20@50 15@60 15@60');
    expect(show('Bands 25kg 24x 35kg 25x 50kg 25x')).toBe('24@25 25@35 25@50');
  });

  it('ladders: `N down`, `Downs REPS` alone, and a written-out list', () => {
    expect(show('10 down')).toBe('10 9 8 7 6 5 4 3 2 1');
    expect(show('Ring deficit pushups 15 down').split(' ')).toHaveLength(15);
    expect(show('Rings Downs 15x').split(' ')).toHaveLength(15);
    expect(show('Dips Downs 15x 14x 13x 10x')).toBe('15 14 13 10');
  });

  it('rest phrases set restSec and stay in the note', () => {
    const rings = parseLine('Rings Downs 15x Start with 1m Rest');
    expect(rings.restSec).toBe(60);
    expect(rings.noteWords).toEqual(['Start with 1m Rest']);
    expect(rings.alias?.id).toBe('ring-deficit-push-ups');
    const emom = parseLine('10x 7 every 2 minutes');
    expect(emom.restSec).toBe(120);
    expect(emom.noteWords).toEqual(['every 2 minutes']);
    expect(show('10x 7 every 2 minutes')).toBe('10 10 10 10 10 10 10');
  });

  it('`dann` splits segments, a leading `dann`/`plus` sets join', () => {
    expect(show('Pullups 1x 2x 3x dann 5x 5x')).toBe('1 2 3 | 5 5');
    expect(parseLine('dann 7x 6x').join).toBe('dann');
    expect(show('dann 7x 6x')).toBe('7 6');
    expect(parseLine('plus 10x 3').join).toBe('plus');
    expect(parseLine('Pullups 1x').join).toBe('new');
  });

  it('expands pyramids and flags them', () => {
    expect(show('Pullups 2x die 5er Pyramide')).toBe('1 2 3 4 5 4 3 2 1 | 1 2 3 4 5 4 3 2 1');
    expect(show('Pullups 5er Pyramide')).toBe('1 2 3 4 5 4 3 2 1');
    expect(kinds('Pullups 5er Pyramide')).toEqual(['pyramid-expanded']);
    expect(kinds('Pullups 5er Pyramide 10x')).toEqual(['unparsed-line']);
  });

  it('aggregate: a single number before the exercise name', () => {
    const p = parseLine('100 Diamonds');
    expect(p.segments).toEqual([{ sets: [{ reps: 100, bodyweight: false }], aggregate: true }]);
    expect(p.alias?.id).toBe('diamond-push-ups');
    expect(kinds('100 Diamonds')).toEqual(['aggregate']);
    expect(parseLine('100x Dipbar Knee Raises').alias?.id).toBe('knee-raises-dip-bar');
    expect(kinds('100x Dipbar Knee Raises')).toEqual(['aggregate']);
    expect(kinds('Diamonds 20x')).toEqual([]);
  });

  it('note-only blocks: exercise names without numbers', () => {
    const p = parseLine('Burpees, Pyramide Pullups');
    expect(p.segments).toEqual([{ sets: [], noteOnly: 'Burpees' }, { sets: [], noteOnly: 'Pyramide Pullups' }]);
    expect(kinds('Burpees, Pyramide Pullups')).toEqual(['note-only', 'note-only']);
    expect(parseLine('Overhead Press Bands').segments).toEqual([{ sets: [], noteOnly: 'Overhead Press' }]);
    expect(parseLine('Overhead Press Bands').bands).toBe(true);
  });

  it('`nichts` yields nothing', () => {
    const p = parseLine('nichts');
    expect(p.nichts).toBe(true);
    expect(p.segments).toEqual([]);
    expect(p.issues).toEqual([]);
  });
});

describe('parseLine: phrases, aliases, refinements, notes', () => {
  it('tags and cues are extracted and dropped; leftovers become notes', () => {
    const p = parseLine('nach Essen, voller Bauch');
    expect(p.tags).toEqual(['after-meal']);
    expect(p.noteWords).toEqual(['voller', 'Bauch']);
    expect(p.unrecognised).toEqual(['voller', 'Bauch']);
    expect(p.segments).toEqual([]);
    const cues = parseLine('sauber (Ellbogen), langsam, gestreckt erkältet');
    expect(cues.cuesDropped).toEqual(['sauber (Ellbogen)', 'langsam', 'gestreckt']);
    expect(cues.tags).toEqual(['sick']);
    expect(cues.noteWords).toEqual([]);
  });

  it('`vor den Australians` sets orderFirst and leaves no note', () => {
    const p = parseLine('Pullups 1x 2x 3x vor den Australians');
    expect(p.orderFirst).toBe(true);
    expect(p.noteWords).toEqual([]);
    expect(show('Pullups 1x 2x 3x vor den Australians')).toBe('1 2 3');
  });

  it('`ohne Griffe` is a note phrase, not the load keyword', () => {
    const p = parseLine('35kg 20 x 2 ohne Griffe');
    expect(show('35kg 20 x 2 ohne Griffe')).toBe('20@35 20@35');
    expect(p.noteWords).toEqual(['ohne Griffe']);
    expect(p.unrecognised).toEqual([]);
  });

  it('keeps unknown words as notes in their original spelling', () => {
    expect(parseLine('10kg 20x 16,5x Deeep').noteWords).toEqual(['Deeep']);
    expect(parseLine('11,5kg 12x 19x (schräger)').noteWords).toEqual(['(schräger)']);
    expect(parseLine('flacher 20x 20x').noteWords).toEqual(['flacher']);
    expect(show('flacher 20x 20x')).toBe('20 20');
  });

  it('finds the longest alias first and records all aliases', () => {
    expect(parseLine('Aust Pullups 10kg 17x 14x').alias).toEqual({ id: 'australian-pull-ups-rings', raw: 'Aust Pullups' });
    expect(parseLine('Neg Pullups 10x').alias?.id).toBe('negative-pull-ups');
    expect(parseLine('Pyramide Pullups').alias?.id).toBe('pull-ups');
    expect(parseLine('Lat Raise Bands 10kg 22x 22x').alias?.id).toBe('lateral-raises-band');
    expect(parseLine('normal Squats 17,4kg 30x').alias?.id).toBe('squats');
    expect(parseLine('Calve Raises 35x 3').alias?.id).toBe('calf-raises');
    expect(parseLine('Burpees, Pyramide Pullups').aliases.map((a) => a.id)).toEqual(['burpees', 'pull-ups']);
  });

  it('collects refinements', () => {
    expect(parseLine('Aust Pullups Stange 20x 20x').refinements).toEqual(['stange']);
    expect(parseLine('10kg SZ Hantel 17x 15,5x').refinements).toEqual(['ez-bar']);
    expect(show('10kg SZ Hantel 17x 15,5x')).toBe('17@10 15.5@10');
    expect(parseLine('15kg Maschine 23x 2').refinements).toEqual(['maschine']);
  });
});

describe('parseLine: review triggers and failures', () => {
  it('flags more sets than reps', () => {
    expect(kinds('Diamonds 5x 20')).toEqual(['sets-exceed-reps']);
    expect(show('Diamonds 5x 20').split(' ')).toHaveLength(20);
  });

  it('flags and removes a parenthesised group with numbers', () => {
    const p = parseLine('25x 2 mit 17,4 kg (R 1x 20)');
    expect(show('25x 2 mit 17,4 kg (R 1x 20)')).toBe('25@17.4 25@17.4');
    expect(p.issues).toEqual([{ kind: 'parenthesised-numbers', detail: '(R 1x 20)' }]);
  });

  it('never drops numbers silently: unused loads, idle `mit` and `nichts` with numbers fail', () => {
    for (const line of ['nichts 20x', 'Pullups 20x 25kg', '6kg 20x mit 8kg', '20x ohne mit 5kg']) {
      const p = parseLine(line);
      expect(p.segments, line).toEqual([]);
      expect(p.issues.map((i) => i.kind), line).toContain('unparsed-line');
    }
  });

  it('reports grammar failures as unparsed-line with no segments', () => {
    for (const line of ['mit', '6kg', '3', 'x 20', 'Pullups 1x 2x dann', 'Pullups 5x Dips 5x', '0x 3']) {
      const p = parseLine(line);
      expect(p.segments, line).toEqual([]);
      expect(p.issues.map((i) => i.kind), line).toContain('unparsed-line');
    }
  });

  it('F1: a leftover word with a digit in it is an unparsed line, not a note', () => {
    for (const [line, raw] of [['20x/15x', '20x/15x'], ['20x 15x 12xx', '12xx'], ['3×5', '3×5']] as const) {
      const p = parseLine(line);
      expect(p.segments, line).toEqual([]);
      expect(p.issues, line).toContainEqual({ kind: 'unparsed-line', detail: `number not understood: ${raw}` });
    }
    expect(kinds('Pullups 5er Pyramide')).toEqual(['pyramid-expanded']);
    expect(show('Pullups 2x die 5er Pyramide')).toBe('1 2 3 4 5 4 3 2 1 | 1 2 3 4 5 4 3 2 1');
    expect(parseLine('Rings Downs 15x Start with 1m Rest').restSec).toBe(60);
    expect(show('10x 7 every 2 minutes')).toBe('10 10 10 10 10 10 10');
  });

  it('F6: an unrecognised word between two paired numbers blocks the pairing', () => {
    const p = parseLine('10x kurz 5');
    expect(p.segments).toEqual([]);
    expect(p.issues.map((i) => i.kind)).toContain('unparsed-line');
    for (const line of ['25kg x kurz 20', '12 kurz x 3', '15x kurz x2']) {
      expect(parseLine(line).segments, line).toEqual([]);
      expect(kinds(line), line).toContain('unparsed-line');
    }
    expect(show('35kg 20 x 2 ohne Griffe')).toBe('20@35 20@35');
    expect(show('10kg SZ Hantel 17x 15,5x')).toBe('17@10 15.5@10');
    expect(show('20x 2 ohne weil erkältet')).toBe('20@bw 20@bw');
    expect(show('20x weil erkältet 2')).toBe('20 20');
    expect(show('Rings Downs 15x Start with 1m Rest').split(' ')).toHaveLength(15);
    expect(show('10x 7 every 2 minutes')).toBe('10 10 10 10 10 10 10');
    expect(show('flacher 20x 20x')).toBe('20 20');
  });

  it('F8: a load before `Bodyweight` that no set used is an unparsed line', () => {
    const p = parseLine('25kg Bodyweight 20x');
    expect(p.segments).toEqual([]);
    expect(p.issues.map((i) => i.kind)).toContain('unparsed-line');
    expect(show('Bodyweight 20x 25x')).toBe('20@bw 25@bw');
    expect(show('25kg 20x Bodyweight 15x')).toBe('20@25 15@bw');
  });
});
