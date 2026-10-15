import { describe, expect, it } from 'vitest';
import { EditError } from './edit';
import {
  addBodyweightEntry,
  deleteBodyweightEntry,
  emptyBodyweightFile,
  setBodyweightEntry,
  undeleteBodyweightEntry,
} from './edit-bodyweight';
import { MODEL_VERSION } from './schema';
import { T0, bodyweight, bodyweightFile, uuid } from './test-fixtures';
import type { BodyweightFile } from './types';
import { validateForWrite } from './validate';

const later = new Date('2030-01-01T11:00:00.000Z');
const LATER = '2030-01-01T11:00:00.000Z';
const earlier = new Date('2030-01-01T09:00:00.000Z');
const T0_PLUS_1 = '2030-01-01T10:00:00.001Z';

/** Every edit result must be writable as it is. */
function valid(file: BodyweightFile): BodyweightFile {
  const result = validateForWrite('bodyweight', file);
  expect(result.issues).toEqual([]);
  expect(result.ok).toBe(true);
  return file;
}

describe('emptyBodyweightFile', () => {
  it('is the current version with no entries, and valid', () => {
    expect(valid(emptyBodyweightFile())).toEqual({ schemaVersion: MODEL_VERSION, entries: [] });
  });
});

describe('addBodyweightEntry', () => {
  it('appends an entry with updatedAt = now and the given id', () => {
    const other = bodyweight({ date: '2030-01-01', kg: 80 });
    const id = uuid();
    const { file, entryId } = addBodyweightEntry(bodyweightFile([other]), { date: '2030-01-05', kg: 79.5 }, later, id);
    valid(file);
    expect(entryId).toBe(id);
    expect(file.entries).toEqual([other, { id, date: '2030-01-05', kg: 79.5, updatedAt: LATER }]);
  });

  it('defaults the id to a fresh uuid', () => {
    const { file, entryId } = addBodyweightEntry(emptyBodyweightFile(), { date: '2030-01-05', kg: 80 }, later);
    valid(file);
    expect(file.entries[0]?.id).toBe(entryId);
  });

  it('trims the note and omits a blank one', () => {
    const a = addBodyweightEntry(emptyBodyweightFile(), { date: '2030-01-05', kg: 80, note: '  morning ' }, later, uuid());
    expect(valid(a.file).entries[0]?.note).toBe('morning');
    const b = addBodyweightEntry(emptyBodyweightFile(), { date: '2030-01-05', kg: 80, note: '   ' }, later, uuid());
    expect(valid(b.file).entries[0]).not.toHaveProperty('note');
  });

  it('does not mutate the input file', () => {
    const input = bodyweightFile([bodyweight()]);
    const copy = structuredClone(input);
    addBodyweightEntry(input, { date: '2030-01-05', kg: 80 }, later, uuid());
    expect(input).toEqual(copy);
  });

  it('returns the same file when an entry with that id is already there (a replayed add)', () => {
    const id = uuid();
    const once = addBodyweightEntry(emptyBodyweightFile(), { date: '2030-01-05', kg: 80 }, later, id).file;
    const twice = addBodyweightEntry(once, { date: '2030-01-05', kg: 80 }, later, id);
    expect(twice.file).toBe(once);
    expect(twice.entryId).toBe(id);
  });

  it('refuses kg <= 0 or not finite with an EditError', () => {
    for (const kg of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => addBodyweightEntry(emptyBodyweightFile(), { date: '2030-01-05', kg }, later)).toThrow(EditError);
    }
  });

  it('refuses a date that is not a calendar date', () => {
    for (const date of ['2030-02-30', '2030-13-01', '30-01-01', '']) {
      expect(() => addBodyweightEntry(emptyBodyweightFile(), { date, kg: 80 }, later)).toThrow(EditError);
    }
  });
});

