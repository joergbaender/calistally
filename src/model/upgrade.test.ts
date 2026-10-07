import { describe, expect, it } from 'vitest';
import { fileVersion, upgradeFile, type UpgradeStep } from './upgrade';
import { exercisesFile } from './test-fixtures';

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
});
