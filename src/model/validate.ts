import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Lenient, Strict } from './schema';
import type { BodyweightFile, Exercise, ExercisesFile, FileKind, Session, SessionFile } from './types';

export type IssueLevel = 'schema' | 'hard' | 'soft';

export interface ValidationIssue {
  level: IssueLevel;
  /** JSON pointer into the file, e.g. "/session/blocks/0/sets/2/loadKg". */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type ValidationMode = 'strict' | 'lenient';

function schemaFor(kind: FileKind, mode: ValidationMode): TSchema {
  const model = mode === 'strict' ? Strict : Lenient;
  if (kind === 'exercises') return model.ExercisesFile;
  if (kind === 'bodyweight') return model.BodyweightFile;
  return model.SessionFile;
}

/**
 * Schema check, then the hard rules of spec §5. Strict mode is for files at the app's own
 * version; lenient mode (unknown properties ignored) only for too-new files.
 */
export function validateFile(kind: FileKind, value: unknown, mode: ValidationMode = 'strict'): ValidationResult {
  const schemaIssues: ValidationIssue[] = [...Value.Errors(schemaFor(kind, mode), value)].map((e) => ({
    level: 'schema',
    path: e.path,
    message: e.message,
  }));
  if (schemaIssues.length > 0) return { ok: false, issues: schemaIssues };
  const issues = hardRules(kind, value);
  return { ok: issues.length === 0, issues };
}

/** Validates what will actually be stored: the JSON round trip drops undefined keys and turns
 *  NaN/Infinity into null, so the in-memory object and the file can't disagree. */
export function validateForWrite(kind: FileKind, value: unknown): ValidationResult {
  return validateFile(kind, JSON.parse(JSON.stringify(value)), 'strict');
}

export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const hard = (path: string, message: string): ValidationIssue => ({ level: 'hard', path, message });
const soft = (path: string, message: string): ValidationIssue => ({ level: 'soft', path, message });

function duplicateIds(entries: [id: string, path: string][]): ValidationIssue[] {
  const seen = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  for (const [id, path] of entries) {
    const first = seen.get(id);
    if (first === undefined) seen.set(id, path);
    else issues.push(hard(path, `duplicate id ${id} (first at ${first})`));
  }
  return issues;
}

function hardRules(kind: FileKind, value: unknown): ValidationIssue[] {
  if (kind === 'exercises') {
    const file = value as ExercisesFile;
    return duplicateIds(file.exercises.map((e, i) => [e.id, `/exercises/${i}/id`]));
  }
  if (kind === 'bodyweight') {
    const file = value as BodyweightFile;
    const issues = file.entries.flatMap((e, i) =>
      isCalendarDate(e.date) ? [] : [hard(`/entries/${i}/date`, `not a calendar date: ${e.date}`)],
    );
    return [...issues, ...duplicateIds(file.entries.map((e, i) => [e.id, `/entries/${i}/id`]))];
  }
  return sessionHardRules((value as SessionFile).session);
}

function sessionHardRules(session: Session): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const migrated = session.source === 'migrated';
  if (!isCalendarDate(session.date)) issues.push(hard('/session/date', `not a calendar date: ${session.date}`));
  if (session.dateUncertain && !migrated) issues.push(hard('/session/dateUncertain', 'only allowed in migrated sessions'));

  const ids: [string, string][] = [[session.id, '/session/id']];
  session.blocks.forEach((block, bi) => {
    const bp = `/session/blocks/${bi}`;
    ids.push([block.id, `${bp}/id`]);
    const live = block.sets.filter((s) => s.deletedAt === undefined);
    if (new Set(live.map((s) => ('reps' in s ? 'reps' : 'seconds'))).size > 1) {
      issues.push(hard(`${bp}/sets`, 'sets mix reps and seconds'));
    }
    block.sets.forEach((s, si) => {
      const sp = `${bp}/sets/${si}`;
      ids.push([s.id, `${sp}/id`]);
      if (s.loadType === 'bodyweight' && s.loadKg !== 0) issues.push(hard(`${sp}/loadKg`, 'must be 0 for bodyweight'));
      if ((s.loadType === 'added' || s.loadType === 'assist') && s.loadKg <= 0) {
        issues.push(hard(`${sp}/loadKg`, `must be > 0 for ${s.loadType}`));
      }
      if (s.restSec !== undefined && s.completedAt !== undefined) {
        issues.push(hard(`${sp}/restSec`, 'not allowed on a set with completedAt'));
      }
      if (s.aggregate && !migrated) issues.push(hard(`${sp}/aggregate`, 'only allowed in migrated sessions'));
    });
  });
  return [...issues, ...duplicateIds(ids)];
}

/**
 * Soft rules (spec §5): need the catalog, never quarantine. Tombstoned exercises resolve
 * (the catalog passed in must include them); deleted blocks and sets are skipped.
 */
export function checkCatalogRules(session: Session, catalog: readonly Exercise[]): ValidationIssue[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const issues: ValidationIssue[] = [];
  session.blocks.forEach((block, bi) => {
    if (block.deletedAt !== undefined) return;
    const bp = `/session/blocks/${bi}`;
    const ex = byId.get(block.exerciseId);
    if (ex === undefined) {
      issues.push(soft(`${bp}/exerciseId`, `unknown exercise ${block.exerciseId}`));
      return;
    }
    block.sets.forEach((s, si) => {
      if (s.deletedAt !== undefined) return;
      const field = 'reps' in s ? 'reps' : 'seconds';
      if (field !== ex.metric) issues.push(soft(`${bp}/sets/${si}/${field}`, `${ex.id} is measured in ${ex.metric}`));
    });
  });
  return issues;
}
