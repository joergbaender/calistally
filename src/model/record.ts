import type { RecordMeta } from './types';

/** Spec §3 "Setting updatedAt": max(now, previous + 1 ms), so a later edit always wins. */
export function nextUpdatedAt(previous: string | undefined, now: Date = new Date()): string {
  const candidate = now.toISOString();
  if (previous === undefined || candidate > previous) return candidate;
  return new Date(Date.parse(previous) + 1).toISOString();
}

/** A copy with a new updatedAt. Child arrays are the same references: a child change never
 *  touches the parent (spec §3 "What updatedAt covers"). */
export function touch<T extends RecordMeta>(record: T, now?: Date): T {
  return { ...record, updatedAt: nextUpdatedAt(record.updatedAt, now) };
}

export function tombstone<T extends RecordMeta>(record: T, now?: Date): T {
  const at = nextUpdatedAt(record.updatedAt, now);
  return { ...record, updatedAt: at, deletedAt: at };
}

export function undelete<T extends RecordMeta>(record: T, now?: Date): T {
  const { deletedAt: _removed, ...rest } = record;
  return { ...(rest as T), updatedAt: nextUpdatedAt(record.updatedAt, now) };
}

export function isDeleted(record: RecordMeta): boolean {
  return record.deletedAt !== undefined;
}

/** Order for a new sibling: max + 1 over all siblings, deleted ones included. */
export function nextOrder(siblings: readonly { order: number }[]): number {
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
}

/** Order for a sibling inserted between two others; nobody else is renumbered. */
export function orderBetween(before: number, after: number): number {
  return (before + after) / 2;
}
