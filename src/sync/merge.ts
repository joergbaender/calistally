import { MODEL_VERSION } from '../model/schema';
import type {
  Block, BodyweightEntry, BodyweightFile, Exercise, ExercisesFile, FileKind, RecordMeta, Session, SessionFile, WorkoutSet,
} from '../model/types';

/** JSON with object keys sorted at every level, so equal content gives equal text (spec 3 §6). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** Equal content regardless of key order and array formatting. */
export function sameContent(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Equal content for the sync decisions (spec 3 §6): like sameContent, but a record (an object
 * with a string `id`) counts in any array position, at every level. Other arrays (`tags`) stay
 * positional. canonicalJson and sameContent stay positional for the tie-break and the tests.
 */
export function sameRecords(a: unknown, b: unknown): boolean {
  return canonicalJson(sortRecords(a)) === canonicalJson(sortRecords(b));
}

function sortRecords(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(sortRecords);
    return items.length > 0 && items.every(hasId) ? items.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) : items;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = sortRecords(v);
    return out;
  }
  return value;
}

function hasId(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string';
}

type Rec = RecordMeta & { id: string };

function ownFields<T extends object>(record: T, childKey?: keyof T): object {
  if (childKey === undefined) return record;
  const { [childKey]: _children, ...own } = record;
  return own;
}

/**
 * Spec 1 §3 "Merge unit" with the spec 3 §6 tie-break. Returns `a` or `b` (the one that supplies
 * the own fields): newer updatedAt wins; on a tie a tombstone wins; on a full tie the copy whose
 * canonical JSON sorts higher. The order is total, so the choice is symmetric and associative.
 */
export function pickWinner<T extends Rec>(a: T, b: T, childKey?: keyof T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const aDead = a.deletedAt !== undefined;
  const bDead = b.deletedAt !== undefined;
  if (aDead !== bDead) return aDead ? a : b;
  return canonicalJson(ownFields(a, childKey)) >= canonicalJson(ownFields(b, childKey)) ? a : b;
}

/** Union by id, each shared id merged, sorted by id (array position carries no meaning). */
export function mergeById<T extends Rec>(as: readonly T[], bs: readonly T[], merge: (a: T, b: T) => T): T[] {
  const byId = new Map<string, T>();
  for (const a of as) byId.set(a.id, a);
  for (const b of bs) {
    const a = byId.get(b.id);
    byId.set(b.id, a === undefined ? b : merge(a, b));
  }
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function mergeSet(a: WorkoutSet, b: WorkoutSet): WorkoutSet {
  return pickWinner(a, b);
}

export function mergeBlock(a: Block, b: Block): Block {
  const winner = pickWinner(a, b, 'sets');
  return { ...winner, sets: mergeById(a.sets, b.sets, mergeSet) };
}

export function mergeSession(a: Session, b: Session): Session {
  const winner = pickWinner(a, b, 'blocks');
  return { ...winner, blocks: mergeById(a.blocks, b.blocks, mergeBlock) };
}

export function mergeExercise(a: Exercise, b: Exercise): Exercise {
  return pickWinner(a, b);
}

export function mergeBodyweightEntry(a: BodyweightEntry, b: BodyweightEntry): BodyweightEntry {
  return pickWinner(a, b);
}

export function mergeFile(kind: 'exercises', a: ExercisesFile, b: ExercisesFile): ExercisesFile;
export function mergeFile(kind: 'bodyweight', a: BodyweightFile, b: BodyweightFile): BodyweightFile;
export function mergeFile(kind: 'session', a: SessionFile, b: SessionFile): SessionFile;
export function mergeFile(kind: FileKind, a: unknown, b: unknown): unknown;
/** Both files must be at MODEL_VERSION (the caller upgrades first). The result is at MODEL_VERSION. */
export function mergeFile(kind: FileKind, a: unknown, b: unknown): unknown {
  if (kind === 'exercises') {
    const x = a as ExercisesFile;
    const y = b as ExercisesFile;
    return { schemaVersion: MODEL_VERSION, exercises: mergeById(x.exercises, y.exercises, mergeExercise) };
  }
  if (kind === 'bodyweight') {
    const x = a as BodyweightFile;
    const y = b as BodyweightFile;
    return { schemaVersion: MODEL_VERSION, entries: mergeById(x.entries, y.entries, mergeBodyweightEntry) };
  }
  const x = a as SessionFile;
  const y = b as SessionFile;
  if (x.session.id !== y.session.id) throw new Error(`cannot merge sessions ${x.session.id} and ${y.session.id}`);
  return { schemaVersion: MODEL_VERSION, session: mergeSession(x.session, y.session) };
}