describe('setBodyweightEntry', () => {
  it('changes the given fields and touches that entry only', () => {
    const a = bodyweight({ kg: 80 });
    const b = bodyweight({ kg: 81, date: '2030-01-02' });
    const file = valid(setBodyweightEntry(bodyweightFile([a, b]), b.id, { kg: 80.5, date: '2030-01-03' }, later));
    expect(file.entries[0]).toBe(a);
    expect(file.entries[1]).toEqual({ ...b, kg: 80.5, date: '2030-01-03', updatedAt: LATER });
  });

  it('keeps fields that are not given', () => {
    const a = bodyweight({ kg: 80, note: 'after run' });
    const file = valid(setBodyweightEntry(bodyweightFile([a]), a.id, {}, later));
    expect(file.entries[0]).toEqual({ ...a, updatedAt: LATER });
  });

  it('sets, trims and removes the note (null or blank removes it)', () => {
    const a = bodyweight({ kg: 80 });
    const withNote = valid(setBodyweightEntry(bodyweightFile([a]), a.id, { note: ' fasted ' }, later));
    expect(withNote.entries[0]?.note).toBe('fasted');
    const removed = valid(setBodyweightEntry(withNote, a.id, { note: null }, later));
    expect(removed.entries[0]).not.toHaveProperty('note');
    const blank = valid(setBodyweightEntry(withNote, a.id, { note: '  ' }, later));
    expect(blank.entries[0]).not.toHaveProperty('note');
  });

  it('moves updatedAt forward by 1 ms when the clock is behind', () => {
    const a = bodyweight({ updatedAt: T0 });
    const file = setBodyweightEntry(bodyweightFile([a]), a.id, { kg: 79 }, earlier);
    expect(file.entries[0]?.updatedAt).toBe(T0_PLUS_1);
  });

  it('refuses an unknown id, kg <= 0 and a bad date', () => {
    const a = bodyweight();
    const file = bodyweightFile([a]);
    expect(() => setBodyweightEntry(file, uuid(), { kg: 80 }, later)).toThrow(EditError);
    expect(() => setBodyweightEntry(file, a.id, { kg: 0 }, later)).toThrow(EditError);
    expect(() => setBodyweightEntry(file, a.id, { kg: Number.NaN }, later)).toThrow(EditError);
    expect(() => setBodyweightEntry(file, a.id, { date: '2030-02-29' }, later)).toThrow(EditError);
  });
});

describe('deleteBodyweightEntry and undeleteBodyweightEntry', () => {
  it('tombstone and restore that entry only', () => {
    const a = bodyweight();
    const b = bodyweight({ date: '2030-01-02' });
    const deleted = valid(deleteBodyweightEntry(bodyweightFile([a, b]), b.id, later));
    expect(deleted.entries[0]).toBe(a);
    expect(deleted.entries[1]).toEqual({ ...b, updatedAt: LATER, deletedAt: LATER });

    const restored = valid(undeleteBodyweightEntry(deleted, b.id, new Date('2030-01-01T12:00:00.000Z')));
    expect(restored.entries[0]).toBe(a);
    expect(restored.entries[1]).toEqual({ ...b, updatedAt: '2030-01-01T12:00:00.000Z' });
  });

  it('refuse an unknown id', () => {
    const file = bodyweightFile([bodyweight()]);
    expect(() => deleteBodyweightEntry(file, uuid(), later)).toThrow(EditError);
    expect(() => undeleteBodyweightEntry(file, uuid(), later)).toThrow(EditError);
  });
});

describe('edits of a tombstoned entry', () => {
  it('setBodyweightEntry and deleteBodyweightEntry refuse it (deleted elsewhere); undelete does not', () => {
    const a = bodyweight({ deletedAt: T0 });
    const file = bodyweightFile([a]);
    expect(() => setBodyweightEntry(file, a.id, { kg: 80 }, later)).toThrow(new EditError('This entry was deleted elsewhere'));
    expect(() => deleteBodyweightEntry(file, a.id, later)).toThrow(new EditError('This entry was deleted elsewhere'));
    expect(valid(undeleteBodyweightEntry(file, a.id, later)).entries[0]).not.toHaveProperty('deletedAt');
  });
});
