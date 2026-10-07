/** Spec 2 §7 phrase lists and the §5 keywords. Words as produced by tokenize.ts (lowercase). */
export const TAG_PHRASES: readonly { words: readonly string[]; tag: string }[] = [
  { words: ['weil', 'erkältet'], tag: 'sick' },
  { words: ['erkältet'], tag: 'sick' },
  { words: ['nach', 'frühstück'], tag: 'after-meal' },
  { words: ['nach', 'essen'], tag: 'after-meal' },
];

/** Standing cues of Australian Pull-ups (Rings); dropped from blocks, kept once in the seed. */
export const CUE_PHRASES: readonly (readonly string[])[] = [['sauber', 'ellbogen'], ['langsam'], ['gestreckt']];

export const ORDER_FIRST_PHRASE: readonly string[] = ['vor', 'den', 'australians'];

/** Multi-word notes that must not be read as keywords (`ohne Griffe` is not the `ohne` load keyword). */
export const NOTE_PHRASES: readonly (readonly string[])[] = [['ohne', 'griffe']];

/** Words the set grammar consumes. */
export const GRAMMAR_KEYWORDS: ReadonlySet<string> = new Set(['mit', 'ohne', 'bodyweight', 'down', 'downs', 'dann', 'plus']);

/** Words that set a line flag and never reach the grammar. */
export const FLAG_KEYWORDS: ReadonlySet<string> = new Set(['bands', 'nichts']);
