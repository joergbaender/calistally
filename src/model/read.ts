import { MODEL_VERSION } from './schema';
import type { FileKind } from './types';
import { UPGRADE_STEPS, fileVersion, upgradeFile, type UpgradeStep } from './upgrade';
import { validateFile, type ValidationIssue } from './validate';

/** ok: usable and writable. read-only: newer than the app, shown but never written.
 *  needs-update: newer than the app and not even readable. quarantined: invalid at a known version. */
export type ReadStatus = 'ok' | 'read-only' | 'needs-update' | 'quarantined';

export interface ReadResult {
  status: ReadStatus;
  version: number | undefined;
  /** The upgraded file for 'ok'; the raw input otherwise. */
  file: unknown;
  issues: ValidationIssue[];
}

/** Spec §5: upgrade, then validate; too-new files are validated leniently and never written. */
export function readFile(
  kind: FileKind,
  raw: unknown,
  steps: Record<FileKind, Record<number, UpgradeStep>> = UPGRADE_STEPS,
  current: number = MODEL_VERSION,
): ReadResult {
  const up = upgradeFile(kind, raw, steps, current);
  if (up.status === 'invalid') {
    const issue: ValidationIssue = { level: 'hard', path: '/schemaVersion', message: up.message };
    return { status: 'quarantined', version: fileVersion(raw), file: raw, issues: [issue] };
  }
  if (up.status === 'too-new') {
    const r = validateFile(kind, raw, 'lenient');
    return { status: r.ok ? 'read-only' : 'needs-update', version: up.version, file: raw, issues: r.issues };
  }
  const r = validateFile(kind, up.file, 'strict');
  return { status: r.ok ? 'ok' : 'quarantined', version: up.from, file: up.file, issues: r.issues };
}
