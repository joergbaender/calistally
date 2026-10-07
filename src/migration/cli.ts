import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SEED } from '../model/seed';
import { buildSessions } from './build';
import { parseDecisions } from './decisions';
import { readWorkbook } from './grid';
import { isInside, toFiles, validateAll, writeOutput } from './output';
import { renderReport, renderReview } from './review';
import { outsideCells, splitRows } from './rows';
import { MIGRATION_STAMP, SHEET_YEAR } from './sheet';

export interface MigrationArgs {
  xlsx: string;
  decisions: string;
  out: string;
  repoRoot: string;
  log?: (line: string) => void;
}

/** Exit codes: 0 final, 1 review items open (files written), 2 usage, 3 validation failed (nothing written). */
export const EXIT = { final: 0, open: 1, usage: 2, invalid: 3 } as const;

/** The whole pipeline of spec 2 §3, from workbook to output folder. */
export async function runMigration(args: MigrationArgs): Promise<number> {
  const log = args.log ?? ((line: string): void => console.log(line));
  const out = path.resolve(args.out);
  if (isInside(out, args.repoRoot)) {
    log(`refusing --out ${out}: it is inside the repository, and training data never goes into git`);
    return EXIT.usage;
  }
  const foreign = await foreignSessionFile(out);
  if (foreign !== undefined) {
    log(`refusing --out ${out}: ${foreign} was not written by the migration (it may hold sessions from the app); point --out at an empty or migration-only folder`);
    return EXIT.usage;
  }
  const grid = await readWorkbook(args.xlsx);
  const decisions = parseDecisions(await readFile(args.decisions, 'utf8'));
  const result = buildSessions(splitRows(grid), decisions, SEED, { year: SHEET_YEAR, stamp: MIGRATION_STAMP, bodyweightKg: args.bodyweightKg }, outsideCells(grid));
  const issues = validateAll(result);
  if (issues.length > 0) {
    log('validation failed, nothing written (this is a bug in the migration, not a review item):');
    for (const i of issues) log(`  ${i.level} ${i.path}: ${i.message}`);
    return EXIT.invalid;
  }
  const final = result.review.length === 0;
  const files = [
    ...toFiles(result),
    { path: 'review.md', content: renderReview(result.review) },
    { path: 'report.md', content: renderReport(result, { final, xlsx: path.basename(args.xlsx), decisionCount: Object.keys(decisions).length }) },
  ];
  await writeOutput(out, files);
  log(`${result.sessions.length} sessions, ${result.review.length} open review item(s) → ${out} (${final ? 'FINAL' : 'NOT FINAL'})`);
  return final ? EXIT.final : EXIT.open;
}

/**
 * The first entry under `<out>/sessions` that the migration did not write (a non-`.json` file, or a file
 * that is not `{ session: { source: 'migrated' } }`), as `sessions/<path>`; undefined when there is none.
 * writeOutput deletes `sessions/` wholesale, so anything else there would be lost.
 */
async function foreignSessionFile(out: string): Promise<string | undefined> {
  const root = path.join(out, 'sessions');
  let info;
  try {
    info = await stat(root);
  } catch {
    return undefined;
  }
  const rel = (p: string): string => path.relative(out, p).split(path.sep).join('/');
  if (!info.isDirectory()) return rel(root);
  const walk = async (dir: string): Promise<string | undefined> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(p);
        if (found !== undefined) return found;
      } else if (!entry.isFile() || !entry.name.endsWith('.json') || !(await isMigratedSession(p))) return rel(p);
    }
    return undefined;
  };
  return walk(root);
}

async function isMigratedSession(file: string): Promise<boolean> {
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof data !== 'object' || data === null || !('session' in data)) return false;
    const session: unknown = data.session;
    return typeof session === 'object' && session !== null && 'source' in session && session.source === 'migrated';
  } catch {
    return false;
  }
}
