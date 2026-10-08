import { describe, expect, it } from 'vitest';
import { MODEL_VERSION } from './schema';
import { UPGRADE_STEPS, fileVersion, upgradeFile, type UpgradeStep } from './upgrade';
import { exercisesFile } from './test-fixtures';
import type { FileKind } from './types';

describe('fileVersion', () => {
  it.each([[{ schemaVersion: 1 }, 1], [{ schemaVersion: 7 }, 7]])('reads %o', (raw, v) => expect(fileVersion(raw)).toBe(v));
  it.each([{}, { schemaVersion: 0 }, { schemaVersion: '1' }, { schemaVersion: 1.5 }, null, 'x'])(
    'returns undefined for %o',
    (raw) => expect(fileVersion(raw)).toBeUndefined(),
  );
});

describe('upgradeFile', () => {
  const addField: UpgradeStep = (file) => ({ ...file, added: true });

  it('returns the file unchanged at the current version', () => {
    const r = upgradeFile('exercises', exercisesFile());
    expect(r).toEqual({ status: 'ok', file: exercisesFile(), from: 1 });
  });

  it('applies steps in order and stamps the current version', () => {
    const steps = { exercises: { 1: addField, 2: (f: Record<string, unknown>) => ({ ...f, twice: true }) }, bodyweight: {}, session: {} };
    const r = upgradeFile('exercises', exercisesFile(), steps, 3);
    expect(r).toEqual({ status: 'ok', file: { ...exercisesFile(), added: true, twice: true, schemaVersion: 3 }, from: 1 });
  });

  it('is invalid when a step is missing', () => {
    const r = upgradeFile('exercises', exercisesFile(), { exercises: {}, bodyweight: {}, session: {} }, 2);
    expect(r.status).toBe('invalid');
  });

  it('is too-new when the file is ahead of the app', () => {
    expect(upgradeFile('exercises', { ...exercisesFile(), schemaVersion: 2 })).toEqual({ status: 'too-new', version: 2 });
  });

  it('is invalid without a usable schemaVersion', () => {
    expect(upgradeFile('exercises', { exercises: [] }).status).toBe('invalid');
  });

  it('turns a throwing step into invalid and leaves the input untouched', () => {
    const boom: UpgradeStep = () => { throw new Error('boom'); };
    const raw = exercisesFile();
    const r = upgradeFile('exercises', raw, { exercises: { 1: boom }, bodyweight: {}, session: {} }, 2);
    expect(r).toEqual({ status: 'invalid', message: 'upgrade step from version 1 for exercises failed: boom' });
    expect(raw).toEqual(exercisesFile());
  });
});

describe('UPGRADE_STEPS', () => {
  const kinds: FileKind[] = ['exercises', 'bodyweight', 'session'];

  it('has a step for every kind and every version below MODEL_VERSION', () => {
    for (const kind of kinds) {
      for (let v = 1; v < MODEL_VERSION; v += 1) {
        expect(UPGRADE_STEPS[kind][v], `${kind} v${v}→v${v + 1}`).toBeTypeOf('function');
      }
    }
  });

  it('has no step at or above MODEL_VERSION', () => {
    for (const kind of kinds) {
      for (const v of Object.keys(UPGRADE_STEPS[kind]).map(Number)) expect(v).toBeLessThan(MODEL_VERSION);
    }
  });
});
