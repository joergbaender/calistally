import { ALIASES, REFINEMENT_PHRASES, type Refinement } from './exercises';
import { CUE_PHRASES, FLAG_KEYWORDS, GRAMMAR_KEYWORDS, NOTE_PHRASES, ORDER_FIRST_PHRASE, TAG_PHRASES } from './phrases';
import { isNumeric, tokenize, type Token } from './tokenize';
import type { ReviewKind } from './types';

export interface ParsedSet {
  reps: number;
  kg?: number;
  /** true: the sheet says explicitly that no load was used (`ohne`, `Bodyweight`). */
  bodyweight: boolean;
}

export interface LineSegment {
  sets: ParsedSet[];
  aggregate?: true;
  /** Note-only block: the exercise alias as written. */
  noteOnly?: string;
}

export type LineJoin = 'new' | 'dann' | 'plus';

export interface LineIssue {
  kind: ReviewKind;
  detail: string;
}

export interface ParsedLine {
  /** First exercise alias on the line (undefined: use the column header). */
  alias?: { id: string; raw: string };
  /** Every alias on the line, in order. */
  aliases: { id: string; raw: string }[];
  join: LineJoin;
  /** One per block this line produces: split at `dann`, or M pyramid copies, or one per note-only alias. */
  segments: LineSegment[];
  bands: boolean;
  nichts: boolean;
  refinements: Refinement[];
  tags: string[];
  cuesDropped: string[];
  orderFirst: boolean;
  restSec?: number;
  /** Leftover words and note phrases, original spelling and order. */
  noteWords: string[];
  /** Leftover words that matched no list at all (subset of noteWords). */
  unrecognised: string[];
  issues: LineIssue[];
}

class GrammarError extends Error {}

const PAREN_WITH_NUMBER = /\([^)]*\d[^)]*\)/g;
const NER = /^(\d+)er$/;

function wordsMatch(tokens: readonly Token[], at: number, words: readonly string[]): boolean {
  for (let k = 0; k < words.length; k += 1) {
    const t = tokens[at + k];
    if (t === undefined || t.type !== 'word' || t.text !== words[k]) return false;
  }
  return true;
}

function wordAt(tokens: readonly Token[], at: number): string | undefined {
  const t = tokens[at];
  return t?.type === 'word' ? t.text : undefined;
}

/** The original spelling of `count` tokens from `at`, trailing commas dropped. */
function rawOf(tokens: readonly Token[], at: number, count: number): string {
  return tokens.slice(at, at + count).map((t) => t.raw.replace(/,+$/, '')).join(' ');
}

const ALIASES_LONGEST_FIRST = [...ALIASES].sort((a, b) => b.words.length - a.words.length);

/** Spec 2 §5: one line of a cell → segments, flags, notes and review issues. The exercise is not
 *  yet resolved against the header; parse-cell.ts does that. */
