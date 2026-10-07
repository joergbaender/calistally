import { describe, expect, it } from 'vitest';
import { readFile } from './read';
import { exercise, exercisesFile } from './test-fixtures';

describe('readFile', () => {
  it('returns ok for a valid file at the current version', () => {
    const r = readFile('exercises', exercisesFile([exercise()]));
    expect(r.status).toBe('ok');
    expect(r.version).toBe(1);
    expect(r.issues).toEqual([]);
  });

  it('quarantines an invalid file at the current version, with its issues', () => {
    const r = readFile('exercises', exercisesFile([exercise({ name: '' })]));
    expect(r.status).toBe('quarantined');
    expect(r.issues[0]?.level).toBe('schema');
  });

  it('quarantines a file at the current version that has an unknown property', () => {
    expect(readFile('exercises', { ...exercisesFile(), future: 1 }).status).toBe('quarantined');
  });

  it('quarantines a file without a usable schemaVersion', () => {
    const r = readFile('exercises', { exercises: [] });
    expect(r.status).toBe('quarantined');
    expect(r.issues[0]?.path).toBe('/schemaVersion');
  });

  it('marks a too-new file with an unknown property read-only', () => {
    const r = readFile('exercises', { ...exercisesFile([{ ...exercise(), future: 1 } as never]), schemaVersion: 2 });
    expect(r.status).toBe('read-only');
    expect(r.version).toBe(2);
  });

  it('marks a too-new file whose known fields are invalid as needs-update', () => {
    const r = readFile('exercises', { ...exercisesFile([exercise({ name: '' })]), schemaVersion: 2 });
    expect(r.status).toBe('needs-update');
  });

  it('marks a too-new file that fails a hard rule as needs-update', () => {
    const r = readFile('exercises', { ...exercisesFile([exercise(), exercise()]), schemaVersion: 2 });
    expect(r.status).toBe('needs-update');
    expect(r.issues.some((i) => i.level === 'hard')).toBe(true);
  });
});
