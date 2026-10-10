import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('theme.css defines every token of spec 4 §8', () => {
    const css = readFileSync(join(UI_DIR, 'theme.css'), 'utf8');
    for (const token of ['--bg', '--panel', '--panel-2', '--text', '--muted', '--accent', '--ok', '--danger', '--outline', '--on-accent']) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});
