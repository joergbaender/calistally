export type Token =
  | { type: 'load'; kg: number; raw: string }
  | { type: 'reps'; reps: number; raw: string }
  | { type: 'num'; value: number; raw: string }
  | { type: 'x'; raw: string }
  | { type: 'repsxsets'; reps: number; sets: number; raw: string }
  | { type: 'xsets'; sets: number; raw: string }
  | { type: 'minutes'; minutes: number; raw: string }
  | { type: 'word'; text: string; raw: string; paren: boolean };

const NUMBER = /^(\d+(?:[.,]\d+)?)$/;
const REPS = /^(\d+(?:[.,]\d+)?)x$/i;
const LOAD = /^(\d+(?:[.,]\d+)?)kg$/i;
const REPS_X_SETS = /^(\d+)x(\d+)$/i;
const X_SETS = /^x(\d+)$/i;
const MINUTES = /^(\d+)m$/i;
const BARE_KG = /^kg$/i;

export function parseNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

export function isNumeric(t: Token): boolean {
  return t.type === 'load' || t.type === 'reps' || t.type === 'num' || t.type === 'repsxsets' || t.type === 'xsets';
}

/** Spec 2 §5 "Tokens": whitespace split, decimal comma, `12,4 kg` glued, lone `/` dropped,
 *  trailing commas dropped, parentheses stripped but remembered. */
export function tokenize(line: string): Token[] {
  const parts = line.trim().split(/\s+/).filter((p) => p !== '' && p !== '/');
  const glued: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!;
    const next = parts[i + 1];
    if (next !== undefined && NUMBER.test(p) && BARE_KG.test(next)) {
      glued.push(p + next);
      i += 1;
    } else glued.push(p);
  }
  return glued.map(toToken);
}

function toToken(raw: string): Token {
  let core = raw.replace(/,+$/, '');
  let paren = false;
  if (core.startsWith('(')) {
    core = core.slice(1);
    paren = true;
  }
  if (core.endsWith(')')) {
    core = core.slice(0, -1);
    paren = true;
  }
  let m: RegExpExecArray | null;
  if ((m = LOAD.exec(core))) return { type: 'load', kg: parseNumber(m[1]!), raw };
  if ((m = REPS_X_SETS.exec(core))) return { type: 'repsxsets', reps: Number(m[1]), sets: Number(m[2]), raw };
  if ((m = REPS.exec(core))) return { type: 'reps', reps: parseNumber(m[1]!), raw };
  if ((m = X_SETS.exec(core))) return { type: 'xsets', sets: Number(m[1]), raw };
  if (/^x$/i.test(core)) return { type: 'x', raw };
  if ((m = MINUTES.exec(core))) return { type: 'minutes', minutes: Number(m[1]), raw };
  if ((m = NUMBER.exec(core))) return { type: 'num', value: parseNumber(m[1]!), raw };
  return { type: 'word', text: core.toLowerCase(), raw, paren };
}
