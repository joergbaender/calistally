import { Value } from '@sinclair/typebox/value';
import { Lenient } from '../model/schema';
import type { Session } from '../model/types';
import type { FileRow } from '../sync/store';

/**
 * Spec 4 §5: sessions on refused rows, shown read-only. One module for the Days list and the session
 * page, so the list and the page agree on which file an id opens.
 */

/**
 * The lenient session-file schema (unknown properties ignored, any schemaVersion from 1), so every
 * field the views read has its declared type: a label is one of the five, tags are strings, a load
 * type is known. Hard-rule failures (a 30 February, duplicate ids) do not matter for display; a file
 * that fails this check stays off the Days list and shows on the Sync tab only.
 */
function sessionOf(content: unknown): Session | undefined {
  // The lenient type differs from Session only by the unknown fields it allows, which no view reads.
  return Value.Check(Lenient.SessionFile, content) ? (content.session as Session) : undefined;
}

export interface LockedSession { row: FileRow; session: Session }

/**
 * Spec 4 §5: refused session rows (read-only, needs-update, quarantined) whose content passes the
 * lenient session-file schema, with their row (the session page names `row.status` in its banner).
 *
 * Left out, because the route `#/days/<sessionId>` could never open them read-only:
 * - the loser of a duplicate pair (`duplicateOf`): spec 3 §6 hides it from views; the engine merged
 *   its content into the ok twin at the path that sorts first, and the Sync tab lists it as "Duplicate file";
 * - a session whose id `okSessionIds` (every ok session row, tombstoned ones too) or an earlier refused
 *   row already holds; the session page resolves `data.sessions` first, then this list in order.
 */
export function lockedSessionRows(rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): LockedSession[] {
  const out: LockedSession[] = [];
  const taken = new Set(okSessionIds);
  for (const row of rows) {
    if (row.kind !== 'session' || row.duplicateOf !== undefined) continue;
    const s = sessionOf(row.content);
    if (s === undefined || taken.has(s.id)) continue;
    taken.add(s.id);
    out.push({ row, session: s });
  }
  return out;
}

/** The sessions of `lockedSessionRows`, for the Days list. */
export function lockedSessionsOf(rows: readonly FileRow[], okSessionIds: ReadonlySet<string> = new Set()): Session[] {
  return lockedSessionRows(rows, okSessionIds).map((l) => l.session);
}
