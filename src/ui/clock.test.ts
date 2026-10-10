import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One clock: every write in the screens takes its time from `data.clock()`, which
 * tests control through `DataDeps.now`. A bare `new Date()` in a component would be a second clock.
 */
const COMPONENTS_DIR = join(import.meta.dirname, 'components');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('one clock', () => {
  it("no 'new Date()' in src/ui/components outside tests", () => {
    const offenders = walk(COMPONENTS_DIR)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /new Date\(\s*\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(COMPONENTS_DIR, f));
    expect(offenders).toEqual([]);
  });
});
