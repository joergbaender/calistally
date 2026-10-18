import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from './theme';

/** Spec 4 §8 (U11): every colour is a token in theme.css; components never contain a literal colour. */
const UI_DIR = join(import.meta.dirname, '.');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?:^|[^-\w])(?:color|background(?:-color)?)\s*:\s*(?!var\(|transparent|inherit|currentColor|none)[a-z]+/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('theme tokens', () => {
  it('no literal colour outside theme.css', () => {
    const offenders = walk(UI_DIR)
      .filter((f) => !f.endsWith('theme.css') && !f.endsWith('theme.test.ts') && /\.(tsx?|css)$/.test(f))
      .filter((f) => LITERAL.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every theme block declares every token of spec 4 §8 and spec 5 §3, and color-scheme', () => {
    const blocks = themeBlocks();
    for (const t of THEMES) {
      expect([...(blocks.get(t.id)?.keys() ?? [])].sort(), t.id).toEqual([...TOKENS, 'color-scheme'].sort());
    }
  });

  it('the theme blocks are exactly the themes of theme.ts, in its order', () => {
    expect([...themeBlocks().keys()]).toEqual(THEMES.map((t) => t.id));
  });

  it('color-scheme matches each theme kind', () => {
    const blocks = themeBlocks();
    for (const t of THEMES) expect(blocks.get(t.id)?.get('color-scheme'), t.id).toBe(t.kind);
  });

  it('Slate & Amber renders as before spec 5: strip, scrim and shadow are its old --bg mixes', () => {
    const slate = themeBlocks().get('slate');
    expect(slate?.get('--status-bar')).toBe('var(--bg)');
    expect(slate?.get('--scrim')).toBe('color-mix(in srgb, var(--bg) 70%, transparent)');
    expect(slate?.get('--shadow')).toBe('color-mix(in srgb, var(--bg) 60%, transparent)');
  });

  it('the block parser refuses a theme declared twice', () => {
    expect(() => themeBlocks(':root, [data-theme="slate"] { --bg: #000000; } [data-theme="slate"] { --bg: #000000; }')).toThrow('slate block twice');
  });
});

/** Spec 5 §8: contrast of every theme, computed from theme.css itself. */
describe('theme contrast', () => {
  const blocks = themeBlocks();
  const SURFACES = ['--bg', '--panel', '--panel-2'] as const;
  const TEXT = ['--text', '--muted', '--accent', '--ok', '--danger'] as const;
  const DOTS = ['--chip-push', '--chip-pull', '--chip-legs', '--chip-other'] as const;

  it.each(THEMES.map((t) => t.id))('%s: text 4.5:1, dots 3:1, white on the status strip 4.5:1', (id) => {
    const block = blocks.get(id);
    if (block === undefined) throw new Error(`no block for ${id}`);
    const colour = (token: string): string => resolveHex(block, token, id);
    const failures: string[] = [];
    const check = (fg: string, bg: string, min: number, fgLabel = fg): void => {
      const r = contrast(fg.startsWith('#') ? fg : colour(fg), colour(bg));
      if (r < min) failures.push(`${id}: ${fgLabel} on ${bg} is ${r.toFixed(2)}, needs ${min}`);
    };
    for (const fg of TEXT) for (const bg of SURFACES) check(fg, bg, 4.5);
    check('--on-accent', '--accent', 4.5);
    check('--on-accent', '--danger', 4.5);
    check('#ffffff', '--status-bar', 4.5, 'iOS status-bar white');
    for (const fg of DOTS) for (const bg of SURFACES) check(fg, bg, 3);
    expect(failures).toEqual([]);
  });

  it('flags a pair below its threshold (the check itself)', () => {
    expect(contrast('#777777', '#888888')).toBeLessThan(3);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

const TOKENS = [
  '--bg', '--panel', '--panel-2', '--text', '--muted', '--accent', '--ok', '--danger', '--outline', '--on-accent',
  '--chip-push', '--chip-pull', '--chip-legs', '--chip-other', '--status-bar', '--scrim', '--shadow',
];

/** theme id → (property → value) for `:root, [data-theme="slate"]` and each `[data-theme="<id>"]` block, in file order. */
function themeBlocks(source = readFileSync(join(UI_DIR, 'theme.css'), 'utf8')): Map<string, Map<string, string>> {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map<string, Map<string, string>>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim();
    const id = /^:root\s*,\s*\[data-theme="slate"\]$/.test(selector) ? 'slate' : /^\[data-theme="([a-z]+)"\]$/.exec(selector)?.[1];
    if (id === undefined) continue;
    const props = new Map<string, string>();
    for (const d of (m[2] ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) props.set(d[1] ?? '', (d[2] ?? '').trim());
    if (blocks.has(id)) throw new Error(`theme.css declares the ${id} block twice`);
    blocks.set(id, props);
  }
  return blocks;
}

/** A token's #rrggbb value inside its own block, following var() references. */
function resolveHex(block: Map<string, string>, token: string, id: string, seen: string[] = []): string {
  const value = block.get(token);
  if (value === undefined) throw new Error(`${id}: ${token} is not declared`);
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (ref === undefined || seen.includes(ref)) throw new Error(`${id}: ${token} is neither #rrggbb nor var(--token): ${value}`);
  return resolveHex(block, ref, id, [...seen, token]);
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel(((n >> 16) & 255) / 255) + 0.7152 * channel(((n >> 8) & 255) / 255) + 0.0722 * channel((n & 255) / 255);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
