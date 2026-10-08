import type { FileKind } from '../model/types';

/** Spec 1 §4: the three kinds of data file, addressed from the App folder root. */
export const EXERCISES_PATH = '/exercises.json';
export const BODYWEIGHT_PATH = '/bodyweight.json';

const SESSION_PATH = /^\/sessions\/(\d{4})\/(\d{4})-\d{2}-\d{2}_[0-9a-f]{8}\.json$/;

/** `/sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json`, fixed when the session is first written (spec 1 D12). */
export function sessionPath(date: string, id: string): string {
  return `/sessions/${date.slice(0, 4)}/${date}_${id.slice(0, 8)}.json`;
}

export type PathClass =
  | { kind: 'data'; fileKind: FileKind }
  /** A .json where only data files belong: never read, listed as an issue (spec 3 §7). */
  | { kind: 'unexpected' }
  /** Folders, export/, review.md and the like: not ours to look at. */
  | { kind: 'ignored' };

/** Classifies a Dropbox `path_lower`. */
export function classifyPath(path: string): PathClass {
  if (path === EXERCISES_PATH) return { kind: 'data', fileKind: 'exercises' };
  if (path === BODYWEIGHT_PATH) return { kind: 'data', fileKind: 'bodyweight' };
  const m = SESSION_PATH.exec(path);
  if (m && m[1] === m[2]) return { kind: 'data', fileKind: 'session' };
  if (!path.endsWith('.json')) return { kind: 'ignored' };
  const inRoot = path.lastIndexOf('/') === 0;
  if (inRoot || path.startsWith('/sessions/')) return { kind: 'unexpected' };
  return { kind: 'ignored' };
}

/** Catalog files sort ahead of sessions in the queue (spec 3 S12); within a group the caller orders by time. */
export function queueRank(kind: FileKind): number {
  return kind === 'exercises' ? 0 : kind === 'bodyweight' ? 1 : 2;
}
