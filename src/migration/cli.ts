import { readFile } from 'node:fs/promises';
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
