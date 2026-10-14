import { EditError } from './edit';
import { tombstone, touch, undelete } from './record';
import { MODEL_VERSION } from './schema';
import type { BodyweightEntry, BodyweightFile } from './types';
import { isCalendarDate } from './validate';

/**
 * Pure edits over `bodyweight.json` (spec 4 §3 "Edits", §6 "Bodyweight"): the same three-liners
 * over `entries` as the session edits. Each returns a new file with `updatedAt` moved on the
 * edited entry only; `now` is always passed in. Input that could not be stored is refused with
 * an `EditError`, so every result passes `validateForWrite('bodyweight', …)` when the input did.
 */
export interface BodyweightInput {
  date: string;
  kg: number;
  note?: string;
}

export function emptyBodyweightFile(): BodyweightFile {
  return { schemaVersion: MODEL_VERSION, entries: [] };
}

function requireKg(kg: number): number {
  if (!Number.isFinite(kg) || kg <= 0) throw new EditError(`bodyweight must be more than 0 kg, got ${kg}`);
  return kg;
}

function requireDate(date: string): string {
  if (!isCalendarDate(date)) throw new EditError(`not a calendar date: ${date}`);
  return date;
}

/** Trimmed text, or undefined when the note is to be removed (null, empty or blank). */
function optionalText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function withNote(entry: Omit<BodyweightEntry, 'note'>, note: string | undefined): BodyweightEntry {
  return note === undefined ? entry : { ...entry, note };
}

function requireEntry(file: BodyweightFile, entryId: string): BodyweightEntry {
  const found = file.entries.find((e) => e.id === entryId);
  if (found === undefined) throw new EditError(`unknown bodyweight entry ${entryId}`);
  return found;
}

/** The entry for an edit: a tombstoned one was deleted (on another device) while the sheet was open,
 *  so the edit is refused instead of changing an entry nobody sees (like edit.ts for sessions). */
function requireLiveEntry(file: BodyweightFile, entryId: string): BodyweightEntry {
  const found = requireEntry(file, entryId);
  if (found.deletedAt !== undefined) throw new EditError('This entry was deleted elsewhere');
  return found;
}

function replaceEntry(file: BodyweightFile, next: BodyweightEntry): BodyweightFile {
  return { ...file, entries: file.entries.map((e) => (e.id === next.id ? next : e)) };
}

/** Appends a new entry; when an entry with `id` is already there (a replayed or repeated add), the
 *  same file comes back, so the add never makes a second record with that id. */
export function addBodyweightEntry(
  file: BodyweightFile,
  input: BodyweightInput,
  now: Date,
  id?: string,
): { file: BodyweightFile; entryId: string } {
  const entryId = id ?? crypto.randomUUID();
  if (file.entries.some((e) => e.id === entryId)) return { file, entryId };
  const entry = withNote(
    { id: entryId, date: requireDate(input.date), kg: requireKg(input.kg), updatedAt: now.toISOString() },
    optionalText(input.note),
  );
  return { file: { ...file, entries: [...file.entries, entry] }, entryId };
}

/** Changes date, kg and note of one entry; `null` (or blank) removes the note. Touches that entry only. */
export function setBodyweightEntry(
  file: BodyweightFile,
  entryId: string,
  fields: { date?: string; kg?: number; note?: string | null },
  now: Date,
): BodyweightFile {
  const { note: current, ...rest } = requireLiveEntry(file, entryId);
  const next = withNote(
    {
      ...rest,
      date: fields.date === undefined ? rest.date : requireDate(fields.date),
      kg: fields.kg === undefined ? rest.kg : requireKg(fields.kg),
    },
    fields.note === undefined ? current : optionalText(fields.note),
  );
  return replaceEntry(file, touch(next, now));
}

export function deleteBodyweightEntry(file: BodyweightFile, entryId: string, now: Date): BodyweightFile {
  return replaceEntry(file, tombstone(requireLiveEntry(file, entryId), now));
}

export function undeleteBodyweightEntry(file: BodyweightFile, entryId: string, now: Date): BodyweightFile {
  return replaceEntry(file, undelete(requireEntry(file, entryId), now));
}
