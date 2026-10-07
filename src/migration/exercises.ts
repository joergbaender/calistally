import { normalizeName } from '../model/slug';

/** Spec 2 §6: closed alias table. Words are the lowercased, comma- and parenthesis-stripped word
 *  tokens of tokenize.ts, so `Pullups,` and `(Diamonds)` still match. `Downs` and `Bands` stay
 *  keywords, so `Dips Downs` is the alias `dips` plus the keyword. */
export interface Alias {
  words: readonly string[];
  id: string;
}

export const ALIASES: readonly Alias[] = [
  { words: ['aust', 'pullups'], id: 'australian-pull-ups-rings' },
  { words: ['aus', 'pullup'], id: 'australian-pull-ups-rings' },
  { words: ['australian', 'pullups'], id: 'australian-pull-ups-rings' },
  { words: ['australians'], id: 'australian-pull-ups-rings' },
  { words: ['pyramide', 'pullups'], id: 'pull-ups' },
  { words: ['neg', 'pullups'], id: 'negative-pull-ups' },
  { words: ['pullups'], id: 'pull-ups' },
  { words: ['pullup'], id: 'pull-ups' },
  { words: ['facepull'], id: 'face-pulls-band' },
  { words: ['dipbar', 'knee', 'raises'], id: 'knee-raises-dip-bar' },
  { words: ['knee', 'raises'], id: 'knee-raises-dip-bar' },
  { words: ['dips'], id: 'dips-bar' },
  { words: ['ring', 'deficit', 'pushups'], id: 'ring-deficit-push-ups' },
  { words: ['rings'], id: 'ring-deficit-push-ups' },
  { words: ['diamond'], id: 'diamond-push-ups' },
  { words: ['diamonds'], id: 'diamond-push-ups' },
  { words: ['overhead', 'press'], id: 'overhead-press-band' },
  { words: ['lat', 'raise'], id: 'lateral-raises-band' },
  { words: ['lateral', 'raises'], id: 'lateral-raises-band' },
  { words: ['normal', 'squats'], id: 'squats' },
  { words: ['jump', 'squats'], id: 'jump-squats' },
  { words: ['calve', 'raises'], id: 'calf-raises' },
  { words: ['burpees'], id: 'burpees' },
];

/** Keys are normalizeName(header text of row 2). `Extra` has no entry on purpose (spec 2 §4). */
export const HEADER_EXERCISES: Readonly<Record<string, string>> = {
  'australian pull ups': 'australian-pull-ups-rings',
  'bicep curls': 'bicep-curls-band',
  'face pulls': 'face-pulls-band',
  dips: 'dips-bar',
  'push ups': 'push-ups',
  'triceps pulldowns': 'triceps-pulldowns-band',
  'single leg rdl': 'single-leg-rdl',
  'split squats': 'split-squats',
  'calf raises': 'calf-raises',
};

/** `Bands` on a header family that has a band variant (spec 2 §6). */
export const BAND_VARIANTS: Readonly<Record<string, string>> = {
  'single-leg-rdl': 'single-leg-rdl-band',
  'calf-raises': 'calf-raises-band',
};

export type Refinement = 'stange' | 'ez-bar' | 'maschine';

export const REFINEMENT_PHRASES: readonly { words: readonly string[]; refinement: Refinement }[] = [
  { words: ['stange'], refinement: 'stange' },
  { words: ['sz', 'hantel'], refinement: 'ez-bar' },
  { words: ['maschine'], refinement: 'maschine' },
];

const REFINED: Readonly<Record<Refinement, Readonly<Record<string, string>>>> = {
  stange: { 'australian-pull-ups-rings': 'australian-pull-ups-bar' },
  'ez-bar': { 'bicep-curls-band': 'bicep-curls-ez-bar' },
  maschine: { 'face-pulls-band': 'face-pulls-cable' },
};

export function resolveExercise(
  aliasId: string | undefined,
  header: string,
  opts: { bands: boolean; refinements: readonly Refinement[] },
): string | undefined {
  let id = aliasId ?? HEADER_EXERCISES[normalizeName(header)];
  if (id === undefined) return undefined;
  if (opts.bands) id = BAND_VARIANTS[id] ?? id;
  for (const r of opts.refinements) id = REFINED[r][id] ?? id;
  return id;
}

/** Every id the migration can emit; a test checks they are all seed ids. */
export function allTargetIds(): string[] {
  const ids = new Set<string>();
  for (const a of ALIASES) ids.add(a.id);
  for (const id of Object.values(HEADER_EXERCISES)) ids.add(id);
  for (const id of Object.values(BAND_VARIANTS)) ids.add(id);
  for (const map of Object.values(REFINED)) for (const id of Object.values(map)) ids.add(id);
  return [...ids].sort();
}
