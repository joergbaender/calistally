import { MODEL_VERSION } from './schema';
import type { FileKind } from './types';

export type UpgradeStep = (file: Record<string, unknown>) => Record<string, unknown>;

/** UPGRADE_STEPS[kind][n] upgrades a file of that kind from version n to n + 1.
 *  Whenever MODEL_VERSION is bumped, add a step for every kind, a no-op where nothing changed. */
export const UPGRADE_STEPS: Record<FileKind, Record<number, UpgradeStep>> = {
  exercises: {},
  bodyweight: {},
  session: {},
};

export type UpgradeResult =
  | { status: 'ok'; file: Record<string, unknown>; from: number }
  | { status: 'too-new'; version: number }
  | { status: 'invalid'; message: string };

export function fileVersion(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const v = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;
}

export function upgradeFile(
  kind: FileKind,
  raw: unknown,
  steps: Record<FileKind, Record<number, UpgradeStep>> = UPGRADE_STEPS,
  current: number = MODEL_VERSION,
): UpgradeResult {
  const from = fileVersion(raw);
  if (from === undefined) return { status: 'invalid', message: 'missing or invalid schemaVersion' };
  if (from > current) return { status: 'too-new', version: from };
  let file = raw as Record<string, unknown>;
  for (let v = from; v < current; v += 1) {
    const step = steps[kind][v];
    if (step === undefined) return { status: 'invalid', message: `no upgrade step from version ${v} for ${kind}` };
    file = step(file);
  }
  return { status: 'ok', file: { ...file, schemaVersion: current }, from };
}
