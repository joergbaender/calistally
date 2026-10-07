import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_VERSION } from '../model/schema';
import type { Session } from '../model/types';
import { checkCatalogRules, validateForWrite, type ValidationIssue } from '../model/validate';
import type { BuildResult } from './build';

export interface OutFile {
  /** Relative to the output directory, forward slashes. */
  path: string;
  content: string;
}

/** Everything the migration owns inside `--out`; nothing else is ever touched (spec 2 §8). */
export const MANAGED_PATHS = ['exercises.json', 'bodyweight.json', 'sessions', 'review.md', 'report.md'] as const;

/** Spec 1 §4: sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json */
export function sessionFilePath(session: Session): string {
  return `sessions/${session.date.slice(0, 4)}/${session.date}_${session.id.slice(0, 8)}.json`;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function toFiles(result: BuildResult): OutFile[] {
  return [
    { path: 'exercises.json', content: json({ schemaVersion: MODEL_VERSION, exercises: result.catalog }) },
    { path: 'bodyweight.json', content: json({ schemaVersion: MODEL_VERSION, entries: result.bodyweight }) },
    ...result.sessions.map((s) => ({ path: sessionFilePath(s), content: json({ schemaVersion: MODEL_VERSION, session: s }) })),
  ];
}

/** The validation gate (spec 2 §8): hard rules, soft catalog rules, unique ids and paths across files. */
export function validateAll(result: BuildResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefixed = (file: string, list: readonly ValidationIssue[]): ValidationIssue[] => list.map((i) => ({ ...i, path: `${file}${i.path}` }));
  issues.push(...prefixed('exercises.json', validateForWrite('exercises', { schemaVersion: MODEL_VERSION, exercises: result.catalog }).issues));
  issues.push(...prefixed('bodyweight.json', validateForWrite('bodyweight', { schemaVersion: MODEL_VERSION, entries: result.bodyweight }).issues));
  const seenIds = new Map<string, string>();
  const seenPaths = new Set<string>();
  for (const s of result.sessions) {
    const file = sessionFilePath(s);
    issues.push(...prefixed(file, validateForWrite('session', { schemaVersion: MODEL_VERSION, session: s }).issues));
    issues.push(...prefixed(file, checkCatalogRules(s, result.catalog)));
    const first = seenIds.get(s.id);
    if (first !== undefined) issues.push({ level: 'hard', path: `${file}/session/id`, message: `duplicate session id ${s.id} (first in ${first})` });
    else seenIds.set(s.id, file);
    if (seenPaths.has(file)) issues.push({ level: 'hard', path: file, message: 'two sessions map to the same file' });
    seenPaths.add(file);
  }
  return issues;
}

/** true when `child` is `parent` or lies under it. */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Removes exactly the managed paths, then writes the files. The only output-side I/O of the migration. */
export async function writeOutput(dir: string, files: readonly OutFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const managed of MANAGED_PATHS) await rm(path.join(dir, managed), { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(dir, ...file.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}