export function parseLine(input: string): ParsedLine {
  const out: ParsedLine = {
    aliases: [], join: 'new', segments: [], bands: false, nichts: false, refinements: [], tags: [],
    cuesDropped: [], orderFirst: false, noteWords: [], unrecognised: [], issues: [],
  };
  let line = input;
  const parenGroups = line.match(PAREN_WITH_NUMBER);
  if (parenGroups) {
    out.issues.push({ kind: 'parenthesised-numbers', detail: parenGroups.join(' ') });
    line = line.replace(PAREN_WITH_NUMBER, ' ');
  }
  const tokens = tokenize(line);

  // Phrase pass: words are consumed by phrases, aliases, flags and keywords; everything numeric
  // and every grammar keyword goes to `rest` for the set grammar.
  const rest: Token[] = [];
  let aliasRestIndex: number | undefined;
  let pyramid: { blocks: number; top: number } | undefined;
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    const ner2 = NER.exec(wordAt(tokens, i + 2) ?? '');
    if (t.type === 'reps' && wordAt(tokens, i + 1) === 'die' && ner2 && wordAt(tokens, i + 3) === 'pyramide') {
      pyramid = { blocks: t.reps, top: Number(ner2[1]) };
      i += 4;
      continue;
    }
    if (t.type !== 'word') {
      rest.push(t);
      i += 1;
      continue;
    }
    const ner0 = NER.exec(t.text);
    if (ner0 && wordAt(tokens, i + 1) === 'pyramide') {
      pyramid = { blocks: 1, top: Number(ner0[1]) };
      i += 2;
      continue;
    }
    if (wordsMatch(tokens, i, ORDER_FIRST_PHRASE)) {
      out.orderFirst = true;
      i += ORDER_FIRST_PHRASE.length;
      continue;
    }
    const n1 = tokens[i + 1];
    if (t.text === 'every' && n1?.type === 'num' && wordAt(tokens, i + 2) === 'minutes') {
      out.restSec = 60 * n1.value;
      out.noteWords.push(rawOf(tokens, i, 3));
      i += 3;
      continue;
    }
    const n2 = tokens[i + 2];
    if (wordsMatch(tokens, i, ['start', 'with']) && n2?.type === 'minutes' && wordAt(tokens, i + 3) === 'rest') {
      out.restSec = 60 * n2.minutes;
      out.noteWords.push(rawOf(tokens, i, 4));
      i += 4;
      continue;
    }
    const alias = ALIASES_LONGEST_FIRST.find((a) => wordsMatch(tokens, i, a.words));
    if (alias) {
      out.aliases.push({ id: alias.id, raw: rawOf(tokens, i, alias.words.length) });
      if (aliasRestIndex === undefined) aliasRestIndex = rest.length;
      i += alias.words.length;
      continue;
    }
    const tag = TAG_PHRASES.find((p) => wordsMatch(tokens, i, p.words));
    if (tag) {
      out.tags.push(tag.tag);
      i += tag.words.length;
      continue;
    }
    const cue = CUE_PHRASES.find((p) => wordsMatch(tokens, i, p));
    if (cue) {
      out.cuesDropped.push(rawOf(tokens, i, cue.length));
      i += cue.length;
      continue;
    }
    const note = NOTE_PHRASES.find((p) => wordsMatch(tokens, i, p));
    if (note) {
      out.noteWords.push(rawOf(tokens, i, note.length));
      i += note.length;
      continue;
    }
    const refinement = REFINEMENT_PHRASES.find((p) => wordsMatch(tokens, i, p.words));
    if (refinement) {
      out.refinements.push(refinement.refinement);
      i += refinement.words.length;
      continue;
    }
    if (FLAG_KEYWORDS.has(t.text)) {
      if (t.text === 'bands') out.bands = true;
      else out.nichts = true;
      i += 1;
      continue;
    }
    if (GRAMMAR_KEYWORDS.has(t.text)) {
      rest.push(t);
      i += 1;
      continue;
    }
    out.noteWords.push(t.raw);
    out.unrecognised.push(t.raw);
    i += 1;
  }
  if (out.aliases[0] !== undefined) out.alias = out.aliases[0];

  const first = rest[0];
  if (first?.type === 'word' && (first.text === 'dann' || first.text === 'plus')) {
    out.join = first.text;
    rest.shift();
    if (aliasRestIndex !== undefined && aliasRestIndex > 0) aliasRestIndex -= 1;
  }
  const numeric = rest.filter(isNumeric);

  if (pyramid) {
    const { blocks, top } = pyramid;
    if (numeric.length > 0 || !Number.isInteger(top) || top < 1 || !Number.isInteger(blocks) || blocks < 1) {
      out.issues.push({ kind: 'unparsed-line', detail: 'pyramid phrase mixed with other numbers' });
      return out;
    }
    const reps = [...Array.from({ length: top }, (_, k) => k + 1), ...Array.from({ length: top - 1 }, (_, k) => top - 1 - k)];
    for (let b = 0; b < blocks; b += 1) out.segments.push({ sets: reps.map((r) => ({ reps: r, bodyweight: false })) });
    out.issues.push({ kind: 'pyramid-expanded', detail: `${blocks} × ${reps.join(' ')}` });
    return out;
  }
  if (out.nichts) {
    if (numeric.length > 0) out.issues.push({ kind: 'unparsed-line', detail: 'nichts with numbers' });
    return out;
  }
  if (numeric.length === 0) {
    if (rest.length > 0) {
      out.issues.push({ kind: 'unparsed-line', detail: `keyword without numbers: ${rest.map((t) => t.raw).join(' ')}` });
      return out;
    }
    for (const a of out.aliases) {
      out.segments.push({ sets: [], noteOnly: a.raw });
      out.issues.push({ kind: 'note-only', detail: a.raw });
    }
    return out;
  }
  // Aggregate: exactly one number, before the single alias, nothing else numeric and no keywords.
  if (out.aliases.length === 1 && aliasRestIndex === 1 && rest.length === 1) {
    const t = rest[0]!;
    const total = t.type === 'num' ? t.value : t.type === 'reps' ? t.reps : undefined;
    if (total !== undefined && total > 0) {
      out.segments.push({ sets: [{ reps: total, bodyweight: false }], aggregate: true });
      out.issues.push({ kind: 'aggregate', detail: `${total} total, set count unknown` });
      return out;
    }
  }
  if (out.aliases.length > 1) {
    out.issues.push({ kind: 'unparsed-line', detail: `several exercise names with numbers: ${out.aliases.map((a) => a.raw).join(', ')}` });
    return out;
  }
  try {
    const { segments, issues } = runGrammar(rest);
    out.segments = segments;
    out.issues.push(...issues);
  } catch (e) {
    if (!(e instanceof GrammarError)) throw e;
    out.issues.push({ kind: 'unparsed-line', detail: e.message });
    out.segments = [];
  }
  return out;
}

/** The set-building rules of spec 2 §5, left to right. */
function runGrammar(rest: readonly Token[]): { segments: LineSegment[]; issues: LineIssue[] } {
  const issues: LineIssue[] = [];
  const segments: LineSegment[] = [{ sets: [] }];
  let sets = segments[0]!.sets;
  let load: number | undefined;
  let bodyweightMode = false;
  let loadUnused = false;

  const push = (reps: number, count: number): void => {
    loadUnused = false;
    if (!(reps > 0) || !Number.isInteger(count) || count < 1) throw new GrammarError(`cannot read ${count} × ${reps}`);
    if (count > reps) issues.push({ kind: 'sets-exceed-reps', detail: `${count} sets of ${reps}` });
    for (let k = 0; k < count; k += 1) {
      sets.push(load !== undefined ? { reps, kg: load, bodyweight: false } : { reps, bodyweight: bodyweightMode });
    }
  };
  const ladder = (top: number): void => {
    if (!Number.isInteger(top) || top < 1) throw new GrammarError(`cannot read ladder ${top} down`);
    for (let r = top; r >= 1; r -= 1) push(r, 1);
  };

  for (let i = 0; i < rest.length; ) {
    const t = rest[i]!;
    const n1 = rest[i + 1];
    const n2 = rest[i + 2];
    const n3 = rest[i + 3];
    switch (t.type) {
      case 'load':
        if (loadUnused) throw new GrammarError('a load with no sets');
        load = t.kg;
        loadUnused = true;
        bodyweightMode = false;
        if (n1?.type === 'x' && n2?.type === 'num') {
          const count = n3?.type === 'xsets' ? n3.sets : 1;
          push(n2.value, count);
          i += n3?.type === 'xsets' ? 4 : 3;
        } else i += 1;
        break;
      case 'reps':
        if (n1?.type === 'num') {
          push(t.reps, n1.value);
          i += 2;
        } else if (n1?.type === 'xsets') {
          push(t.reps, n1.sets);
          i += 2;
        } else {
          push(t.reps, 1);
          i += 1;
        }
        break;
      case 'repsxsets':
        push(t.reps, t.sets);
        i += 1;
        break;
      case 'num':
        if (n1?.type === 'x' && n2?.type === 'num') {
          push(t.value, n2.value);
          i += 3;
        } else if (n1?.type === 'word' && n1.text === 'down') {
          ladder(t.value);
          i += 2;
        } else throw new GrammarError(`bare number ${t.raw}`);
        break;
      case 'word':
        switch (t.text) {
          case 'mit':
            if (n1?.type !== 'load') throw new GrammarError('mit without a load');
            let applied = 0;
            for (const s of sets) {
              if (s.kg === undefined && !s.bodyweight) {
                s.kg = n1.kg;
                applied += 1;
              }
            }
            if (applied === 0) throw new GrammarError('mit LOAD applies to no set');
            i += 2;
            break;
          case 'ohne':
            for (const s of sets) if (s.kg === undefined) s.bodyweight = true;
            i += 1;
            break;
          case 'bodyweight':
            bodyweightMode = true;
            load = undefined;
            i += 1;
            break;
          case 'downs':
            if (n1?.type === 'reps' && n2?.type !== 'reps') {
              ladder(n1.reps);
              i += 2;
            } else i += 1;
            break;
          case 'dann':
            sets = [];
            segments.push({ sets });
            i += 1;
            break;
          case 'plus':
            i += 1;
            break;
          default:
            throw new GrammarError(`unexpected ${t.raw}`);
        }
        break;
      default:
        throw new GrammarError(`unexpected ${t.raw}`);
    }
  }
  if (loadUnused) throw new GrammarError('a load with no sets');
  if (segments.some((s) => s.sets.length === 0)) throw new GrammarError('a block without sets');
  return { segments, issues };
}
