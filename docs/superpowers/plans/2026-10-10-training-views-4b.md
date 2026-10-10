# Training Views Implementation Plan, part 4b: the More tab (spec 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the More tab: exercise list and per-exercise history, the calendar, the bodyweight log with its line, the catalog screen (rename, archive, delete only without history, metric and per side locked), and soft-issue flags on blocks. Then apply the corrections the owner collected while using plan 4a.

**Architecture:** As in plan 4a: pure edits in `src/model/` (`edit-bodyweight.ts`, `edit-catalog.ts`), one pure view model per screen in `src/ui/components/more/*.vm.ts` tested in Node, thin TSX components tested under happy-dom for the interactions that write, every write through `Data.edit` / `Data.create` and the helpers in `components/log/outcome.ts`, timestamps from `data.clock()`, colours as tokens.

**Tech Stack:** Unchanged from plan 4a: Preact 10.29 with `@preact/signals` 2, Vite 8, Vitest 5 with happy-dom and Testing Library. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-10-training-views-design.md` (spec 4) §6, §7 and §12 "Plan 4b", with its amendments of 2026-10-10. Spec 1 §3 (catalog rules) and §7 (indicators) bind.

**Prerequisite:** plan 4a (`docs/superpowers/plans/2026-10-10-training-views-4a.md`) is merged into `main`. Start from a freshly pulled `main` on a new branch `feat/training-views-4b`.

**The code in this plan was prototyped, reviewed and run while planning**, on top of plan 4a's final code. Three reviewers (spec conformance, data safety, phone layout and tests) went over it; their 21 findings were fixed and re-verified. Every task was then rebuilt as one commit on top of plan 4a and checked independently: the suite and the typecheck pass at the end of every task, with the counts given in its last step. Copy the code as written; where a test and the code disagree, the code is the reference.

## Global Constraints

- Everything in plan 4a's Global Constraints applies unchanged: dependency pins, TypeScript strictness, the test environments, signals in components only through hooks, every write through `Data.edit`/`Data.create` with `data.clock()`, tombstones with a 6-second Undo, a write control ignores a second tap until its write has landed, colours only as tokens in `src/ui/theme.css`, 44 px touch targets, English text, synthetic fixtures, no model change, files written with the Write/Edit tools, commit messages ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Catalog rules (spec 1 §3): `metric` and `perSide` never change after creation; an exercise referenced by a live block of a live session (readable or read-only) is archived, never deleted; names are unique, and a create or rename that hits an existing name (deleted ones included) writes nothing and offers that entry. The engine's catalog heal (`restoreReferenced`) is not touched.
- The four calendar tokens `--chip-push`, `--chip-pull`, `--chip-legs`, `--chip-other` join the `:root` block; `theme.test.ts` requires them.

## Review Focus

Inputs the spec implies but does not name, most likely first. Each is pinned to a test in the task that owns the code.

1. **Creating an exercise under the name of an archived or deleted one with a different metric** (a seconds version of a reps exercise). Silently reviving the old entry would log seconds as reps. → Task 5 "Create on a deleted name with another metric writes nothing and asks; Use it brings the entry back as it was" and "Create on an archived name with another metric writes nothing and asks; Cancel keeps the form, Use it adds the existing entry".
2. **Renaming onto the name of a deleted exercise**: two live entries with one name would follow on the next restore. → Task 1 "a tombstoned entry's name is a clash too and changes nothing (spec 1 §3: tombstoned names count)"; Task 5 "a rename to the name of a deleted entry writes nothing; Use it opens that entry, which offers Restore (spec 1 §3)".
3. **An exercise used only by a read-only or quarantined session file**: it has history, so Delete must stay away. → Task 5 "a session on a read-only row that uses the exercise keeps Delete away (spec 1 §3)" and "Delete refuses at write time when a locked session that uses the exercise arrived meanwhile".
4. **The migrated bodyweight entry with two decimals**: a note or date change must not force a retyped weight. → Task 4 "a migrated two-decimal entry can still get a new note and date".
5. **A training week across New Year** must keep the streak. → Task 3 "crosses a year boundary inside one ISO week (2030-12-30 … 2031-01-05)".

## File Structure

| File | Responsibility |
|---|---|
| `src/model/edit-bodyweight.ts` | Add, change, delete, undelete a bodyweight entry |
| `src/model/edit-catalog.ts` | Rename with the clash result, archive, delete only without history, undelete with the clash check |
| `src/ui/components/more/MoreTab.tsx` | The menu and the page switch |
| `src/ui/components/more/exercises.vm.ts`, `ExercisesPage.tsx` | Exercises by family with the last date |
| `src/ui/components/more/exercise-history.vm.ts`, `ExerciseHistoryPage.tsx` | One row per block, newest first, with year headings |
| `src/ui/components/more/calendar.vm.ts`, `CalendarPage.tsx` | Month grids, dots, counts, streak, lazy months |
| `src/ui/components/more/bodyweight.vm.ts`, `BodyweightPage.tsx`, `BodyweightSheet.tsx` | The line, the list, add/edit/delete |
| `src/ui/components/more/catalog.vm.ts`, `CatalogPage.tsx`, `ExerciseEditPage.tsx` | The catalog list and the edit page |
| `src/ui/components/shared/ExerciseForm.tsx`, `ClashSheet.tsx`, `create-clash.ts` | The create form and the name clash, shared with the Log tab |
| `src/ui/soft-flags.ts` | Soft catalog issues per block |

### Task 1: Bodyweight and catalog edits

The pure edits behind the bodyweight log and the catalog screen (spec 4 §6, spec 1 §3): add, change, delete and undelete a bodyweight entry; rename, archive, delete and undelete an exercise, with the name clash returned instead of written, `metric` and `perSide` never touched, and a delete refused while the exercise has history.

**Files:**
- Create: `src/model/edit-bodyweight.test.ts`
- Create: `src/model/edit-bodyweight.ts`
- Create: `src/model/edit-catalog.test.ts`
- Create: `src/model/edit-catalog.ts`

**Interfaces:**
- Consumes: `src/model/catalog`, `src/model/edit`, `src/model/record`, `src/model/schema`, `src/model/slug`, `src/model/types`, `src/model/validate`.
- Produces:
  - `src/model/edit-bodyweight.ts`:
    - `export interface BodyweightInput`
    - `export function emptyBodyweightFile(): BodyweightFile`
    - `export function addBodyweightEntry(`
    - `export function setBodyweightEntry(`
    - `export function deleteBodyweightEntry(file: BodyweightFile, entryId: string, now: Date): BodyweightFile`
    - `export function undeleteBodyweightEntry(file: BodyweightFile, entryId: string, now: Date): BodyweightFile`
  - `src/model/edit-catalog.ts`:
    - `export interface ExerciseFields`
    - `export type UpdateExerciseResult = { ok: true; file: ExercisesFile } | { ok: false; clash: Exercise }`
    - `export function emptyExercisesFile(): ExercisesFile`
    - `export function updateExercise(file: ExercisesFile, id: string, fields: ExerciseFields, now: Date): UpdateExerciseResult`
    - `export function setArchived(file: ExercisesFile, id: string, archived: boolean, now: Date): ExercisesFile`
    - `export function referencingSessions(exerciseId: string, sessions: readonly Session[]): Session[]`
    - `export function isReferenced(exerciseId: string, sessions: readonly Session[]): boolean`
    - `export function deleteExercise(file: ExercisesFile, id: string, sessions: readonly Session[], now: Date): ExercisesFile`
    - `export function restoreClash(file: ExercisesFile, id: string): Exercise | undefined`
    - `export function undeleteExercise(file: ExercisesFile, id: string, now: Date): ExercisesFile`

- [ ] **Step 1: Write the failing tests**

Create `src/model/edit-bodyweight.test.ts`:

```ts
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
```

Create `src/model/edit-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EditError } from './edit';
import {
  deleteExercise,
  emptyExercisesFile,
  isReferenced,
  restoreClash,
  setArchived,
  undeleteExercise,
  updateExercise,
  type ExerciseFields,
} from './edit-catalog';
import { MODEL_VERSION } from './schema';
import { T0, block, exercise, exercisesFile, session, set } from './test-fixtures';
import type { ExercisesFile } from './types';
import { validateForWrite } from './validate';

const later = new Date('2030-01-01T11:00:00.000Z');
const LATER = '2030-01-01T11:00:00.000Z';
const earlier = new Date('2030-01-01T09:00:00.000Z');
const T0_PLUS_1 = '2030-01-01T10:00:00.001Z';

const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const GONE = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: T0 });
const OLD = exercise({ id: 'kipping', name: 'Kipping', archived: true });

/** Every edit result must be writable as it is. */
function valid(file: ExercisesFile): ExercisesFile {
  const result = validateForWrite('exercises', file);
  expect(result.issues).toEqual([]);
  expect(result.ok).toBe(true);
  return file;
}

function updated(file: ExercisesFile, id: string, fields: ExerciseFields, now: Date = later): ExercisesFile {
  const r = updateExercise(file, id, fields, now);
  if (!r.ok) throw new Error(`unexpected clash with ${r.clash.id}`);
  return valid(r.file);
}

describe('emptyExercisesFile', () => {
  it('is the current version with no exercises, and valid', () => {
    expect(valid(emptyExercisesFile())).toEqual({ schemaVersion: MODEL_VERSION, exercises: [] });
  });
});

describe('updateExercise', () => {
  it('renames keeping the id, trims the name, and touches only that entry', () => {
    const input = exercisesFile([PULL, PUSH]);
    const file = updated(input, 'pull-ups', { name: '  Strict Pull-ups ' });
    expect(file.exercises).toEqual([{ ...PULL, name: 'Strict Pull-ups', updatedAt: LATER }, PUSH]);
    expect(file.exercises[1]).toBe(PUSH);
  });

  it('changes family, pattern, default load type and cues; blank or null removes family and cues', () => {
    const withCues = exercise({ ...PULL, cues: 'scapula first' });
    const a = updated(exercisesFile([withCues]), 'pull-ups', { family: ' row ', pattern: 'other', defaultLoadType: 'added', cues: ' hollow body ' });
    expect(a.exercises[0]).toEqual({ ...withCues, family: 'row', pattern: 'other', defaultLoadType: 'added', cues: 'hollow body', updatedAt: LATER });
    const b = updated(exercisesFile([withCues]), 'pull-ups', { family: null, cues: '   ' });
    expect(b.exercises[0]).not.toHaveProperty('family');
    expect(b.exercises[0]).not.toHaveProperty('cues');
  });

  it('never changes id, metric or perSide, even when a caller sneaks them in', () => {
    const sneaky = { name: 'Chin-ups', id: 'chin-ups', metric: 'seconds', perSide: true } as unknown as ExerciseFields;
    const file = updated(exercisesFile([PULL]), 'pull-ups', sneaky);
    expect(file.exercises[0]).toMatchObject({ id: 'pull-ups', name: 'Chin-ups', metric: 'reps', perSide: false });
  });

  it('a name another live or archived entry has is a clash and changes nothing', () => {
    const input = exercisesFile([PULL, PUSH, GONE, OLD]);
    for (const [name, other] of [[' push-UPS ', PUSH], ['KIPPING', OLD]] as const) {
      const r = updateExercise(input, 'pull-ups', { name, cues: 'x' }, later);
      expect(r).toEqual({ ok: false, clash: other });
    }
  });

  it('a tombstoned entry\'s name is a clash too and changes nothing (spec 1 §3: tombstoned names count)', () => {
    const input = exercisesFile([PULL, GONE]);
    const r = updateExercise(input, 'pull-ups', { name: ' ring ROWS ', cues: 'x' }, later);
    expect(r).toEqual({ ok: false, clash: GONE });
    expect(input.exercises).toEqual([PULL, GONE]);
  });

  it('a name held by a non-deleted entry and a tombstone returns the non-deleted one', () => {
    const twin = exercise({ id: 'push-ups-2', name: 'Push-ups', deletedAt: T0 });
    const r = updateExercise(exercisesFile([PULL, twin, PUSH]), 'pull-ups', { name: 'Push-ups' }, later);
    expect(r).toEqual({ ok: false, clash: PUSH });
  });

  it('the entry\'s own name in another case is no clash', () => {
    const file = updated(exercisesFile([PULL, PUSH]), 'pull-ups', { name: 'PULL-UPS' });
    expect(file.exercises[0]?.name).toBe('PULL-UPS');
  });

  it('returns the same file when nothing changes', () => {
    const input = exercisesFile([PULL]);
    const r = updateExercise(input, 'pull-ups', { name: 'Pull-ups', family: 'pull-up', pattern: 'pull' }, later);
    expect(r).toEqual({ ok: true, file: input });
    if (r.ok) expect(r.file).toBe(input);
  });

  it('keeps updatedAt increasing when the clock is behind', () => {
    const file = updated(exercisesFile([PULL]), 'pull-ups', { cues: 'x' }, earlier);
    expect(file.exercises[0]?.updatedAt).toBe(T0_PLUS_1);
  });

  it('refuses an unknown id, a blank name, and a pattern or load type outside the schema', () => {
    const input = exercisesFile([PULL]);
    expect(() => updateExercise(input, 'nope', { cues: 'x' }, later)).toThrow(EditError);
    expect(() => updateExercise(input, 'pull-ups', { name: '   ' }, later)).toThrow(EditError);
    expect(() => updateExercise(input, 'pull-ups', { pattern: 'arms' } as unknown as ExerciseFields, later)).toThrow(EditError);
    expect(() => updateExercise(input, 'pull-ups', { defaultLoadType: 'kettlebell' } as unknown as ExerciseFields, later)).toThrow(EditError);
  });

  it('does not mutate the input file', () => {
    const input = exercisesFile([PULL, PUSH]);
    const copy = structuredClone(input);
    updateExercise(input, 'pull-ups', { name: 'Chin-ups' }, later);
    expect(input).toEqual(copy);
  });
});

describe('setArchived', () => {
  it('archives and unarchives, touching only that entry', () => {
    const archived = valid(setArchived(exercisesFile([PULL, PUSH]), 'pull-ups', true, later));
    expect(archived.exercises).toEqual([{ ...PULL, archived: true, updatedAt: LATER }, PUSH]);
    const back = valid(setArchived(exercisesFile([OLD]), 'kipping', false, later));
    expect(back.exercises[0]).toEqual({ ...OLD, archived: false, updatedAt: LATER });
  });

  it('returns the same file when the entry already has that state', () => {
    const input = exercisesFile([PULL]);
    expect(setArchived(input, 'pull-ups', false, later)).toBe(input);
  });

  it('refuses an unknown id', () => {
    expect(() => setArchived(exercisesFile([PULL]), 'nope', true, later)).toThrow(EditError);
  });
});

describe('isReferenced', () => {
  it('counts only live blocks of live sessions', () => {
    const live = session([block([set()], { exerciseId: 'pull-ups' })]);
    expect(isReferenced('pull-ups', [live])).toBe(true);
    expect(isReferenced('push-ups', [live])).toBe(false);
    const deletedBlock = session([block([set()], { exerciseId: 'pull-ups', deletedAt: T0 })]);
    const deletedSession = session([block([set()], { exerciseId: 'pull-ups' })], { deletedAt: T0 });
    expect(isReferenced('pull-ups', [deletedBlock, deletedSession])).toBe(false);
  });

  it('a live block without sets still references the exercise', () => {
    expect(isReferenced('pull-ups', [session([block([], { exerciseId: 'pull-ups' })])])).toBe(true);
  });
});

describe('deleteExercise', () => {
  it('tombstones an unreferenced entry, touching only it', () => {
    const sessions = [session([block([set()], { exerciseId: 'push-ups' })])];
    const file = valid(deleteExercise(exercisesFile([PULL, PUSH]), 'pull-ups', sessions, later));
    expect(file.exercises).toEqual([{ ...PULL, updatedAt: LATER, deletedAt: LATER }, PUSH]);
  });

  it('refuses a referenced entry (spec 1 §3: archive, never delete)', () => {
    const sessions = [session([block([set()], { exerciseId: 'pull-ups' })])];
    expect(() => deleteExercise(exercisesFile([PULL]), 'pull-ups', sessions, later)).toThrow(EditError);
    expect(() => deleteExercise(exercisesFile([PULL]), 'pull-ups', sessions, later)).toThrow(/archive/);
  });

  it('refuses an unknown id', () => {
    expect(() => deleteExercise(exercisesFile([PULL]), 'nope', [], later)).toThrow(EditError);
  });
});

describe('undeleteExercise', () => {
  it('removes the tombstone, touching only that entry', () => {
    const file = valid(undeleteExercise(exercisesFile([GONE, PUSH]), 'ring-rows', later));
    expect(file.exercises[0]).not.toHaveProperty('deletedAt');
    expect(file.exercises[0]?.updatedAt).toBe(LATER);
    expect(file.exercises[1]).toBe(PUSH);
  });

  it('refuses an unknown id', () => {
    expect(() => undeleteExercise(exercisesFile([PULL]), 'nope', later)).toThrow(EditError);
  });

  it('refuses when a live or archived entry holds the name (the offline race spec 1 §3 accepts)', () => {
    const renamed = exercise({ id: 'rows', name: 'ring  ROWS' });
    expect(() => undeleteExercise(exercisesFile([GONE, renamed]), 'ring-rows', later)).toThrow(/an exercise named “ring {2}ROWS” exists/);
    expect(() => undeleteExercise(exercisesFile([GONE, { ...renamed, archived: true }]), 'ring-rows', later)).toThrow(EditError);
  });

  it('another tombstone with the same name is no clash', () => {
    const twin = exercise({ id: 'ring-rows-2', name: 'Ring Rows', deletedAt: T0 });
    const file = valid(undeleteExercise(exercisesFile([GONE, twin]), 'ring-rows', later));
    expect(file.exercises[0]).not.toHaveProperty('deletedAt');
  });
});

describe('restoreClash', () => {
  it('names the non-deleted entry that holds the name of the one to restore', () => {
    const renamed = exercise({ id: 'rows', name: 'Ring Rows' });
    expect(restoreClash(exercisesFile([GONE, PUSH, renamed]), 'ring-rows')).toBe(renamed);
    expect(restoreClash(exercisesFile([GONE, PUSH, { ...renamed, archived: true }]), 'ring-rows')?.id).toBe('rows');
  });

  it('is undefined without a clash, for a deleted twin, and for an unknown id', () => {
    expect(restoreClash(exercisesFile([GONE, PUSH]), 'ring-rows')).toBeUndefined();
    expect(restoreClash(exercisesFile([GONE, { ...PUSH, name: 'Ring Rows', deletedAt: T0 }]), 'ring-rows')).toBeUndefined();
    expect(restoreClash(exercisesFile([GONE]), 'nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/model/edit-bodyweight.test.ts src/model/edit-catalog.test.ts`

Expected: FAIL. The first error reads:

```
src/model/edit-bodyweight.test.ts: Error: Cannot find module './edit-bodyweight' imported from src/model/edit-bodyweight.test.ts
```


- [ ] **Step 3: Write the implementation**

Create `src/model/edit-bodyweight.ts`:

```ts
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
```

Create `src/model/edit-catalog.ts`:

```ts
import { findByName } from './catalog';
import { EditError } from './edit';
import { tombstone, touch, undelete } from './record';
import { LOAD_TYPES, MODEL_VERSION, PATTERNS } from './schema';
import { normalizeName } from './slug';
import type { Exercise, ExercisesFile, LoadType, Pattern, Session } from './types';

/**
 * Pure edits over `exercises.json` (spec 4 §6 "Catalog", spec 1 §3): rename and the other mutable
 * fields, archive, and delete of an unused entry. Each returns a new file with `updatedAt` moved on
 * the edited entry only (the same file object when nothing changes); `now` is always passed in.
 * `id`, `metric` and `perSide` never change here. Every result passes
 * `validateForWrite('exercises', …)` when the input did.
 */
export interface ExerciseFields {
  name?: string;
  family?: string | null;
  pattern?: Pattern;
  defaultLoadType?: LoadType;
  cues?: string | null;
}

export type UpdateExerciseResult = { ok: true; file: ExercisesFile } | { ok: false; clash: Exercise };

export function emptyExercisesFile(): ExercisesFile {
  return { schemaVersion: MODEL_VERSION, exercises: [] };
}

function requireExercise(file: ExercisesFile, id: string): Exercise {
  const found = file.exercises.find((e) => e.id === id);
  if (found === undefined) throw new EditError(`unknown exercise ${id}`);
  return found;
}

function replaceExercise(file: ExercisesFile, next: Exercise): ExercisesFile {
  return { ...file, exercises: file.exercises.map((e) => (e.id === next.id ? next : e)) };
}

/** Trimmed text, or undefined when the field is to be removed (null, empty or blank). */
function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A copy of `e` with an optional text field set to `value`, or without it when `value` is undefined. */
function withOptional(e: Exercise, field: 'family' | 'cues', value: string | undefined): Exercise {
  const { [field]: _removed, ...rest } = e;
  return value === undefined ? rest : { ...rest, [field]: value };
}

function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  const found = allowed.find((x) => x === value);
  if (found === undefined) throw new EditError(`not a ${what}: ${value}`);
  return found;
}

/** Changes the mutable fields of one entry. A name that any other entry already has (live, archived
 *  or tombstoned) is a clash: nothing changes and that entry is returned, a non-deleted one first.
 *  Spec 1 §3: tombstoned names count, and a name that exists never makes a second record; the app
 *  offers the existing entry instead (a deleted one can then be restored). */
export function updateExercise(file: ExercisesFile, id: string, fields: ExerciseFields, now: Date): UpdateExerciseResult {
  const current = requireExercise(file, id);
  let next: Exercise = { ...current };
  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (name === '') throw new EditError('the name must not be blank');
    // findByName prefers a non-deleted match, then falls back to a tombstone.
    const clash = findByName(file.exercises.filter((e) => e.id !== id), name);
    if (clash !== undefined) return { ok: false, clash };
    next.name = name;
  }
  if (fields.pattern !== undefined) next.pattern = oneOf(PATTERNS, fields.pattern, 'pattern');
  if (fields.defaultLoadType !== undefined) next.defaultLoadType = oneOf(LOAD_TYPES, fields.defaultLoadType, 'load type');
  if (fields.family !== undefined) next = withOptional(next, 'family', optionalText(fields.family));
  if (fields.cues !== undefined) next = withOptional(next, 'cues', optionalText(fields.cues));
  const unchanged =
    next.name === current.name &&
    next.pattern === current.pattern &&
    next.defaultLoadType === current.defaultLoadType &&
    next.family === current.family &&
    next.cues === current.cues;
  if (unchanged) return { ok: true, file };
  return { ok: true, file: replaceExercise(file, touch(next, now)) };
}

export function setArchived(file: ExercisesFile, id: string, archived: boolean, now: Date): ExercisesFile {
  const current = requireExercise(file, id);
  if (current.archived === archived) return file;
  return replaceExercise(file, touch({ ...current, archived }, now));
}

/** The live sessions with at least one live block of the exercise. */
export function referencingSessions(exerciseId: string, sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.deletedAt === undefined && s.blocks.some((b) => b.deletedAt === undefined && b.exerciseId === exerciseId));
}

/** Live blocks of live sessions that reference the exercise. */
export function isReferenced(exerciseId: string, sessions: readonly Session[]): boolean {
  return referencingSessions(exerciseId, sessions).length > 0;
}

/** EditError when referenced (spec 1 §3: archive, never delete); else a tombstone. */
export function deleteExercise(file: ExercisesFile, id: string, sessions: readonly Session[], now: Date): ExercisesFile {
  const current = requireExercise(file, id);
  const used = referencingSessions(id, sessions).length;
  if (used > 0) throw new EditError(`${current.name} is used in ${used} session${used === 1 ? '' : 's'}; archive it instead`);
  return replaceExercise(file, tombstone(current, now));
}

/** The non-deleted entry (live or archived) other than `id` that holds `id`'s name: bringing `id`
 *  back would make two non-deleted entries with one name (spec 1 §3). A rename never takes a deleted
 *  entry's name (`updateExercise`), so this guards only the offline race spec 1 §3 accepts (two
 *  devices naming entries alike before they sync). */
export function restoreClash(file: ExercisesFile, id: string): Exercise | undefined {
  const entry = file.exercises.find((e) => e.id === id);
  if (entry === undefined) return undefined;
  const wanted = normalizeName(entry.name);
  return file.exercises.find((e) => e.id !== id && e.deletedAt === undefined && normalizeName(e.name) === wanted);
}

/** EditError when another non-deleted entry holds the name meanwhile (`restoreClash`); screens check first. */
export function undeleteExercise(file: ExercisesFile, id: string, now: Date): ExercisesFile {
  const current = requireExercise(file, id);
  const clash = restoreClash(file, id);
  if (clash !== undefined) throw new EditError(`an exercise named “${clash.name}” exists; rename it first`);
  return replaceExercise(file, undelete(current, now));
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 76 test files and 1083 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/model/edit-bodyweight.test.ts src/model/edit-bodyweight.ts src/model/edit-catalog.test.ts src/model/edit-catalog.ts
git commit -m "Add the bodyweight and catalog edit functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: More menu, exercise list and history

The More tab menu and page switch, the exercise list grouped by family with the last date, and the per-exercise history: one row per block, newest first, with run numbers, totals, both block indicators and the block load (spec 4 §6). The calendar, bodyweight and catalog pages are placeholders until their tasks.

**Files:**
- Modify: `src/ui/app.test.tsx`
- Create: `src/ui/components/more/BodyweightPage.tsx`
- Create: `src/ui/components/more/CalendarPage.tsx`
- Create: `src/ui/components/more/CatalogPage.tsx`
- Create: `src/ui/components/more/ExerciseEditPage.tsx`
- Create: `src/ui/components/more/ExerciseHistoryPage.tsx`
- Create: `src/ui/components/more/ExercisesPage.tsx`
- Create: `src/ui/components/more/MoreTab.test.tsx`
- Modify: `src/ui/components/more/MoreTab.tsx`
- Create: `src/ui/components/more/exercise-history.vm.test.ts`
- Create: `src/ui/components/more/exercise-history.vm.ts`
- Create: `src/ui/components/more/exercises.vm.test.ts`
- Create: `src/ui/components/more/exercises.vm.ts`
- Modify: `src/ui/format.test.ts`
- Modify: `src/ui/format.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/derive/compare`, `src/model/types`, `src/ui/components/shared`, `src/ui/context`, `src/ui/router`.
- Produces:
  - `src/ui/components/more/BodyweightPage.tsx`:
    - `export function BodyweightPage(): JSX.Element`
  - `src/ui/components/more/CalendarPage.tsx`:
    - `export function CalendarPage(): JSX.Element`
  - `src/ui/components/more/CatalogPage.tsx`:
    - `export function CatalogPage(): JSX.Element`
  - `src/ui/components/more/ExerciseEditPage.tsx`:
    - `export function ExerciseEditPage(p: { exerciseId: string }): JSX.Element`
  - `src/ui/components/more/ExerciseHistoryPage.tsx`:
    - `export function ExerciseHistoryPage(p: { exerciseId: string }): JSX.Element`
  - `src/ui/components/more/ExercisesPage.tsx`:
    - `export function ExercisesPage(): JSX.Element`
  - `src/ui/components/more/MoreTab.tsx`:
    - `export function MoreTab(): JSX.Element`
  - `src/ui/components/more/exercise-history.vm.ts`:
    - `export interface HistoryRow`
    - `export interface ExerciseHistoryVm { name: string; archived: boolean; unknown: boolean; metric: 'reps' | 'seconds'; rows: HistoryRow[] }`
    - `export function exerciseHistoryVm(`
  - `src/ui/components/more/exercises.vm.ts`:
    - `export interface ExerciseListRow { id: string; name: string; lastDate: string | undefined /* formatDayYear of the latest live block's session (the year only outside today's) */ }`
    - `export interface ExerciseGroup { family: string /* family or the name itself */; rows: ExerciseListRow[] }`
    - `export interface ExercisesVm { live: ExerciseGroup[]; archived: ExerciseGroup[] }`
    - `export function exercisesVm(catalog: readonly Exercise[], sessions: readonly Session[], today: string): ExercisesVm`
  - `src/ui/format.ts`:
    - `export function localDate(now: Date): string`
    - `export function parseLocalDate(date: string): Date`
    - `export function formatDay(date: string): string`
    - `export function formatDayYear(date: string, today: string): string`
    - `export function formatDayLong(date: string): string`
    - `export function formatMonth(date: string): string`
    - `export function formatLabel(label: SessionLabel): string`
    - `export function formatTime(iso: string): string`
    - `export function formatClock(seconds: number): string`
    - `export function formatMinutes(seconds: number): string`
    - `export function formatAmount(n: number): string`
    - `export function formatLoad(loadType: LoadType, loadKg: number): string`
    - `export function formatLoadShort(loadType: LoadType, loadKg: number): string`
    - `export function glyph(ind: AmountIndicator | LoadIndicator): string`
    - `export function glyphLabel(ind: AmountIndicator | LoadIndicator): string`

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `src/ui/app.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../sync/db';
import { block, ladder, session, sessionFile } from '../model/test-fixtures';
import { sessionPath } from '../sync/paths';
import type { Issue } from '../sync/store';
import { Store } from '../sync/store';
import { App } from './app';
import { AppContext, type AppDeps, type SyncActions } from './context';
import { Data } from './data';
import { Router, type RouterWindow } from './router';

function fakeWindow(hash: string): RouterWindow {
  const win: RouterWindow = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

async function mount(over: { hash?: string; connected?: boolean; issues?: Issue[]; before?: (store: Store) => Promise<void> } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  await over.before?.(store);
  const data = new Data({ store });
  await data.load();
  if (over.issues !== undefined) data.issues.value = over.issues;
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const router = new Router(fakeWindow(over.hash ?? '#/log'));
  const deps: AppDeps = {
    data, router, sync,
    ui: {
      connected: signal(over.connected ?? true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    },
  };
  render(<AppContext.Provider value={deps}><App /></AppContext.Provider>);
  return deps;
}

const heading = () => document.querySelector('main h2')?.textContent;

describe('App', () => {
  it('renders the screen of the current route and switches with the router', async () => {
    const { router } = await mount();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy(); // the Log tab without an open session
    act(() => { router.navigate({ tab: 'days' }); });
    expect(document.querySelector('main .days')).toBeTruthy();
    act(() => { router.navigate({ tab: 'days', sessionId: 'abc' }); });
    expect(document.querySelector('main h1')?.textContent).toBe('Session'); // the session page's BackBar
    expect(screen.getByText('This session is not here.')).toBeTruthy();
    act(() => { router.navigate({ tab: 'more' }); });
    expect(screen.getByRole('navigation', { name: 'More' })).toBeTruthy();
    act(() => { router.navigate({ tab: 'sync' }); });
    expect(document.querySelector('.sync')).toBeTruthy();
  });

  it('tab buttons navigate and mark the active tab', async () => {
    const { router } = await mount();
    const tabs = screen.getAllByRole('button', { name: /^(Log|Days|More|Sync)$/ });
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(true);
    act(() => { screen.getByRole('button', { name: 'Days' }).click(); });
    expect(router.route.value).toEqual({ tab: 'days' });
    expect(screen.getByRole('button', { name: 'Days' }).classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(false);
  });

  it('shows 3 on the Sync tab for three issues', async () => {
    await mount({
      issues: [
        { path: 'a.json', reason: 'quarantined', detail: 'x' },
        { path: 'b.json', reason: 'duplicate', detail: 'y' },
        { path: 'c.txt', reason: 'unexpected-file', detail: 'z' },
      ],
    });
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('3');
    expect(document.querySelector('.tabbar__dot')).toBeNull();
  });

  it('counts a held-back write once, though the store lists it as an issue too', async () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    // 30 February fails a hard rule: the write stays local and queued, held back (spec 3 §5).
    const bad = sessionFile({ ...s, date: '2030-02-30' });
    const { data } = await mount({
      before: async (store) => {
        expect(await store.writeFile('session', sessionPath(s.date, s.id), bad, new Date('2030-03-04T11:00:00.000Z'))).toMatchObject({ ok: true, heldBack: expect.any(Array) });
      },
    });
    expect(data.issues.value.map((i) => i.reason)).toEqual(['held-back']);
    expect(data.heldBackCount.value).toBe(1);
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('1');
  });

  it('shows a dot when disconnected without issues, nothing when connected and clean', async () => {
    const { ui } = await mount({ connected: false });
    expect(document.querySelector('.tabbar__dot')).toBeTruthy();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
    act(() => { ui.connected.value = true; });
    expect(document.querySelector('.tabbar__dot')).toBeNull();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
  });
});
```

Create `src/ui/components/more/MoreTab.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatAmount, formatDay } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { MoreTab } from './MoreTab';

function fakeWindow(hash: string): RouterWindow {
  const win: RouterWindow = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const older = session([block(ladder([5, 4]), { exerciseId: 'pull-ups' })], { date: '2030-03-01' });
const newer = session([block(ladder([8, 7]), { exerciseId: 'pull-ups' }), block(ladder([3]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-04' });

async function mount(hash: string, sessions: Session[] = [older, newer]) {
  const store = new Store(await openDb(new IDBFactory()));
  const data = new Data({ store, now: () => new Date('2030-03-05T10:00:00.000Z') });
  await data.load();
  await data.create('exercises', EXERCISES_PATH, exercisesFile([
    exercise({ id: 'pull-ups', name: 'Pull-ups', family: 'Pull-up' }),
    exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
    exercise({ id: 'rows', name: 'Rows', archived: true }),
  ]));
  for (const s of sessions) await data.create('session', sessionPath(s.date, s.id), sessionFile(s));
  await data.refresh(EXERCISES_PATH);
  for (const s of sessions) await data.refresh(sessionPath(s.date, s.id));
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow(hash));
  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><MoreTab /></AppContext.Provider>);
  return { data, router };
}

describe('MoreTab', () => {
  it('shows the menu and each entry navigates to its page', async () => {
    const { router } = await mount('#/more');
    for (const [label, page] of [['Exercises', 'exercises'], ['Calendar', 'calendar'], ['Bodyweight', 'bodyweight'], ['Catalog', 'catalog']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(router.route.value).toEqual({ tab: 'more', page });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(router.route.value).toEqual({ tab: 'more' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Exercises' })).toBeTruthy());
    }
  });

  it('the exercise route without an id shows the exercise list', async () => {
    await mount('#/more/exercise');
    expect(screen.getByRole('button', { name: /Pull-ups/ }).textContent).toContain(formatDay('2030-03-04'));
  });

  it('lists exercises by family with the last date, archived ones apart, and opens the history', async () => {
    const { router } = await mount('#/more/exercises');
    expect(screen.getByText('Pull-up')).toBeTruthy();
    const pullUps = screen.getByRole('button', { name: /Pull-ups/ });
    expect(pullUps.textContent).toContain(formatDay('2030-03-04'));
    const archived = screen.getByText('Archived').closest('details');
    expect(archived?.open).toBe(false);
    expect(archived?.textContent).toContain('Rows');
    fireEvent.click(pullUps);
    expect(router.route.value).toEqual({ tab: 'more', page: 'exercise', id: 'pull-ups' });
  });

  it('lists the history rows of an exercise, and a row opens its session', async () => {
    const { router } = await mount('#/more/exercise/pull-ups');
    expect(screen.getByRole('heading', { name: 'Pull-ups' })).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /sets/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(formatDay('2030-03-04'));
    expect(rows[0]?.textContent).toContain(`${formatAmount(15)} · 2 sets`);
    expect(rows[0]?.querySelector('[aria-label="more"]')).toBeTruthy();
    fireEvent.click(rows[1] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: older.id });
  });

  it('numbers a second run in one session', async () => {
    const twice = session([block(ladder([6]), { exerciseId: 'pull-ups' }), block(ladder([4]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-02' });
    await mount('#/more/exercise/pull-ups', [twice]);
    expect(screen.getByText('run 2')).toBeTruthy();
    expect(screen.queryByText('run 1')).toBeNull();
  });
});
```

Create `src/ui/components/more/exercise-history.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blockIndicator } from '../../../model/derive';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Exercise } from '../../../model/types';
import { formatAmount, formatDay } from '../../format';
import { exerciseHistoryVm } from './exercise-history.vm';

const pullUps = exercise({ id: 'pull-ups', name: 'Pull-ups' });
const plank = exercise({ id: 'plank', name: 'Plank', metric: 'seconds', pattern: 'core', archived: true });
const catalog = new Map<string, Exercise>([[pullUps.id, pullUps], [plank.id, plank]]);
const n = formatAmount;

describe('exerciseHistoryVm', () => {
  it('lists live blocks newest session first, runs numbered within a session', () => {
    const older = session([block(ladder([5, 4]), { id: 'b-old' })], { id: 's-old', date: '2030-03-01' });
    const newer = session(
      [
        block(ladder([8, 7]), { id: 'b-first', order: 0 }),
        block(ladder([3]), { id: 'b-dips', order: 1, exerciseId: 'dips' }),
        block(ladder([6]), { id: 'b-second', order: 2 }),
      ],
      { id: 's-new', date: '2030-03-04', dateUncertain: true },
    );
    const vm = exerciseHistoryVm('pull-ups', [older, newer], catalog);
    expect(vm).toMatchObject({ name: 'Pull-ups', archived: false, unknown: false, metric: 'reps' });
    expect(vm.rows.map((r) => [r.sessionId, r.blockId, r.run])).toEqual([
      ['s-new', 'b-first', 1],
      ['s-new', 'b-second', 2],
      ['s-old', 'b-old', 1],
    ]);
    const first = vm.rows[0];
    expect(first).toMatchObject({ day: formatDay('2030-03-04'), uncertain: true, sets: `${n(8)} ${n(7)}`, totals: `${n(15)} · 2 sets`, noteOnly: false, load: 'bw' });
    expect(first?.note).toBeUndefined();
    expect(first?.marks).toEqual({ amount: 'up', load: 'hidden' });
    expect(vm.rows[1]?.marks).toEqual({ amount: 'none', load: 'none' });
    expect(vm.rows[2]).toMatchObject({ uncertain: false, totals: `${n(9)} · 2 sets` });
  });

  it('leaves out tombstoned sessions, blocks and sets', () => {
    const s = session(
      [
        block([set({ reps: 5 }), set({ reps: 9, order: 1, deletedAt: '2030-03-02T10:00:00.000Z' })], { id: 'b-live' }),
        block(ladder([4]), { id: 'b-gone', order: 1, deletedAt: '2030-03-02T10:00:00.000Z' }),
      ],
      { date: '2030-03-02' },
    );
    const gone = session([block(ladder([4]))], { date: '2030-03-03', deletedAt: '2030-03-03T10:00:00.000Z' });
    const vm = exerciseHistoryVm('pull-ups', [s, gone], catalog);
    expect(vm.rows.map((r) => [r.blockId, r.sets, r.totals])).toEqual([['b-live', n(5), `${n(5)} · 1 set`]]);
  });

  it('shows an aggregate set as 100* and a note-only block by its note', () => {
    const s = session(
      [
        block([set({ reps: 100, aggregate: true })], { id: 'b-agg' }),
        block([], { id: 'b-note', order: 1, note: 'some pull-ups' }),
      ],
      { date: '2030-03-02', source: 'migrated' },
    );
    const vm = exerciseHistoryVm('pull-ups', [s], catalog);
    expect(vm.rows[0]).toMatchObject({ sets: `${n(100)}*`, totals: `${n(100)}*`, noteOnly: false, load: 'bw' });
    expect(vm.rows[1]).toMatchObject({ sets: '', totals: '', note: 'some pull-ups', noteOnly: true, load: '' });
  });

  it('writes the block load for each group: bw, added, assist, external, band', () => {
    const loads = [
      block([set({ loadType: 'added', loadKg: 11.5 })], { id: 'added' }),
      block([set({ loadType: 'assist', loadKg: 10 })], { id: 'assist' }),
      block([set({ loadType: 'external', loadKg: 35 })], { id: 'external' }),
      block([set({ loadType: 'band', loadKg: 50 })], { id: 'band' }),
      block([set({ loadType: 'added', loadKg: 0 }), set({ order: 1 })], { id: 'zero' }),
    ];
    const sessions = loads.map((b, i) => session([b], { date: `2030-03-1${i}` }));
    const vm = exerciseHistoryVm('pull-ups', sessions, catalog);
    const byBlock = new Map(vm.rows.map((r) => [r.blockId, r.load]));
    expect(byBlock.get('added')).toBe(`+${n(11.5)}`);
    expect(byBlock.get('assist')).toBe(`−${n(10)}`);
    expect(byBlock.get('external')).toBe(`${n(35)} kg`);
    expect(byBlock.get('band')).toBe(`band ${n(50)}`);
    expect(byBlock.get('zero')).toBe('bw');
  });

  it('carries the metric and the archived flag of the exercise', () => {
    const s = session([block([timedSet({ seconds: 45 })], { exerciseId: 'plank' })], { date: '2030-03-02' });
    const vm = exerciseHistoryVm('plank', [s], catalog);
    expect(vm).toMatchObject({ name: 'Plank', archived: true, unknown: false, metric: 'seconds' });
    expect(vm.rows[0]?.sets).toBe(n(45));
  });

  it('names an unknown exercise by its id', () => {
    const s = session([block([timedSet({ seconds: 30 })], { exerciseId: 'l-sit' })], { date: '2030-03-02' });
    const vm = exerciseHistoryVm('l-sit', [s], catalog);
    expect(vm).toMatchObject({ name: 'l-sit', archived: false, unknown: true, metric: 'seconds' });
    expect(vm.rows).toHaveLength(1);
    expect(exerciseHistoryVm('nothing', [], catalog)).toEqual({ name: 'nothing', archived: false, unknown: true, metric: 'reps', rows: [] });
  });

  it('flags the rows of the open session, so their marks render provisional (spec 4 §14)', () => {
    const older = session([block(ladder([5]), { id: 'b-old' })], { id: 's-old', date: '2030-03-01' });
    const open = session([block(ladder([6]), { id: 'b-open' })], { id: 's-open', date: '2030-03-04' });
    const vm = exerciseHistoryVm('pull-ups', [older, open], catalog, 's-open');
    expect(vm.rows.map((r) => [r.blockId, r.open])).toEqual([['b-open', true], ['b-old', false]]);
    expect(exerciseHistoryVm('pull-ups', [older, open], catalog, undefined).rows.every((r) => !r.open)).toBe(true);
  });

  it('carries the year of each row, for the year headings', () => {
    const a = session([block(ladder([5]))], { date: '2029-12-30' });
    const b = session([block(ladder([6]))], { date: '2030-01-02' });
    expect(exerciseHistoryVm('pull-ups', [a, b], catalog).rows.map((r) => r.year)).toEqual(['2030', '2029']);
  });

  it('compares each run with the previous occurrence of that run (spec 1 §7), as blockIndicator does', () => {
    // Run 2 of the newest session skips the middle session, which has only one run.
    const s1 = session([block(ladder([5]), { id: 'a1' }), block(ladder([4]), { id: 'a2', order: 1 })], { id: 's1', date: '2030-03-01' });
    const s2 = session([block(ladder([6]), { id: 'b1' })], { id: 's2', date: '2030-03-02' });
    const s3 = session([block(ladder([7]), { id: 'c1' }), block(ladder([3]), { id: 'c2', order: 1 })], { id: 's3', date: '2030-03-03' });
    const sessions = [s3, s1, s2];
    const vm = exerciseHistoryVm('pull-ups', sessions, catalog);
    expect(vm.rows.map((r) => [r.blockId, r.marks.amount])).toEqual([['c1', 'up'], ['c2', 'down'], ['b1', 'up'], ['a1', 'none'], ['a2', 'none']]);
    for (const r of vm.rows) {
      const s = sessions.find((x) => x.id === r.sessionId);
      const b = s?.blocks.find((x) => x.id === r.blockId);
      if (s === undefined || b === undefined) throw new Error('row without its block');
      expect(r.marks).toEqual(blockIndicator(sessions, s, b));
    }
  });
});
```

Create `src/ui/components/more/exercises.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import { formatDay } from '../../format';
import { exercisesVm } from './exercises.vm';

const pullUps = exercise({ id: 'pull-ups', name: 'Pull-ups', family: 'Pull-up' });
const chinUps = exercise({ id: 'chin-ups', name: 'Chin-ups', family: 'Pull-up' });
const dips = exercise({ id: 'dips', name: 'Dips', pattern: 'push' });
const rows = exercise({ id: 'rows', name: 'Rows', archived: true });
const gone = exercise({ id: 'gone', name: 'Gone', deletedAt: '2030-01-02T10:00:00.000Z' });
const TODAY = '2030-03-10';

describe('exercisesVm', () => {
  it('groups live entries by family (the name when none), sorted by family then name', () => {
    const vm = exercisesVm([pullUps, dips, chinUps], [], TODAY);
    expect(vm.live.map((g) => g.family)).toEqual(['Dips', 'Pull-up']);
    expect(vm.live[1]?.rows.map((r) => r.name)).toEqual(['Chin-ups', 'Pull-ups']);
    expect(vm.archived).toEqual([]);
  });

  it('puts archived entries in their own groups and omits tombstoned ones', () => {
    const vm = exercisesVm([pullUps, rows, gone], [], TODAY);
    expect(vm.live.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['pull-ups']);
    expect(vm.archived).toEqual([{ family: 'Rows', rows: [{ id: 'rows', name: 'Rows', lastDate: undefined }] }]);
  });

  it('shows the date of the latest live block, ignoring tombstoned sessions and blocks', () => {
    const sessions = [
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-01' }),
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-05' }),
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-09', deletedAt: '2030-03-09T12:00:00.000Z' }),
      session([block(ladder([5]), { exerciseId: 'pull-ups', deletedAt: '2030-03-08T12:00:00.000Z' })], { date: '2030-03-08' }),
      session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-03-07' }),
    ];
    const vm = exercisesVm([pullUps, dips, chinUps], sessions, TODAY);
    const byId = new Map(vm.live.flatMap((g) => g.rows).map((r) => [r.id, r]));
    expect(byId.get('pull-ups')?.lastDate).toBe(formatDay('2030-03-05'));
    expect(byId.get('dips')?.lastDate).toBe(formatDay('2030-03-07'));
    expect(byId.get('chin-ups')?.lastDate).toBeUndefined();
  });

  it('adds the year to a last date outside the current year, so an old one does not look recent', () => {
    const sessions = [
      session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2029-03-05' }),
      session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-01-07' }),
    ];
    const vm = exercisesVm([pullUps, dips], sessions, TODAY);
    const byId = new Map(vm.live.flatMap((g) => g.rows).map((r) => [r.id, r]));
    expect(byId.get('pull-ups')?.lastDate).toBe(`${formatDay('2029-03-05')} 2029`);
    expect(byId.get('dips')?.lastDate).toBe(formatDay('2030-01-07'));
  });
});
```

Replace the whole content of `src/ui/format.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatClock,
  formatDay,
  formatDayLong,
  formatDayYear,
  formatLoad,
  formatLoadShort,
  formatMinutes,
  formatMonth,
  formatTime,
  glyph,
  glyphLabel,
  formatLabel,
  localDate,
  parseLocalDate,
} from './format';
import { SESSION_LABELS } from '../model/schema';

/** The device locale's rendering of a number, the same call format.ts makes (spec 4 §8: decimals use the device locale). */
const num = (n: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
const pad2 = (n: number): string => String(n).padStart(2, '0');

describe('localDate', () => {
  it('uses the local calendar day, not the UTC one, late in the evening', () => {
    // 23:30 local; in any zone east of UTC the UTC date is already the 5th.
    expect(localDate(new Date(2030, 2, 4, 23, 30))).toBe('2030-03-04');
  });

  it('uses the local calendar day early in the morning', () => {
    expect(localDate(new Date(2030, 0, 1, 0, 15))).toBe('2030-01-01');
  });

  it('pads month and day', () => {
    expect(localDate(new Date(2030, 10, 9, 12, 0))).toBe('2030-11-09');
  });
});

describe('parseLocalDate', () => {
  it('returns local midnight of that day', () => {
    const d = parseLocalDate('2030-03-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2030, 2, 4, 0, 0]);
  });

  it('round-trips with localDate', () => {
    expect(localDate(parseLocalDate('2030-12-31'))).toBe('2030-12-31');
    expect(localDate(parseLocalDate('2030-01-01'))).toBe('2030-01-01');
  });
});

describe('formatDay', () => {
  it('shows weekday, zero-padded day and short month in English', () => {
    expect(formatDay('2030-03-07')).toBe('Thu 07 Mar');
    expect(formatDay('2030-03-04')).toBe('Mon 04 Mar');
  });

  it('covers the other weekdays and months', () => {
    expect(formatDay('2030-11-30')).toBe('Sat 30 Nov');
    expect(formatDay('2030-01-01')).toBe('Tue 01 Jan');
  });
});

describe('formatDayYear', () => {
  it("is formatDay within today's year, and adds the year outside it", () => {
    expect(formatDayYear('2030-03-07', '2030-12-31')).toBe('Thu 07 Mar');
    expect(formatDayYear('2029-03-07', '2030-01-01')).toBe('Wed 07 Mar 2029');
    expect(formatDayYear('2031-01-02', '2030-12-31')).toBe('Thu 02 Jan 2031');
  });
});

describe('formatDayLong', () => {
  it('shows the weekday and the ISO date', () => {
    expect(formatDayLong('2030-03-07')).toBe('Thu 2030-03-07');
    expect(formatDayLong('2030-11-30')).toBe('Sat 2030-11-30');
  });
});

describe('formatMonth', () => {
  it('shows the full English month name and the year', () => {
    expect(formatMonth('2030-03-04')).toBe('March 2030');
    expect(formatMonth('2030-11-30')).toBe('November 2030');
  });
});

describe('formatLabel', () => {
  it('shows a session label as capitalised display text', () => {
    expect(formatLabel('push')).toBe('Push');
    expect(formatLabel('mixed')).toBe('Mixed');
    expect(SESSION_LABELS.map(formatLabel)).toEqual(['Pull', 'Push', 'Legs', 'Mixed', 'Other']);
  });
});

describe('formatTime', () => {
  it('shows the local 24 h clock of an ISO instant', () => {
    const d = new Date(2030, 2, 4, 23, 30, 0);
    expect(formatTime(d.toISOString())).toBe(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    expect(formatTime(d.toISOString())).toBe('23:30');
  });

  it('pads single-digit hours and minutes', () => {
    const d = new Date(2030, 2, 4, 7, 5, 59);
    expect(formatTime(d.toISOString())).toBe('07:05');
  });
});

describe('formatClock', () => {
  it('shows m:ss below an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(3599)).toBe('59:59');
  });

  it('switches to h:mm:ss from 3600 seconds', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(36000)).toBe('10:00:00');
  });

  it('drops fractional seconds', () => {
    expect(formatClock(59.9)).toBe('0:59');
  });
});

describe('formatMinutes', () => {
  it('shows whole minutes under an hour', () => {
    expect(formatMinutes(48 * 60)).toBe('48 min');
    expect(formatMinutes(48 * 60 + 59)).toBe('48 min');
    expect(formatMinutes(30)).toBe('0 min');
  });

  it('shows hours and minutes from an hour', () => {
    expect(formatMinutes(72 * 60)).toBe('1 h 12 min');
    expect(formatMinutes(3600)).toBe('1 h 0 min');
    expect(formatMinutes(2 * 3600 + 5 * 60)).toBe('2 h 5 min');
  });
});

describe('formatAmount', () => {
  it('matches the device locale with up to two decimals', () => {
    expect(formatAmount(11.5)).toBe(num(11.5));
    expect(formatAmount(12)).toBe(num(12));
    expect(formatAmount(0.125)).toBe(num(0.125));
  });

  it('rounds to two decimals and keeps integers plain', () => {
    expect(formatAmount(0.125)).toBe(formatAmount(0.13));
    expect(formatAmount(10)).toBe(num(10));
    expect(formatAmount(10)).toHaveLength(2);
  });
});

describe('formatLoad', () => {
  it('names bodyweight and external load', () => {
    expect(formatLoad('bodyweight', 0)).toBe('bodyweight');
    expect(formatLoad('external', 35)).toBe(`${num(35)} kg`);
  });

  it('signs added and assist, assist with U+2212 and the word assist', () => {
    expect(formatLoad('added', 11.5)).toBe(`+${num(11.5)} kg`);
    expect(formatLoad('assist', 10)).toBe(`−10 kg assist`.replace('10', num(10)));
    expect(formatLoad('assist', 10).charAt(0)).toBe('−');
  });

  it('shows the band grade without a unit', () => {
    expect(formatLoad('band', 50)).toBe(`band ${num(50)}`);
  });
});

describe('formatLoadShort', () => {
  it('abbreviates bodyweight and drops the unit on added and assist', () => {
    expect(formatLoadShort('bodyweight', 0)).toBe('bw');
    expect(formatLoadShort('added', 11.5)).toBe(`+${num(11.5)}`);
    expect(formatLoadShort('assist', 10)).toBe(`−${num(10)}`);
  });

  it('keeps the unit on external and the band word', () => {
    expect(formatLoadShort('external', 35)).toBe(`${num(35)} kg`);
    expect(formatLoadShort('band', 50)).toBe(`band ${num(50)}`);
  });
});

describe('glyph', () => {
  it('maps the trend indicators', () => {
    expect(glyph('up')).toBe('↑');
    expect(glyph('down')).toBe('↓');
    expect(glyph('same')).toBe('=');
  });

  it('maps the load-only indicators', () => {
    expect(glyph('incomparable')).toBe('≠');
    expect(glyph('none')).toBe('–');
    expect(glyph('hidden')).toBe('');
  });
});

describe('glyphLabel', () => {
  it('gives a screen-reader text for every indicator', () => {
    expect(glyphLabel('up')).toBe('more');
    expect(glyphLabel('down')).toBe('less');
    expect(glyphLabel('same')).toBe('same');
    expect(glyphLabel('incomparable')).toBe('not comparable');
    expect(glyphLabel('none')).toBe('no comparison');
  });

  it('is empty for hidden', () => {
    expect(glyphLabel('hidden')).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/app.test.tsx src/ui/components/more/MoreTab.test.tsx src/ui/components/more/exercise-history.vm.test.ts src/ui/components/more/exercises.vm.test.ts src/ui/format.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/more/MoreTab.test.tsx: TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Exercises"
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/components/more/BodyweightPage.tsx`:

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/bodyweight`: a stub until the bodyweight task replaces it. */
export function BodyweightPage(): JSX.Element {
  const { router } = useApp();
  return (
    <div class="more-page">
      <BackBar title="Bodyweight" onBack={() => router.navigate({ tab: 'more' })} />
    </div>
  );
}
```

Create `src/ui/components/more/CalendarPage.tsx`:

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/calendar`: a stub until the calendar task replaces it. */
export function CalendarPage(): JSX.Element {
  const { router } = useApp();
  return (
    <div class="more-page">
      <BackBar title="Calendar" onBack={() => router.navigate({ tab: 'more' })} />
    </div>
  );
}
```

Create `src/ui/components/more/CatalogPage.tsx`:

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/catalog`: a stub until the catalog task replaces it. */
export function CatalogPage(): JSX.Element {
  const { router } = useApp();
  return (
    <div class="more-page">
      <BackBar title="Catalog" onBack={() => router.navigate({ tab: 'more' })} />
    </div>
  );
}
```

Create `src/ui/components/more/ExerciseEditPage.tsx`:

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/catalog/<id>`: a stub until the catalog task replaces it. */
export function ExerciseEditPage(p: { exerciseId: string }): JSX.Element {
  const { data, router } = useApp();
  const exercise = data.exercises.value.find((e) => e.id === p.exerciseId);
  return (
    <div class="more-page">
      <BackBar title={exercise?.name ?? 'Exercise'} onBack={() => router.navigate({ tab: 'more', page: 'catalog' })} />
    </div>
  );
}
```

Create `src/ui/components/more/ExerciseHistoryPage.tsx`:

```tsx
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { useApp } from '../../context';
import { BackBar, Marks } from '../shared';
import { exerciseHistoryVm, type HistoryRow } from './exercise-history.vm';

/** The rows in runs of one year, newest first (the rows show no year of their own). */
function byYear(rows: readonly HistoryRow[]): { year: string; rows: HistoryRow[] }[] {
  const groups: { year: string; rows: HistoryRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last?.year === r.year) last.rows.push(r);
    else groups.push({ year: r.year, rows: [r] });
  }
  return groups;
}

/**
 * Spec 4 §6 `#/more/exercise/<id>`: one row per live block, newest first, under a heading per year;
 * a row opens its session. The open session's marks are provisional (dimmed, spec 4 §14). The view
 * model is recomputed only when its inputs change, not on every signal the page reads.
 */
export function ExerciseHistoryPage(p: { exerciseId: string }): JSX.Element {
  const { data, router } = useApp();
  const sessions = data.liveSessions.value;
  const catalog = data.exerciseById.value;
  const openId = data.openSession.value?.file.session.id;
  const vm = useMemo(() => exerciseHistoryVm(p.exerciseId, sessions, catalog, openId), [p.exerciseId, sessions, catalog, openId]);
  return (
    <div class="more-page">
      <BackBar title={vm.name} onBack={() => router.back()} />
      {(vm.archived || vm.unknown) && (
        <p class="xhist__status">{vm.unknown ? 'Unknown exercise: not in the catalog.' : 'Archived.'}</p>
      )}
      {vm.rows.length === 0 && <p class="more-page__empty">No blocks of this exercise yet.</p>}
      {byYear(vm.rows).map((g) => (
        <section key={g.year} class="xhist__year" aria-label={g.year}>
          <h2 class="xhist__yeartitle">{g.year}</h2>
          <ul class="xhist">
            {g.rows.map((r) => (
              <li key={r.blockId}>
                <button type="button" class="xhist__row" onClick={() => router.navigate({ tab: 'days', sessionId: r.sessionId })}>
                  <span class="xhist__day">
                    {r.day}
                    {r.uncertain && '?'}
                    {r.run > 1 && <sup class="xhist__run">run {r.run}</sup>}
                  </span>
                  <span class={`xhist__sets${r.noteOnly ? ' is-note' : ''}`}>{r.noteOnly ? r.note : r.sets}</span>
                  <span class="xhist__totals">{r.totals}</span>
                  <span class="xhist__marks"><Marks amount={r.marks.amount} load={r.marks.load} provisional={r.open} /></span>
                  <span class="xhist__load">{r.load}</span>
                  {!r.noteOnly && r.note !== undefined && <span class="xhist__note">{r.note}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

Create `src/ui/components/more/ExercisesPage.tsx`:

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import { localDate } from '../../format';
import { BackBar } from '../shared';
import { exercisesVm, type ExerciseGroup } from './exercises.vm';

function Groups(p: { groups: readonly ExerciseGroup[]; onOpen(id: string): void }): JSX.Element {
  return (
    <>
      {p.groups.map((g) => {
        // A family of one named like its exercise needs no heading of its own.
        const only = g.rows.length === 1 ? g.rows[0] : undefined;
        const heading = only === undefined || only.name !== g.family;
        return (
          <section key={g.family} class="xlist__group">
            {heading && <h2 class="xlist__family">{g.family}</h2>}
            <ul class="xlist__rows">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" class="xlist__row" onClick={() => p.onOpen(r.id)}>
                    <span class="xlist__name">{r.name}</span>
                    <span class="xlist__date">{r.lastDate ?? 'never'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Spec 4 §6 `#/more/exercises`: every exercise by family with its last date; archived ones collapsed. */
export function ExercisesPage(): JSX.Element {
  const { data, router } = useApp();
  const vm = exercisesVm(data.exercises.value, data.liveSessions.value, localDate(data.now.value));
  const open = (id: string): void => router.navigate({ tab: 'more', page: 'exercise', id });
  return (
    <div class="more-page">
      <BackBar title="Exercises" onBack={() => router.back()} />
      {vm.live.length === 0 && vm.archived.length === 0 && <p class="more-page__empty">No exercises yet.</p>}
      <Groups groups={vm.live} onOpen={open} />
      {vm.archived.length > 0 && (
        <details class="xlist__archived">
          <summary>Archived</summary>
          <Groups groups={vm.archived} onOpen={open} />
        </details>
      )}
    </div>
  );
}
```

Replace the whole content of `src/ui/components/more/MoreTab.tsx` with:

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import type { MorePage } from '../../router';
import { BodyweightPage } from './BodyweightPage';
import { CalendarPage } from './CalendarPage';
import { CatalogPage } from './CatalogPage';
import { ExerciseEditPage } from './ExerciseEditPage';
import { ExerciseHistoryPage } from './ExerciseHistoryPage';
import { ExercisesPage } from './ExercisesPage';

const MENU: ReadonlyArray<{ page: MorePage; label: string }> = [
  { page: 'exercises', label: 'Exercises' },
  { page: 'calendar', label: 'Calendar' },
  { page: 'bodyweight', label: 'Bodyweight' },
  { page: 'catalog', label: 'Catalog' },
];

function Menu(): JSX.Element {
  const { router } = useApp();
  return (
    <nav class="more-menu" aria-label="More">
      <h1 class="more-menu__title">More</h1>
      {MENU.map((m) => (
        <button key={m.page} type="button" class="more-menu__item" onClick={() => router.navigate({ tab: 'more', page: m.page })}>
          {m.label}
        </button>
      ))}
    </nav>
  );
}

/** Spec 4 §6: the menu of four lines and the switch to its pages (routes in spec 4 §3). */
export function MoreTab(): JSX.Element {
  const { router } = useApp();
  const route = router.route.value;
  if (route.tab !== 'more') return <Menu />;
  switch (route.page) {
    case undefined:
      break;
    case 'exercises':
      return <ExercisesPage />;
    case 'exercise':
      return route.id === undefined ? <ExercisesPage /> : <ExerciseHistoryPage exerciseId={route.id} />;
    case 'calendar':
      return <CalendarPage />;
    case 'bodyweight':
      return <BodyweightPage />;
    case 'catalog':
      return route.id === undefined ? <CatalogPage /> : <ExerciseEditPage exerciseId={route.id} />;
  }
  return <Menu />;
}
```

Create `src/ui/components/more/exercise-history.vm.ts`:

```ts
import { amountOf, blockLoad, blocksOf, blockTotals, compareBlockPair, liveSets, metricOf, sortSessions, type BlockIndicator, type BlockLoad } from '../../../model/derive';
import type { Block, Exercise, Session, WorkoutSet } from '../../../model/types';
import { formatAmount, formatDay, formatLoadShort } from '../../format';

export interface HistoryRow {
  sessionId: string;
  blockId: string;
  day: string /* formatDay */;
  uncertain: boolean;
  run: number /* 1 for the first block of X in that session, 2 … */;
  sets: string /* amounts joined by ' ', aggregate as '100*' */;
  note: string | undefined;
  noteOnly: boolean;
  totals: string /* '143 · 14 sets' */;
  marks: BlockIndicator;
  load: string /* formatLoadShort of blockLoad's group/kg; '' when no sets */;
  /** The session's year ('2030'), for the year headings of spec 4 §6 (the rows themselves show no year). */
  year: string;
  /** The block belongs to the open session: its marks are provisional, shown dimmed (spec 4 §14). */
  open: boolean;
}
export interface ExerciseHistoryVm { name: string; archived: boolean; unknown: boolean; metric: 'reps' | 'seconds'; rows: HistoryRow[] }

/** Spec 4 §6 block load: blockLoad's body group is one signed axis (bw at 0, +added, −assist). */
function loadText(load: BlockLoad | undefined): string {
  if (load === undefined) return '';
  switch (load.group) {
    case 'body':
      if (load.kg === 0) return formatLoadShort('bodyweight', 0);
      return load.kg > 0 ? formatLoadShort('added', load.kg) : formatLoadShort('assist', -load.kg);
    case 'external':
      return formatLoadShort('external', load.kg);
    case 'band':
      return formatLoadShort('band', load.kg);
  }
}

/** '143 · 14 sets'; an aggregate marks the total with '*' and is not a set; '' for an empty block. */
function totalsText(block: Block): string {
  const t = blockTotals(block);
  if (t.isEmpty) return '';
  const parts = [`${formatAmount(t.amount)}${t.hasAggregate ? '*' : ''}`];
  if (t.setCount > 0) parts.push(`${t.setCount} ${t.setCount === 1 ? 'set' : 'sets'}`);
  return parts.join(' · ');
}

function row(session: Session, block: Block, run: number, marks: BlockIndicator, open: boolean): HistoryRow {
  const sets = liveSets(block);
  return {
    sessionId: session.id,
    blockId: block.id,
    day: formatDay(session.date),
    uncertain: session.dateUncertain === true,
    run,
    sets: sets.map((s) => `${formatAmount(amountOf(s))}${s.aggregate === true ? '*' : ''}`).join(' '),
    note: block.note,
    noteOnly: sets.length === 0 && block.note !== undefined,
    totals: totalsText(block),
    marks,
    load: loadText(blockLoad(block)),
    year: session.date.slice(0, 4),
    open,
  };
}

/**
 * Spec 4 §6: every live block of the exercise, newest session first; within a session by run. The
 * marks are `blockIndicator`'s (spec 1 §7: block n of X against block n of X in the most recent
 * earlier session that has n blocks of X), computed in one walk from the oldest session, keeping
 * the last block per run, instead of sorting all sessions again for every row. `openSessionId`
 * marks the open session's rows provisional.
 */
export function exerciseHistoryVm(
  exerciseId: string,
  sessions: readonly Session[],
  catalog: ReadonlyMap<string, Exercise>,
  openSessionId?: string | undefined,
): ExerciseHistoryVm {
  const lastByRun: Block[] = [];
  const perSession: HistoryRow[][] = [];
  let firstSet: WorkoutSet | undefined;
  for (const s of sortSessions(sessions)) {
    const blocks = blocksOf(s, exerciseId);
    if (blocks.length === 0) continue;
    perSession.push(blocks.map((b, i) => row(s, b, i + 1, compareBlockPair(b, lastByRun[i]), s.id === openSessionId)));
    blocks.forEach((b, i) => {
      lastByRun[i] = b;
    });
    firstSet ??= blocks.flatMap(liveSets)[0];
  }
  const exercise = catalog.get(exerciseId);
  return {
    name: exercise?.name ?? exerciseId,
    archived: exercise?.archived ?? false,
    unknown: exercise === undefined,
    metric: exercise?.metric ?? (firstSet === undefined ? 'reps' : metricOf(firstSet)),
    rows: perSession.reverse().flat(),
  };
}
```

Create `src/ui/components/more/exercises.vm.ts`:

```ts
import { liveBlocks, sortSessions } from '../../../model/derive';
import type { Exercise, Session } from '../../../model/types';
import { formatDayYear } from '../../format';

export interface ExerciseListRow { id: string; name: string; lastDate: string | undefined /* formatDayYear of the latest live block's session (the year only outside today's) */ }
export interface ExerciseGroup { family: string /* family or the name itself */; rows: ExerciseListRow[] }
export interface ExercisesVm { live: ExerciseGroup[]; archived: ExerciseGroup[] }

const byText = (a: string, b: string): number => a.localeCompare(b, 'en');

/** Exercise id → date of the latest live session with a live block of it. */
function lastDates(sessions: readonly Session[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const s of sortSessions(sessions)) {
    for (const b of liveBlocks(s)) last.set(b.exerciseId, s.date);
  }
  return last;
}

function group(entries: readonly Exercise[], last: ReadonlyMap<string, string>, today: string): ExerciseGroup[] {
  const groups = new Map<string, ExerciseListRow[]>();
  for (const e of entries) {
    const family = e.family ?? e.name;
    const date = last.get(e.id);
    const row: ExerciseListRow = { id: e.id, name: e.name, lastDate: date === undefined ? undefined : formatDayYear(date, today) };
    const rows = groups.get(family);
    if (rows === undefined) groups.set(family, [row]);
    else rows.push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([family, rows]) => ({ family, rows: rows.sort((a, b) => byText(a.name, b.name)) }));
}

/** Spec 4 §6: every exercise grouped by family, live first, archived apart; tombstoned entries omitted.
 *  `today` (local 'YYYY-MM-DD') adds the year to a last date in another year. */
export function exercisesVm(catalog: readonly Exercise[], sessions: readonly Session[], today: string): ExercisesVm {
  const present = catalog.filter((e) => e.deletedAt === undefined);
  const last = lastDates(sessions);
  return {
    live: group(present.filter((e) => !e.archived), last, today),
    archived: group(present.filter((e) => e.archived), last, today),
  };
}
```

Replace the whole content of `src/ui/format.ts` with:

```ts
/**
 * Display formatting for the UI (spec 4 §8 "Text"): English names fixed,
 * local calendar days and local times, durations as m:ss / h:mm:ss, and the
 * device locale for decimals only. Pure; no DOM.
 */
import type { AmountIndicator, LoadIndicator } from '../model/derive/compare';
import type { LoadType, SessionLabel } from '../model/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** U+2212 MINUS SIGN, used for assist loads. */
const MINUS = '−';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of `now` in the local zone. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Local midnight of a 'YYYY-MM-DD' day. */
export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function weekdayOf(date: string): string {
  return WEEKDAYS[parseLocalDate(date).getDay()] ?? '';
}

/** 'Thu 07 Mar' */
export function formatDay(date: string): string {
  const d = parseLocalDate(date);
  return `${weekdayOf(date)} ${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()] ?? ''}`;
}

/** formatDay, plus the year when `date` is not in the year of `today` ('Wed 07 Mar 2029'), so a
 *  list without year headings never shows an old date as a recent one. */
export function formatDayYear(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? formatDay(date) : `${formatDay(date)} ${date.slice(0, 4)}`;
}

/** 'Thu 2030-03-07' */
export function formatDayLong(date: string): string {
  return `${weekdayOf(date)} ${date}`;
}

/** 'March 2030' */
export function formatMonth(date: string): string {
  const d = parseLocalDate(date);
  return `${MONTHS_LONG[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** A session label as display text: 'push' → 'Push'. Shared by the Days list, the session page and its label select. */
export function formatLabel(label: SessionLabel): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Local 'HH:MM' (24 h) of an ISO instant. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 'm:ss' below an hour, 'h:mm:ss' from 3600 seconds; fractions dropped. */
export function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** '48 min' below an hour, '1 h 12 min' from an hour; whole minutes. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const amountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Up to two decimals in the device locale (display only; files store JSON numbers). */
export function formatAmount(n: number): string {
  return amountFormat.format(n);
}

/** 'bodyweight' | '+11.5 kg' | '−10 kg assist' | '35 kg' | 'band 50' */
export function formatLoad(loadType: LoadType, loadKg: number): string {
  switch (loadType) {
    case 'bodyweight':
      return 'bodyweight';
    case 'added':
      return `+${formatAmount(loadKg)} kg`;
    case 'assist':
      return `${MINUS}${formatAmount(loadKg)} kg assist`;
    case 'external':
      return `${formatAmount(loadKg)} kg`;
    case 'band':
      return `band ${formatAmount(loadKg)}`;
  }
}

/** 'bw' | '+11.5' | '−10' | '35 kg' | 'band 50' */
export function formatLoadShort(loadType: LoadType, loadKg: number): string {
  switch (loadType) {
    case 'bodyweight':
      return 'bw';
    case 'added':
      return `+${formatAmount(loadKg)}`;
    case 'assist':
      return `${MINUS}${formatAmount(loadKg)}`;
    case 'external':
      return `${formatAmount(loadKg)} kg`;
    case 'band':
      return `band ${formatAmount(loadKg)}`;
  }
}

/** The indicator glyph (spec 4 §8): ↑ ↓ = ≠ –, and nothing for hidden. */
export function glyph(ind: AmountIndicator | LoadIndicator): string {
  switch (ind) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'same':
      return '=';
    case 'incomparable':
      return '≠';
    case 'none':
      return '–';
    case 'hidden':
      return '';
  }
}

/** The screen-reader text for an indicator glyph. */
export function glyphLabel(ind: AmountIndicator | LoadIndicator): string {
  switch (ind) {
    case 'up':
      return 'more';
    case 'down':
      return 'less';
    case 'same':
      return 'same';
    case 'incomparable':
      return 'not comparable';
    case 'none':
      return 'no comparison';
    case 'hidden':
      return '';
  }
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .more-menu, .more-page (components/more) ---- */
.more-menu { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.more-menu__title { margin: 0 0 4px; font-size: 22px; }
.more-menu__item {
  min-height: 52px;
  padding: 12px 16px;
  border: 0;
  border-radius: 12px;
  background: var(--panel);
  text-align: left;
  font-size: 17px;
}
.more-page { display: flex; flex-direction: column; gap: 8px; }
.more-page__empty { color: var(--muted); }

/* ---- .xlist (more/ExercisesPage) ---- */
.xlist__group { margin-top: 8px; }
.xlist__family { margin: 0 0 4px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.xlist__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.xlist__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
}
.xlist__date { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.xlist__archived { margin-top: 12px; }
.xlist__archived > summary { min-height: 44px; padding: 10px 0; color: var(--muted); cursor: pointer; }

/* ---- .xhist (more/ExerciseHistoryPage) ---- */
.xhist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.xhist__status { margin: 0; color: var(--muted); }
.xhist__yeartitle { margin: 12px 0 4px; font-size: 13px; color: var(--muted); letter-spacing: 0.04em; }
/* A phone gets two lines: date, totals, marks and load, then the sets across the full width (a
   one-line row squeezed the sets to one number per line). From 560 px everything fits on one line. */
.xhist__row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content max-content;
  grid-template-areas:
    'day totals marks load'
    'sets sets sets sets';
  align-items: baseline;
  gap: 4px 10px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.xhist__day { grid-area: day; white-space: nowrap; }
.xhist__run { margin-left: 2px; color: var(--accent); font-size: 11px; }
.xhist__sets { grid-area: sets; overflow-wrap: anywhere; }
.xhist__sets.is-note { color: var(--muted); font-style: italic; }
.xhist__totals { grid-area: totals; justify-self: end; text-align: right; }
.xhist__marks { grid-area: marks; }
.xhist__load { grid-area: load; white-space: nowrap; }
.xhist__totals, .xhist__load { color: var(--muted); font-size: 14px; }
.xhist__note { grid-column: 1 / -1; color: var(--muted); font-size: 14px; font-style: italic; }
@media (min-width: 560px) {
  .xhist__row {
    grid-template-columns: max-content minmax(0, 1fr) max-content max-content max-content;
    grid-template-areas: 'day sets totals marks load';
  }
  .xhist__totals { justify-self: start; text-align: left; white-space: nowrap; }
  .xhist__note { grid-column: 2 / -1; }
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 79 test files and 1102 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/app.test.tsx src/ui/components/more/BodyweightPage.tsx src/ui/components/more/CalendarPage.tsx src/ui/components/more/CatalogPage.tsx src/ui/components/more/ExerciseEditPage.tsx src/ui/components/more/ExerciseHistoryPage.tsx src/ui/components/more/ExercisesPage.tsx src/ui/components/more/MoreTab.test.tsx src/ui/components/more/MoreTab.tsx src/ui/components/more/exercise-history.vm.test.ts src/ui/components/more/exercise-history.vm.ts src/ui/components/more/exercises.vm.test.ts src/ui/components/more/exercises.vm.ts src/ui/format.test.ts src/ui/format.ts src/ui/theme.css
git commit -m "Add the More menu, the exercise list and the exercise history" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Calendar

Month grids, newest first, Monday-first, dots by chip, hollow for uncertain dates, counts per month, the week streak, and lazy loading of earlier months (spec 4 §6 "Calendar").

**Files:**
- Create: `src/ui/components/more/CalendarPage.test.tsx`
- Modify: `src/ui/components/more/CalendarPage.tsx`
- Create: `src/ui/components/more/calendar.vm.test.ts`
- Create: `src/ui/components/more/calendar.vm.ts`
- Modify: `src/ui/theme.css`
- Modify: `src/ui/theme.test.ts`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/types`, `src/ui/components/shared`, `src/ui/context`, `src/ui/format`.
- Produces:
  - `src/ui/components/more/CalendarPage.tsx`:
    - `export const INITIAL_MONTHS = 4`
    - `export const MORE_MONTHS = 6`
    - `export function CalendarPage(): JSX.Element`
  - `src/ui/components/more/calendar.vm.ts`:
    - `export interface CalendarDay`
    - `export interface CalendarMonth`
    - `export interface CalendarVm`
    - `export function calendarSessionLine(session: Session, catalog: readonly Exercise[]): string`
    - `export function reuseMonths(prev: readonly CalendarMonth[], next: readonly CalendarMonth[]): CalendarMonth[]`
    - `export function calendarVm(sessions: readonly Session[], catalog: readonly Exercise[], today: string): CalendarVm`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/components/more/CalendarPage.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatDay } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { CalendarPage, INITIAL_MONTHS, MORE_MONTHS } from './CalendarPage';

// Wednesday; the week starts Monday 2030-03-11.
const NOW = new Date('2030-03-13T11:00:00.000Z');

const CATALOG = [
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }),
  exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
];

const on = (date: string, exerciseIds: string[], over: Partial<Session> = {}): Session =>
  session(exerciseIds.map((id, i) => block(ladder([5]), { exerciseId: id, order: i })), { date, ...over });

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/more/calendar' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

async function mount(sessions: Session[]) {
  const store = new Store(await openDb(new IDBFactory()));
  await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(CATALOG), NOW);
  for (const s of sessions) await store.writeFile('session', sessionPath(s.date, s.id), sessionFile(s), NOW);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow());
  const all: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={all}><CalendarPage /></AppContext.Provider>);
  return { data, router };
}

describe('CalendarPage', () => {
  /** The cells' accessible name carries the day, the count, the day types and the uncertain date. */
  const dayButton = (date: string, rest: string): HTMLElement => screen.getByRole('button', { name: `${formatDay(date)}, ${rest}` });
  const sessionsIn = (sheet: HTMLElement): HTMLElement[] => within(sheet).getAllByRole('button').filter((b) => b.textContent !== 'Cancel');

  it("shows the streak, months newest first with counts, and the day types and uncertain dates in each day's name", async () => {
    const a = on('2030-03-04', ['dips', 'pull-ups']);
    const b = on('2030-02-20', ['pull-ups'], { dateUncertain: true });
    await mount([a, b]);
    expect(screen.getByText('Streak: 1 week')).toBeTruthy();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['March 2030', 'February 2030']);
    for (const month of ['March 2030', 'February 2030']) {
      expect(within(screen.getByRole('region', { name: month })).getByText('1 session · 1 training day')).toBeTruthy();
    }
    expect(dayButton('2030-03-04', '1 session: push, pull')).toBeTruthy();
    expect(dayButton('2030-02-20', '1 session: pull; date uncertain')).toBeTruthy();
  });

  it('back goes to the More menu', async () => {
    const { router } = await mount([]);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.route.value).toEqual({ tab: 'more' });
  });

  it('a day with one session lists it in the sheet (spec 4 §6); tapping it opens its session page', async () => {
    const a = on('2030-03-04', ['dips']);
    const { router } = await mount([a]);
    fireEvent.click(dayButton('2030-03-04', '1 session: push'));
    expect(router.route.value).toEqual({ tab: 'more', page: 'calendar' });
    const items = sessionsIn(screen.getByRole('dialog', { name: formatDay('2030-03-04') }));
    expect(items).toHaveLength(1);
    fireEvent.click(items[0] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: a.id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the open session opens the Log tab', async () => {
    const open = on('2030-03-13', ['dips'], { startedAt: '2030-03-13T10:30:00.000Z' });
    const { router, data } = await mount([open]);
    expect(data.openSession.value?.file.session.id).toBe(open.id);
    fireEvent.click(dayButton('2030-03-13', '1 session: push'));
    fireEvent.click(sessionsIn(screen.getByRole('dialog', { name: formatDay('2030-03-13') }))[0] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'log' });
  });

  it('a day with several sessions lists them in a sheet; tapping one opens it', async () => {
    // Distinct first id segments: the session path carries the first eight characters of the id.
    const a = on('2030-03-04', ['dips'], { id: 'a1b2c3d4-0000-4000-8000-000000000001', startedAt: '2030-03-04T08:00:00.000Z' });
    const b = on('2030-03-04', ['pull-ups'], { id: 'b1b2c3d4-0000-4000-8000-000000000002', startedAt: '2030-03-04T18:00:00.000Z' });
    const { router } = await mount([a, b]);
    fireEvent.click(dayButton('2030-03-04', '2 sessions: push, pull'));
    const items = sessionsIn(screen.getByRole('dialog', { name: formatDay('2030-03-04') }));
    expect(items.map((el) => el.textContent)).toEqual([expect.stringMatching(/^push · /), expect.stringMatching(/^pull · /)]);
    fireEvent.click(items[1] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: b.id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('lazy months (spec 4 §6)', () => {
    afterEach(() => vi.unstubAllGlobals());

    // One session a month from March 2030 back to April 2029: 12 months.
    const yearOfSessions = (): Session[] =>
      Array.from({ length: 12 }, (_, i) => {
        const month = new Date(Date.UTC(2030, 2 - i, 4));
        return on(month.toISOString().slice(0, 10), ['dips']);
      });
    const monthTitles = (): (string | null)[] => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

    it('mounts the newest months first and the earlier ones on demand, until the first session', async () => {
      expect(INITIAL_MONTHS).toBeLessThan(12);
      await mount(yearOfSessions());
      expect(monthTitles()).toHaveLength(INITIAL_MONTHS);
      expect(monthTitles()[0]).toBe('March 2030');
      fireEvent.click(screen.getByRole('button', { name: 'Show earlier months' }));
      expect(monthTitles()).toHaveLength(Math.min(12, INITIAL_MONTHS + MORE_MONTHS));
      while (screen.queryByRole('button', { name: 'Show earlier months' }) !== null) {
        fireEvent.click(screen.getByRole('button', { name: 'Show earlier months' }));
      }
      expect(monthTitles()).toHaveLength(12);
      expect(monthTitles()[11]).toBe('April 2029');
    });

    it('mounts the next months by itself when the end of the list scrolls into view', async () => {
      let fire: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
      const observed: Element[] = [];
      class FakeObserver {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { fire = cb; }
        observe(el: Element): void { observed.push(el); }
        disconnect(): void {}
      }
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      await mount(yearOfSessions());
      expect(observed.map((el) => el.textContent)).toContain('Show earlier months');
      await act(() => fire?.([{ isIntersecting: false }]));
      expect(monthTitles()).toHaveLength(INITIAL_MONTHS);
      await act(() => fire?.([{ isIntersecting: true }]));
      expect(monthTitles()).toHaveLength(Math.min(12, INITIAL_MONTHS + MORE_MONTHS));
    });

    it('a new session keeps the months shown so far', async () => {
      const { data } = await mount(yearOfSessions());
      fireEvent.click(screen.getByRole('button', { name: 'Show earlier months' }));
      const shown = monthTitles().length;
      const extra = on('2030-03-12', ['pull-ups']);
      await act(async () => {
        await data.create('session', sessionPath(extra.date, extra.id), sessionFile(extra));
        await data.refresh(sessionPath(extra.date, extra.id));
      });
      await waitFor(() => expect(dayButton('2030-03-12', '1 session: pull')).toBeTruthy());
      expect(monthTitles()).toHaveLength(shown);
    });
  });

  it('days without sessions are not buttons', async () => {
    await mount([on('2030-03-04', ['dips'])]);
    expect(screen.queryByRole('button', { name: new RegExp(formatDay('2030-03-05')) })).toBeNull();
  });
});
```

Create `src/ui/components/more/calendar.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatTime } from '../../format';
import { calendarSessionLine, calendarVm, reuseMonths, type CalendarDay, type CalendarMonth } from './calendar.vm';

const CATALOG = [
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }),
  exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs' }),
  exercise({ id: 'l-sit', name: 'L-sit', pattern: 'core', metric: 'seconds' }),
];

const on = (date: string, exerciseIds: string[], over: Partial<Session> = {}): Session =>
  session(exerciseIds.map((id, i) => block(ladder([5]), { exerciseId: id, order: i })), { date, ...over });

function month(vm: { months: CalendarMonth[] }, key: string): CalendarMonth {
  const m = vm.months.find((x) => x.key === key);
  if (m === undefined) throw new Error(`no month ${key}`);
  return m;
}

function day(m: CalendarMonth, date: string): CalendarDay {
  const d = m.weeks.flat().find((x) => x.date === date && x.inMonth);
  if (d === undefined) throw new Error(`no day ${date}`);
  return d;
}

describe('calendarVm grid', () => {
  it('builds Monday-first weeks of seven with leading and trailing days outside the month', () => {
    // March 2030: the 1st is a Friday, the 31st a Sunday.
    const vm = calendarVm([], CATALOG, '2030-03-15');
    const m = month(vm, '2030-03');
    expect(m.title).toBe('March 2030');
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
    expect(m.weeks).toHaveLength(5);
    const first = m.weeks[0] ?? [];
    expect(first.map((d) => d.date)).toEqual(['2030-02-25', '2030-02-26', '2030-02-27', '2030-02-28', '2030-03-01', '2030-03-02', '2030-03-03']);
    expect(first.map((d) => d.inMonth)).toEqual([false, false, false, false, true, true, true]);
    const last = m.weeks[4] ?? [];
    expect(last[6]).toMatchObject({ date: '2030-03-31', inMonth: true });
  });

  it('adds trailing days after the last of the month up to Sunday', () => {
    // April 2030: the 30th is a Tuesday.
    const vm = calendarVm([], CATALOG, '2030-04-10');
    const m = month(vm, '2030-04');
    const last = m.weeks[m.weeks.length - 1] ?? [];
    expect(last.map((d) => d.date)).toEqual(['2030-04-29', '2030-04-30', '2030-05-01', '2030-05-02', '2030-05-03', '2030-05-04', '2030-05-05']);
    expect(last.map((d) => d.inMonth)).toEqual([true, true, false, false, false, false, false]);
  });

  it('days outside the month carry no dots or sessions', () => {
    const s = on('2030-03-01', ['dips']);
    const vm = calendarVm([s, on('2030-02-10', ['dips'])], CATALOG, '2030-03-15');
    const feb = month(vm, '2030-02');
    const trailing = feb.weeks.flat().find((d) => d.date === '2030-03-01');
    expect(trailing).toMatchObject({ inMonth: false, dots: [], sessionIds: [], hollow: false });
    expect(day(month(vm, '2030-03'), '2030-03-01').sessionIds).toEqual([s.id]);
  });
});

describe('calendarVm dots', () => {
  it('colours a day by the chips of its sessions in the fixed order push pull legs other', () => {
    const a = on('2030-03-04', ['squats', 'pull-ups'], { startedAt: '2030-03-04T08:00:00.000Z' });
    const b = on('2030-03-04', ['dips'], { startedAt: '2030-03-04T18:00:00.000Z' });
    const vm = calendarVm([b, a], CATALOG, '2030-03-15');
    const d = day(month(vm, '2030-03'), '2030-03-04');
    expect(d.dots).toEqual(['push', 'pull', 'legs']);
    expect(d.sessionIds).toEqual([a.id, b.id]);
    expect(d.hollow).toBe(false);
  });

  it('shows at most three dots', () => {
    const s = on('2030-03-04', ['l-sit', 'squats', 'pull-ups', 'dips']);
    const d = day(month(calendarVm([s], CATALOG, '2030-03-15'), '2030-03'), '2030-03-04');
    expect(d.dots).toEqual(['push', 'pull', 'legs']);
  });

  it('counts an unknown exercise as other and gives a session without blocks no dot', () => {
    const s1 = on('2030-03-05', ['nope']);
    const s2 = on('2030-03-06', []);
    const m = month(calendarVm([s1, s2], CATALOG, '2030-03-15'), '2030-03');
    expect(day(m, '2030-03-05').dots).toEqual(['other']);
    expect(day(m, '2030-03-06')).toMatchObject({ dots: [], sessionIds: [s2.id] });
  });

  it('is hollow only when every session of the day has an uncertain date', () => {
    const u1 = on('2030-03-04', ['dips'], { dateUncertain: true });
    const u2 = on('2030-03-04', ['pull-ups'], { dateUncertain: true });
    const u3 = on('2030-03-05', ['dips'], { dateUncertain: true });
    const c3 = on('2030-03-05', ['dips']);
    const m = month(calendarVm([u1, u2, u3, c3], CATALOG, '2030-03-15'), '2030-03');
    expect(day(m, '2030-03-04').hollow).toBe(true);
    expect(day(m, '2030-03-05').hollow).toBe(false);
    expect(day(m, '2030-03-06').hollow).toBe(false);
  });

  it('ignores tombstoned sessions and blocks', () => {
    const gone = on('2030-03-04', ['dips'], { deletedAt: '2030-03-04T12:00:00.000Z' });
    const s = session(
      [
        block(ladder([5]), { exerciseId: 'dips', deletedAt: '2030-03-05T12:00:00.000Z' }),
        block(ladder([5]), { exerciseId: 'pull-ups', order: 1 }),
      ],
      { date: '2030-03-05' },
    );
    const vm = calendarVm([gone, s], CATALOG, '2030-03-15');
    const m = month(vm, '2030-03');
    expect(day(m, '2030-03-04')).toMatchObject({ dots: [], sessionIds: [] });
    expect(day(m, '2030-03-05').dots).toEqual(['pull']);
    expect(m.sessions).toBe(1);
  });
});

describe('calendarVm months', () => {
  it('lists months newest first from the current month back to the first live session', () => {
    const vm = calendarVm([on('2029-11-20', ['dips']), on('2030-01-02', ['dips'])], CATALOG, '2030-03-15');
    expect(vm.months.map((m) => m.key)).toEqual(['2030-03', '2030-02', '2030-01', '2029-12', '2029-11']);
    expect(vm.months.map((m) => m.title)).toEqual(['March 2030', 'February 2030', 'January 2030', 'December 2029', 'November 2029']);
  });

  it('shows the current month alone without sessions, and a tombstone does not extend the range', () => {
    expect(calendarVm([], CATALOG, '2030-03-15').months.map((m) => m.key)).toEqual(['2030-03']);
    const gone = on('2029-06-01', ['dips'], { deletedAt: '2029-06-01T12:00:00.000Z' });
    expect(calendarVm([gone], CATALOG, '2030-03-15').months.map((m) => m.key)).toEqual(['2030-03']);
  });

  it('starts at a later month when a session is dated after today', () => {
    const vm = calendarVm([on('2030-04-02', ['dips'])], CATALOG, '2030-03-15');
    expect(vm.months.map((m) => m.key)).toEqual(['2030-04', '2030-03']);
  });

  it('counts sessions and training days per month', () => {
    const vm = calendarVm(
      [on('2030-03-04', ['dips']), on('2030-03-04', ['pull-ups']), on('2030-03-09', ['dips']), on('2030-02-28', ['dips'])],
      CATALOG,
      '2030-03-15',
    );
    expect(month(vm, '2030-03')).toMatchObject({ sessions: 3, trainingDays: 2 });
    expect(month(vm, '2030-02')).toMatchObject({ sessions: 1, trainingDays: 1 });
  });
});

describe('reuseMonths (the page re-renders only the months whose grid changed)', () => {
  const before = [on('2030-01-10', ['dips']), on('2030-03-04', ['dips'])];

  it('keeps the previous object of every month whose content is the same', () => {
    const prev = calendarVm(before, CATALOG, '2030-03-15').months;
    const next = calendarVm([...before, on('2030-03-05', ['pull-ups'])], CATALOG, '2030-03-15').months;
    const out = reuseMonths(prev, next);
    expect(out.map((m) => m.key)).toEqual(['2030-03', '2030-02', '2030-01']);
    expect(out[0]).toBe(next[0]);
    expect(out[0]).not.toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
    expect(out[2]).toBe(prev[2]);
  });

  it('a change of a session id, a dot, the hollow mark or a count is a change', () => {
    const prev = calendarVm(before, CATALOG, '2030-03-15').months;
    const swapped = [on('2030-01-10', ['dips']), on('2030-03-04', ['dips'], { id: 'c0c0c0c0-0000-4000-8000-000000000001' })];
    expect(reuseMonths(prev, calendarVm(swapped, CATALOG, '2030-03-15').months)[0]).not.toBe(prev[0]);
    const pulled = [on('2030-01-10', ['dips']), { ...before[1] as Session, blocks: [block(ladder([5]), { exerciseId: 'pull-ups' })] }];
    expect(reuseMonths(prev, calendarVm(pulled, CATALOG, '2030-03-15').months)[0]).not.toBe(prev[0]);
    const uncertain = [on('2030-01-10', ['dips']), { ...before[1] as Session, dateUncertain: true as const }];
    expect(reuseMonths(prev, calendarVm(uncertain, CATALOG, '2030-03-15').months)[0]).not.toBe(prev[0]);
  });

  it('a new month is the new object; without a previous list everything is new', () => {
    const prev = calendarVm(before, CATALOG, '2030-03-15').months;
    const next = calendarVm(before, CATALOG, '2030-04-01').months;
    const out = reuseMonths(prev, next);
    expect(out[0]).toBe(next[0]);
    expect(out[1]).toBe(prev[0]);
    expect(reuseMonths([], next)).toEqual(next);
  });
});

describe('calendarSessionLine', () => {
  it('names the session by its label, else its day type, with the start time and an uncertain date', () => {
    const started = '2030-03-04T08:05:00.000Z';
    expect(calendarSessionLine(on('2030-03-04', ['dips', 'dips', 'pull-ups'], { label: 'mixed' }), CATALOG)).toBe('mixed');
    expect(calendarSessionLine(on('2030-03-04', ['dips', 'dips', 'pull-ups'], { startedAt: started }), CATALOG)).toBe(`push · ${formatTime(started)}`);
    expect(calendarSessionLine(on('2030-03-04', [], { dateUncertain: true }), CATALOG)).toBe('no exercises · date uncertain');
  });
});

describe('calendarVm streak', () => {
  // 2030-03-11 is a Monday; today Wednesday 2030-03-13.
  const TODAY = '2030-03-13';

  it('is 0 without sessions', () => {
    expect(calendarVm([], CATALOG, TODAY).streakWeeks).toBe(0);
  });

  it('counts consecutive weeks ending with the current week', () => {
    const vm = calendarVm([on('2030-03-11', ['dips']), on('2030-03-10', ['dips']), on('2030-02-25', ['dips'])], CATALOG, TODAY);
    expect(vm.streakWeeks).toBe(3);
  });

  it('starts from last week when the current week has no session yet', () => {
    const vm = calendarVm([on('2030-03-10', ['dips']), on('2030-03-04', ['dips']), on('2030-02-26', ['dips']), on('2030-02-19', ['dips'])], CATALOG, TODAY);
    expect(vm.streakWeeks).toBe(3);
  });

  it('a week without a session ends it', () => {
    const vm = calendarVm([on('2030-03-12', ['dips']), on('2030-03-05', ['dips']), on('2030-02-20', ['dips'])], CATALOG, TODAY);
    expect(vm.streakWeeks).toBe(2);
  });

  it('is 0 when neither this week nor last week has a session', () => {
    expect(calendarVm([on('2030-03-01', ['dips'])], CATALOG, TODAY).streakWeeks).toBe(0);
  });

  it('crosses a year boundary inside one ISO week (2030-12-30 … 2031-01-05)', () => {
    const vm = calendarVm([on('2031-01-05', ['dips']), on('2030-12-31', ['dips']), on('2030-12-25', ['dips'])], CATALOG, '2031-01-08');
    expect(vm.streakWeeks).toBe(2);
    const vm2 = calendarVm([on('2031-01-02', ['dips']), on('2030-12-24', ['dips'])], CATALOG, '2031-01-04');
    expect(vm2.streakWeeks).toBe(2);
  });

  it('ignores tombstoned sessions and sessions after today', () => {
    const gone = on('2030-03-12', ['dips'], { deletedAt: '2030-03-12T12:00:00.000Z' });
    expect(calendarVm([gone], CATALOG, TODAY).streakWeeks).toBe(0);
    expect(calendarVm([on('2030-03-20', ['dips'])], CATALOG, TODAY).streakWeeks).toBe(0);
  });
});
```

Replace the whole content of `src/ui/theme.test.ts` with:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Spec 4 §8 (U11): every colour is a token in theme.css; components never contain a literal colour. */
const UI_DIR = join(import.meta.dirname, '.');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?:^|[^-\w])(?:color|background(?:-color)?)\s*:\s*(?!var\(|transparent|inherit|currentColor|none)[a-z]+/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('theme tokens', () => {
  it('no literal colour outside theme.css', () => {
    const offenders = walk(UI_DIR)
      .filter((f) => !f.endsWith('theme.css') && !f.endsWith('theme.test.ts') && /\.(tsx?|css)$/.test(f))
      .filter((f) => LITERAL.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('theme.css defines every token of spec 4 §8', () => {
    const css = readFileSync(join(UI_DIR, 'theme.css'), 'utf8');
    for (const token of ['--bg', '--panel', '--panel-2', '--text', '--muted', '--accent', '--ok', '--danger', '--outline', '--on-accent', '--chip-push', '--chip-pull', '--chip-legs', '--chip-other']) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/more/CalendarPage.test.tsx src/ui/components/more/calendar.vm.test.ts src/ui/theme.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/more/calendar.vm.test.ts: Error: Cannot find module './calendar.vm' imported from src/ui/components/more/calendar.vm.test.ts
```


- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/ui/components/more/CalendarPage.tsx` with:

```tsx
import { useComputed, useSignal } from '@preact/signals';
import { Component, type JSX } from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useApp } from '../../context';
import { formatDay, localDate } from '../../format';
import { BackBar, Sheet } from '../shared';
import { calendarSessionLine, calendarVm, reuseMonths, type CalendarDay, type CalendarMonth } from './calendar.vm';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Months mounted on first render (a phone screen shows about one and a half). */
export const INITIAL_MONTHS = 4;
/** Months mounted each time the end of the list comes near or "Show earlier months" is tapped. */
export const MORE_MONTHS = 6;
/** How far below the screen the end of the list starts mounting the next months. */
const AHEAD = '600px 0px';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The in-month cell of `date` in the grids. */
function dayOf(months: readonly CalendarMonth[], date: string): CalendarDay | undefined {
  for (const m of months) for (const week of m.weeks) for (const d of week) if (d.inMonth && d.date === date) return d;
  return undefined;
}

/** What a day cell says to assistive tech: the dots and the hollow mark are only drawn. */
function dayLabel(d: CalendarDay): string {
  const types = d.dots.length > 0 ? `: ${d.dots.join(', ')}` : '';
  return `${formatDay(d.date)}, ${plural(d.sessionIds.length, 'session')}${types}${d.hollow ? '; date uncertain' : ''}`;
}

/**
 * Spec 4 §6 "Calendar": month grids newest first, dots by chip, the streak. Tapping a day lists its
 * sessions in a sheet; tapping one opens the session page (or the Log tab if it is open).
 *
 * Lazy months (spec 4 §6): only the newest INITIAL_MONTHS are mounted at first; the next
 * MORE_MONTHS mount when the end of the list comes within AHEAD of the screen (or on the "Show
 * earlier months" button, which is also the fallback without IntersectionObserver), so three years
 * of history never mount 1,500 cells at once. Months keep their vm object while their content is
 * the same (`reuseMonths`) and are components that compare by identity, with a stable tap handler,
 * so a session change re-renders only the months it touched and the sheet re-renders no grid.
 */
export function CalendarPage(): JSX.Element {
  const { data, router } = useApp();
  const today = useComputed(() => localDate(data.now.value));
  const previous = useRef<CalendarMonth[]>([]);
  const vm = useComputed(() => {
    const next = calendarVm(data.liveSessions.value, data.exercises.value, today.value);
    const months = reuseMonths(previous.current, next.months);
    previous.current = months;
    return { ...next, months };
  });
  const shown = useSignal(INITIAL_MONTHS);
  const sheetDate = useSignal<string | undefined>(undefined);
  const showMore = useCallback((): void => {
    shown.value += MORE_MONTHS;
  }, [shown]);

  const openSession = (sessionId: string): void => {
    sheetDate.value = undefined;
    if (data.openSession.value?.file.session.id === sessionId) router.navigate({ tab: 'log' });
    else router.navigate({ tab: 'days', sessionId });
  };

  // Only cells with sessions are buttons; `sheetDate` is a stable signal, so this never changes.
  const tapDay = useCallback((day: CalendarDay): void => {
    sheetDate.value = day.date;
  }, [sheetDate]);

  const sheetDay = sheetDate.value;
  // The tapped day's sessions are the vm's `sessionIds` for that day (one source for the grid and the sheet).
  const sheetIds = sheetDay === undefined ? [] : (dayOf(vm.value.months, sheetDay)?.sessionIds ?? []);
  const sheetSessions = sheetIds.flatMap((id) => data.liveSessions.value.filter((s) => s.id === id));

  return (
    <section class="cal">
      <BackBar title="Calendar" onBack={() => router.navigate({ tab: 'more' })} />
      <p class="cal__streak">Streak: {plural(vm.value.streakWeeks, 'week')}</p>
      {vm.value.months.slice(0, shown.value).map((m) => (
        <Month key={m.key} month={m} today={today.value} onTap={tapDay} />
      ))}
      {shown.value < vm.value.months.length && <MoreMonths onMore={showMore} />}
      {sheetDay !== undefined && (
        <Sheet title={formatDay(sheetDay)} onClose={() => { sheetDate.value = undefined; }}>
          {sheetSessions.map((s) => (
            <button key={s.id} type="button" class="cal__session" onClick={() => openSession(s.id)}>
              {calendarSessionLine(s, data.exercises.value)}
            </button>
          ))}
        </Sheet>
      )}
    </section>
  );
}

/** The end of the list: a button, and with IntersectionObserver it presses itself when it comes near. */
function MoreMonths(p: { onMore(): void }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const { onMore } = p;
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore();
    }, { rootMargin: AHEAD });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onMore]);
  return (
    <button ref={ref} type="button" class="cal__more" onClick={onMore}>
      Show earlier months
    </button>
  );
}

interface MonthProps { month: CalendarMonth; today: string; onTap(day: CalendarDay): void }

/**
 * One month, re-rendered only when its vm object, today or the tap handler change (they stay the
 * same while the data does). A class with shouldComponentUpdate, not `memo`: `preact/compat` would
 * install its global vnode hook, which changes how `onChange` behaves on every select in the app.
 */
class Month extends Component<MonthProps> {
  override shouldComponentUpdate(next: MonthProps): boolean {
    return next.month !== this.props.month || next.today !== this.props.today || next.onTap !== this.props.onTap;
  }

  override render(): JSX.Element {
    const p = this.props;
    const m = p.month;
    return (
      <section class="cal__month" aria-label={m.title}>
        <h2 class="cal__title">{m.title}</h2>
        <p class="cal__counts">{`${plural(m.sessions, 'session')} · ${plural(m.trainingDays, 'training day')}`}</p>
        <div class="cal__grid">
          {WEEKDAYS.map((w) => (
            <span key={w} class="cal__weekday" aria-hidden="true">{w}</span>
          ))}
          {m.weeks.flat().map((d) => (
            <Day key={d.date} day={d} today={p.today} onTap={p.onTap} />
          ))}
        </div>
      </section>
    );
  }
}

function Day(p: { day: CalendarDay; today: string; onTap(day: CalendarDay): void }): JSX.Element {
  const d = p.day;
  const cls = `cal__day${d.inMonth ? '' : ' cal__day--out'}${d.date === p.today ? ' cal__day--today' : ''}`;
  const inner = (
    <>
      <span class="cal__num" aria-hidden={d.sessionIds.length > 0 ? 'true' : undefined}>{Number(d.date.slice(8))}</span>
      <span class="cal__dots" aria-hidden="true">
        {d.dots.map((c) => (
          <span key={c} class={`cal__dot cal__dot--${c}${d.hollow ? ' cal__dot--hollow' : ''}`} />
        ))}
      </span>
    </>
  );
  if (d.sessionIds.length === 0) return <div class={cls} aria-hidden={d.inMonth ? undefined : 'true'}>{inner}</div>;
  return (
    <button type="button" class={cls} aria-label={dayLabel(d)} onClick={() => p.onTap(d)}>
      {inner}
    </button>
  );
}
```

Create `src/ui/components/more/calendar.vm.ts`:

```ts
/**
 * Spec 4 §6 "Calendar": month grids newest first, day dots by chip, per-month counts and the
 * streak of calendar weeks. Pure: dates are 'YYYY-MM-DD' strings and all arithmetic is on UTC
 * calendar days, so the local zone and DST never shift a day.
 */
import { dayType, sessionChips, sortSessions, type Chip } from '../../../model/derive';
import type { Exercise, Session } from '../../../model/types';
import { formatMonth, formatTime } from '../../format';

export interface CalendarDay {
  date: string;
  inMonth: boolean;
  /** At most 3, order push pull legs other. */
  dots: Chip[];
  hollow: boolean;
  sessionIds: string[];
}

export interface CalendarMonth {
  /** 'YYYY-MM' */
  key: string;
  /** formatMonth */
  title: string;
  /** Monday-first rows of 7. */
  weeks: CalendarDay[][];
  sessions: number;
  trainingDays: number;
}

export interface CalendarVm {
  streakWeeks: number;
  /** Newest first, from the current month back to the month of the first live session. */
  months: CalendarMonth[];
}

const CHIP_ORDER: readonly Chip[] = ['push', 'pull', 'legs', 'other'];
const MAX_DOTS = 3;
const DAY_MS = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, '0');

function toUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
}

function fromUtc(d: Date): string {
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(date: string, n: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + n * DAY_MS));
}

/** The Monday of the ISO week (Monday to Sunday) holding `date`. */
function mondayOf(date: string): string {
  const weekday = toUtc(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function previousMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const year = y ?? 0;
  const month = m ?? 1;
  return month === 1 ? `${String(year - 1).padStart(4, '0')}-12` : `${String(year).padStart(4, '0')}-${pad2(month - 1)}`;
}

function lastDayOf(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return fromUtc(new Date(Date.UTC(y ?? 0, m ?? 1, 0)));
}

function buildDay(date: string, inMonth: boolean, sessions: readonly Session[], catalog: readonly Exercise[]): CalendarDay {
  if (!inMonth || sessions.length === 0) return { date, inMonth, dots: [], hollow: false, sessionIds: [] };
  const chips = new Set<Chip>();
  for (const s of sessions) for (const c of sessionChips(s, catalog)) chips.add(c);
  return {
    date,
    inMonth,
    dots: CHIP_ORDER.filter((c) => chips.has(c)).slice(0, MAX_DOTS),
    hollow: sessions.every((s) => s.dateUncertain === true),
    sessionIds: sessions.map((s) => s.id),
  };
}

function buildMonth(key: string, byDate: ReadonlyMap<string, Session[]>, catalog: readonly Exercise[]): CalendarMonth {
  const first = `${key}-01`;
  const last = lastDayOf(key);
  const weeks: CalendarDay[][] = [];
  let sessions = 0;
  let trainingDays = 0;
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      const inMonth = monthKey(date) === key;
      const onDay = inMonth ? (byDate.get(date) ?? []) : [];
      if (onDay.length > 0) {
        sessions += onDay.length;
        trainingDays += 1;
      }
      week.push(buildDay(date, inMonth, onDay, catalog));
    }
    weeks.push(week);
  }
  return { key, title: formatMonth(first), weeks, sessions, trainingDays };
}

/** Consecutive weeks with a live session, ending with the current week, or with last week when the current week is still empty. */
function streak(live: readonly Session[], today: string): number {
  const weeks = new Set(live.filter((s) => s.date <= today).map((s) => mondayOf(s.date)));
  let monday = mondayOf(today);
  if (!weeks.has(monday)) monday = addDays(monday, -7);
  let n = 0;
  while (weeks.has(monday)) {
    n += 1;
    monday = addDays(monday, -7);
  }
  return n;
}

/** One line of the day sheet: the label (else the day type), the start time, and the uncertain-date mark. */
export function calendarSessionLine(session: Session, catalog: readonly Exercise[]): string {
  const parts = [session.label ?? dayType(session, catalog) ?? 'no exercises'];
  if (session.startedAt !== undefined) parts.push(formatTime(session.startedAt));
  if (session.dateUncertain === true) parts.push('date uncertain');
  return parts.join(' · ');
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameDay(a: CalendarDay, b: CalendarDay): boolean {
  return a.date === b.date && a.inMonth === b.inMonth && a.hollow === b.hollow && sameList(a.dots, b.dots) && sameList(a.sessionIds, b.sessionIds);
}

function sameMonth(a: CalendarMonth, b: CalendarMonth): boolean {
  if (a.key !== b.key || a.title !== b.title || a.sessions !== b.sessions || a.trainingDays !== b.trainingDays) return false;
  if (a.weeks.length !== b.weeks.length) return false;
  return a.weeks.every((week, w) => {
    const other = b.weeks[w];
    return other !== undefined && week.length === other.length && week.every((d, i) => {
      const o = other[i];
      return o !== undefined && sameDay(d, o);
    });
  });
}

/**
 * `next` with every month whose content equals the one in `prev` (same key) replaced by the `prev`
 * object, so the page's month components, which compare by identity, skip the months a session
 * change did not touch (a pull of one session re-renders one month, not the whole history).
 * Comparing 42 cells is far cheaper than
 * re-diffing a grid.
 */
export function reuseMonths(prev: readonly CalendarMonth[], next: readonly CalendarMonth[]): CalendarMonth[] {
  const byKey = new Map(prev.map((m) => [m.key, m]));
  return next.map((m) => {
    const old = byKey.get(m.key);
    return old !== undefined && sameMonth(old, m) ? old : m;
  });
}

export function calendarVm(sessions: readonly Session[], catalog: readonly Exercise[], today: string): CalendarVm {
  const live = sortSessions(sessions);
  const byDate = new Map<string, Session[]>();
  for (const s of live) {
    const list = byDate.get(s.date);
    if (list === undefined) byDate.set(s.date, [s]);
    else list.push(s);
  }

  // A session dated after today still gets its month, so nothing is hidden.
  const dates = live.map((s) => s.date);
  const newest = [monthKey(today), ...dates.map(monthKey)].reduce((a, b) => (b > a ? b : a));
  const oldest = [monthKey(today), ...dates.map(monthKey)].reduce((a, b) => (b < a ? b : a));

  const months: CalendarMonth[] = [];
  for (let key = newest; key >= oldest; key = previousMonth(key)) months.push(buildMonth(key, byDate, catalog));

  return { streakWeeks: streak(live, today), months };
}
```

Replace the whole content of `src/ui/theme.css` with:

```css
/* Spec 4 §8: the one token block. A re-theme edits this block only; components reference tokens. */
:root {
  color-scheme: dark;
  --bg: #111827;
  --panel: #1f2937;
  --panel-2: #273449;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --accent: #f59e0b;
  --ok: #34d399;
  --danger: #f87171;
  --outline: #374151;
  --on-accent: #111111;
  /* Calendar dots by chip (spec 4 §6); legs gets its own colour so it never reads as an error. */
  --chip-push: var(--accent);
  --chip-pull: var(--ok);
  --chip-legs: #60a5fa;
  --chip-other: var(--muted);
}

/* ---- base ---- */
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
  overscroll-behavior: none;
}
/* The status bar is translucent (black-translucent): this strip covers its area, so scrolled
   content (the Log cards) never shows under the clock and battery. Above the bars, below sheets. */
body::before {
  content: '';
  position: fixed;
  top: 0;
  inset-inline: 0;
  z-index: 15;
  height: env(safe-area-inset-top, 0px);
  background: var(--bg);
  pointer-events: none;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { touch-action: manipulation; cursor: pointer; }
input, select, textarea { font-size: 16px; } /* iOS: no zoom on focus below 16 px */
/* Read by screen readers, not shown. */
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ---- .btn (shared/Button) ---- */
.btn {
  min-height: 44px;
  min-width: 44px;
  padding: 0 16px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-weight: 600;
}
.btn:disabled { opacity: 0.45; cursor: default; }
.btn--primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn--secondary { background: var(--panel-2); }
.btn--danger { background: transparent; border-color: var(--danger); color: var(--danger); }

/* ---- .sheet (shared/Sheet) ---- */
.sheet__backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
}
.sheet {
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0;
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 -8px 24px color-mix(in srgb, var(--bg) 60%, transparent);
  outline: none;
  /* Spec 4 §8: sheets slide up from the bottom. */
  animation: sheet-up 180ms ease-out;
}
@keyframes sheet-up {
  from { transform: translateY(100%); }
  to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sheet { animation: none; }
}
/* The title bar is the swipe-down handle (Sheet.tsx): it stays at the top of a long sheet, and the
   browser does not start a scroll from it, so the touch ends on it. */
.sheet__head {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: -12px -16px 0;
  padding: 8px 16px 0;
  background: var(--panel);
  touch-action: none;
}
.sheet__head::before {
  content: '';
  display: block;
  width: 36px;
  height: 4px;
  margin: 0 auto 4px;
  border-radius: 2px;
  background: var(--outline);
}
.sheet__title { margin: 4px 0 12px; font-size: 18px; }
.sheet__body { display: flex; flex-direction: column; gap: 12px; }
.sheet__foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

/* ---- .stepper (shared/Stepper) ---- */
.stepper { display: flex; align-items: center; gap: 8px; }
.stepper__btn {
  width: 56px;
  height: 56px;
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 28px;
  line-height: 1;
}
.stepper__value {
  flex: 1;
  min-width: 88px;
  height: 56px;
  border: 1px dashed var(--accent);
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}

/* ---- .numpad (shared/NumberPad) ---- */
.numpad { display: flex; flex-direction: column; gap: 12px; }
.numpad__display {
  width: 100%;
  height: 52px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font-size: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* The current value, shown until the first key starts a fresh number. */
.numpad__display::placeholder { color: var(--muted); opacity: 1; }
.numpad__keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.numpad__key {
  height: 52px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 22px;
}
.numpad__actions { display: flex; justify-content: flex-end; gap: 8px; }

/* ---- .setchips (shared/SetChips) ---- */
.setchips { display: flex; flex-wrap: wrap; gap: 6px; }
.setchips__chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--outline);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.setchips--today .setchips__chip { min-height: 44px; } /* spec 4 §8 touch targets */
.setchips--reference .setchips__chip { background: transparent; color: var(--muted); }
.setchips__chip.is-last { border-color: var(--ok); }
.setchips__chip.is-marked { border-color: var(--accent); color: var(--text); }
.setchips__chip.is-proposed { border-style: dashed; border-color: var(--accent); background: transparent; color: var(--accent); }

/* ---- .marks (shared/Marks) ---- */
.marks { display: inline-flex; gap: 2px; font-variant-numeric: tabular-nums; }
.marks__glyph { min-width: 1em; text-align: center; }
.marks.is-provisional { opacity: 0.5; }

/* ---- .toast (shared/ToastHost) ---- */
.toast {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px 8px 16px;
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--panel-2);
  color: var(--text);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 60%, transparent);
}
.toast__action {
  min-height: 44px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-weight: 600;
}

/* ---- .backbar (shared/BackBar) ---- */
/* .app__main already starts below the top inset, so the bar adds none of its own (two insets put the
   session page about 2 × 47 px down on a notched iPhone); it sticks just below the status-bar strip. */
.backbar {
  position: sticky;
  top: env(safe-area-inset-top, 0px);
  z-index: 10;
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 8px;
  background: var(--panel);
  border-bottom: 1px solid var(--outline);
}
.backbar__back {
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 28px;
  line-height: 1;
}
.backbar__title { margin: 0; font-size: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.backbar__right { display: flex; align-items: center; gap: 8px; }

/* ---- .app__main (app) ---- */
/* The scrolling area; the tab bar is fixed, so the bottom padding keeps the last row above it (the entry area adds its own later). */
.app__main {
  max-width: 40rem;
  margin: 0 auto;
  padding: env(safe-area-inset-top, 0px) 16px calc(56px + 16px + env(safe-area-inset-bottom, 0px));
}

/* ---- .tabbar (app) ---- */
.tabbar {
  position: fixed;
  bottom: 0;
  inset-inline: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--panel);
  border-top: 1px solid var(--outline);
}
.tabbar__tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 600;
}
.tabbar__tab.is-active { color: var(--accent); }
.tabbar__badge {
  position: absolute;
  top: 6px;
  left: calc(50% + 12px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: var(--on-accent);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.tabbar__dot {
  position: absolute;
  top: 10px;
  left: calc(50% + 16px);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

/* ---- .placeholder (stub screens) ---- */
.placeholder { padding: 24px 0; color: var(--muted); }
.placeholder h2 { margin: 0 0 8px; color: var(--text); }

/* ---- .sync (components/sync) ---- */
.sync { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.sync__title { margin: 0; font-size: 22px; }
.sync__footer { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.sync__muted { color: var(--muted); }
.sync--error { color: var(--danger); }
.sync--ok { color: var(--ok); }
.sync-card { padding: 12px 16px; border-radius: 12px; background: var(--panel); }
.sync-card p { margin: 6px 0; overflow-wrap: anywhere; }
.sync-card--notice { border-left: 3px solid var(--accent); }
.sync-card__title { margin: 0 0 8px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.sync-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sync-rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.sync-rows dt { color: var(--muted); }
.sync-rows dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.sync-paste { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--outline); }
.sync-paste a { color: var(--accent); }
.sync-paste__code {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  margin: 4px 0 8px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}
.sync-issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sync-issue { padding: 8px 12px; border-radius: 10px; background: var(--panel-2); border-left: 3px solid var(--danger); }
.sync-issue--soft { border-left-color: var(--accent); }
.sync-issue__head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.sync-issue__title { font-weight: 600; }
.sync-issue__path { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.sync-issue__detail { color: var(--text); }
.sync-issue__advice { color: var(--muted); }
.sync-issue__link { color: var(--accent); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }

/* ---- .log-start, .picker (components/log/StartPicker) ---- */
.log-start { display: flex; justify-content: center; padding: 48px 0; }
.log-start .btn { min-width: 60%; }
.picker { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.picker__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  text-align: left;
}
.picker__row.is-proposed { border-color: var(--accent); }
.picker__row:disabled { opacity: 0.45; cursor: default; }
.picker__head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.picker__title { font-weight: 600; }
.picker__label { color: var(--muted); }
.picker__tag { color: var(--accent); font-size: 13px; }
.picker__exercises { color: var(--muted); font-size: 14px; }
.picker__none { justify-content: center; color: var(--muted); }

/* ---- .log, .log-head, .log-card, .log-foot (components/log/LogScreen) ---- */
.log { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.log-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.log-head__when { font-weight: 600; font-variant-numeric: tabular-nums; }
.log-head__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.log-head__ref {
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
}
.log-head__offline { color: var(--danger); font-size: 14px; }
.log-card { padding: 10px 12px; border: 2px solid transparent; border-radius: 12px; background: var(--panel); }
.log-card--current { border-color: var(--accent); }
.log-card--finished .log-card__body { cursor: pointer; }
.log-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; }
.log-card__name { margin: 0; font-size: 17px; }
.log-card__namebtn {
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: inherit;
  font-weight: inherit;
  text-align: left;
}
.log-card__archived { margin-left: 8px; color: var(--muted); font-size: 12px; font-weight: 400; text-transform: uppercase; }
.log-card__load { color: var(--muted); font-variant-numeric: tabular-nums; }
.log-card__body { display: flex; flex-direction: column; gap: 6px; }
.log-card__rest { display: flex; flex-direction: column; gap: 6px; }
.log-card__rest.is-target { min-height: 44px; border-radius: 8px; }
.log-card__rest.is-target:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.log-card__caption { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.log-card__note { margin: 0; color: var(--muted); font-style: italic; overflow-wrap: anywhere; }
.log-card__totals { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
.log-card__counter { margin-left: auto; color: var(--accent); font-weight: 600; }
.log-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 0 12px; }

/* ---- .entry (components/log/EntryArea) ---- */
/* Pinned above the tab bar (56 px + safe area); the spacer keeps the last card scrollable above it,
   and the toast moves above it while it shows. */
.entry {
  position: fixed;
  inset-inline: 0;
  bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  z-index: 5;
  background: var(--panel);
  border-top: 1px solid var(--outline);
}
.entry__inner { display: flex; flex-direction: column; gap: 8px; max-width: 40rem; margin: 0 auto; padding: 8px 16px; }
.entry__inner > .btn { width: 100%; }
.entry__top { display: flex; align-items: center; gap: 8px; min-height: 44px; }
/* At 375 px a long name ('Diamond Push-ups', 'Australian Pull-ups') next to the load and note
   buttons leaves about 150 px: only the name truncates, the set number always shows. */
.entry__what { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 0.3em; white-space: nowrap; }
.entry__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.entry__set { flex: none; }
.entry__load, .entry__note {
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.entry__load::after { content: ' ▾'; color: var(--muted); }
.entry__note { color: var(--muted); }
.entry__note.is-set { border-color: var(--accent); color: var(--accent); }
.entry-spacer { height: 190px; }
body:has(.entry) .toast { bottom: calc(56px + 190px + env(safe-area-inset-bottom, 0px)); }

/* ---- .loadsheet, .notesheet (components/log/LoadSheet, NoteSheet) ---- */
.loadsheet__types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.loadsheet__type {
  min-height: 44px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
}
.loadsheet__type.is-active { border-color: var(--accent); color: var(--accent); }
.loadsheet__caption { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.notesheet__input, .setsheet__note, .blocksheet__note, .exsearch__input, .exform__field input, .exform__field select {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}

/* ---- .setsheet, .blocksheet (components/log/SetSheet, BlockSheet) ---- */
.setsheet__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.setsheet__label { color: var(--muted); }
.setsheet__load {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
}
.setsheet__load::after { content: ' ▾'; color: var(--muted); }
.setsheet__actions { display: flex; justify-content: space-between; gap: 8px; }
.setsheet__actions .btn--primary { margin-left: auto; }
.setsheet__gone, .blocksheet__gone { margin: 0; color: var(--muted); }

/* ---- .exsearch, .exform (components/log/ExerciseSearch) ---- */
.exsearch__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.exsearch__family { padding: 8px 0 2px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.exsearch__entry {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  text-align: left;
}
.exsearch__archived summary { min-height: 44px; display: flex; align-items: center; color: var(--muted); cursor: pointer; }
.exsearch__archived .exsearch__entry { color: var(--muted); }
.exsearch__create { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.exsearch__reason { color: var(--muted); font-size: 14px; }
.exform__field { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 14px; }
.exform__check { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.exform__check input { width: 22px; height: 22px; accent-color: var(--accent); }

/* ---- .days, .days-row, .past-session (components/days: list and Add past session) ---- */
.days { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.days__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.days__chip {
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
  border: 1px solid var(--outline);
  border-radius: 22px;
  background: var(--panel);
  color: var(--muted);
  font-weight: 600;
}
.days__chip.is-active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.days__add { display: flex; }
.days__empty { margin: 8px 0; color: var(--muted); }
.days__group { display: flex; flex-direction: column; }
/* Sticky under the top of the scrolling area; the background hides the rows passing below. */
.days__month {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 8px 0 6px;
  background: var(--bg);
  color: var(--muted);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.days__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.days-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
}
.days-row.is-open { border-color: var(--ok); }
.days-row.is-locked { background: var(--panel-2); }
.days-row__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.days-row__day { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.days-row__uncertain { color: var(--accent); }
.days-row__label { color: var(--muted); }
.days-row__open { color: var(--ok); font-weight: 600; }
.days-row__span { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.days-row__lock { display: inline-flex; align-self: center; color: var(--muted); }
.days-row__exercises { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 14px; }
.days-row__exercise { white-space: nowrap; }
.past-session__field { display: flex; flex-direction: column; gap: 6px; }
.past-session__label { color: var(--muted); font-size: 14px; }
.past-session__date {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
}

/* ---- .session, .session-head, .session-block, .session-set (components/days/SessionPage) ---- */
.session { display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; }
.session__missing { color: var(--muted); }
.session__banner { padding: 10px 12px; border: 1px solid var(--danger); border-radius: 10px; color: var(--text); background: var(--panel); }
.session__banner a { color: var(--accent); }
/* At least 44 px tall (spec 4 §8 touch targets). */
.session__banner-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 4px; }
.session__deleted { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-radius: 10px; background: var(--panel); color: var(--danger); font-weight: 600; }
.session__foot { display: flex; justify-content: space-between; gap: 8px; padding-top: 8px; }
.session-head { display: flex; flex-direction: column; gap: 6px; }
.session-head__uncertain { margin: 0; color: var(--muted); font-size: 14px; }
.session-head__line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.session-head__label { padding: 4px 10px; border-radius: 999px; background: var(--panel-2); color: var(--accent); font-size: 14px; text-transform: capitalize; }
.session-head__tag {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}
span.session-head__tag { display: inline-flex; align-items: center; min-height: 32px; }
.session-head__tag--add { border-style: dashed; color: var(--muted); }
.session-head__notes {
  margin: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font-size: 15px;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.session-head__placeholder { color: var(--muted); }
.session-block { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 12px; background: var(--panel); }
.session-block__head { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.session-block__name { margin: 0; flex: 1; font-size: 17px; }
.session-block__namebtn {
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: inherit;
  font-weight: inherit;
  text-align: left;
}
.session-block__flag { margin-left: 8px; color: var(--muted); font-size: 12px; font-weight: 400; text-transform: uppercase; }
.session-block__load { color: var(--muted); font-variant-numeric: tabular-nums; }
.session-block__options {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 18px;
}
.session-block__note { margin: 0; color: var(--muted); font-style: italic; overflow-wrap: anywhere; }
.session-block__empty { margin: 0; color: var(--muted); }
.session-block__sets { display: flex; flex-wrap: wrap; gap: 8px; }
.session-block__totals { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
.session-block__exmark { display: inline-flex; align-items: center; gap: 4px; }
.session-block__actions { display: flex; justify-content: flex-end; }
.session-set { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.session-set__meta, .session-set__note { max-width: 120px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; text-align: center; overflow-wrap: anywhere; }
.session-set__note { font-style: italic; }

/* ---- .sessionsheet, .tagsheet, .setsheet__aggregate (components/days/SessionHeaderSheet, SessionPage sheets; log/SetSheet) ---- */
.sessionsheet__field { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 14px; }
.sessionsheet__field input, .sessionsheet__field select, .sessionsheet__field textarea, .sessionsheet__notes, .tagsheet__input {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font-size: 16px; /* no zoom on focus (spec 4 §10 notes) */
  font-family: inherit;
}
.sessionsheet__switch { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.sessionsheet__switch input { width: 22px; height: 22px; accent-color: var(--accent); }
.tagsheet__seen { display: flex; flex-wrap: wrap; gap: 6px; }
.setsheet__aggregate { margin: 0; color: var(--muted); }

/* ---- .more-menu, .more-page (components/more) ---- */
.more-menu { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.more-menu__title { margin: 0 0 4px; font-size: 22px; }
.more-menu__item {
  min-height: 52px;
  padding: 12px 16px;
  border: 0;
  border-radius: 12px;
  background: var(--panel);
  text-align: left;
  font-size: 17px;
}
.more-page { display: flex; flex-direction: column; gap: 8px; }
.more-page__empty { color: var(--muted); }

/* ---- .xlist (more/ExercisesPage) ---- */
.xlist__group { margin-top: 8px; }
.xlist__family { margin: 0 0 4px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.xlist__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.xlist__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
}
.xlist__date { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.xlist__archived { margin-top: 12px; }
.xlist__archived > summary { min-height: 44px; padding: 10px 0; color: var(--muted); cursor: pointer; }

/* ---- .xhist (more/ExerciseHistoryPage) ---- */
.xhist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.xhist__status { margin: 0; color: var(--muted); }
.xhist__yeartitle { margin: 12px 0 4px; font-size: 13px; color: var(--muted); letter-spacing: 0.04em; }
/* A phone gets two lines: date, totals, marks and load, then the sets across the full width (a
   one-line row squeezed the sets to one number per line). From 560 px everything fits on one line. */
.xhist__row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content max-content;
  grid-template-areas:
    'day totals marks load'
    'sets sets sets sets';
  align-items: baseline;
  gap: 4px 10px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.xhist__day { grid-area: day; white-space: nowrap; }
.xhist__run { margin-left: 2px; color: var(--accent); font-size: 11px; }
.xhist__sets { grid-area: sets; overflow-wrap: anywhere; }
.xhist__sets.is-note { color: var(--muted); font-style: italic; }
.xhist__totals { grid-area: totals; justify-self: end; text-align: right; }
.xhist__marks { grid-area: marks; }
.xhist__load { grid-area: load; white-space: nowrap; }
.xhist__totals, .xhist__load { color: var(--muted); font-size: 14px; }
.xhist__note { grid-column: 1 / -1; color: var(--muted); font-size: 14px; font-style: italic; }
@media (min-width: 560px) {
  .xhist__row {
    grid-template-columns: max-content minmax(0, 1fr) max-content max-content max-content;
    grid-template-areas: 'day sets totals marks load';
  }
  .xhist__totals { justify-self: start; text-align: left; white-space: nowrap; }
  .xhist__note { grid-column: 2 / -1; }
}

/* ---- .cal (components/more/CalendarPage) ---- */
.cal { display: flex; flex-direction: column; gap: 16px; padding-top: 12px; }
.cal__streak { margin: 0; font-weight: 600; }
.cal__month { display: flex; flex-direction: column; gap: 6px; }
.cal__title { margin: 0; font-size: 18px; }
.cal__counts { margin: 0; color: var(--muted); font-size: 14px; }
/* Spec 4 §8: 44 px touch targets. The grid reaches 10 px into the page's 16 px side padding and has
   no gap, so 7 cells are 44 px wide from a 320 px screen on (288 + 20 = 7 × 44); the visible gap is
   each cell's transparent border, which the background leaves out. */
.cal__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0; margin-inline: -10px; }
.cal__weekday { color: var(--muted); font-size: 12px; text-align: center; }
.cal__day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  min-height: 44px;
  min-width: 0;
  padding: 3px 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  background-clip: padding-box;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.cal__day--out { visibility: hidden; }
.cal__day--today .cal__num { color: var(--accent); font-weight: 700; }
button.cal__day { background: var(--panel); }
.cal__num { font-size: 14px; line-height: 1; }
.cal__dots { display: flex; gap: 3px; height: 8px; }
.cal__dot { width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--chip-other); background: var(--chip-other); }
.cal__dot--push { border-color: var(--chip-push); background: var(--chip-push); }
.cal__dot--pull { border-color: var(--chip-pull); background: var(--chip-pull); }
.cal__dot--legs { border-color: var(--chip-legs); background: var(--chip-legs); }
.cal__dot--other { border-color: var(--chip-other); background: var(--chip-other); }
.cal__dot--hollow { background: transparent; }
.cal__more {
  min-height: 44px; padding: 10px 14px; border: 1px solid var(--outline); border-radius: 10px;
  background: var(--panel); color: var(--text); font: inherit;
}
.cal__session {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  text-align: left;
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 81 test files and 1134 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/more/CalendarPage.test.tsx src/ui/components/more/CalendarPage.tsx src/ui/components/more/calendar.vm.test.ts src/ui/components/more/calendar.vm.ts src/ui/theme.css src/ui/theme.test.ts
git commit -m "Add the calendar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Bodyweight log

The entries with the hand-drawn SVG line (no chart library, U5), add, edit and delete with Undo, and the shared write helpers for files other than sessions (spec 4 §6 "Bodyweight").

**Files:**
- Modify: `src/ui/components/log/outcome.test.ts`
- Modify: `src/ui/components/log/outcome.ts`
- Create: `src/ui/components/more/BodyweightPage.test.tsx`
- Modify: `src/ui/components/more/BodyweightPage.tsx`
- Create: `src/ui/components/more/BodyweightSheet.tsx`
- Create: `src/ui/components/more/bodyweight.vm.test.ts`
- Create: `src/ui/components/more/bodyweight.vm.ts`
- Modify: `src/ui/components/shared/NumberPad.test.tsx`
- Modify: `src/ui/components/shared/NumberPad.tsx`
- Modify: `src/ui/locked.test.ts`
- Modify: `src/ui/locked.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/edit`, `src/model/edit-bodyweight`, `src/model/schema`, `src/model/types`, `src/model/validate`, `src/sync/paths`, `src/sync/store`, `src/ui/components/shared`, `src/ui/components/shared/Button`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/held-back`, `src/ui/toast`.
- Produces:
  - `src/ui/components/log/outcome.ts`:
    - `export const HELD_BACK_TEXT = 'Saved here, not uploaded (app bug)'`
    - `export type Written = { ok: false } | { ok: true; heldBackNote: boolean }`
    - `export function quietOutcome(path: string, outcome: WriteOutcome): Written`
    - `export function showHeldBack(): void`
    - `export function reportOutcome(path: string, outcome: WriteOutcome): boolean`
    - `export async function quietWrite(path: string, write: () => Promise<WriteOutcome>): Promise<Written>`
    - `export async function reportWrite(path: string, write: () => Promise<WriteOutcome>): Promise<boolean>`
    - `export function editSessionQuiet(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<Written>`
    - `export async function editSession(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<boolean>`
  - `src/ui/components/more/BodyweightPage.tsx`:
    - `export function BodyweightPage(): JSX.Element`
  - `src/ui/components/more/BodyweightSheet.tsx`:
    - `export function BodyweightSheet(p: { entry?: BodyweightEntry; onClose(): void }): JSX.Element`
  - `src/ui/components/more/bodyweight.vm.ts`:
    - `export interface LinePoint { x: number; y: number; date: string; kg: number }`
    - `export interface BodyweightLine`
    - `export interface BodyweightRow { entryId: string; day: string; kg: string; note: string | undefined }`
    - `export function bodyweightLine(entries: readonly BodyweightEntry[], width: number, height: number, pad = 8): BodyweightLine | undefined`
    - `export function bodyweightRows(entries: readonly BodyweightEntry[]): BodyweightRow[]`
    - `export interface BodyweightDraft { kg: number | undefined; date: string; note: string }`
    - `export function bodyweightProblem(draft: BodyweightDraft, opened: BodyweightEntry | undefined): string | undefined`
    - `export function bodyweightChanges(`
  - `src/ui/components/shared/NumberPad.tsx`:
    - `export function NumberPad(p:`
  - `src/ui/locked.ts`:
    - `export interface LockedSession { row: FileRow; session: Session }`
    - `export function lockedSessionRows(rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): LockedSession[]`
    - `export function lockedSessionsOf(rows: readonly FileRow[], okSessionIds: ReadonlySet<string> = new Set()): Session[]`
    - `export function readOnlyCatalog(rows: readonly FileRow[]): Exercise[] | undefined`
    - `export function readOnlyBodyweight(rows: readonly FileRow[]): BodyweightEntry[] | undefined`

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `src/ui/components/log/outcome.test.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { EditError } from '../../../model/edit';
import { sessionFile } from '../../../model/test-fixtures';
import type { SessionFile } from '../../../model/types';
import type { WriteOutcome } from '../../data';
import { dismissToast, showToast, toast } from '../../toast';
import { editSession, editSessionQuiet, HELD_BACK_TEXT, quietOutcome, quietWrite, reportOutcome, reportWrite, showHeldBack } from './outcome';

afterEach(() => dismissToast());

describe('quietOutcome', () => {
  it('owes the held-back note the first time per path and shows nothing itself', () => {
    expect(quietOutcome('/quiet.json', { ok: true, heldBack: true })).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    expect(quietOutcome('/quiet.json', { ok: true, heldBack: true })).toEqual({ ok: true, heldBackNote: false });
    expect(quietOutcome('/quiet-ok.json', { ok: true, heldBack: false })).toEqual({ ok: true, heldBackNote: false });
  });

  it('still names a refusal', () => {
    expect(quietOutcome('/q.json', { ok: false, reason: 'changed' })).toEqual({ ok: false });
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
  });
});

describe('showHeldBack', () => {
  it('shows the note alone when no toast is showing', () => {
    showHeldBack();
    expect(toast.value).toEqual({ text: HELD_BACK_TEXT, ms: 4000 });
  });

  it('folds the note into the toast showing, keeping its action and time', () => {
    const run = (): void => {};
    showToast('Set 8 deleted', { label: 'Undo', run }, 6000);
    showHeldBack();
    expect(toast.value).toEqual({ text: `Set 8 deleted · ${HELD_BACK_TEXT}`, action: { label: 'Undo', run }, ms: 6000 });
    showHeldBack();
    expect(toast.value?.text).toBe(`Set 8 deleted · ${HELD_BACK_TEXT}`);
  });
});

describe('editSessionQuiet', () => {
  const fakeData = (outcome: WriteOutcome) => ({
    edit<F>(_kind: string, _path: string, fn: (file: F) => F): Promise<WriteOutcome> {
      fn(sessionFile() as F);
      return Promise.resolve(outcome);
    },
  });

  it('returns the owed note; an EditError becomes a toast', async () => {
    expect(await editSessionQuiet(fakeData({ ok: true, heldBack: true }), '/eq.json', (f: SessionFile) => f)).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    const failed = await editSessionQuiet(fakeData({ ok: true, heldBack: false }), '/eq.json', () => {
      throw new EditError('reps must be more than 0, got 0');
    });
    expect(failed).toEqual({ ok: false });
    expect(toast.value?.text).toBe('reps must be more than 0, got 0');
  });
});

describe('reportOutcome', () => {
  it('is quiet on a plain ok', () => {
    expect(reportOutcome('/a.json', { ok: true, heldBack: false })).toBe(true);
    expect(toast.value).toBeUndefined();
  });

  it('shows the held-back toast once per path', () => {
    expect(reportOutcome('/held.json', { ok: true, heldBack: true })).toBe(true);
    expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)');
    dismissToast();
    expect(reportOutcome('/held.json', { ok: true, heldBack: true })).toBe(true);
    expect(toast.value).toBeUndefined();
  });

  it('names a changed row and a refused row', () => {
    expect(reportOutcome('/b.json', { ok: false, reason: 'changed' })).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
    expect(reportOutcome('/b.json', { ok: false, reason: 'quarantined' })).toBe(false);
    expect(toast.value?.text).toBe('This file is read-only (quarantined)');
  });

  it("says a 'missing' session no longer exists instead of calling it read-only", () => {
    expect(reportOutcome('/sessions/2030/2030-03-07_00000000.json', { ok: false, reason: 'missing' })).toBe(false);
    expect(toast.value?.text).toBe('This session no longer exists');
    expect(reportOutcome('/exercises.json', { ok: false, reason: 'missing' })).toBe(false);
    expect(toast.value?.text).toBe('The exercise catalog is not here yet');
  });
});

describe('editSession', () => {
  /** A stand-in for Data.edit that applies fn to one file and returns the given outcome. */
  const fakeData = (outcome: WriteOutcome) => ({
    edit<F>(_kind: string, _path: string, fn: (file: F) => F): Promise<WriteOutcome> {
      fn(sessionFile() as F);
      return Promise.resolve(outcome);
    },
  });

  it('true on ok, false with the outcome toast otherwise', async () => {
    expect(await editSession(fakeData({ ok: true, heldBack: false }), '/s.json', (f: SessionFile) => f)).toBe(true);
    expect(await editSession(fakeData({ ok: false, reason: 'changed' }), '/s.json', (f: SessionFile) => f)).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
  });

  it('an EditError becomes a toast with its message', async () => {
    const result = await editSession(fakeData({ ok: true, heldBack: false }), '/s.json', () => {
      throw new EditError('reps must be more than 0, got 0');
    });
    expect(result).toBe(false);
    expect(toast.value?.text).toBe('reps must be more than 0, got 0');
  });

  it('any other error propagates', async () => {
    await expect(editSession(fakeData({ ok: true, heldBack: false }), '/s.json', () => {
      throw new TypeError('bug');
    })).rejects.toThrow('bug');
  });
});

describe('quietWrite and reportWrite (any file kind: Data.create or Data.edit)', () => {
  it('quietWrite returns the owed note, names a refusal, and turns an EditError into a toast', async () => {
    expect(await quietWrite('/qw.json', () => Promise.resolve({ ok: true, heldBack: true }))).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    expect(await quietWrite('/qw.json', () => Promise.resolve({ ok: false, reason: 'missing' }))).toEqual({ ok: false });
    expect(toast.value?.text).toBe('This session no longer exists');
    expect(await quietWrite('/qw.json', () => Promise.reject(new EditError('bodyweight must be more than 0 kg, got 0')))).toEqual({ ok: false });
    expect(toast.value?.text).toBe('bodyweight must be more than 0 kg, got 0');
    await expect(quietWrite('/qw.json', () => Promise.reject(new TypeError('bug')))).rejects.toThrow('bug');
  });

  it('reportWrite shows the held-back note itself and returns whether the write went through', async () => {
    expect(await reportWrite('/rw.json', () => Promise.resolve({ ok: true, heldBack: true }))).toBe(true);
    expect(toast.value?.text).toBe(HELD_BACK_TEXT);
    dismissToast();
    expect(await reportWrite('/rw.json', () => Promise.resolve({ ok: false, reason: 'changed' }))).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
    expect(await reportWrite('/rw.json', () => {
      throw new EditError('not a calendar date: 2030-02-30');
    })).toBe(false);
    expect(toast.value?.text).toBe('not a calendar date: 2030-02-30');
  });
});
```

Create `src/ui/components/more/BodyweightPage.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteBodyweightEntry, setBodyweightEntry } from '../../../model/edit-bodyweight';
import { bodyweight, bodyweightFile } from '../../../model/test-fixtures';
import type { BodyweightEntry, BodyweightFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { BODYWEIGHT_PATH } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatAmount, localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { dismissToast, toast } from '../../toast';
import { ToastHost } from '../shared';
import { BodyweightPage } from './BodyweightPage';

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
});

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/more/bodyweight' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

/** The clock of Data: every write must take its time from it (`data.clock()`). */
const NOW = new Date('2030-03-10T08:00:00.000Z');

async function mount(entries?: BodyweightEntry[]) {
  let data: Data | undefined;
  const store = new Store(await openDb(new IDBFactory()), { onChange: (path) => void data?.refresh(path) });
  if (entries !== undefined) await store.writeFile('bodyweight', BODYWEIGHT_PATH, bodyweightFile(entries), new Date(), 0);
  data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const deps: AppDeps = {
    data,
    router: new Router(fakeWindow()),
    sync,
    ui: {
      connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    },
  };
  render(
    <AppContext.Provider value={deps}>
      <BodyweightPage />
      <ToastHost />
    </AppContext.Provider>,
  );
  const stored = async (): Promise<BodyweightFile | undefined> => (await store.getRow(BODYWEIGHT_PATH))?.content as BodyweightFile | undefined;
  return { ...deps, store, stored };
}

const press = (...keys: string[]): void => {
  for (const k of keys) fireEvent.click(screen.getByRole('button', { name: k }));
};

describe('BodyweightPage', () => {
  it('Add entry creates bodyweight.json with the entry when no file exists', async () => {
    const d = await mount();
    expect(screen.queryByRole('img', { name: 'Bodyweight over time' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('7', '9', '.', '5', 'Use');
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    expect(date.value).toBe(localDate(d.data.now.value));
    fireEvent.input(date, { target: { value: '2030-03-07' } });
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: ' fasted ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      const file = await d.stored();
      expect(file?.entries).toHaveLength(1);
    });
    const entry = (await d.stored())?.entries[0];
    expect(entry).toMatchObject({ date: '2030-03-07', kg: 79.5, note: 'fasted', updatedAt: NOW.toISOString() });
    await waitFor(() => expect(screen.getByText(`${formatAmount(79.5)} kg`)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Add entry appends to an existing file', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '1', 'Use');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries).toHaveLength(2));
    expect((await d.stored())?.entries[1]).toMatchObject({ kg: 81 });
  });

  it('refuses a weight with more than one decimal', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '0', '.', '2', '5', 'Use');
    expect(screen.getByText('One decimal at most')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('draws the line with min and max labels from two entries on', async () => {
    await mount([bodyweight({ date: '2030-03-01', kg: 80 }), bodyweight({ date: '2030-03-08', kg: 82.5 })]);
    const svg = screen.getByRole('img', { name: 'Bodyweight over time' });
    expect(svg.querySelector('polyline')?.getAttribute('points')).toMatch(/^[\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
    const labels = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels).toEqual([`${formatAmount(82.5)} kg`, `${formatAmount(80)} kg`]);
  });

  it('tapping a row edits the entry', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeTruthy();
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2030-03-01');
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]).toMatchObject({ id: a.id, kg: 80, note: 'evening' }));
  });

  it('Delete tombstones the entry, Undo restores it', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const b = bodyweight({ date: '2030-03-02', kg: 81 });
    const d = await mount([a, b]);
    fireEvent.click(screen.getByRole('button', { name: /81 kg/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect((await d.stored())?.entries[1]?.deletedAt).toBeDefined());
    await waitFor(() => expect(screen.queryByRole('button', { name: /81 kg/ })).toBeNull());
    expect((await d.stored())?.entries[0]).toEqual(a);

    expect(toast.value?.ms).toBe(6000);
    expect((await d.stored())?.entries[1]?.deletedAt).toBe(NOW.toISOString());
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await d.stored())?.entries[1]?.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('button', { name: /81 kg/ })).toBeTruthy());
  });

  it('the kg pad reads Use and does not accept 0', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('0');
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('a migrated two-decimal entry can still get a new note and date', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80.25 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${formatAmount(80.25)} kg`) }));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'migrated' } });
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2030-03-02' } });
    expect(screen.queryByText('One decimal at most')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]).toMatchObject({ id: a.id, kg: 80.25, date: '2030-03-02', note: 'migrated', updatedAt: NOW.toISOString() }));
  });

  it('an edit Save that changes nothing writes nothing and closes the sheet', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80, note: 'fasted' });
    const d = await mount([a]);
    const before = await d.store.getRow(BODYWEIGHT_PATH);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: ' fasted ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const after = await d.store.getRow(BODYWEIGHT_PATH);
    expect(after?.version).toBe(before?.version);
    expect((await d.stored())?.entries[0]).toEqual(a);
  });

  it('an edit writes only the fields changed in the sheet, keeping a change made elsewhere meanwhile', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    // Another device changes the kg while the sheet is open.
    await d.data.edit('bodyweight', BODYWEIGHT_PATH, (f) => setBodyweightEntry(f, a.id, { kg: 82 }, NOW));
    await waitFor(async () => expect((await d.stored())?.entries[0]?.kg).toBe(82));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]?.note).toBe('evening'));
    expect((await d.stored())?.entries[0]).toMatchObject({ kg: 82, date: '2030-03-01' });
  });

  it('the date defaults to the clock\'s day, not the slow `now` tick (after a resume or past midnight)', async () => {
    const d = await mount();
    act(() => { d.data.now.value = new Date('2030-03-09T08:00:00.000Z'); });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '0', 'Use');
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(localDate(NOW));
  });

  it('typing 0 on the kg pad says why Use is disabled', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('0');
    expect(screen.getByText('More than 0 kg')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    press('Backspace', '8');
    expect(screen.queryByText('More than 0 kg')).toBeNull();
  });

  it('the sheet\'s own Cancel while the kg pad is open goes back to the form and keeps the typed note', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Weight' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit entry' });
    expect(within(sheet).getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeTruthy();
    expect((screen.getByLabelText('Note') as HTMLInputElement).value).toBe('evening');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await d.stored())?.entries[0]).toMatchObject({ id: a.id, note: 'evening' }));
  });

  it('a new entry\'s pad Cancel without a kg closes the sheet', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add entry' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a double tap on Save appends one entry', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '1', 'Use');
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await d.stored())?.entries).toHaveLength(2);
  });

  it('a refused write shows the reason and leaves Save enabled', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    press('8', '1', 'Use');
    // The file turns quarantined after the sheet opened (a pull).
    const row = await d.store.getRow(BODYWEIGHT_PATH);
    if (row === undefined) throw new Error('no row');
    await d.store.saveRow({ ...row, status: 'quarantined' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('This file is read-only (quarantined)'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    expect((await d.stored())?.entries).toHaveLength(1);
  });

  it('an edit or Delete of an entry another device deleted meanwhile writes nothing and says so', async () => {
    const a = bodyweight({ date: '2030-03-01', kg: 80 });
    const d = await mount([a]);
    fireEvent.click(screen.getByRole('button', { name: /80 kg/ }));
    await d.data.edit('bodyweight', BODYWEIGHT_PATH, (f) => deleteBodyweightEntry(f, a.id, NOW));
    const before = (await d.store.getRow(BODYWEIGHT_PATH))?.version;
    fireEvent.input(screen.getByLabelText('Note'), { target: { value: 'evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('This entry was deleted elsewhere'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false));
    expect(toast.value?.text).toBe('This entry was deleted elsewhere');
    expect((await d.store.getRow(BODYWEIGHT_PATH))?.version).toBe(before);
    expect((await d.stored())?.entries[0]).not.toHaveProperty('note');
  });

  it('a read-only bodyweight.json (written by a newer app) still lists its entries and line, without edit controls', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 }), bodyweight({ date: '2030-03-08', kg: 81 })]);
    const row = await d.store.getRow(BODYWEIGHT_PATH);
    if (row === undefined) throw new Error('no row');
    await d.store.saveRow({ ...row, status: 'needs-update', content: { ...(row.content as BodyweightFile), schemaVersion: 99 } });
    await act(async () => { await d.data.refresh(BODYWEIGHT_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('bodyweight.json is needs-update'));
    expect(screen.getByRole('button', { name: /81 kg/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('img', { name: 'Bodyweight over time' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add entry' })).toBeNull();
    expect(screen.queryByText('No entries yet.')).toBeNull();
  });

  it('a quarantined bodyweight.json shows the banner, no Add entry and no "No entries yet."', async () => {
    const d = await mount([bodyweight({ date: '2030-03-01', kg: 80 })]);
    const row = await d.store.getRow(BODYWEIGHT_PATH);
    if (row === undefined) throw new Error('no row');
    await d.store.saveRow({ ...row, status: 'quarantined' });
    await act(async () => { await d.data.refresh(BODYWEIGHT_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('bodyweight.json is quarantined'));
    expect(screen.queryByRole('button', { name: 'Add entry' })).toBeNull();
    expect(screen.queryByText('No entries yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: /80 kg/ })).toBeNull();
  });

  it('Back goes to the More menu', async () => {
    const d = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(d.router.route.value).toEqual({ tab: 'more' });
  });
});
```

Create `src/ui/components/more/bodyweight.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bodyweight } from '../../../model/test-fixtures';
import { formatAmount } from '../../format';
import { bodyweightChanges, bodyweightLine, bodyweightProblem, bodyweightRows, type BodyweightDraft } from './bodyweight.vm';

const DEL = '2030-01-09T10:00:00.000Z';

describe('bodyweightLine', () => {
  it('is undefined with no entries and with one entry', () => {
    expect(bodyweightLine([], 100, 50)).toBeUndefined();
    expect(bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 })], 100, 50)).toBeUndefined();
  });

  it('is undefined when only one entry is live (tombstones out)', () => {
    const entries = [bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-02', kg: 81, deletedAt: DEL, updatedAt: DEL })];
    expect(bodyweightLine(entries, 100, 50)).toBeUndefined();
  });

  it('spans two entries from pad to width - pad, heavier higher (y inverted)', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-11', kg: 82 })], 100, 50);
    expect(line?.points).toEqual([
      { x: 8, y: 42, date: '2030-01-01', kg: 80 },
      { x: 92, y: 8, date: '2030-01-11', kg: 82 },
    ]);
    expect(line?.polyline).toBe('8,42 92,8');
    expect(line?.min).toEqual({ kg: 80, y: 42 });
    expect(line?.max).toEqual({ kg: 82, y: 8 });
  });

  it('takes the pad argument', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 82 }), bodyweight({ date: '2030-01-02', kg: 80 })], 100, 50, 0);
    expect(line?.polyline).toBe('0,0 100,50');
  });

  it('places x by days between dates and sorts points by date', () => {
    const entries = [
      bodyweight({ date: '2030-01-31', kg: 81 }),
      bodyweight({ date: '2030-01-01', kg: 80 }),
      bodyweight({ date: '2030-01-04', kg: 82 }),
    ];
    const line = bodyweightLine(entries, 316, 50);
    expect(line?.points.map((p) => p.date)).toEqual(['2030-01-01', '2030-01-04', '2030-01-31']);
    // 30 days over 300 px: 10 px a day.
    expect(line?.points.map((p) => p.x)).toEqual([8, 38, 308]);
    expect(line?.points.map((p) => p.y)).toEqual([42, 8, 25]);
  });

  it('draws equal weights as a flat line in the middle', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-03', kg: 80 })], 100, 50);
    expect(line?.points.map((p) => p.y)).toEqual([25, 25]);
    expect(line?.min).toEqual({ kg: 80, y: 25 });
    expect(line?.max).toEqual({ kg: 80, y: 25 });
  });

  it('puts entries that are all on one day in the horizontal middle, still heavier higher', () => {
    const line = bodyweightLine([bodyweight({ date: '2030-01-01', kg: 80 }), bodyweight({ date: '2030-01-01', kg: 81 })], 100, 50);
    expect(line?.points.map((p) => p.x)).toEqual([50, 50]);
    expect(line?.min).toEqual({ kg: 80, y: 42 });
    expect(line?.max).toEqual({ kg: 81, y: 8 });
    expect(line?.polyline).toBe('50,42 50,8');
  });

  it('rounds the polyline to one decimal', () => {
    const entries = [
      bodyweight({ date: '2030-01-01', kg: 80 }),
      bodyweight({ date: '2030-01-04', kg: 81 }),
      bodyweight({ date: '2030-01-07', kg: 83 }),
    ];
    const line = bodyweightLine(entries, 100, 50);
    // x: 8, 50, 92; y: 42, 42 - 34/3 = 30.666…, 8
    expect(line?.points[1]?.y).toBeCloseTo(30.6667, 3);
    expect(line?.polyline).toBe('8,42 50,30.7 92,8');
  });

  it('handles many entries, all within the box', () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      bodyweight({ date: `2030-02-${String((i % 28) + 1).padStart(2, '0')}`, kg: 78 + (i % 7) * 0.5 }),
    );
    const line = bodyweightLine(entries, 200, 80);
    expect(line?.points).toHaveLength(40);
    for (const p of line?.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(192);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.y).toBeLessThanOrEqual(72);
    }
    expect(line?.polyline.split(' ')).toHaveLength(40);
    expect(line?.min.kg).toBe(78);
    expect(line?.max.kg).toBe(81);
  });
});

describe('bodyweightRows', () => {
  it('lists live entries newest first, then by updatedAt, with day, kg and note', () => {
    const old = bodyweight({ date: '2030-03-01', kg: 80 });
    const sameDayEarly = bodyweight({ date: '2030-03-07', kg: 79.5, updatedAt: '2030-03-07T06:00:00.000Z' });
    const sameDayLate = bodyweight({ date: '2030-03-07', kg: 79.8, note: 'after lunch', updatedAt: '2030-03-07T13:00:00.000Z' });
    const gone = bodyweight({ date: '2030-03-08', kg: 70, deletedAt: DEL, updatedAt: DEL });
    expect(bodyweightRows([old, sameDayEarly, gone, sameDayLate])).toEqual([
      { entryId: sameDayLate.id, day: 'Thu 07 Mar', kg: `${formatAmount(79.8)} kg`, note: 'after lunch' },
      { entryId: sameDayEarly.id, day: 'Thu 07 Mar', kg: `${formatAmount(79.5)} kg`, note: undefined },
      { entryId: old.id, day: 'Fri 01 Mar', kg: `${formatAmount(80)} kg`, note: undefined },
    ]);
  });

  it('is empty without live entries', () => {
    expect(bodyweightRows([])).toEqual([]);
    expect(bodyweightRows([bodyweight({ deletedAt: DEL, updatedAt: DEL })])).toEqual([]);
  });
});

describe('bodyweightProblem', () => {
  const draft = (over: Partial<BodyweightDraft> = {}): BodyweightDraft => ({ kg: 80, date: '2030-03-01', note: '', ...over });

  it('asks for a weight more than 0 kg', () => {
    expect(bodyweightProblem(draft({ kg: undefined }), undefined)).toBe('Enter the weight');
    expect(bodyweightProblem(draft({ kg: 0 }), undefined)).toBe('More than 0 kg');
    expect(bodyweightProblem(draft({ kg: -1 }), undefined)).toBe('More than 0 kg');
    expect(bodyweightProblem(draft({ kg: Number.NaN }), undefined)).toBe('More than 0 kg');
    expect(bodyweightProblem(draft(), undefined)).toBeUndefined();
  });

  it('allows one decimal only for a new or changed kg', () => {
    expect(bodyweightProblem(draft({ kg: 80.25 }), undefined)).toBe('One decimal at most');
    const migrated = bodyweight({ date: '2030-03-01', kg: 80.25 });
    expect(bodyweightProblem(draft({ kg: 80.25, note: 'new note', date: '2030-03-02' }), migrated)).toBeUndefined();
    expect(bodyweightProblem(draft({ kg: 80.35 }), migrated)).toBe('One decimal at most');
    expect(bodyweightProblem(draft({ kg: 80.3 }), migrated)).toBeUndefined();
  });

  it('asks for a calendar date', () => {
    expect(bodyweightProblem(draft({ date: '' }), undefined)).toBe('Pick a date');
    expect(bodyweightProblem(draft({ date: '2030-02-30' }), undefined)).toBe('Pick a date');
  });
});

describe('bodyweightChanges', () => {
  const opened = bodyweight({ date: '2030-03-01', kg: 80.25, note: 'migrated' });

  it('is empty when nothing changed (a blank-padded note counts as the same)', () => {
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-01', note: ' migrated ' }, opened)).toEqual({});
    expect(bodyweightChanges({ kg: 80, date: '2030-03-01', note: '' }, bodyweight({ date: '2030-03-01', kg: 80 }))).toEqual({});
  });

  it('holds only the fields that differ from the values the sheet opened with', () => {
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-02', note: 'migrated' }, opened)).toEqual({ date: '2030-03-02' });
    expect(bodyweightChanges({ kg: 81, date: '2030-03-01', note: 'migrated' }, opened)).toEqual({ kg: 81 });
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-01', note: 'evening' }, opened)).toEqual({ note: 'evening' });
  });

  it('removes a cleared note with null', () => {
    expect(bodyweightChanges({ kg: 80.25, date: '2030-03-01', note: '  ' }, opened)).toEqual({ note: null });
  });
});
```

Replace the whole content of `src/ui/components/shared/NumberPad.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../format';
import { NumberPad } from './NumberPad';

const tap = (name: string): boolean => fireEvent.click(screen.getByRole('button', { name }));
const display = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const submit = (label = 'Add'): HTMLButtonElement => screen.getByRole('button', { name: label }) as HTMLButtonElement;

describe('NumberPad', () => {
  it('opens empty with the current value as a placeholder; digits and one decimal point start a fresh number', () => {
    const onSubmit = vi.fn();
    render(<NumberPad value={16} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    const field = display();
    expect(field.value).toBe('');
    expect(field.placeholder).toBe(formatAmount(16));
    expect(field.readOnly).toBe(true);
    expect(field.getAttribute('inputmode')).toBe('decimal');
    tap('1');
    tap('6');
    tap('.');
    tap('.');
    tap('5');
    expect(field.value).toBe('16.5');
    for (const d of ['0', '1', '2', '3', '4', '6', '7', '8', '9']) expect(screen.getByRole('button', { name: d })).toBeTruthy();
    tap('Add');
    expect(onSubmit).toHaveBeenCalledWith(16.5);
  });

  it('a jump replaces the value: 8 shown, 3 0 submits 30; 11.5 shown, 1 4 submits 14', () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<NumberPad value={8} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    tap('3');
    tap('0');
    tap('Add');
    expect(onSubmit).toHaveBeenLastCalledWith(30);
    unmount();
    render(<NumberPad value={11.5} submitLabel="Use" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    tap('1');
    tap('4');
    tap('Use');
    expect(onSubmit).toHaveBeenLastCalledWith(14);
  });

  it('the submit button carries the given label', () => {
    render(<NumberPad value={undefined} submitLabel="Use" allowZero={false} onSubmit={() => {}} onCancel={() => {}} />);
    expect(submit('Use')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('disables the submit when empty or 0, backspace deletes, Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<NumberPad value={undefined} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={onCancel} />);
    expect(display().value).toBe('');
    expect(display().placeholder).toBe('');
    expect(submit().disabled).toBe(true);
    tap('0');
    expect(submit().disabled).toBe(true);
    tap('Backspace');
    tap('3');
    expect(submit().disabled).toBe(false);
    tap('Backspace');
    expect(display().value).toBe('');
    expect(submit().disabled).toBe(true);
    tap('Cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('allowZero accepts 0 (external or band at 0 kg, spec 1 §3); empty stays disabled', () => {
    const onSubmit = vi.fn();
    render(<NumberPad value={undefined} submitLabel="Use" allowZero onSubmit={onSubmit} onCancel={() => {}} />);
    expect(submit('Use').disabled).toBe(true);
    tap('0');
    expect(submit('Use').disabled).toBe(false);
    tap('Use');
    expect(onSubmit).toHaveBeenCalledWith(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('without allowZero a typed 0 says why the submit is disabled (default text, or zeroHint)', () => {
    render(<NumberPad value={undefined} submitLabel="Use" allowZero={false} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
    tap('0');
    tap('.');
    expect(screen.getByRole('status').textContent).toBe('More than 0');
    tap('5');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('zeroHint replaces the default text', () => {
    render(<NumberPad value={undefined} submitLabel="Use" allowZero={false} zeroHint="More than 0 kg" onSubmit={() => {}} onCancel={() => {}} />);
    tap('0');
    expect(screen.getByRole('status').textContent).toBe('More than 0 kg');
  });
});
```

Replace the whole content of `src/ui/locked.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { block, bodyweight, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile } from '../model/test-fixtures';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../sync/paths';
import type { FileRow } from '../sync/store';
import { lockedSessionRows, lockedSessionsOf, readOnlyBodyweight, readOnlyCatalog } from './locked';

describe('readOnlyCatalog and readOnlyBodyweight', () => {
  const catalogRow = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
    path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content, status: 'read-only', issues: [], version: 1, ...over,
  });
  const bodyRow = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
    path: BODYWEIGHT_PATH, kind: 'bodyweight', rev: 'r1', content, status: 'needs-update', issues: [], version: 1, ...over,
  });

  it('give the lenient content of a read-only or needs-update file (spec 4 §6: shown read-only)', () => {
    const e = exercise({ id: 'dips', name: 'Dips' });
    expect(readOnlyCatalog([catalogRow({ ...exercisesFile([e]), schemaVersion: 99, extra: true })])).toEqual([e]);
    expect(readOnlyCatalog([catalogRow(exercisesFile([e]), { status: 'needs-update' })])).toEqual([e]);
    const b = bodyweight({ kg: 80 });
    expect(readOnlyBodyweight([bodyRow(bodyweightFile([b]))])).toEqual([b]);
    expect(readOnlyBodyweight([bodyRow(bodyweightFile([b]), { status: 'read-only' })])).toEqual([b]);
  });

  it('give nothing for a quarantined or duplicate row, content that does not parse, or no row', () => {
    const e = exercise();
    expect(readOnlyCatalog([catalogRow(exercisesFile([e]), { status: 'quarantined' })])).toBeUndefined();
    expect(readOnlyCatalog([catalogRow(exercisesFile([e]), { duplicateOf: '/other.json' })])).toBeUndefined();
    expect(readOnlyCatalog([catalogRow({ schemaVersion: 1, exercises: 'no' })])).toBeUndefined();
    expect(readOnlyCatalog([])).toBeUndefined();
    expect(readOnlyBodyweight([bodyRow({ schemaVersion: 1, entries: [{ id: 'x' }] })])).toBeUndefined();
    expect(readOnlyBodyweight([bodyRow(bodyweightFile([bodyweight()]), { status: 'quarantined' })])).toBeUndefined();
  });
});

const row = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
  path: '/sessions/2030/2030-03-04_00000000.json', kind: 'session', rev: 'r1', content, status: 'quarantined', issues: [], version: 1, ...over,
});

describe('lockedSessionsOf', () => {
  it('takes the session of refused session rows whose content parses as a session', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    expect(lockedSessionsOf([row(sessionFile(s))])).toEqual([s]);
  });

  it('skips rows of other kinds and content that is not a session', () => {
    expect(lockedSessionsOf([
      row({ schemaVersion: 1 }),
      row({ session: 'nope' }),
      row({ session: { id: 'x', date: '2030-03-04' } }),
      row({ session: { id: 'x', date: '2030-03-04', blocks: 'no' } }),
      row({ session: { id: 'x', date: '2030-03-04', tags: [], blocks: [{ id: 'b', exerciseId: 'dips' }] } }),
      row(null),
      row({ schemaVersion: 1, exercises: [] }, { kind: 'exercises', path: '/exercises.json' }),
    ])).toEqual([]);
  });

  it('skips a session the page could not render: tags missing, or a set without a numeric amount', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const { tags: _tags, ...noTags } = s;
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noTags })])).toEqual([]);
    const noAmount = { ...s, blocks: [{ ...s.blocks[0], sets: [{ id: 'x', order: 0 }] }] };
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noAmount })])).toEqual([]);
  });

  it('checks the lenient session schema: a wrong label, a non-string tag or a bad load type keeps the file off the list', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const file = sessionFile(s);
    const b0 = s.blocks[0];
    const set0 = b0?.sets[0];
    if (b0 === undefined || set0 === undefined) throw new Error('fixture');
    for (const bad of [
      { ...s, label: 5 },
      { ...s, label: null },
      { ...s, label: 'Push' },
      { ...s, tags: ['ok', 7] },
      { ...s, notes: { text: 'x' } },
      { ...s, blocks: [{ ...b0, sets: [{ ...set0, loadType: 'chains' }] }] },
    ]) {
      expect(lockedSessionsOf([row({ ...file, session: bad })])).toEqual([]);
    }
  });

  it('lists a file a newer app wrote (unknown fields, newer schemaVersion) and one that fails only a hard rule', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const newer = { schemaVersion: 99, session: { ...s, mood: 'good' } };
    expect(lockedSessionsOf([row(newer, { status: 'needs-update' })])).toEqual([newer.session]);
    // 30 February matches the date pattern; only the hard rules refuse it (display does not care).
    const hard = sessionFile({ ...s, date: '2030-02-30' });
    expect(lockedSessionsOf([row(hard)])).toEqual([hard.session]);
  });

  it('leaves out the loser of a duplicate pair: spec 3 §6 hides it from views, its content is merged into the ok twin', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const loser = row(sessionFile(s), { status: 'ok', duplicateOf: '/sessions/2030/2030-03-04_aaaaaaaa.json', path: '/sessions/2030/2030-03-04_bbbbbbbb.json' });
    expect(lockedSessionsOf([loser], new Set([s.id]))).toEqual([]);
    // Even before the twin's row is known: a duplicate is never listed on its own.
    expect(lockedSessionsOf([loser])).toEqual([]);
  });

  it('leaves out a refused session whose id an ok session or an earlier refused row already holds (the route could not reach it)', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const first = row(sessionFile(s), { status: 'needs-update', path: '/sessions/2030/2030-03-04_first.json' });
    const second = row(sessionFile(s), { status: 'quarantined', path: '/sessions/2030/2030-03-04_second.json' });
    expect(lockedSessionsOf([first], new Set([s.id]))).toEqual([]);
    expect(lockedSessionRows([first, second], new Set())).toEqual([{ row: first, session: s }]);
  });
});

describe('lockedSessionRows', () => {
  it('pairs each listed session with its row, so the session page reads the same row and its reason', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const r: FileRow = { path: '/sessions/2030/2030-03-04_x.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'read-only', issues: [], version: 1 };
    expect(lockedSessionRows([r], new Set())).toEqual([{ row: r, session: s }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/log/outcome.test.ts src/ui/components/more/BodyweightPage.test.tsx src/ui/components/more/bodyweight.vm.test.ts src/ui/components/shared/NumberPad.test.tsx src/ui/locked.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/more/bodyweight.vm.test.ts: Error: Cannot find module './bodyweight.vm' imported from src/ui/components/more/bodyweight.vm.test.ts
```


- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/ui/components/log/outcome.ts` with:

```ts
import { EditError } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../../../sync/paths';
import type { Data, WriteOutcome } from '../../data';
import { noteHeldBack } from '../../held-back';
import { showToast, toast } from '../../toast';

export const HELD_BACK_TEXT = 'Saved here, not uploaded (app bug)';

/** A refusal in plain words: 'missing' (no ok row at the path) is not a read-only file. */
function refusalText(path: string, reason: Exclude<WriteOutcome, { ok: true }>['reason']): string {
  if (reason === 'changed') return 'Changed elsewhere, try again';
  if (reason === 'missing') {
    if (path === EXERCISES_PATH) return 'The exercise catalog is not here yet';
    if (path === BODYWEIGHT_PATH) return 'The bodyweight log is not here yet';
    return 'This session no longer exists';
  }
  return `This file is read-only (${reason})`;
}

/** A write's result for a caller that shows a toast of its own right after it (an Undo toast, or a
 *  second write): `heldBackNote` is true when this path's once-only held-back note is still owed. */
export type Written = { ok: false } | { ok: true; heldBackNote: boolean };

/** Spec 4 §9: refusals become a toast at once; a first held-back write is only reported back, so the
 *  caller can fold the note into its own toast with `showHeldBack` instead of having it replaced. */
export function quietOutcome(path: string, outcome: WriteOutcome): Written {
  if (outcome.ok) return { ok: true, heldBackNote: outcome.heldBack && noteHeldBack(path) };
  showToast(refusalText(path, outcome.reason));
  return { ok: false };
}

/** The held-back note. A toast already showing (an Undo, an error) keeps its action and time and
 *  carries the note after its own text, so neither message replaces the other. */
export function showHeldBack(): void {
  const current = toast.value;
  if (current === undefined) {
    showToast(HELD_BACK_TEXT);
    return;
  }
  if (current.text.includes(HELD_BACK_TEXT)) return;
  toast.value = { ...current, text: `${current.text} · ${HELD_BACK_TEXT}` };
}

/** Spec 4 §9: the toasts for a write's outcome. True when the write went through (held back or not). */
export function reportOutcome(path: string, outcome: WriteOutcome): boolean {
  const written = quietOutcome(path, outcome);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}

/** One write of any file kind (a `Data.edit` or a `Data.create`) with the toasts of `quietOutcome`,
 *  and an EditError thrown while building the file shown as a toast with its message. */
export async function quietWrite(path: string, write: () => Promise<WriteOutcome>): Promise<Written> {
  try {
    return quietOutcome(path, await write());
  } catch (e) {
    if (e instanceof EditError) {
      showToast(e.message);
      return { ok: false };
    }
    throw e;
  }
}

/** `quietWrite` with the held-back note shown at once. True when the write went through. */
export async function reportWrite(path: string, write: () => Promise<WriteOutcome>): Promise<boolean> {
  const written = await quietWrite(path, write);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}

/** One session edit through Data.edit with the toasts of `quietOutcome`, and an EditError from `fn`
 *  shown as a toast with its message. */
export function editSessionQuiet(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<Written> {
  return quietWrite(path, () => data.edit('session', path, fn));
}

/** One session edit through Data.edit: the outcome toasts of reportOutcome, and an EditError from
 *  `fn` shown as a toast with its message. True when the write went through. */
export async function editSession(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<boolean> {
  const written = await editSessionQuiet(data, path, fn);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}
```

Replace the whole content of `src/ui/components/more/BodyweightPage.tsx` with:

```tsx
import { useComputed, useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { BODYWEIGHT_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { formatAmount } from '../../format';
import { readOnlyBodyweight } from '../../locked';
import { BackBar, Button } from '../shared';
import { bodyweightLine, bodyweightRows } from './bodyweight.vm';
import { BodyweightSheet } from './BodyweightSheet';

const W = 320;
const H = 120;
const PAD = 16;

/** The sheet state: closed, adding, or editing one entry. */
type SheetState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; entryId: string };

/**
 * Spec 4 §6 "Bodyweight": the line (two entries on), the entries newest first, Add entry; a row edits.
 * A refused bodyweight.json shows the banner and no edit control; a read-only or needs-update file
 * (written by a newer app) still shows its entries and line, a quarantined one only the banner.
 */
export function BodyweightPage(): JSX.Element {
  const { data, router } = useApp();
  const sheet = useSignal<SheetState>({ mode: 'closed' });
  const refused = useComputed(() => data.refusedRows.value.find((r) => r.path === BODYWEIGHT_PATH));
  /** undefined: nothing to show (a quarantined or unparseable file); [] is a file without entries. */
  const shown = useComputed(() => {
    const ok = data.bodyweight.value?.file.entries;
    if (ok !== undefined) return ok;
    return refused.value === undefined ? [] : readOnlyBodyweight(data.refusedRows.value);
  });
  const entries = shown.value ?? [];

  const line = bodyweightLine(entries, W, H, PAD);
  const rows = bodyweightRows(entries);
  const blocked = refused.value;
  const current = sheet.value;
  const editing = current.mode === 'edit' && blocked === undefined ? entries.find((e) => e.id === current.entryId) : undefined;
  const close = (): void => { sheet.value = { mode: 'closed' }; };

  return (
    <section class="bw">
      <BackBar title="Bodyweight" onBack={() => router.navigate({ tab: 'more' })} />
      {blocked !== undefined && (
        <p class="bw__banner" role="alert">bodyweight.json is {blocked.duplicateOf !== undefined ? 'a duplicate' : blocked.status}; entries cannot be changed here. See the Sync tab.</p>
      )}
      {line !== undefined && (
        <svg class="bw-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bodyweight over time">
          <polyline class="bw-line__path" points={line.polyline} />
          <text class="bw-line__label" x={W - 2} y={line.max.y - 4} text-anchor="end">{`${formatAmount(line.max.kg)} kg`}</text>
          {line.min.kg !== line.max.kg && (
            <text class="bw-line__label" x={W - 2} y={line.min.y + 12} text-anchor="end">{`${formatAmount(line.min.kg)} kg`}</text>
          )}
        </svg>
      )}
      {blocked === undefined && (
        <div class="bw__actions">
          <Button kind="primary" onClick={() => { sheet.value = { mode: 'add' }; }}>Add entry</Button>
        </div>
      )}
      {rows.length === 0 ? (
        shown.value !== undefined && <p class="bw__empty">No entries yet.</p>
      ) : (
        <ul class="bw__list">
          {rows.map((r) => (
            <li key={r.entryId}>
              <button
                type="button"
                class="bw-row"
                disabled={blocked !== undefined}
                onClick={() => { sheet.value = { mode: 'edit', entryId: r.entryId }; }}
              >
                <span class="bw-row__day">{r.day}</span>
                <span class="bw-row__kg">{r.kg}</span>
                {r.note !== undefined && <span class="bw-row__note">{r.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {current.mode === 'add' && <BodyweightSheet onClose={close} />}
      {editing !== undefined && <BodyweightSheet entry={editing} onClose={close} />}
    </section>
  );
}
```

Create `src/ui/components/more/BodyweightSheet.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  addBodyweightEntry,
  deleteBodyweightEntry,
  emptyBodyweightFile,
  setBodyweightEntry,
  undeleteBodyweightEntry,
} from '../../../model/edit-bodyweight';
import type { BodyweightEntry, BodyweightFile } from '../../../model/types';
import { BODYWEIGHT_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import type { Data, WriteOutcome } from '../../data';
import { formatAmount, localDate } from '../../format';
import { showToast } from '../../toast';
import { quietWrite, reportWrite, showHeldBack } from '../log/outcome';
import { Button, NumberPad, Sheet } from '../shared';
import { bodyweightChanges, bodyweightProblem } from './bodyweight.vm';

const UNDO_MS = 6000;

function editFile(data: Data, fn: (f: BodyweightFile) => BodyweightFile): Promise<WriteOutcome> {
  return data.edit('bodyweight', BODYWEIGHT_PATH, fn);
}

/**
 * Add or edit one bodyweight entry (spec 4 §6): kg through the NumberPad, the date (default
 * today) and a note; in edit mode also Delete with the 6 s Undo toast. Writes create
 * bodyweight.json when it does not exist yet, else edit it. Every write takes its time from
 * `data.clock()`; an edit sends only the fields changed against the values the sheet opened with
 * (so a field another device changed meanwhile is never written back), and nothing at all when none
 * changed.
 */
export function BodyweightSheet(p: { entry?: BodyweightEntry; onClose(): void }): JSX.Element {
  const { data } = useApp();
  // The entry as the sheet opened it: later refreshes of the row do not move the comparison base.
  const [opened] = useState(p.entry);
  const [kg, setKg] = useState<number | undefined>(opened?.kg);
  const [padOpen, setPadOpen] = useState(opened === undefined);
  // The clock, not `now` (which ticks once a minute here and not on resume): today's day.
  const [date, setDate] = useState(() => opened?.date ?? localDate(data.clock()));
  const [note, setNote] = useState(opened?.note ?? '');
  const [newId] = useState(() => crypto.randomUUID());
  const busy = useSignal(false);

  const problem = bodyweightProblem({ kg, date, note }, opened);

  /** Runs one write unless one is running; the flag is cleared however the write ends. */
  const guarded = async (write: () => Promise<void>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const save = (): Promise<void> => guarded(async () => {
    if (kg === undefined || problem !== undefined) return;
    if (opened !== undefined) {
      const changes = bodyweightChanges({ kg, date, note }, opened);
      if (Object.keys(changes).length === 0) {
        p.onClose();
        return;
      }
      if (await reportWrite(BODYWEIGHT_PATH, () => editFile(data, (f) => setBodyweightEntry(f, opened.id, changes, data.clock())))) p.onClose();
      return;
    }
    const input = { date, kg, note };
    const ok = await reportWrite(BODYWEIGHT_PATH, async () => {
      if (data.bodyweight.value === undefined) {
        const created = await data.create('bodyweight', BODYWEIGHT_PATH, addBodyweightEntry(emptyBodyweightFile(), input, data.clock(), newId).file);
        // The file appeared meanwhile (a pull, another tab): append to it instead.
        if (created.ok || created.reason !== 'changed') return created;
      }
      return editFile(data, (f) => addBodyweightEntry(f, input, data.clock(), newId).file);
    });
    if (ok) p.onClose();
  });

  const remove = (): Promise<void> => guarded(async () => {
    if (opened === undefined) return;
    const written = await quietWrite(BODYWEIGHT_PATH, () => editFile(data, (f) => deleteBodyweightEntry(f, opened.id, data.clock())));
    if (!written.ok) return;
    p.onClose();
    showToast(
      'Entry deleted',
      { label: 'Undo', run: () => void reportWrite(BODYWEIGHT_PATH, () => editFile(data, (f) => undeleteBodyweightEntry(f, opened.id, data.clock()))) },
      UNDO_MS,
    );
    if (written.heldBackNote) showHeldBack();
  });

  const title = opened === undefined ? 'Add entry' : 'Edit entry';
  if (padOpen) {
    // Every way out of the pad (its Cancel, the sheet's Cancel, swipe, backdrop, Escape) goes back to
    // the form once there is one to go back to, so a typed note or date is never thrown away.
    const leavePad = (): void => (kg === undefined && opened === undefined ? p.onClose() : setPadOpen(false));
    return (
      <Sheet title={title} onClose={leavePad}>
        <p class="bw-sheet__label">Weight in kg</p>
        <NumberPad
          value={kg}
          submitLabel="Use"
          allowZero={false}
          zeroHint="More than 0 kg"
          onSubmit={(v) => { setKg(v); setPadOpen(false); }}
          onCancel={leavePad}
        />
      </Sheet>
    );
  }
  return (
    <Sheet title={title} onClose={p.onClose}>
      <button type="button" class="bw-sheet__kg" aria-label="Weight" onClick={() => setPadOpen(true)}>
        {kg === undefined ? 'kg' : `${formatAmount(kg)} kg`}
      </button>
      <label class="bw-sheet__field">
        <span>Date</span>
        <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
      </label>
      <label class="bw-sheet__field">
        <span>Note</span>
        <input type="text" value={note} autocomplete="off" onInput={(e) => setNote(e.currentTarget.value)} />
      </label>
      {problem !== undefined && <p class="bw-sheet__problem" role="alert">{problem}</p>}
      <div class="bw-sheet__actions">
        {opened !== undefined && <Button kind="danger" disabled={busy.value} onClick={() => void remove()}>Delete</Button>}
        <Button kind="primary" disabled={busy.value || problem !== undefined} onClick={() => void save()}>Save</Button>
      </div>
    </Sheet>
  );
}
```

Create `src/ui/components/more/bodyweight.vm.ts`:

```ts
import type { BodyweightEntry } from '../../../model/types';
import { isCalendarDate } from '../../../model/validate';
import { formatAmount, formatDay } from '../../format';

/** Spec 4 §6 "Bodyweight": the line above the list and the list rows, from plain entries. */
export interface LinePoint { x: number; y: number; date: string; kg: number }
export interface BodyweightLine {
  points: LinePoint[];
  /** 'x1,y1 x2,y2 …' rounded to 1 decimal. */
  polyline: string;
  min: { kg: number; y: number };
  max: { kg: number; y: number };
}
export interface BodyweightRow { entryId: string; day: string; kg: string; note: string | undefined }

const DAY_MS = 86_400_000;

/** Whole days since the epoch for a 'YYYY-MM-DD' (UTC arithmetic, so no DST hour creeps in). */
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / DAY_MS;
}

/** Oldest first: date, then updatedAt, then id (stable). */
function byDate(a: BodyweightEntry, b: BodyweightEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function live(entries: readonly BodyweightEntry[]): BodyweightEntry[] {
  return entries.filter((e) => e.deletedAt === undefined).sort(byDate);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Live entries by date in a `width` × `height` box with `pad` around it; undefined below two
 * entries. x is proportional to days, y is inverted (heavier is higher); equal weights draw a
 * flat line through the middle, and entries all on one day sit in the horizontal middle.
 */
export function bodyweightLine(entries: readonly BodyweightEntry[], width: number, height: number, pad = 8): BodyweightLine | undefined {
  const sorted = live(entries);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length < 2 || first === undefined || last === undefined) return undefined;
  const day0 = dayNumber(first.date);
  const days = dayNumber(last.date) - day0;
  const kgs = sorted.map((e) => e.kg);
  const minKg = Math.min(...kgs);
  const maxKg = Math.max(...kgs);
  const x = (date: string): number => (days === 0 ? width / 2 : pad + ((dayNumber(date) - day0) / days) * (width - 2 * pad));
  const y = (kg: number): number => (maxKg === minKg ? height / 2 : pad + ((maxKg - kg) / (maxKg - minKg)) * (height - 2 * pad));
  const points = sorted.map((e) => ({ x: x(e.date), y: y(e.kg), date: e.date, kg: e.kg }));
  return {
    points,
    polyline: points.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' '),
    min: { kg: minKg, y: y(minKg) },
    max: { kg: maxKg, y: y(maxKg) },
  };
}

/** Live entries, newest first (date, then updatedAt). */
export function bodyweightRows(entries: readonly BodyweightEntry[]): BodyweightRow[] {
  return live(entries)
    .reverse()
    .map((e) => ({ entryId: e.id, day: formatDay(e.date), kg: `${formatAmount(e.kg)} kg`, note: e.note }));
}

/** What the add/edit sheet holds: the kg from the pad, the date field and the note field (untrimmed). */
export interface BodyweightDraft { kg: number | undefined; date: string; note: string }

/**
 * Why the sheet cannot save, or undefined (spec 4 §6: "kg (positive, one decimal)"). The one-decimal
 * rule applies only to a new entry or a changed kg, so a migrated two-decimal entry can still get a
 * new note or date. `opened` is the entry the sheet opened with; undefined when adding.
 */
export function bodyweightProblem(draft: BodyweightDraft, opened: BodyweightEntry | undefined): string | undefined {
  const { kg } = draft;
  if (kg === undefined) return 'Enter the weight';
  if (!Number.isFinite(kg) || kg <= 0) return 'More than 0 kg';
  if ((opened === undefined || kg !== opened.kg) && Number(kg.toFixed(1)) !== kg) return 'One decimal at most';
  if (!isCalendarDate(draft.date)) return 'Pick a date';
  return undefined;
}

/**
 * The fields the owner changed, compared against the values the sheet opened with, so a
 * field another device changed meanwhile is never written back; `{}` when nothing changed. A blank
 * note removes it (`null`); the note is compared trimmed, as the model stores it.
 */
export function bodyweightChanges(
  draft: { kg: number; date: string; note: string },
  opened: BodyweightEntry,
): { date?: string; kg?: number; note?: string | null } {
  const changes: { date?: string; kg?: number; note?: string | null } = {};
  if (draft.date !== opened.date) changes.date = draft.date;
  if (draft.kg !== opened.kg) changes.kg = draft.kg;
  const note = draft.note.trim();
  if (note !== (opened.note ?? '')) changes.note = note === '' ? null : note;
  return changes;
}
```

Replace the whole content of `src/ui/components/shared/NumberPad.tsx` with:

```tsx
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { formatAmount } from '../../format';
import { Button } from './Button';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Parses the typed text; undefined when it is empty or not a number above 0 (at least 0 with `allowZero`). */
function parse(text: string, allowZero: boolean): number | undefined {
  if (text === '' || text === '.') return undefined;
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 || (allowZero && n === 0) ? n : undefined;
}

/**
 * Spec 4 §4 (U8): digits, '.', backspace and the submit button, for decimals (16.5) and jumps (30).
 * It opens empty with the current value as a placeholder, so the first key starts a fresh number
 * (no backspacing over the old value first). `submitLabel` names what the button does where the
 * pad is used
 * ("Add" adds the set, "Use" only sets the value); `allowZero` accepts 0 (a 0 kg external or band load).
 * Without it, a typed 0 shows `zeroHint` (default "More than 0") under the display, so the disabled
 * button has a reason.
 */
export function NumberPad(p: {
  value: number | undefined;
  submitLabel: string;
  allowZero: boolean;
  zeroHint?: string;
  onSubmit(v: number): void;
  onCancel(): void;
}): JSX.Element {
  const [text, setText] = useState('');
  const parsed = parse(text, p.allowZero);
  const typedZero = !p.allowZero && text !== '' && text !== '.' && Number(text) === 0;
  const type = (ch: string): void => {
    if (ch === '.' && text.includes('.')) return;
    setText(text + ch);
  };
  const key = (label: string, onClick: () => void): JSX.Element => (
    <button type="button" class="numpad__key" aria-label={label} onClick={onClick}>{label}</button>
  );
  return (
    <div class="numpad">
      <input
        class="numpad__display"
        type="text"
        inputMode="decimal"
        readOnly
        value={text}
        placeholder={p.value === undefined ? '' : formatAmount(p.value)}
        aria-label="Value"
      />
      {typedZero && <p class="numpad__hint" role="status">{p.zeroHint ?? 'More than 0'}</p>}
      <div class="numpad__keys">
        {DIGITS.map((d) => key(d, () => type(d)))}
        {key('.', () => type('.'))}
        {key('0', () => type('0'))}
        <button type="button" class="numpad__key" aria-label="Backspace" onClick={() => setText(text.slice(0, -1))}>⌫</button>
      </div>
      <div class="numpad__actions">
        <Button kind="secondary" onClick={p.onCancel}>Cancel</Button>
        <Button kind="primary" disabled={parsed === undefined} onClick={() => { if (parsed !== undefined) p.onSubmit(parsed); }}>{p.submitLabel}</Button>
      </div>
    </div>
  );
}
```

Replace the whole content of `src/ui/locked.ts` with:

```ts
import { Value } from '@sinclair/typebox/value';
import { Lenient } from '../model/schema';
import type { BodyweightEntry, Exercise, Session } from '../model/types';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../sync/paths';
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

/** The refused row at `path` when it is only locked for writing (read-only, needs-update: written by
 *  a newer app, read leniently, spec 1/3), never a quarantined file or a duplicate loser. */
function lockedRowAt(rows: readonly FileRow[], path: string): FileRow | undefined {
  return rows.find((r) => r.path === path && r.duplicateOf === undefined && (r.status === 'read-only' || r.status === 'needs-update'));
}

/** Spec 4 §6: the catalog of a read-only exercises.json, shown read-only; undefined when the file is
 *  not locked that way or fails the lenient schema (then only the banner shows). */
export function readOnlyCatalog(rows: readonly FileRow[]): Exercise[] | undefined {
  const content = lockedRowAt(rows, EXERCISES_PATH)?.content;
  return Value.Check(Lenient.ExercisesFile, content) ? (content.exercises as Exercise[]) : undefined;
}

/** Spec 4 §6: the entries of a read-only bodyweight.json, shown read-only; as `readOnlyCatalog`. */
export function readOnlyBodyweight(rows: readonly FileRow[]): BodyweightEntry[] | undefined {
  const content = lockedRowAt(rows, BODYWEIGHT_PATH)?.content;
  return Value.Check(Lenient.BodyweightFile, content) ? (content.entries as BodyweightEntry[]) : undefined;
}
```

Append to `src/ui/theme.css`:

```css
/* Why the submit button is disabled for a typed 0. */
.numpad__hint { margin: -4px 0 0; color: var(--danger); font-size: 14px; text-align: right; }

/* ---- .bw (components/more/BodyweightPage, BodyweightSheet) ---- */
.bw { display: flex; flex-direction: column; gap: 12px; }
.bw__banner { margin: 0; padding: 8px 12px; border-radius: 10px; background: var(--panel); border-left: 3px solid var(--danger); }
.bw__actions { display: flex; justify-content: flex-end; }
.bw__empty { margin: 0; color: var(--muted); }
.bw__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.bw-line { display: block; width: 100%; height: auto; border-radius: 12px; background: var(--panel); }
.bw-line__path { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.bw-line__label { fill: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.bw-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 16px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
}
.bw-row:disabled { cursor: default; }
.bw-row__day { min-width: 7em; color: var(--muted); }
.bw-row__kg { font-variant-numeric: tabular-nums; font-weight: 600; }
.bw-row__note { flex-basis: 100%; color: var(--muted); font-size: 14px; }
.bw-sheet__label { margin: 0; color: var(--muted); }
.bw-sheet__kg {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  text-align: left;
}
.bw-sheet__field { display: flex; flex-direction: column; gap: 4px; color: var(--muted); }
.bw-sheet__field input {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}
.bw-sheet__problem { margin: 0; color: var(--danger); }
.bw-sheet__actions { display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 83 test files and 1177 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/log/outcome.test.ts src/ui/components/log/outcome.ts src/ui/components/more/BodyweightPage.test.tsx src/ui/components/more/BodyweightPage.tsx src/ui/components/more/BodyweightSheet.tsx src/ui/components/more/bodyweight.vm.test.ts src/ui/components/more/bodyweight.vm.ts src/ui/components/shared/NumberPad.test.tsx src/ui/components/shared/NumberPad.tsx src/ui/locked.test.ts src/ui/locked.ts src/ui/theme.css
git commit -m "Add the bodyweight log with its line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Catalog screen and the shared exercise form

The catalog list and the edit page (rename with the clash sheet, archive, delete only without history, metric and per side locked), the create form shared with the Log tab's exercise search, and Restore for a deleted entry (spec 4 §6 "Catalog", spec 1 §3).

**Files:**
- Modify: `src/ui/components/log/ExerciseSearch.test.tsx`
- Modify: `src/ui/components/log/ExerciseSearch.tsx`
- Create: `src/ui/components/more/CatalogPage.test.tsx`
- Modify: `src/ui/components/more/CatalogPage.tsx`
- Modify: `src/ui/components/more/ExerciseEditPage.tsx`
- Modify: `src/ui/components/more/MoreTab.test.tsx`
- Create: `src/ui/components/more/catalog.vm.test.ts`
- Create: `src/ui/components/more/catalog.vm.ts`
- Create: `src/ui/components/shared/ClashSheet.tsx`
- Create: `src/ui/components/shared/ExerciseForm.test.tsx`
- Create: `src/ui/components/shared/ExerciseForm.tsx`
- Create: `src/ui/components/shared/create-clash.test.ts`
- Create: `src/ui/components/shared/create-clash.ts`
- Modify: `src/ui/components/shared/index.ts`
- Modify: `src/ui/locked.test.ts`
- Modify: `src/ui/locked.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/catalog`, `src/model/edit-catalog`, `src/model/schema`, `src/model/types`, `src/sync/paths`, `src/sync/store`, `src/ui/components/log/exercise-search.vm`, `src/ui/components/log/outcome`, `src/ui/components/shared/BackBar`, `src/ui/components/shared/Button`, `src/ui/components/shared/Marks`, `src/ui/components/shared/NumberPad`, `src/ui/components/shared/SetChips`, `src/ui/components/shared/Sheet`, `src/ui/components/shared/Stepper`, `src/ui/components/shared/ToastHost`, `src/ui/context`, `src/ui/data`, `src/ui/toast`.
- Produces:
  - `src/ui/components/log/ExerciseSearch.tsx`:
    - `export function ExerciseSearch(p: { onPick(exerciseId: string): Promise<void>; onClose(): void }): JSX.Element`
  - `src/ui/components/more/CatalogPage.tsx`:
    - `export function CatalogPage(): JSX.Element`
  - `src/ui/components/more/ExerciseEditPage.tsx`:
    - `export function ExerciseEditPage(p: { exerciseId: string }): JSX.Element`
  - `src/ui/components/more/catalog.vm.ts`:
    - `export interface CatalogRow { id: string; name: string; meta: string /* 'pull · reps · per side · bodyweight' (per side only when true) */ }`
    - `export interface CatalogVm { live: { family: string; rows: CatalogRow[] }[]; archived: CatalogRow[]; readOnly: string | undefined /* reason when the catalog row is refused or missing */ }`
    - `export function catalogRefusedReason(refusedRows: readonly FileRow[]): string | undefined`
    - `export function catalogReadOnly(catalog: readonly Exercise[] | undefined, refusedReason: string | undefined): string | undefined`
    - `export function catalogVm(catalog: readonly Exercise[] | undefined, refusedReason: string | undefined): CatalogVm`
    - `export interface ExerciseFormVm`
    - `export function exerciseFormVm(exercise: Exercise, sessions: readonly Session[]): ExerciseFormVm`
  - `src/ui/components/shared/ClashSheet.tsx`:
    - `export function ClashSheet(p: { name: string; detail: string; busy: boolean; onUse(): void; onCancel(): void }): JSX.Element`
  - `src/ui/components/shared/ExerciseForm.tsx`:
    - `export function ExerciseForm(p: { initialName: string; onSave(name: string, fields: NewExerciseFields): void; onCancel(): void }): JSX.Element`
  - `src/ui/components/shared/create-clash.ts`:
    - `export function createClash(existing: Exercise, fields: NewExerciseFields, opts: { askOnRevive: boolean }): string | undefined`
  - `src/ui/locked.ts`:
    - `export interface LockedSession { row: FileRow; session: Session }`
    - `export function lockedSessionRows(rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): LockedSession[]`
    - `export function lockedSessionsOf(rows: readonly FileRow[], okSessionIds: ReadonlySet<string> = new Set()): Session[]`
    - `export function sessionsWithLocked(live: readonly Session[], rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): Session[]`
    - `export function readOnlyCatalog(rows: readonly FileRow[]): Exercise[] | undefined`
    - `export function readOnlyBodyweight(rows: readonly FileRow[]): BodyweightEntry[] | undefined`

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `src/ui/components/log/ExerciseSearch.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercise, session } from '../../../model/test-fixtures';
import type { Exercise, ExercisesFile, FileKind, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import type { FileOf, WriteOutcome } from '../../data';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push', family: 'push-up' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const OLD = exercise({ id: 'kipping-pull-ups', name: 'Kipping Pull-ups', pattern: 'pull', family: 'pull-up', archived: true });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session => session([], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mount(today: Session, exercises: Exercise[] | undefined) {
  const m = await setup({ now: NOW, sessions: [today], exercises, meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Other exercise…' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Other exercise…' }));
  const sheet = screen.getByRole('dialog', { name: 'Exercise' });
  return { ...m, sheet };
}

const search = (sheet: HTMLElement, text: string): void => {
  fireEvent.input(within(sheet).getByRole('textbox', { name: 'Search exercises' }), { target: { value: text } });
};

describe('ExerciseSearch', () => {
  it('lists live entries by name as typed, archived ones in their own group; picking one adds a block and makes it current', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    search(sheet, 'pull');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Push-ups' })).toBeNull());
    expect(within(sheet).getByText('Archived (1)')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Create/ })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Pull-ups' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups']));
    const added = (await fileAt(store, pathOf(today))).session.blocks[0];
    await waitFor(() => expect(currentBlockId.value).toBe(added?.id));
    expect(screen.queryByRole('dialog', { name: 'Exercise' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Entry' }).textContent).toContain('Pull-ups · set 1'));
  });

  it('Create writes the catalog before the session, and the block references the new id', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    expect((within(form).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ring Rows');
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'pull' } });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Family' }), { target: { value: 'row' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks).toHaveLength(1));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([EXERCISES_PATH, pathOf(today)]);
    const catalog = (await store.getRow(EXERCISES_PATH))?.content as ExercisesFile;
    const created = catalog.exercises.find((e) => e.name === 'Ring Rows');
    expect(created).toMatchObject({
      id: 'ring-rows', pattern: 'pull', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: 'row', archived: false, updatedAt: NOW.toISOString(),
    });
    const added = (await fileAt(store, pathOf(today))).session.blocks[0];
    expect(added?.exerciseId).toBe('ring-rows');
    await waitFor(() => expect(currentBlockId.value).toBe(added?.id));
  });

  it('a name that exists already uses that entry and writes no catalog', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Rows”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: ' pull-UPS ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups']));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([pathOf(today)]);
  });

  it('Create on the name of a deleted entry undeletes it, writes the catalog first and adds its block', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', pattern: 'pull', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, gone]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'ring rows');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Ring Rows' })).toBeNull());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “ring rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['ring-rows']));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([EXERCISES_PATH, pathOf(today)]);
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.filter((e) => e.name.toLowerCase() === 'ring rows')).toHaveLength(1);
    const revived = catalog.find((e) => e.id === 'ring-rows');
    expect(revived?.deletedAt).toBeUndefined();
    expect(revived?.updatedAt).toBe(NOW.toISOString());
  });

  it('Create on the name of an archived entry unarchives it and adds its block', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    search(sheet, 'Kipping Pull-ups');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Kipping Pull-ups”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['kipping-pull-ups']));
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.find((e) => e.id === 'kipping-pull-ups')).toMatchObject({ archived: false, updatedAt: NOW.toISOString() });
  });

  it('Create on an archived name with another metric writes nothing and asks; Cancel keeps the form, Use it adds the existing entry', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Kipping Pull-ups');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Kipping Pull-ups”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Metric' }), { target: { value: 'seconds' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));

    const clash = await screen.findByRole('dialog', { name: 'An exercise named “Kipping Pull-ups” exists' });
    expect(within(clash).getByText('It is archived, measured in reps, not seconds. Use it as it is, or cancel and pick another name for the new one.')).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(clash).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /exists/ })).toBeNull());
    const again = screen.getByRole('dialog', { name: 'New exercise' });
    expect((within(again).getByRole('combobox', { name: 'Metric' }) as HTMLSelectElement).value).toBe('seconds');

    fireEvent.click(within(again).getByRole('button', { name: 'Create exercise' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'An exercise named “Kipping Pull-ups” exists' })).getByRole('button', { name: 'Use it' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['kipping-pull-ups']));
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.find((e) => e.id === 'kipping-pull-ups')).toMatchObject({ archived: false, metric: 'reps' });
    expect(catalog).toHaveLength(3);
  });

  it("a held-back catalog write keeps its note when the session write shows a toast of its own", async () => {
    const today = openToday();
    const { data, sheet } = await mount(today, [PUSH, PULL]);
    const edit = data.edit.bind(data);
    vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> => {
      if (kind !== 'exercises') return { ok: false, reason: 'changed' };
      const r = await edit(kind, path, fn);
      return r.ok ? { ok: true, heldBack: true } : r;
    });
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));
    await waitFor(() => expect(toast.value?.text).toBe('Changed elsewhere, try again · Saved here, not uploaded (app bug)'));
  });
  it('a double tap on Create exercise adds one block', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    const create = within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(currentBlockId.value).toBeDefined());
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks).toHaveLength(1);
  });

  // The quiet-session case is in ExerciseSearch.held-back.test.tsx: the once-per-path note for
  // exercises.json is module state, so that case needs a module of its own.

  it('without a catalog, Create is disabled with the reason', async () => {
    const today = openToday();
    const { sheet } = await mount(today, undefined);
    search(sheet, 'Ring Rows');
    await waitFor(() => expect(within(sheet).getByText('catalog not available')).toBeTruthy());
    expect((within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

Create `src/ui/components/more/CatalogPage.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, session, sessionFile, set } from '../../../model/test-fixtures';
import type { Exercise, ExercisesFile, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { pathOf, renderIn, setup } from '../../test-harness';
import { dismissToast, toast } from '../../toast';
import { ToastHost } from '../shared';
import { MoreTab } from './MoreTab';

const NOW = new Date('2030-03-10T08:00:00.000Z');
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const CHIN = exercise({ id: 'chin-ups', name: 'Chin-ups', pattern: 'pull', family: 'pull-up' });
const LUNGE = exercise({ id: 'lunges', name: 'Lunges', pattern: 'legs', perSide: true, defaultLoadType: 'external' });
const OLD = exercise({ id: 'kipping', name: 'Kipping', archived: true });

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
});

async function mount(input: { exercises: Exercise[] | undefined; sessions?: Session[]; id?: string }) {
  const m = await setup({ now: NOW, sessions: input.sessions ?? [], exercises: input.exercises });
  m.deps.router.navigate(input.id === undefined ? { tab: 'more', page: 'catalog' } : { tab: 'more', page: 'catalog', id: input.id });
  renderIn(m.deps, <><MoreTab /><ToastHost /></>);
  const catalog = async (): Promise<Exercise[]> => ((await m.store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
  return { ...m, router: m.deps.router, catalog };
}

describe('CatalogPage', () => {
  it('lists live entries by family with their meta, archived ones below; a row opens its edit page', async () => {
    const { router } = await mount({ exercises: [PULL, LUNGE, OLD, CHIN] });
    const live = screen.getByRole('list', { name: 'pull-up' });
    const rows = within(live).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Chin-ups')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('pull · reps · bodyweight')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Pull-ups')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /Lunges/ })).getByText('legs · reps · per side · external')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Archived' })).getByRole('button', { name: /Kipping/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pull-ups/ }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'pull-ups' });
  });

  it('Create opens the shared form in a sheet and writes a new entry', async () => {
    const { catalog, router } = await mount({ exercises: [PULL] });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Ring Rows' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'pull' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(async () => expect((await catalog()).map((e) => e.id)).toEqual(['pull-ups', 'ring-rows']));
    expect((await catalog())[1]).toEqual({
      id: 'ring-rows', name: 'Ring Rows', pattern: 'pull', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', archived: false, updatedAt: NOW.toISOString(),
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New exercise' })).toBeNull());
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'ring-rows' });
  });

  it('Create with a name that exists writes nothing and opens that entry', async () => {
    const { store, router } = await mount({ exercises: [PULL] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: ' pull-UPS' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'pull-ups' }));
    expect(writes).not.toHaveBeenCalled();
  });

  it('Create on a deleted name with another metric writes nothing and asks; Use it brings the entry back as it was', async () => {
    const plank = exercise({ id: 'plank', name: 'Plank', pattern: 'core', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const { store, catalog, router } = await mount({ exercises: [PULL, plank] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Plank' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Metric' }), { target: { value: 'seconds' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));

    const clash = await screen.findByRole('dialog', { name: 'An exercise named “Plank” exists' });
    expect(within(clash).getByText('It is deleted, measured in reps, not seconds. Use it as it is, or cancel and pick another name for the new one.')).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(clash).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /exists/ })).toBeNull());
    expect((within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Plank');
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog' });

    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'An exercise named “Plank” exists' })).getByRole('button', { name: 'Use it' }));
    const { deletedAt: _deletedAt, ...alive } = plank;
    await waitFor(async () => expect((await catalog())[1]).toEqual({ ...alive, updatedAt: NOW.toISOString() }));
    expect(await catalog()).toHaveLength(2);
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'plank' }));
  });

  it('Create on an archived name with the same metric asks before bringing it back', async () => {
    const { store, catalog, router } = await mount({ exercises: [PULL, OLD] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'kipping' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    const clash = await screen.findByRole('dialog', { name: 'An exercise named “Kipping” exists' });
    expect(within(clash).getByText('It is archived. Use it to bring it back.')).toBeTruthy();
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(clash).getByRole('button', { name: 'Use it' }));
    await waitFor(async () => expect((await catalog())[1]).toEqual({ ...OLD, archived: false, updatedAt: NOW.toISOString() }));
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'kipping' }));
  });

  it('a double tap on Create exercise writes one entry', async () => {
    const { store, catalog } = await mount({ exercises: [PULL] });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'Ring Rows' } });
    const create = within(form).getByRole('button', { name: 'Create exercise' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(async () => expect((await catalog()).map((e) => e.id)).toEqual(['pull-ups', 'ring-rows']));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a read-only catalog (written by a newer app) still lists its entries, without edit controls', async () => {
    const m = await mount({ exercises: [PULL] });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: { ...exercisesFile([PULL, OLD]), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exercises.json is needs-update; the catalog cannot be changed here. See the Sync tab.'));
    const live = screen.getByRole('list', { name: 'pull-up' });
    expect(within(live).getByText('Pull-ups')).toBeTruthy();
    expect(within(live).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Archived' })).getByText('Kipping')).toBeTruthy();
    expect(screen.queryByText('No exercises yet.')).toBeNull();
  });

  it('a quarantined catalog shows the banner only, not "No exercises yet."', async () => {
    const m = await mount({ exercises: [PULL] });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([PULL]), status: 'quarantined', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Pull-ups')).toBeNull();
    expect(screen.queryByText('No exercises yet.')).toBeNull();
  });

  it('without a catalog the screen is read-only with a banner and Create disabled', async () => {
    await mount({ exercises: undefined });
    expect(screen.getByRole('alert').textContent).toBe('The exercise catalog is not here yet; it arrives with the first sync.');
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with the catalog row quarantined the banner names the reason', async () => {
    const m = await mount({ exercises: [PULL] });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([PULL]), status: 'quarantined', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exercises.json is quarantined; the catalog cannot be changed here. See the Sync tab.'));
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ExerciseEditPage', () => {
  const used = (): Session => session([block([set()], { exerciseId: 'pull-ups' })], { date: '2030-03-07' });

  it('shows metric and per side locked, without controls for them', async () => {
    await mount({ exercises: [LUNGE], id: 'lunges' });
    expect(screen.queryByRole('combobox', { name: 'Metric' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Per side' })).toBeNull();
    expect(screen.getByText('fixed at creation; create a new exercise instead')).toBeTruthy();
    const locked = screen.getByRole('group', { name: 'Fixed at creation' });
    expect(within(locked).getByText('reps')).toBeTruthy();
    expect(within(locked).getByText('yes')).toBeTruthy();
  });

  it('rename writes the catalog with the same id, only the changed field, and goes back to the catalog', async () => {
    const { catalog, router } = await mount({ exercises: [PULL, CHIN], id: 'pull-ups' });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Pull-ups');
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Strict Pull-ups' } });
    fireEvent.input(screen.getByRole('textbox', { name: 'Cues' }), { target: { value: 'hollow body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await catalog())[0]).toEqual({ ...PULL, name: 'Strict Pull-ups', cues: 'hollow body', updatedAt: NOW.toISOString() }));
    expect((await catalog())[1]).toEqual(CHIN);
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog' }));
  });

  it('a rename clash writes nothing and offers the other entry', async () => {
    const { store, router } = await mount({ exercises: [PULL, CHIN], id: 'pull-ups' });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'chin-UPS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “Chin-ups” exists' });
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use it' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'chin-ups' });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Chin-ups'));
  });

  it('the clash sheet’s Cancel keeps the typed name', async () => {
    await mount({ exercises: [PULL, CHIN], id: 'pull-ups' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chin-ups' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “Chin-ups” exists' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Chin-ups');
  });

  it('Archive archives the entry, Unarchive brings it back', async () => {
    const { catalog } = await mount({ exercises: [PULL], sessions: [used()], id: 'pull-ups' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(async () => expect((await catalog())[0]).toEqual({ ...PULL, archived: true, updatedAt: NOW.toISOString() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive' }));
    await waitFor(async () => expect((await catalog())[0]?.archived).toBe(false));
  });

  it('a referenced exercise offers no Delete, only the reason', async () => {
    await mount({ exercises: [PULL], sessions: [used()], id: 'pull-ups' });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText('used in 1 session; archive instead')).toBeTruthy();
  });

  it('Delete tombstones an unreferenced exercise, goes back to the catalog, and Undo restores it', async () => {
    const { catalog, router } = await mount({ exercises: [PULL, CHIN], sessions: [used()], id: 'chin-ups' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await catalog())[1]).toEqual({ ...CHIN, updatedAt: NOW.toISOString(), deletedAt: NOW.toISOString() }));
    await waitFor(() => expect(router.route.value).toEqual({ tab: 'more', page: 'catalog' }));
    expect(toast.value?.text).toBe('Exercise deleted');
    expect(toast.value?.ms).toBe(6000);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await catalog())[1]).not.toHaveProperty('deletedAt'));
  });

  it('a rename to the name of a deleted entry writes nothing; Use it opens that entry, which offers Restore (spec 1 §3)', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const { store, catalog, router } = await mount({ exercises: [PULL, gone], id: 'pull-ups' });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'ring ROWS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “Ring Rows” exists' });
    expect(writes).not.toHaveBeenCalled();
    expect(within(sheet).getByText('Names are unique in the catalog, deleted ones included. Open that exercise to restore it, or cancel and pick another name.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use it' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'ring-rows' });
    await waitFor(() => expect(screen.getByText('This exercise was deleted. Restore it to edit.')).toBeTruthy());
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ring Rows');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await catalog())[1]).not.toHaveProperty('deletedAt'));
    expect((await catalog())[0]).toEqual(PULL);
  });

  it('a session on a read-only row that uses the exercise keeps Delete away (spec 1 §3)', async () => {
    const s = used();
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'read-only', issues: [], version: 1 });
    await act(async () => { await m.data.refresh(pathOf(s)); });
    await waitFor(() => expect(screen.getByText('used in 1 session; archive instead')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('Delete refuses at write time when a locked session that uses the exercise arrived meanwhile', async () => {
    const s = used();
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    const del = screen.getByRole('button', { name: 'Delete' });
    // The row arrives in the store, but the page has not re-rendered yet when the owner taps.
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    m.data.refusedRows.value = [...m.data.refusedRows.value, { path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 }];
    fireEvent.click(del);
    await waitFor(() => expect(toast.value?.text).toBe('Pull-ups is used in 1 session; archive it instead'));
    expect((await m.catalog())[0]).toEqual(PULL);
  });

  it('a deleted exercise shows its fields read-only with Restore only; Restore makes it editable', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const { catalog } = await mount({ exercises: [PULL, gone], id: 'ring-rows' });
    expect(screen.getByText('This exercise was deleted. Restore it to edit.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Pattern' }) as HTMLSelectElement).disabled).toBe(true);
    for (const name of ['Save', 'Archive', 'Unarchive', 'Delete']) expect(screen.queryByRole('button', { name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await catalog())[1]).not.toHaveProperty('deletedAt'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy());
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('Restore when a live entry took the name meanwhile writes nothing and offers that entry (spec 1 §3)', async () => {
    // Another device named Rows "ring rows" offline before it saw the delete (the race spec 1 §3 accepts).
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const rows = exercise({ id: 'rows', name: 'ring rows' });
    const { store, router } = await mount({ exercises: [gone, rows], id: 'ring-rows' });
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const sheet = await screen.findByRole('dialog', { name: 'An exercise named “ring rows” exists' });
    expect(writes).not.toHaveBeenCalled();
    expect(within(sheet).getByText('Names are unique in the catalog. Rename that one to restore this one, or open it.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use it' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'rows' });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('ring rows'));
  });

  it('Undo of a delete when another entry took the name meanwhile writes nothing and offers that entry', async () => {
    const { catalog, router, data } = await mount({ exercises: [PULL, CHIN], id: 'chin-ups' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toast.value?.text).toBe('Exercise deleted'));
    // Before Undo, a merge from another device that renamed Pull-ups offline (it had not seen the
    // delete) brings the deleted entry's name: the race spec 1 §3 accepts. A rename here would clash.
    await act(async () => {
      await data.edit('exercises', EXERCISES_PATH, (f) => ({
        ...f,
        exercises: f.exercises.map((e) => (e.id === 'pull-ups' ? { ...e, name: 'Chin-ups', updatedAt: '2030-03-10T08:00:00.001Z' } : e)),
      }));
    });
    const before = await catalog();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(toast.value?.text).toBe('Not restored: an exercise named “Chin-ups” exists'));
    expect(await catalog()).toEqual(before);
    expect(before.filter((e) => e.deletedAt === undefined).map((e) => e.id)).toEqual(['pull-ups']);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(router.route.value).toEqual({ tab: 'more', page: 'catalog', id: 'pull-ups' });
  });

  it('a double tap on Save or Archive writes once', async () => {
    const { store } = await mount({ exercises: [PULL], id: 'pull-ups' });
    const writes = vi.spyOn(store, 'writeFile');
    const archive = screen.getByRole('button', { name: 'Archive' });
    fireEvent.click(archive);
    fireEvent.click(archive);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy());
    expect(writes).toHaveBeenCalledTimes(1);
    writes.mockClear();
    fireEvent.input(screen.getByRole('textbox', { name: 'Cues' }), { target: { value: 'hollow body' } });
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a refused write leaves Save enabled again', async () => {
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Cues' }), { target: { value: 'hollow body' } });
    vi.spyOn(m.data, 'edit').mockResolvedValue({ ok: false, reason: 'quarantined' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('This file is read-only (quarantined)'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('without a catalog the form is read-only with the banner', async () => {
    const m = await mount({ exercises: [PULL], id: 'pull-ups' });
    await m.store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([PULL]), status: 'read-only', issues: [], version: 2 });
    await act(async () => { await m.data.refresh(EXERCISES_PATH); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exercises.json is read-only; the catalog cannot be changed here. See the Sync tab.'));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
```

Replace the whole content of `src/ui/components/more/MoreTab.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { formatAmount, formatDay } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { MoreTab } from './MoreTab';

function fakeWindow(hash: string): RouterWindow {
  const win: RouterWindow = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const older = session([block(ladder([5, 4]), { exerciseId: 'pull-ups' })], { date: '2030-03-01' });
const newer = session([block(ladder([8, 7]), { exerciseId: 'pull-ups' }), block(ladder([3]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-04' });

async function mount(hash: string, sessions: Session[] = [older, newer]) {
  const store = new Store(await openDb(new IDBFactory()));
  const data = new Data({ store, now: () => new Date('2030-03-05T10:00:00.000Z') });
  await data.load();
  await data.create('exercises', EXERCISES_PATH, exercisesFile([
    exercise({ id: 'pull-ups', name: 'Pull-ups', family: 'Pull-up' }),
    exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
    exercise({ id: 'rows', name: 'Rows', archived: true }),
  ]));
  for (const s of sessions) await data.create('session', sessionPath(s.date, s.id), sessionFile(s));
  await data.refresh(EXERCISES_PATH);
  for (const s of sessions) await data.refresh(sessionPath(s.date, s.id));
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow(hash));
  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><MoreTab /></AppContext.Provider>);
  return { data, router };
}

describe('MoreTab', () => {
  it('shows the menu and each entry navigates to its page', async () => {
    const { router } = await mount('#/more');
    for (const [label, page] of [['Exercises', 'exercises'], ['Calendar', 'calendar'], ['Bodyweight', 'bodyweight'], ['Catalog', 'catalog']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(router.route.value).toEqual({ tab: 'more', page });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(router.route.value).toEqual({ tab: 'more' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Exercises' })).toBeTruthy());
    }
  });

  it('the catalog route with an id shows the exercise edit page', async () => {
    await mount('#/more/catalog/pull-ups');
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Pull-ups');
  });

  it('the exercise route without an id shows the exercise list', async () => {
    await mount('#/more/exercise');
    expect(screen.getByRole('button', { name: /Pull-ups/ }).textContent).toContain(formatDay('2030-03-04'));
  });

  it('lists exercises by family with the last date, archived ones apart, and opens the history', async () => {
    const { router } = await mount('#/more/exercises');
    expect(screen.getByText('Pull-up')).toBeTruthy();
    const pullUps = screen.getByRole('button', { name: /Pull-ups/ });
    expect(pullUps.textContent).toContain(formatDay('2030-03-04'));
    const archived = screen.getByText('Archived').closest('details');
    expect(archived?.open).toBe(false);
    expect(archived?.textContent).toContain('Rows');
    fireEvent.click(pullUps);
    expect(router.route.value).toEqual({ tab: 'more', page: 'exercise', id: 'pull-ups' });
  });

  it('lists the history rows of an exercise, and a row opens its session', async () => {
    const { router } = await mount('#/more/exercise/pull-ups');
    expect(screen.getByRole('heading', { name: 'Pull-ups' })).toBeTruthy();
    const rows = screen.getAllByRole('button', { name: /sets/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(formatDay('2030-03-04'));
    expect(rows[0]?.textContent).toContain(`${formatAmount(15)} · 2 sets`);
    expect(rows[0]?.querySelector('[aria-label="more"]')).toBeTruthy();
    fireEvent.click(rows[1] as HTMLElement);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: older.id });
  });

  it('numbers a second run in one session', async () => {
    const twice = session([block(ladder([6]), { exerciseId: 'pull-ups' }), block(ladder([4]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-02' });
    await mount('#/more/exercise/pull-ups', [twice]);
    expect(screen.getByText('run 2')).toBeTruthy();
    expect(screen.queryByText('run 1')).toBeNull();
  });
});
```

Create `src/ui/components/more/catalog.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { T0, block, exercise, session, set } from '../../../model/test-fixtures';
import type { FileRow } from '../../../sync/store';
import { EXERCISES_PATH } from '../../../sync/paths';
import { catalogRefusedReason, catalogVm, exerciseFormVm } from './catalog.vm';

const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const CHIN = exercise({ id: 'chin-ups', name: 'Chin-ups', pattern: 'pull', family: 'pull-up' });
const LUNGE = exercise({ id: 'lunges', name: 'Lunges', pattern: 'legs', perSide: true, defaultLoadType: 'external' });
const PLANK = exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds', family: 'core' });
const OLD = exercise({ id: 'kipping', name: 'Kipping', archived: true, family: 'pull-up' });
const AARDVARK = exercise({ id: 'aardvark', name: 'Aardvark', archived: true });
const GONE = exercise({ id: 'ring-rows', name: 'Ring Rows', deletedAt: T0 });

describe('catalogVm', () => {
  it('groups live entries by family (the name when none), sorted, with archived entries apart by name and tombstones left out', () => {
    const vm = catalogVm([PULL, LUNGE, OLD, PLANK, CHIN, GONE, AARDVARK], undefined);
    expect(vm.live.map((g) => [g.family, g.rows.map((r) => r.id)])).toEqual([
      ['core', ['plank']],
      ['Lunges', ['lunges']],
      ['pull-up', ['chin-ups', 'pull-ups']],
    ]);
    expect(vm.archived.map((r) => r.id)).toEqual(['aardvark', 'kipping']);
    expect(vm.readOnly).toBeUndefined();
  });

  it('meta reads pattern · metric · per side (only when true) · default load type', () => {
    const vm = catalogVm([PULL, LUNGE, PLANK], undefined);
    const rows = vm.live.flatMap((g) => g.rows);
    expect(rows.find((r) => r.id === 'pull-ups')).toEqual({ id: 'pull-ups', name: 'Pull-ups', meta: 'pull · reps · bodyweight' });
    expect(rows.find((r) => r.id === 'lunges')?.meta).toBe('legs · reps · per side · external');
    expect(rows.find((r) => r.id === 'plank')?.meta).toBe('core · seconds · bodyweight');
  });

  it('is read-only with the reason when the catalog row is refused, and when it is missing', () => {
    const refused = catalogVm(undefined, 'quarantined');
    expect(refused).toEqual({ live: [], archived: [], readOnly: 'exercises.json is quarantined; the catalog cannot be changed here. See the Sync tab.' });
    const missing = catalogVm(undefined, undefined);
    expect(missing.readOnly).toBe('The exercise catalog is not here yet; it arrives with the first sync.');
  });
});

describe('exerciseFormVm', () => {
  it('holds the editable fields as text, metric and per side locked', () => {
    const withCues = exercise({ ...LUNGE, cues: 'knee over toe' });
    expect(exerciseFormVm(withCues, [])).toEqual({
      name: 'Lunges', family: '', pattern: 'legs', defaultLoadType: 'external', cues: 'knee over toe',
      metric: 'reps', perSide: true, locked: true, archived: false, canDelete: true, deleteReason: undefined,
    });
    expect(exerciseFormVm(PULL, [])).toMatchObject({ family: 'pull-up', cues: '' });
  });

  it('cannot delete an entry used by live blocks of live sessions, and says in how many sessions', () => {
    const one = session([block([set()], { exerciseId: 'pull-ups' }), block([set()], { exerciseId: 'pull-ups' })]);
    const two = session([block([set()], { exerciseId: 'pull-ups' })]);
    const deleted = session([block([set()], { exerciseId: 'pull-ups' })], { deletedAt: T0 });
    expect(exerciseFormVm(PULL, [one, two, deleted])).toMatchObject({ canDelete: false, deleteReason: 'used in 2 sessions; archive instead' });
    expect(exerciseFormVm(PULL, [one])).toMatchObject({ canDelete: false, deleteReason: 'used in 1 session; archive instead' });
    const deadBlock = session([block([set()], { exerciseId: 'pull-ups', deletedAt: T0 })]);
    expect(exerciseFormVm(PULL, [deadBlock, deleted])).toMatchObject({ canDelete: true, deleteReason: undefined });
  });

  it('carries the archived state', () => {
    expect(exerciseFormVm(OLD, []).archived).toBe(true);
  });
});

describe('catalogRefusedReason', () => {
  const row = (over: Partial<FileRow>): FileRow => ({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: {}, status: 'ok', issues: [], version: 1, ...over });

  it('names the status of the refused catalog row, a duplicate as such, and nothing for other rows', () => {
    expect(catalogRefusedReason([row({ status: 'quarantined' })])).toBe('quarantined');
    expect(catalogRefusedReason([row({ status: 'needs-update' })])).toBe('needs-update');
    expect(catalogRefusedReason([row({ duplicateOf: '/other.json' })])).toBe('a duplicate');
    expect(catalogRefusedReason([row({ path: '/bodyweight.json', kind: 'bodyweight', status: 'quarantined' })])).toBeUndefined();
    expect(catalogRefusedReason([])).toBeUndefined();
  });
});
```

Create `src/ui/components/shared/ExerciseForm.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseForm } from './ExerciseForm';

describe('ExerciseForm', () => {
  it('prefills the name and hands the trimmed name and the chosen fields to onSave', () => {
    const onSave = vi.fn();
    render(<ExerciseForm initialName="Ring Rows" onSave={onSave} onCancel={vi.fn()} />);
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    const name = within(form).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Ring Rows');
    fireEvent.input(name, { target: { value: '  Ring Dips ' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'push' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Metric' }), { target: { value: 'seconds' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Per side' }));
    fireEvent.change(within(form).getByRole('combobox', { name: 'Default load' }), { target: { value: 'added' } });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Family' }), { target: { value: ' dip ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    expect(onSave).toHaveBeenCalledWith('Ring Dips', { pattern: 'push', metric: 'seconds', perSide: true, defaultLoadType: 'added', family: 'dip' });
  });

  it('defaults to other · reps · not per side · bodyweight without a family', () => {
    const onSave = vi.fn();
    render(<ExerciseForm initialName="Rows" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create exercise' }));
    expect(onSave).toHaveBeenCalledWith('Rows', { pattern: 'other', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight' });
  });

  it('disables Create for a blank name; Cancel calls onCancel', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ExerciseForm initialName="  " onSave={onSave} onCancel={onCancel} />);
    const create = screen.getByRole('button', { name: 'Create exercise' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/ui/components/shared/create-clash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { NewExerciseFields } from '../../../model/catalog';
import { exercise } from '../../../model/test-fixtures';
import { createClash } from './create-clash';

const REPS: NewExerciseFields = { pattern: 'core', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight' };
const SECONDS: NewExerciseFields = { ...REPS, metric: 'seconds' };

describe('createClash', () => {
  it('asks nothing for a live entry with the same metric and per side', () => {
    expect(createClash(exercise({ name: 'Plank' }), REPS, { askOnRevive: true })).toBeUndefined();
  });

  it('names a metric or per-side difference, whatever the entry state', () => {
    expect(createClash(exercise({ name: 'Plank' }), SECONDS, { askOnRevive: false })).toBe(
      'It is measured in reps, not seconds. Use it as it is, or cancel and pick another name for the new one.',
    );
    expect(createClash(exercise({ name: 'Plank', perSide: true }), REPS, { askOnRevive: false })).toBe(
      'It is per side. Use it as it is, or cancel and pick another name for the new one.',
    );
    expect(createClash(exercise({ name: 'Plank', archived: true, perSide: true }), { ...SECONDS, perSide: false }, { askOnRevive: false })).toBe(
      'It is archived, measured in reps, not seconds, per side. Use it as it is, or cancel and pick another name for the new one.',
    );
    expect(createClash(exercise({ name: 'Plank' }), { ...REPS, perSide: true }, { askOnRevive: false })).toBe(
      'It is not per side. Use it as it is, or cancel and pick another name for the new one.',
    );
  });

  it('with askOnRevive, asks before bringing back an archived or deleted entry even when it matches', () => {
    expect(createClash(exercise({ name: 'Plank', archived: true }), REPS, { askOnRevive: true })).toBe('It is archived. Use it to bring it back.');
    expect(createClash(exercise({ name: 'Plank', deletedAt: '2030-01-01T10:00:00.000Z' }), REPS, { askOnRevive: true })).toBe(
      'It is deleted. Use it to bring it back.',
    );
    expect(createClash(exercise({ name: 'Plank', archived: true }), REPS, { askOnRevive: false })).toBeUndefined();
  });
});
```

Replace the whole content of `src/ui/locked.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { block, bodyweight, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile } from '../model/test-fixtures';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../sync/paths';
import type { FileRow } from '../sync/store';
import { lockedSessionRows, lockedSessionsOf, readOnlyBodyweight, readOnlyCatalog, sessionsWithLocked } from './locked';

describe('readOnlyCatalog and readOnlyBodyweight', () => {
  const catalogRow = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
    path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content, status: 'read-only', issues: [], version: 1, ...over,
  });
  const bodyRow = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
    path: BODYWEIGHT_PATH, kind: 'bodyweight', rev: 'r1', content, status: 'needs-update', issues: [], version: 1, ...over,
  });

  it('give the lenient content of a read-only or needs-update file (spec 4 §6: shown read-only)', () => {
    const e = exercise({ id: 'dips', name: 'Dips' });
    expect(readOnlyCatalog([catalogRow({ ...exercisesFile([e]), schemaVersion: 99, extra: true })])).toEqual([e]);
    expect(readOnlyCatalog([catalogRow(exercisesFile([e]), { status: 'needs-update' })])).toEqual([e]);
    const b = bodyweight({ kg: 80 });
    expect(readOnlyBodyweight([bodyRow(bodyweightFile([b]))])).toEqual([b]);
    expect(readOnlyBodyweight([bodyRow(bodyweightFile([b]), { status: 'read-only' })])).toEqual([b]);
  });

  it('give nothing for a quarantined or duplicate row, content that does not parse, or no row', () => {
    const e = exercise();
    expect(readOnlyCatalog([catalogRow(exercisesFile([e]), { status: 'quarantined' })])).toBeUndefined();
    expect(readOnlyCatalog([catalogRow(exercisesFile([e]), { duplicateOf: '/other.json' })])).toBeUndefined();
    expect(readOnlyCatalog([catalogRow({ schemaVersion: 1, exercises: 'no' })])).toBeUndefined();
    expect(readOnlyCatalog([])).toBeUndefined();
    expect(readOnlyBodyweight([bodyRow({ schemaVersion: 1, entries: [{ id: 'x' }] })])).toBeUndefined();
    expect(readOnlyBodyweight([bodyRow(bodyweightFile([bodyweight()]), { status: 'quarantined' })])).toBeUndefined();
  });
});

describe('sessionsWithLocked', () => {
  it('adds the locked sessions to the live ones, leaving out ids an ok row holds', () => {
    const live = session([block(ladder([5]))], { date: '2030-03-04' });
    const locked = session([block(ladder([6]))], { date: '2030-03-05' });
    const shadow = session([block(ladder([7]))], { id: live.id, date: '2030-03-04' });
    const rows = [
      row(sessionFile(locked), { status: 'read-only' }),
      row(sessionFile(shadow), { path: '/sessions/2030/2030-03-04_other.json', status: 'needs-update' }),
    ];
    expect(sessionsWithLocked([live], rows, new Set([live.id]))).toEqual([live, locked]);
  });
});

const row = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
  path: '/sessions/2030/2030-03-04_00000000.json', kind: 'session', rev: 'r1', content, status: 'quarantined', issues: [], version: 1, ...over,
});

describe('lockedSessionsOf', () => {
  it('takes the session of refused session rows whose content parses as a session', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    expect(lockedSessionsOf([row(sessionFile(s))])).toEqual([s]);
  });

  it('skips rows of other kinds and content that is not a session', () => {
    expect(lockedSessionsOf([
      row({ schemaVersion: 1 }),
      row({ session: 'nope' }),
      row({ session: { id: 'x', date: '2030-03-04' } }),
      row({ session: { id: 'x', date: '2030-03-04', blocks: 'no' } }),
      row({ session: { id: 'x', date: '2030-03-04', tags: [], blocks: [{ id: 'b', exerciseId: 'dips' }] } }),
      row(null),
      row({ schemaVersion: 1, exercises: [] }, { kind: 'exercises', path: '/exercises.json' }),
    ])).toEqual([]);
  });

  it('skips a session the page could not render: tags missing, or a set without a numeric amount', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const { tags: _tags, ...noTags } = s;
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noTags })])).toEqual([]);
    const noAmount = { ...s, blocks: [{ ...s.blocks[0], sets: [{ id: 'x', order: 0 }] }] };
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noAmount })])).toEqual([]);
  });

  it('checks the lenient session schema: a wrong label, a non-string tag or a bad load type keeps the file off the list', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const file = sessionFile(s);
    const b0 = s.blocks[0];
    const set0 = b0?.sets[0];
    if (b0 === undefined || set0 === undefined) throw new Error('fixture');
    for (const bad of [
      { ...s, label: 5 },
      { ...s, label: null },
      { ...s, label: 'Push' },
      { ...s, tags: ['ok', 7] },
      { ...s, notes: { text: 'x' } },
      { ...s, blocks: [{ ...b0, sets: [{ ...set0, loadType: 'chains' }] }] },
    ]) {
      expect(lockedSessionsOf([row({ ...file, session: bad })])).toEqual([]);
    }
  });

  it('lists a file a newer app wrote (unknown fields, newer schemaVersion) and one that fails only a hard rule', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const newer = { schemaVersion: 99, session: { ...s, mood: 'good' } };
    expect(lockedSessionsOf([row(newer, { status: 'needs-update' })])).toEqual([newer.session]);
    // 30 February matches the date pattern; only the hard rules refuse it (display does not care).
    const hard = sessionFile({ ...s, date: '2030-02-30' });
    expect(lockedSessionsOf([row(hard)])).toEqual([hard.session]);
  });

  it('leaves out the loser of a duplicate pair: spec 3 §6 hides it from views, its content is merged into the ok twin', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const loser = row(sessionFile(s), { status: 'ok', duplicateOf: '/sessions/2030/2030-03-04_aaaaaaaa.json', path: '/sessions/2030/2030-03-04_bbbbbbbb.json' });
    expect(lockedSessionsOf([loser], new Set([s.id]))).toEqual([]);
    // Even before the twin's row is known: a duplicate is never listed on its own.
    expect(lockedSessionsOf([loser])).toEqual([]);
  });

  it('leaves out a refused session whose id an ok session or an earlier refused row already holds (the route could not reach it)', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const first = row(sessionFile(s), { status: 'needs-update', path: '/sessions/2030/2030-03-04_first.json' });
    const second = row(sessionFile(s), { status: 'quarantined', path: '/sessions/2030/2030-03-04_second.json' });
    expect(lockedSessionsOf([first], new Set([s.id]))).toEqual([]);
    expect(lockedSessionRows([first, second], new Set())).toEqual([{ row: first, session: s }]);
  });
});

describe('lockedSessionRows', () => {
  it('pairs each listed session with its row, so the session page reads the same row and its reason', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const r: FileRow = { path: '/sessions/2030/2030-03-04_x.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'read-only', issues: [], version: 1 };
    expect(lockedSessionRows([r], new Set())).toEqual([{ row: r, session: s }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/log/ExerciseSearch.test.tsx src/ui/components/more/CatalogPage.test.tsx src/ui/components/more/MoreTab.test.tsx src/ui/components/more/catalog.vm.test.ts src/ui/components/shared/ExerciseForm.test.tsx src/ui/components/shared/create-clash.test.ts src/ui/locked.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/shared/ExerciseForm.test.tsx: Error: Failed to resolve import "./ExerciseForm" from "src/ui/components/shared/ExerciseForm.test.tsx". Does the file exist?
```


- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/ui/components/log/ExerciseSearch.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createExercise, findByName, type NewExerciseFields } from '../../../model/catalog';
import type { Exercise } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { Button, ClashSheet, ExerciseForm, Sheet } from '../shared';
import { createClash } from '../shared/create-clash';
import { exerciseSearchVm } from './exercise-search.vm';
import { quietOutcome, showHeldBack } from './outcome';

/**
 * Spec 4 §4 "Exercises": the catalog search behind "Other exercise…". Picking an entry hands its id
 * to `onPick` (the Log tab adds a block and makes it current). Create writes the catalog first and
 * then hands over the new id, so the catalog upload goes ahead of the session (spec 3 S12). Without
 * a readable catalog, Create is disabled and existing entries can still be picked.
 */
export function ExerciseSearch(p: { onPick(exerciseId: string): Promise<void>; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const query = useSignal('');
  /** The name the create form opened with; undefined while the search shows. */
  const formName = useSignal<string | undefined>(undefined);
  const catalogOk = data.catalog.value !== undefined && !data.refusedRows.value.some((r) => r.path === EXERCISES_PATH);

  const pick = (id: string): void => {
    p.onClose();
    void p.onPick(id);
  };

  const busy = useSignal(false);
  /** A Create that would reuse an entry with another metric or per side, waiting for the owner. */
  const clash = useSignal<{ name: string; fields: NewExerciseFields; existing: Exercise; detail: string } | undefined>(undefined);

  /** One create at a time: a second tap during the catalog write would add a second block. */
  const create = async (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await createOnce(name, fields, confirmed);
    } finally {
      busy.value = false;
    }
  };

  const createOnce = async (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => {
    const now = data.clock();
    const before = data.exercises.value;
    // An archived or deleted entry of that name comes back with its own metric and per side (spec 1
    // §3); when the form asked for others, the owner decides first (spec 4 §4 "Exercises").
    const existing = findByName(before, name);
    if (existing !== undefined && !confirmed) {
      const detail = createClash(existing, fields, { askOnRevive: false });
      if (detail !== undefined) {
        clash.value = { name, fields, existing, detail };
        return;
      }
    }
    const preview = createExercise(name, fields, before, now);
    // An existing live entry needs no write; one that was archived or deleted is revived by the write.
    if (preview.existing && preview.catalog.every((e, i) => e === before[i])) {
      pick(preview.exercise.id);
      return;
    }
    let made: Exercise | undefined;
    const outcome = await data.edit('exercises', EXERCISES_PATH, (f) => {
      const result = createExercise(name, fields, f.exercises, now);
      made = result.exercise;
      return { ...f, exercises: result.catalog };
    });
    const written = quietOutcome(EXERCISES_PATH, outcome);
    if (!written.ok || made === undefined) return;
    p.onClose();
    await p.onPick(made.id);
    // Shown after the block's write, so a toast of that write cannot replace it; it joins that toast.
    if (written.heldBackNote) showHeldBack();
  };

  if (formName.value !== undefined) {
    const pending = clash.value;
    // The clash sheet sits over the form, so Cancel returns to the form with what was typed.
    return (
      <>
        <ExerciseForm initialName={formName.value} onSave={(name, fields) => void create(name, fields, false)} onCancel={() => (formName.value = undefined)} />
        {pending !== undefined && (
          <ClashSheet
            name={pending.existing.name}
            detail={pending.detail}
            busy={busy.value}
            onUse={() => void create(pending.name, pending.fields, true)}
            onCancel={() => (clash.value = undefined)}
          />
        )}
      </>
    );
  }

  const vm = exerciseSearchVm(data.exercises.value, query.value);
  const typed = query.value.trim().replace(/\s+/g, ' ');
  return (
    <Sheet title="Exercise" onClose={p.onClose}>
      <input
        class="exsearch__input"
        type="text"
        autocomplete="off"
        enterkeyhint="search"
        placeholder="Search"
        aria-label="Search exercises"
        value={query.value}
        onInput={(e) => (query.value = e.currentTarget.value)}
      />
      <EntryList entries={vm.live} onPick={pick} />
      {vm.archived.length > 0 && (
        <details class="exsearch__archived">
          <summary>Archived ({vm.archived.length})</summary>
          <EntryList entries={vm.archived} onPick={pick} />
        </details>
      )}
      {vm.canCreate && (
        <div class="exsearch__create">
          <Button
            kind="primary"
            disabled={!catalogOk}
            onClick={() => (formName.value = typed)}
          >
            {`Create “${typed}”`}
          </Button>
          {!catalogOk && <span class="exsearch__reason">catalog not available</span>}
        </div>
      )}
    </Sheet>
  );
}

/** Entries grouped by family (the order exerciseSearchVm gives), a heading per family. */
function EntryList(p: { entries: readonly Exercise[]; onPick(id: string): void }): JSX.Element {
  const rows: JSX.Element[] = [];
  let family: string | undefined | null = null;
  for (const e of p.entries) {
    if (e.family !== family) {
      family = e.family;
      rows.push(<li key={`family:${family ?? ''}`} class="exsearch__family">{family ?? 'Other'}</li>);
    }
    rows.push(
      <li key={e.id}>
        <button type="button" class="exsearch__entry" onClick={() => p.onPick(e.id)}>{e.name}</button>
      </li>,
    );
  }
  return <ul class="exsearch__list">{rows}</ul>;
}
```

Replace the whole content of `src/ui/components/more/CatalogPage.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createExercise, findByName, type NewExerciseFields } from '../../../model/catalog';
import type { Exercise } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { readOnlyCatalog } from '../../locked';
import { reportWrite } from '../log/outcome';
import { BackBar, Button, ClashSheet, ExerciseForm } from '../shared';
import { createClash } from '../shared/create-clash';
import { catalogRefusedReason, catalogVm, type CatalogRow } from './catalog.vm';

/** A row opens its edit form; without `onOpen` (a read-only catalog) the rows are plain text. */
function Rows(p: { label: string; rows: readonly CatalogRow[]; onOpen: ((id: string) => void) | undefined }): JSX.Element {
  const open = p.onOpen;
  return (
    <ul class="catalog__rows" aria-label={p.label}>
      {p.rows.map((r) => (
        <li key={r.id}>
          {open === undefined ? (
            <div class="catalog-row">
              <span class="catalog-row__name">{r.name}</span>
              <span class="catalog-row__meta">{r.meta}</span>
            </div>
          ) : (
            <button type="button" class="catalog-row" onClick={() => open(r.id)}>
              <span class="catalog-row__name">{r.name}</span>
              <span class="catalog-row__meta">{r.meta}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A Create that would reuse an existing entry and waits for the owner's answer. */
interface PendingClash { name: string; fields: NewExerciseFields; existing: Exercise; detail: string }

/**
 * Spec 4 §6 `#/more/catalog`: every exercise, live first by family, then archived; each line with
 * pattern, metric, per side and default load type; a line opens the edit form. **Create** opens the
 * shared exercise form. A name that exists already never makes a second entry (spec 1 §3): a live
 * entry with the same metric and per side opens at once; otherwise the clash sheet offers it first
 * (archived or deleted: "Use it" brings it back; another metric or per side: it is named, since
 * both stay as they were), and Cancel returns to the form. Read-only with a banner when the catalog
 * row is refused or missing (spec 1 §5); a read-only or needs-update file still lists its entries.
 */
export function CatalogPage(): JSX.Element {
  const { data, router } = useApp();
  const formOpen = useSignal(false);
  const busy = useSignal(false);
  const clash = useSignal<PendingClash | undefined>(undefined);
  const entries = data.catalog.value?.file.exercises ?? readOnlyCatalog(data.refusedRows.value);
  const vm = catalogVm(entries, catalogRefusedReason(data.refusedRows.value));
  const editable = vm.readOnly === undefined;
  const open = (id: string): void => router.navigate({ tab: 'more', page: 'catalog', id });

  const createOnce = async (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => {
    const now = data.clock();
    const before = data.exercises.value;
    const existing = findByName(before, name);
    if (existing !== undefined && !confirmed) {
      const detail = createClash(existing, fields, { askOnRevive: true });
      if (detail !== undefined) {
        clash.value = { name, fields, existing, detail };
        return;
      }
    }
    const preview = createExercise(name, fields, before, now);
    // An existing live entry needs no write; one that was archived or deleted is revived by the write.
    if (preview.existing && preview.catalog.every((e, i) => e === before[i])) {
      clash.value = undefined;
      formOpen.value = false;
      open(preview.exercise.id);
      return;
    }
    let made: Exercise | undefined;
    const ok = await reportWrite(EXERCISES_PATH, () =>
      data.edit('exercises', EXERCISES_PATH, (f) => {
        const result = createExercise(name, fields, f.exercises, now);
        made = result.exercise;
        return { ...f, exercises: result.catalog };
      }),
    );
    if (!ok || made === undefined) return;
    clash.value = undefined;
    formOpen.value = false;
    open(made.id);
  };

  /** One create at a time: a second tap during the catalog write would write again. */
  const create = async (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await createOnce(name, fields, confirmed);
    } finally {
      busy.value = false;
    }
  };

  const empty = vm.live.length === 0 && vm.archived.length === 0;
  const onOpen = editable ? open : undefined;
  const pending = clash.value;
  return (
    <div class="more-page catalog">
      <BackBar title="Catalog" onBack={() => router.navigate({ tab: 'more' })} />
      {vm.readOnly !== undefined && <p class="catalog__banner" role="alert">{vm.readOnly}</p>}
      <div class="catalog__actions">
        <Button kind="primary" disabled={!editable} onClick={() => (formOpen.value = true)}>Create</Button>
      </div>
      {/* Without entries to show (no catalog, or a quarantined one) the banner says it all. */}
      {empty && entries !== undefined && <p class="more-page__empty">No exercises yet.</p>}
      {vm.live.map((g) => (
        <section key={g.family} class="catalog__group">
          <h2 class="catalog__family">{g.family}</h2>
          <Rows label={g.family} rows={g.rows} onOpen={onOpen} />
        </section>
      ))}
      {vm.archived.length > 0 && (
        <section class="catalog__group catalog__group--archived">
          <h2 class="catalog__family">Archived</h2>
          <Rows label="Archived" rows={vm.archived} onOpen={onOpen} />
        </section>
      )}
      {formOpen.value && editable && (
        <ExerciseForm initialName="" onSave={(name, fields) => void create(name, fields, false)} onCancel={() => (formOpen.value = false)} />
      )}
      {pending !== undefined && formOpen.value && editable && (
        <ClashSheet
          name={pending.existing.name}
          detail={pending.detail}
          busy={busy.value}
          onUse={() => void create(pending.name, pending.fields, true)}
          onCancel={() => (clash.value = undefined)}
        />
      )}
    </div>
  );
}
```

Replace the whole content of `src/ui/components/more/ExerciseEditPage.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { deleteExercise, restoreClash, setArchived, undeleteExercise, updateExercise, type ExerciseFields } from '../../../model/edit-catalog';
import { LOAD_TYPES, PATTERNS } from '../../../model/schema';
import type { Exercise, ExercisesFile, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import type { Data, WriteOutcome } from '../../data';
import { sessionsWithLocked } from '../../locked';
import { showToast } from '../../toast';
import { quietWrite, reportWrite, showHeldBack } from '../log/outcome';
import { BackBar, Button, ClashSheet } from '../shared';
import { catalogReadOnly, catalogRefusedReason, exerciseFormVm } from './catalog.vm';

const UNDO_MS = 6000;

function editCatalog(data: Data, fn: (f: ExercisesFile) => ExercisesFile): Promise<WriteOutcome> {
  return data.edit('exercises', EXERCISES_PATH, fn);
}

/**
 * Every session whose blocks keep an exercise from being deleted: the live readable ones and the
 * locked ones the Days list shows (read-only, needs-update, quarantined but parsing). Spec 1 §3: "an
 * exercise referenced by any non-deleted block cannot be tombstoned"; the engine's heal reads only
 * ok rows, so a tombstone written past a locked session would never be repaired (spec 4 §6 "Catalog").
 */
function referenceSessions(data: Data): Session[] {
  return sessionsWithLocked(data.liveSessions.value, data.refusedRows.value, new Set(data.sessions.value.map((r) => r.file.session.id)));
}

/**
 * Brings a deleted entry back unless a non-deleted one holds its name by now. A rename never takes a
 * deleted entry's name (`updateExercise`), so that happens only in the offline race spec 1 §3 accepts
 * (another device naming an entry alike before the sync). On a clash nothing is written and the
 * entry holding the name is returned; else whether the write went through.
 */
async function restoreChecked(data: Data, id: string): Promise<{ clash: Exercise } | { written: boolean }> {
  let clash: Exercise | undefined;
  const written = await reportWrite(EXERCISES_PATH, () => editCatalog(data, (f) => {
    clash = restoreClash(f, id);
    return clash === undefined ? undeleteExercise(f, id, data.clock()) : f;
  }));
  return clash === undefined ? { written } : { clash };
}

/** The select's value as one of the allowed literals, else the previous value. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

/**
 * Spec 4 §6 `#/more/catalog/<id>`: the edit form of one exercise. Without a readable catalog the
 * page shows the read-only banner and no form (spec 1 §5).
 */
export function ExerciseEditPage(p: { exerciseId: string }): JSX.Element {
  const { data, router } = useApp();
  const readOnly = catalogReadOnly(data.catalog.value?.file.exercises, catalogRefusedReason(data.refusedRows.value));
  const exercise = data.exerciseById.value.get(p.exerciseId);
  return (
    <div class="more-page catalog-edit">
      <BackBar title={exercise?.name ?? 'Exercise'} onBack={() => router.navigate({ tab: 'more', page: 'catalog' })} />
      {readOnly !== undefined && <p class="catalog__banner" role="alert">{readOnly}</p>}
      {exercise === undefined
        ? readOnly === undefined && <p class="more-page__empty">No exercise with this id.</p>
        : <EditForm key={exercise.id} exercise={exercise} />}
    </div>
  );
}

/**
 * Name (a rename keeps the id; a clash with any entry, deleted ones included, offers that entry
 * instead of saving, and a deleted one's page then offers Restore; spec 1 §3), family,
 * pattern, default load type and cues; metric and per side shown locked (spec 1 §3); Archive /
 * Unarchive; Delete only while no live block of any live session uses it, locked sessions included
 * (else the reason), with the 6 s Undo toast. Save sends only the fields changed against the values
 * the form opened with, and nothing when none changed. A deleted exercise shows its
 * fields read-only with Restore as the only action; Restore and the delete's Undo refuse while a
 * non-deleted entry holds the name (spec 1 §3) and offer that entry. Keyed by the exercise id, so
 * "Use it" on a clash opens a fresh form.
 */
function EditForm(p: { exercise: Exercise }): JSX.Element {
  const { data, router } = useApp();
  const id = p.exercise.id;
  const [opened] = useState(() => exerciseFormVm(p.exercise, referenceSessions(data)));
  const vm = exerciseFormVm(p.exercise, referenceSessions(data));
  const name = useSignal(opened.name);
  const family = useSignal(opened.family);
  const pattern = useSignal(opened.pattern);
  const defaultLoadType = useSignal(opened.defaultLoadType);
  const cues = useSignal(opened.cues);
  const clash = useSignal<{ entry: Exercise; restoring: boolean } | undefined>(undefined);
  const busy = useSignal(false);
  const toCatalog = (): void => router.navigate({ tab: 'more', page: 'catalog' });

  /** Runs one write unless one is running; the flag is cleared however the write ends. */
  const guarded = async (write: () => Promise<void>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const changes = (): ExerciseFields => {
    const c: ExerciseFields = {};
    if (name.value.trim() !== opened.name) c.name = name.value;
    if (family.value.trim() !== opened.family) c.family = family.value;
    if (pattern.value !== opened.pattern) c.pattern = pattern.value;
    if (defaultLoadType.value !== opened.defaultLoadType) c.defaultLoadType = defaultLoadType.value;
    if (cues.value.trim() !== opened.cues) c.cues = cues.value;
    return c;
  };

  const save = (): Promise<void> => guarded(async () => {
    const c = changes();
    if (Object.keys(c).length === 0) {
      toCatalog();
      return;
    }
    let found: Exercise | undefined;
    const ok = await reportWrite(EXERCISES_PATH, () => editCatalog(data, (f) => {
      const result = updateExercise(f, id, c, data.clock());
      found = result.ok ? undefined : result.clash;
      return result.ok ? result.file : f;
    }));
    if (found !== undefined) {
      clash.value = { entry: found, restoring: false };
      return;
    }
    if (ok) toCatalog();
  });

  const archive = (archived: boolean): Promise<void> => guarded(async () => {
    await reportWrite(EXERCISES_PATH, () => editCatalog(data, (f) => setArchived(f, id, archived, data.clock())));
  });

  const restore = (): Promise<void> => guarded(async () => {
    const result = await restoreChecked(data, id);
    if ('clash' in result) clash.value = { entry: result.clash, restoring: true };
  });

  /** The delete toast's Undo: a name taken since the delete leaves the tombstone and says so. */
  const undo = async (): Promise<void> => {
    const result = await restoreChecked(data, id);
    if (!('clash' in result)) return;
    const other = result.clash;
    showToast(`Not restored: an exercise named “${other.name}” exists`, {
      label: 'Open',
      run: () => router.navigate({ tab: 'more', page: 'catalog', id: other.id }),
    });
  };

  const remove = (): Promise<void> => guarded(async () => {
    // The sessions as they are when the write runs, so a locked one that arrived meanwhile refuses it.
    const written = await quietWrite(EXERCISES_PATH, () => editCatalog(data, (f) => deleteExercise(f, id, referenceSessions(data), data.clock())));
    if (!written.ok) return;
    toCatalog();
    showToast(
      'Exercise deleted',
      { label: 'Undo', run: () => void undo() },
      UNDO_MS,
    );
    if (written.heldBackNote) showHeldBack();
  });

  // A deleted entry is not in the catalog list; its page (reached by a link or "Use it") only restores.
  const deleted = p.exercise.deletedAt !== undefined;
  const c = clash.value;
  return (
    <>
      {deleted && (
        <p class="catalog-edit__deleted">
          This exercise was deleted. Restore it to edit. <Button disabled={busy.value} onClick={() => void restore()}>Restore</Button>
        </p>
      )}
      <label class="exform__field">
        <span>Name</span>
        <input type="text" autocomplete="off" aria-label="Name" disabled={deleted} value={name.value} onInput={(e) => (name.value = e.currentTarget.value)} />
      </label>
      <label class="exform__field">
        <span>Family</span>
        <input type="text" autocomplete="off" aria-label="Family" placeholder="optional" disabled={deleted} value={family.value} onInput={(e) => (family.value = e.currentTarget.value)} />
      </label>
      <label class="exform__field">
        <span>Pattern</span>
        <select aria-label="Pattern" disabled={deleted} value={pattern.value} onChange={(e) => (pattern.value = oneOf(PATTERNS, e.currentTarget.value, pattern.value))}>
          {PATTERNS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Default load</span>
        <select aria-label="Default load" disabled={deleted} value={defaultLoadType.value} onChange={(e) => (defaultLoadType.value = oneOf(LOAD_TYPES, e.currentTarget.value, defaultLoadType.value))}>
          {LOAD_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Cues</span>
        <textarea class="catalog-edit__cues" aria-label="Cues" rows={3} placeholder="optional" disabled={deleted} value={cues.value} onInput={(e) => (cues.value = e.currentTarget.value)} />
      </label>
      <div class="catalog-edit__locked" role="group" aria-label="Fixed at creation">
        <dl class="catalog-edit__fixed">
          <dt>Metric</dt>
          <dd>{vm.metric}</dd>
          <dt>Per side</dt>
          <dd>{vm.perSide ? 'yes' : 'no'}</dd>
        </dl>
        <p class="catalog-edit__note">fixed at creation; create a new exercise instead</p>
      </div>
      {!deleted && (
        <>
          <div class="catalog-edit__actions">
            <Button kind="primary" disabled={busy.value || name.value.trim() === ''} onClick={() => void save()}>Save</Button>
            <Button disabled={busy.value} onClick={() => void archive(!vm.archived)}>{vm.archived ? 'Unarchive' : 'Archive'}</Button>
            {vm.canDelete && <Button kind="danger" disabled={busy.value} onClick={() => void remove()}>Delete</Button>}
          </div>
          {vm.deleteReason !== undefined && <p class="catalog-edit__reason">{vm.deleteReason}</p>}
        </>
      )}
      {c !== undefined && (
        <ClashSheet
          name={c.entry.name}
          detail={c.restoring
            ? 'Names are unique in the catalog. Rename that one to restore this one, or open it.'
            : c.entry.deletedAt !== undefined
              ? 'Names are unique in the catalog, deleted ones included. Open that exercise to restore it, or cancel and pick another name.'
              : 'Names are unique in the catalog. Open that exercise instead?'}
          busy={false}
          onUse={() => {
            clash.value = undefined;
            router.navigate({ tab: 'more', page: 'catalog', id: c.entry.id });
          }}
          onCancel={() => (clash.value = undefined)}
        />
      )}
    </>
  );
}
```

Create `src/ui/components/more/catalog.vm.ts`:

```ts
import { referencingSessions } from '../../../model/edit-catalog';
import type { Exercise, LoadType, Pattern, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import type { FileRow } from '../../../sync/store';

export interface CatalogRow { id: string; name: string; meta: string /* 'pull · reps · per side · bodyweight' (per side only when true) */ }
export interface CatalogVm { live: { family: string; rows: CatalogRow[] }[]; archived: CatalogRow[]; readOnly: string | undefined /* reason when the catalog row is refused or missing */ }

const byText = (a: string, b: string): number => a.localeCompare(b, 'en');

function rowOf(e: Exercise): CatalogRow {
  const meta = [e.pattern, e.metric, ...(e.perSide ? ['per side'] : []), e.defaultLoadType].join(' · ');
  return { id: e.id, name: e.name, meta };
}

/** The refused catalog row's reason in plain words, or undefined when the catalog row is not refused. */
export function catalogRefusedReason(refusedRows: readonly FileRow[]): string | undefined {
  const row = refusedRows.find((r) => r.path === EXERCISES_PATH);
  if (row === undefined) return undefined;
  return row.duplicateOf !== undefined ? 'a duplicate' : row.status;
}

/** The read-only banner text (spec 1 §5): the catalog row is refused, or there is none yet. */
export function catalogReadOnly(catalog: readonly Exercise[] | undefined, refusedReason: string | undefined): string | undefined {
  if (refusedReason !== undefined) return `exercises.json is ${refusedReason}; the catalog cannot be changed here. See the Sync tab.`;
  if (catalog === undefined) return 'The exercise catalog is not here yet; it arrives with the first sync.';
  return undefined;
}

/**
 * Spec 4 §6 "Catalog": every exercise, live entries by family (the name when it has none), then the
 * archived ones by name; tombstoned entries are left out. `refusedReason` is the refused catalog
 * row's reason in plain words ('quarantined', 'read-only', 'a duplicate' …); with it, or without a
 * catalog, the screen is read-only (spec 1 §5).
 */
export function catalogVm(catalog: readonly Exercise[] | undefined, refusedReason: string | undefined): CatalogVm {
  const present = (catalog ?? []).filter((e) => e.deletedAt === undefined);
  const groups = new Map<string, Exercise[]>();
  for (const e of present.filter((x) => !x.archived)) {
    const family = e.family ?? e.name;
    const list = groups.get(family);
    if (list === undefined) groups.set(family, [e]);
    else list.push(e);
  }
  const live = [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([family, list]) => ({ family, rows: [...list].sort((a, b) => byText(a.name, b.name)).map(rowOf) }));
  const archived = present.filter((x) => x.archived).sort((a, b) => byText(a.name, b.name)).map(rowOf);
  return { live, archived, readOnly: catalogReadOnly(catalog, refusedReason) };
}

export interface ExerciseFormVm {
  name: string;
  family: string;
  pattern: Pattern;
  defaultLoadType: LoadType;
  cues: string;
  metric: 'reps' | 'seconds';
  perSide: boolean;
  locked: true;
  archived: boolean;
  canDelete: boolean;
  deleteReason: string | undefined /* 'used in N sessions; archive instead' */;
}

/** Spec 4 §6 edit form: the editable fields as text, metric and per side locked (spec 1 §3); Delete
 *  only while no live block of a live session uses the exercise. */
export function exerciseFormVm(exercise: Exercise, sessions: readonly Session[]): ExerciseFormVm {
  const used = referencingSessions(exercise.id, sessions).length;
  return {
    name: exercise.name,
    family: exercise.family ?? '',
    pattern: exercise.pattern,
    defaultLoadType: exercise.defaultLoadType,
    cues: exercise.cues ?? '',
    metric: exercise.metric,
    perSide: exercise.perSide,
    locked: true,
    archived: exercise.archived,
    canDelete: used === 0,
    deleteReason: used === 0 ? undefined : `used in ${used} session${used === 1 ? '' : 's'}; archive instead`,
  };
}
```

Create `src/ui/components/shared/ClashSheet.tsx`:

```tsx
import type { JSX } from 'preact';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * Spec 1 §3 / spec 4 §6: "An exercise named “X” exists". Offers the existing entry (Use it) instead
 * of saving a name twice; the sheet's Cancel goes back to the form with what was typed. Used by the
 * rename on the edit page and by Create in the catalog and in the Log search.
 */
export function ClashSheet(p: { name: string; detail: string; busy: boolean; onUse(): void; onCancel(): void }): JSX.Element {
  return (
    <Sheet title={`An exercise named “${p.name}” exists`} onClose={p.onCancel}>
      <p class="clash__detail">{p.detail}</p>
      <Button kind="primary" disabled={p.busy} onClick={p.onUse}>Use it</Button>
    </Sheet>
  );
}
```

Create `src/ui/components/shared/ExerciseForm.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import type { NewExerciseFields } from '../../../model/catalog';
import { LOAD_TYPES, PATTERNS } from '../../../model/schema';
import type { LoadType, Pattern } from '../../../model/types';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface Draft {
  name: string;
  pattern: Pattern;
  metric: 'reps' | 'seconds';
  perSide: boolean;
  defaultLoadType: LoadType;
  family: string;
}

/** The select's value as one of the allowed literals, else the previous value. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

/**
 * Spec 4 §4 / §6: the short create form shared by the Log tab's search and the catalog's Create:
 * name (prefilled), pattern, metric (reps), per side (off), default load type (bodyweight) and an
 * optional family, in a sheet titled "New exercise". It only collects the fields; the caller writes
 * (and guards against a second tap while its write runs).
 */
export function ExerciseForm(p: { initialName: string; onSave(name: string, fields: NewExerciseFields): void; onCancel(): void }): JSX.Element {
  const draft = useSignal<Draft>({ name: p.initialName, pattern: 'other', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: '' });
  const d = draft.value;
  const set = (patch: Partial<Draft>): void => {
    draft.value = { ...draft.value, ...patch };
  };
  const name = d.name.trim();
  const submit = (): void => {
    if (name === '') return;
    const family = d.family.trim();
    p.onSave(name, {
      pattern: d.pattern,
      metric: d.metric,
      perSide: d.perSide,
      defaultLoadType: d.defaultLoadType,
      ...(family !== '' ? { family } : {}),
    });
  };
  return (
    <Sheet title="New exercise" onClose={p.onCancel}>
      <label class="exform__field">
        <span>Name</span>
        <input type="text" autocomplete="off" aria-label="Name" value={d.name} onInput={(e) => set({ name: e.currentTarget.value })} />
      </label>
      <label class="exform__field">
        <span>Pattern</span>
        <select aria-label="Pattern" value={d.pattern} onChange={(e) => set({ pattern: oneOf(PATTERNS, e.currentTarget.value, d.pattern) })}>
          {PATTERNS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Metric</span>
        <select aria-label="Metric" value={d.metric} onChange={(e) => set({ metric: e.currentTarget.value === 'seconds' ? 'seconds' : 'reps' })}>
          <option value="reps">reps</option>
          <option value="seconds">seconds</option>
        </select>
      </label>
      <label class="exform__check">
        <input type="checkbox" checked={d.perSide} onChange={(e) => set({ perSide: e.currentTarget.checked })} />
        <span>Per side</span>
      </label>
      <label class="exform__field">
        <span>Default load</span>
        <select aria-label="Default load" value={d.defaultLoadType} onChange={(e) => set({ defaultLoadType: oneOf(LOAD_TYPES, e.currentTarget.value, d.defaultLoadType) })}>
          {LOAD_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Family</span>
        <input type="text" autocomplete="off" aria-label="Family" placeholder="optional" value={d.family} onInput={(e) => set({ family: e.currentTarget.value })} />
      </label>
      <Button kind="primary" disabled={name === ''} onClick={submit}>Create exercise</Button>
    </Sheet>
  );
}
```

Create `src/ui/components/shared/create-clash.ts`:

```ts
import type { NewExerciseFields } from '../../../model/catalog';
import type { Exercise } from '../../../model/types';

/**
 * Spec 1 §3: creating a name that exists never makes a second record; `createExercise` returns the
 * existing entry, revived when it was archived or deleted, and keeps its metric and per side, which
 * never change. Before that happens without a word, the create form asks (spec 4 §4 "Exercises",
 * §6 "Catalog"): always when the form's metric or per side differ from the entry's (the owner would
 * otherwise log hold times as reps), and with `askOnRevive` also before bringing back an archived or
 * deleted entry (the catalog's Create; the Log search revives a matching entry silently, spec 4
 * §4). Returns the sheet's line, or undefined when the entry can be used without asking.
 */
export function createClash(existing: Exercise, fields: NewExerciseFields, opts: { askOnRevive: boolean }): string | undefined {
  const deleted = existing.deletedAt !== undefined;
  const facts: string[] = [];
  if (deleted) facts.push('deleted');
  else if (existing.archived) facts.push('archived');
  const metricDiffers = existing.metric !== fields.metric;
  const perSideDiffers = existing.perSide !== fields.perSide;
  if (metricDiffers) facts.push(`measured in ${existing.metric}, not ${fields.metric}`);
  if (perSideDiffers) facts.push(existing.perSide ? 'per side' : 'not per side');
  if (metricDiffers || perSideDiffers) return `It is ${facts.join(', ')}. Use it as it is, or cancel and pick another name for the new one.`;
  if (opts.askOnRevive && facts.length > 0) return `It is ${facts.join(', ')}. Use it to bring it back.`;
  return undefined;
}
```

Replace the whole content of `src/ui/components/shared/index.ts` with:

```ts
export { BackBar } from './BackBar';
export { Button } from './Button';
export { ClashSheet } from './ClashSheet';
export { ExerciseForm } from './ExerciseForm';
export { Marks } from './Marks';
export { NumberPad } from './NumberPad';
export { SetChips } from './SetChips';
export { Sheet } from './Sheet';
export { Stepper } from './Stepper';
export { ToastHost } from './ToastHost';
```

Replace the whole content of `src/ui/locked.ts` with:

```ts
import { Value } from '@sinclair/typebox/value';
import { Lenient } from '../model/schema';
import type { BodyweightEntry, Exercise, Session } from '../model/types';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../sync/paths';
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

/**
 * The readable live sessions plus the locked ones (the Days list's set), for every check that must
 * see all non-deleted blocks: spec 1 §3 "an exercise referenced by any non-deleted block cannot be
 * tombstoned" holds for a session on a read-only, needs-update or quarantined row too.
 * `okSessionIds` are the ids of every ok session row, tombstoned ones included.
 */
export function sessionsWithLocked(live: readonly Session[], rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): Session[] {
  return [...live, ...lockedSessionsOf(rows, okSessionIds)];
}

/** The refused row at `path` when it is only locked for writing (read-only, needs-update: written by
 *  a newer app, read leniently, spec 1/3), never a quarantined file or a duplicate loser. */
function lockedRowAt(rows: readonly FileRow[], path: string): FileRow | undefined {
  return rows.find((r) => r.path === path && r.duplicateOf === undefined && (r.status === 'read-only' || r.status === 'needs-update'));
}

/** Spec 4 §6: the catalog of a read-only exercises.json, shown read-only; undefined when the file is
 *  not locked that way or fails the lenient schema (then only the banner shows). */
export function readOnlyCatalog(rows: readonly FileRow[]): Exercise[] | undefined {
  const content = lockedRowAt(rows, EXERCISES_PATH)?.content;
  return Value.Check(Lenient.ExercisesFile, content) ? (content.exercises as Exercise[]) : undefined;
}

/** Spec 4 §6: the entries of a read-only bodyweight.json, shown read-only; as `readOnlyCatalog`. */
export function readOnlyBodyweight(rows: readonly FileRow[]): BodyweightEntry[] | undefined {
  const content = lockedRowAt(rows, BODYWEIGHT_PATH)?.content;
  return Value.Check(Lenient.BodyweightFile, content) ? (content.entries as BodyweightEntry[]) : undefined;
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .catalog, .catalog-edit (components/more/CatalogPage, ExerciseEditPage) ---- */
.catalog__banner { margin: 0; padding: 8px 12px; border-radius: 10px; background: var(--panel); border-left: 3px solid var(--danger); }
.catalog__actions { display: flex; justify-content: flex-end; }
.catalog__group { margin-top: 8px; }
.catalog__family { margin: 0 0 4px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.catalog__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.catalog-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
}
.catalog-row__meta { color: var(--muted); font-size: 13px; }
.catalog__group--archived .catalog-row__name { color: var(--muted); }
.catalog-edit__cues {
  width: 100%;
  min-height: 88px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  resize: vertical;
}
.catalog-edit__locked { padding: 8px 12px; border: 1px dashed var(--outline); border-radius: 10px; }
.catalog-edit__fixed { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
.catalog-edit__fixed dt { color: var(--muted); }
.catalog-edit__fixed dd { margin: 0; }
.catalog-edit__note, .catalog-edit__reason { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
/* shared/ClashSheet: why the name is taken and what "Use it" does. */
.clash__detail { margin: 0 0 8px; color: var(--muted); }
/* A deleted exercise's fields are read-only until Restore. */
.exform__field :disabled { opacity: 0.7; }
.catalog-edit__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.catalog-edit__actions .btn--primary { margin-right: auto; }
.catalog-edit__deleted { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 87 test files and 1219 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/log/ExerciseSearch.test.tsx src/ui/components/log/ExerciseSearch.tsx src/ui/components/more/CatalogPage.test.tsx src/ui/components/more/CatalogPage.tsx src/ui/components/more/ExerciseEditPage.tsx src/ui/components/more/MoreTab.test.tsx src/ui/components/more/catalog.vm.test.ts src/ui/components/more/catalog.vm.ts src/ui/components/shared/ClashSheet.tsx src/ui/components/shared/ExerciseForm.test.tsx src/ui/components/shared/ExerciseForm.tsx src/ui/components/shared/create-clash.test.ts src/ui/components/shared/create-clash.ts src/ui/components/shared/index.ts src/ui/locked.test.ts src/ui/locked.ts src/ui/theme.css
git commit -m "Add the catalog screen and the shared exercise form" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Soft-issue flags on blocks

Blocks with an unknown exercise or a metric mismatch carry a flag on the session page and on the Log cards; the Sync tab's soft-issue cards point there (spec 4 §7, §12 plan 4b item 2).

**Files:**
- Modify: `src/ui/components/days/SessionPage.test.tsx`
- Modify: `src/ui/components/days/SessionPage.tsx`
- Modify: `src/ui/components/log/LogScreen.tsx`
- Modify: `src/ui/components/log/LogTab.test.tsx`
- Modify: `src/ui/components/log/LogTab.tsx`
- Modify: `src/ui/components/sync/SyncTab.test.tsx`
- Modify: `src/ui/components/sync/sync.vm.test.ts`
- Modify: `src/ui/components/sync/sync.vm.ts`
- Create: `src/ui/soft-flags.test.ts`
- Create: `src/ui/soft-flags.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/edit`, `src/model/types`, `src/model/validate`, `src/sync/engine`, `src/sync/store`, `src/ui/components/days/PastSessionSheet`, `src/ui/components/days/SessionHeaderSheet`, `src/ui/components/days/session-page.vm`, `src/ui/components/log/BlockSheet`, `src/ui/components/log/EntryArea`, `src/ui/components/log/ExerciseSearch`, `src/ui/components/log/SetSheet`, `src/ui/components/log/StartPicker`, `src/ui/components/log/log-screen.vm`, `src/ui/components/log/log-state`, `src/ui/components/log/outcome`, `src/ui/components/log/use-write-guard`, `src/ui/components/shared`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/locked`, `src/ui/toast`.
- Produces:
  - `src/ui/components/days/SessionPage.tsx`:
    - `export function SessionPage(p: { sessionId: string }): JSX.Element`
  - `src/ui/components/log/LogScreen.tsx`:
    - `export function LogScreen(p: { row: SessionRow; vm: LogScreenVm; reference?: Session | undefined }): JSX.Element`
  - `src/ui/components/log/LogTab.tsx`:
    - `export function LogTab(): JSX.Element`
  - `src/ui/components/sync/sync.vm.ts`:
    - `export type UpdateState = 'idle' | 'updating' | 'retrying' | 'failed'`
    - `export interface SyncVmInput`
    - `export interface IssueCard`
    - `export interface SyncVm`
    - `export function syncVm(input: SyncVmInput): SyncVm`
  - `src/ui/soft-flags.ts`:
    - `export type BlockFlag = 'unknown exercise' | 'metric mismatch'`
    - `export function blockFlags(session: Session, catalog: readonly Exercise[]): Map<string, string[]>`

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `src/ui/components/days/SessionPage.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSessionFields } from '../../../model/edit';
import { block, exercise, ladder, session, set, sessionFile, T0, timedSet } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatAmount, formatDayLong } from '../../format';
import { dismissToast, toast } from '../../toast';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';
import { justCreated } from './PastSessionSheet';
import { SessionPage } from './SessionPage';

const NOW = new Date('2030-03-09T12:00:00.000Z');
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const ROWS = exercise({ id: 'australian-pull-ups', name: 'Australians', pattern: 'pull' });

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  justCreated.value = undefined;
});

const threeBlocks = (over: Partial<Session> = {}): Session =>
  session(
    [
      block(ladder([8, 7], { completedAt: '2030-03-07T10:05:00.000Z' }), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([12]), { exerciseId: 'dips-bar', order: 1 }),
      block(ladder([15]), { exerciseId: 'australian-pull-ups', order: 2 }),
    ],
    { date: '2030-03-07', tags: ['deload'], ...over },
  );

async function mount(s: Session, others: Session[] = [], opts: { staleNow?: Date } = {}) {
  const m = await setup({ now: NOW, sessions: [...others, s], exercises: [PULL, DIPS, ROWS] });
  // A `now` signal away from the clock from the first render on: a handler or a render that read it shows it.
  if (opts.staleNow !== undefined) m.data.now.value = opts.staleNow;
  renderIn(m.deps, <SessionPage sessionId={s.id} />);
  return m;
}

const article = (name: string): HTMLElement => screen.getByRole('article', { name });

/** happy-dom has no window.confirm; the page calls it before Delete session. Undone in afterEach. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

/** A 'now' far from the clock: a write that took its time from the ticking signal would show it. */
const STALE_NOW = new Date('2030-03-01T00:00:00.000Z');

describe('SessionPage', () => {
  it('renders the header and the blocks in canonical order', async () => {
    const s = threeBlocks({ notes: 'felt strong', label: 'pull' });
    await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('heading', { name: formatDayLong('2030-03-07') })).toBeTruthy();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Pull-ups', 'Dips (Bar)', 'Australians']);
    expect(within(article('Pull-ups')).getByText(`${formatAmount(15)} · 2 sets`)).toBeTruthy();
    expect(within(article('Pull-ups')).getByRole('button', { name: '8' })).toBeTruthy();
    expect(screen.getByText('felt strong')).toBeTruthy();
    // Display text through formatLabel, as on the Days list.
    expect(screen.getByText('Pull')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag deload' })).toBeTruthy();
  });

  it('the exercise name opens its history', async () => {
    const s = threeBlocks();
    const { deps } = await mount(s);
    await waitFor(() => expect(article('Dips (Bar)')).toBeTruthy());
    fireEvent.click(within(article('Dips (Bar)')).getByRole('button', { name: 'Dips (Bar)' }));
    expect(deps.router.route.value).toEqual({ tab: 'more', page: 'exercise', id: 'dips-bar' });
  });

  it('Add set writes a set without completedAt', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Add set' }));
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets).toHaveLength(3));
    const added = (await fileAt(store, pathOf(s))).session.blocks[0]?.sets[2];
    expect(added).toMatchObject({ reps: 7, loadType: 'bodyweight', updatedAt: NOW.toISOString() });
    expect(added?.completedAt).toBeUndefined();
    await waitFor(() => expect(within(article('Pull-ups')).getByText(`${formatAmount(22)} · 3 sets`)).toBeTruthy());
  });

  it('Move down gives the block a midpoint order and touches only that block', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Block options' }));
    const sheet = screen.getByRole('dialog', { name: 'Pull-ups' });
    expect((within(sheet).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).queryByRole('button', { name: 'Make current' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move down' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.order).toBe(1.5));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.blocks[0]?.updatedAt).toBe(NOW.toISOString());
    expect(after.blocks.slice(1).map((b) => [b.order, b.updatedAt])).toEqual([[1, T0], [2, T0]]);
    expect(after.updatedAt).toBe(T0);
    await waitFor(() => expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Dips (Bar)', 'Pull-ups', 'Australians']));
  });

  it('Delete session tombstones the session only, goes to Days, and Undo restores it', async () => {
    const s = threeBlocks();
    const { store, deps } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    answerConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBe(NOW.toISOString()));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.blocks.every((b) => b.deletedAt === undefined && b.sets.every((x) => x.deletedAt === undefined))).toBe(true);
    expect(deps.router.route.value).toEqual({ tab: 'days' });
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
  });

  it('a cancelled confirm deletes nothing', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const asked = answerConfirm(false);
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
  });

  it('a tombstoned session shows Deleted with Undo', async () => {
    const s = threeBlocks({ deletedAt: '2030-03-08T10:00:00.000Z' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Add block' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy());
  });

  it('a refused row renders read-only with a banner and no edit controls', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.data.refresh(pathOf(s));
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/newer app/);
    expect(screen.getByRole('link', { name: 'Sync tab' }).getAttribute('href')).toBe('#/sync');
    for (const name of ['Edit', 'Add set', 'Add block', 'Block options', 'Delete session', 'Remove tag deload', 'Add tag', 'Edit notes']) {
      expect(screen.queryAllByRole('button', { name })).toHaveLength(0);
    }
    expect(within(article('Pull-ups')).queryByRole('button', { name: '8' })).toBeNull();
    expect(within(article('Pull-ups')).getByText('8')).toBeTruthy();
  });

  it('resolves an id like the Days list: the ok row first, then the first refused row; a duplicate loser is never reached', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [s], exercises: [PULL, DIPS, ROWS] });
    // A refused row of the same id as an ok row: the ok row opens, editable, no banner.
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_other.json', kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_other.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy();
  });

  it('two refused rows of one id: the first one opens, with its own reason', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_a.json', kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_b.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_a.json');
    await m.data.refresh('/sessions/2030/2030-03-07_b.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/newer app/);
  });

  it('the loser of a duplicate pair alone does not open (spec 3 §6 hides it; the Sync tab lists it)', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_b.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', duplicateOf: '/sessions/2030/2030-03-07_a.json', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_b.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    expect(screen.getByText('This session is not here.')).toBeTruthy();
  });

  it('renders and edits an open session like a closed one: no redirect, Add set writes no completedAt', async () => {
    const s = session([block(ladder([8], { completedAt: '2030-03-09T11:40:00.000Z' }), { exerciseId: 'pull-ups' })], {
      date: '2030-03-09',
      startedAt: '2030-03-09T11:30:00.000Z',
    });
    const m = await setup({ now: NOW, sessions: [s], exercises: [PULL, DIPS, ROWS] });
    expect(m.data.openSession.value?.file.session.id).toBe(s.id);
    m.deps.router.navigate({ tab: 'days', sessionId: s.id });
    const navigate = vi.spyOn(m.deps.router, 'navigate');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Add set' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New set' })).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(m.store, pathOf(s))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(m.store, pathOf(s))).session.blocks[0]?.sets[1]?.completedAt).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.input(within(screen.getByRole('dialog', { name: 'Add tag' })).getByRole('textbox', { name: 'New tag' }), { target: { value: 'gym' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add tag' })).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await fileAt(m.store, pathOf(s))).session.tags).toEqual(['gym']));
    expect(navigate).not.toHaveBeenCalled();
    expect(m.deps.router.route.value).toEqual({ tab: 'days', sessionId: s.id });
  });

  it('a session just created on this device shows as loading, not missing, until its row arrives', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    justCreated.value = s.id;
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    expect(screen.queryByText('This session is not here.')).toBeNull();
    expect(document.querySelector('section.session[aria-busy="true"]')).toBeTruthy();
    await m.store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('removing a tag ignores a second tap while the first write runs', async () => {
    const s = threeBlocks();
    const { data, store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    const chip = screen.getByRole('button', { name: 'Remove tag deload' });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('the Undo of a deleted session ignores a second tap while the first write runs', async () => {
    const s = threeBlocks({ deletedAt: '2030-03-08T10:00:00.000Z' });
    const { data, store } = await mount(s);
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('adding a tag the session already has writes nothing and closes the sheet', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: ' deload ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add tag' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('the set interval and the stated rest carry spoken labels', async () => {
    const s = session(
      [
        block(
          [
            set({ order: 0, reps: 8, completedAt: '2030-03-07T10:00:00.000Z' }),
            set({ order: 1, reps: 8, completedAt: '2030-03-07T10:01:02.000Z' }),
            // restSec only on a set without completedAt (migrated shape, spec 2).
            set({ order: 2, reps: 8, restSec: 120 }),
          ],
          { exerciseId: 'pull-ups' },
        ),
      ],
      { date: '2030-03-07' },
    );
    await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByLabelText('interval 1:02 since the previous set').textContent).toBe('+1:02');
    expect(screen.getByLabelText(`stated rest ${formatAmount(120)} s`).textContent).toBe(`rest ${formatAmount(120)} s`);
  });

  it('the read-only banner link to the Sync tab is a touch target', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    await m.data.refresh(pathOf(s));
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    // theme.css gives .session__banner-link a 44 px min-height (no layout in happy-dom).
    expect(screen.getByRole('link', { name: 'Sync tab' }).classList.contains('session__banner-link')).toBe(true);
  });

  it('notes Save ignores a second tap while the first write runs', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'new' } });
    const save = within(sheet).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('new'));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('notes Save without an edit writes nothing, even for a migrated note with surrounding whitespace', async () => {
    const s = threeBlocks({ notes: '  raw row  ', source: 'migrated' });
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Notes' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notes' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('Add tag ignores a second tap while the first write runs', async () => {
    const s = threeBlocks();
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: 'hotel gym' } });
    const add = within(sheet).getByRole('button', { name: 'Add' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['deload', 'hotel gym']));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('an unknown id says so', async () => {
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL] });
    renderIn(m.deps, <SessionPage sessionId="nope" />);
    expect(screen.getByText('This session is not here.')).toBeTruthy();
  });

  it('a migrated aggregate set: totals text, and its sheet offers note and Delete only', async () => {
    const agg = set({ reps: 100, aggregate: true, order: 0 });
    const s = session(
      [block([agg], { exerciseId: 'pull-ups' }), block([], { exerciseId: 'dips-bar', order: 1, note: '3x max' })],
      { date: '2030-03-07', source: 'migrated', dateUncertain: true },
    );
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(within(article('Pull-ups')).getByText(`${formatAmount(100)} total, set count unknown`)).toBeTruthy();
    expect(within(article('Dips (Bar)')).getByText('no sets recorded')).toBeTruthy();
    expect(screen.getByText('date estimated by the migration')).toBeTruthy();
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: `${formatAmount(100)}*` }));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    expect(within(sheet).queryByRole('button', { name: 'Increase' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Edit value' })).toBeNull();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: 'ladders' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets[0]?.note).toBe('ladders'));
    expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 100, aggregate: true });
  });

  it('a tag tap removes it; Add tag offers tags seen elsewhere and free text', async () => {
    const other = session([], { date: '2030-03-01', tags: ['travel', 'deload'] });
    const s = threeBlocks();
    const { store } = await mount(s, [other]);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag deload' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove tag deload' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    let sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'travel' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['travel']));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove tag travel' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    sheet = screen.getByRole('dialog', { name: 'Add tag' });
    expect(within(sheet).queryByRole('button', { name: 'travel' })).toBeNull();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: 'hotel gym' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['travel', 'hotel gym']));
    expect((await fileAt(store, pathOf(s))).session.blocks.every((b) => b.updatedAt === T0)).toBe(true);
  });

  it('notes edit in a sheet', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'line one\nline two' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('line one\nline two'));
  });

  it('page writes take their time from data.clock(), not from the ticking now signal', async () => {
    const s = threeBlocks();
    const { store, data } = await mount(s, [], { staleNow: STALE_NOW });
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    // A later tick lands too (inside act, so any re-render happens before the taps).
    await act(() => { data.now.value = new Date(STALE_NOW.getTime() + 1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag deload' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));
    expect((await fileAt(store, pathOf(s))).session.updatedAt).toBe(NOW.toISOString());
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Exercise' })).getByRole('button', { name: 'Dips (Bar)' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks).toHaveLength(4));
    expect((await fileAt(store, pathOf(s))).session.blocks[3]?.updatedAt).toBe(NOW.toISOString());
  });

  it('Add block picks an exercise from the search', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    const sheet = screen.getByRole('dialog', { name: 'Exercise' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dips (Bar)' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks).toHaveLength(4));
    expect((await fileAt(store, pathOf(s))).session.blocks[3]).toMatchObject({ exerciseId: 'dips-bar', order: 3, sets: [] });
  });
});

describe('SessionHeaderSheet', () => {
  it('Save with "date is exact" drops dateUncertain; a changed date says the file keeps its name', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '2030-03-06' } });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Date is exact' }));
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'legs' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.date).toBe('2030-03-06'));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.dateUncertain).toBeUndefined();
    expect(after.label).toBe('legs');
    expect(after.updatedAt).toBe(NOW.toISOString());
    expect(toast.value?.text).toBe('The file keeps its old name');
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  it('saving with the switch off keeps dateUncertain; no switch on an exact date', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'n' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('n'));
    expect((await fileAt(store, pathOf(s))).session.dateUncertain).toBe(true);
    expect(toast.value).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog', { name: 'Session' })).getByRole('switch', { name: 'Date is exact' })).toBeTruthy();
  });

  it('a changed date with the switch off keeps dateUncertain', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '2030-03-05' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.date).toBe('2030-03-05'));
    expect((await fileAt(store, pathOf(s))).session.dateUncertain).toBe(true);
  });

  it('the label select shows display text and stores the label value', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const select = within(screen.getByRole('dialog', { name: 'Session' })).getByRole('combobox', { name: 'Label' }) as HTMLSelectElement;
    const legs = [...select.options].find((o) => o.value === 'legs');
    expect(legs?.textContent).toBe('Legs');
    fireEvent.change(select, { target: { value: 'legs' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Session' })).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('legs'));
  });

  it('an unrelated save leaves a migrated note with surrounding whitespace as it was', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', notes: '  raw row\n' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'pull' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('pull'));
    expect((await fileAt(store, pathOf(s))).session.notes).toBe('  raw row\n');
  });

  it('takes the write time from data.clock(), not from the ticking now signal', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store, data } = await mount(s, [], { staleNow: STALE_NOW });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    await act(() => { data.now.value = new Date(STALE_NOW.getTime() + 1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'pull' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('pull'));
    expect((await fileAt(store, pathOf(s))).session.updatedAt).toBe(NOW.toISOString());
  });

  it('Save writes only what the owner changed against the opened values: a label and date changed elsewhere meanwhile survive', async () => {
    const s = session([], { date: '2030-03-07', label: 'push', notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // The PC's change lands (a pull) while the sheet is open.
    await act(async () => {
      await data.edit('session', pathOf(s), (f) => setSessionFields(f, { label: 'pull', date: '2030-03-06' }, new Date('2030-03-09T11:59:00.000Z')));
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: formatDayLong('2030-03-06') })).toBeTruthy());
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'new' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('new'));
    expect((await fileAt(store, pathOf(s))).session).toMatchObject({ label: 'pull', date: '2030-03-06' });
    expect(toast.value?.text).not.toBe('The file keeps its old name');
  });

  it('notes edited elsewhere while the notes sheet is open: an unchanged Save keeps them', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    await act(async () => {
      await data.edit('session', pathOf(s), (f) => setSessionFields(f, { notes: 'from the PC' }, new Date('2030-03-09T11:59:00.000Z')));
    });
    // The refreshed row reached the page (its notes line behind the sheet).
    await waitFor(() => expect(screen.getByText('from the PC')).toBeTruthy());
    // The owner types and returns to the text the sheet opened with: nothing to write.
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'old!' } });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'old' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notes' })).toBeNull());
    expect((await fileAt(store, pathOf(s))).session.notes).toBe('from the PC');
  });

  it('an exact date shows no switch; an empty date is refused with a toast', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    expect(within(sheet).queryByRole('switch')).toBeNull();
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('Enter a date'));
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('SessionPage soft-issue flags', () => {
  it('flags a block with an unknown exercise or a metric mismatch under its name, as the Sync tab names it', async () => {
    const s = session(
      [
        block(ladder([5]), { exerciseId: 'nope', order: 0 }),
        block([timedSet()], { exerciseId: 'pull-ups', order: 1 }),
        block(ladder([12]), { exerciseId: 'dips-bar', order: 2 }),
      ],
      { date: '2030-03-07' },
    );
    await mount(s);
    await waitFor(() => expect(article('nope')).toBeTruthy());
    const flagsOf = (name: string): string[] => within(article(name)).queryAllByText(/^(unknown exercise|metric mismatch)$/).map((e) => e.textContent ?? '');
    expect(flagsOf('nope')).toEqual(['unknown exercise']);
    expect(flagsOf('Pull-ups')).toEqual(['metric mismatch']);
    expect(flagsOf('Dips (Bar)')).toEqual([]);
    // Under the name: after the heading, not inside it.
    const heading = within(article('nope')).getByRole('heading', { name: /nope/ });
    const flag = within(article('nope')).getByText('unknown exercise');
    expect(heading.contains(flag)).toBe(false);
    expect(heading.compareDocumentPosition(flag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('flags no block without a catalog (the Sync tab lists no soft issue then)', async () => {
    const s = session([block(ladder([5]), { exerciseId: 'nope' })], { date: '2030-03-07' });
    const m = await setup({ now: NOW, sessions: [s] });
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('nope')).toBeTruthy());
    expect(screen.queryByText(/^(unknown exercise|metric mismatch)$/)).toBeNull();
  });
});
```

Replace the whole content of `src/ui/components/log/LogTab.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile, timedSet } from '../../../model/test-fixtures';
import type { FileKind, Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor } from './log-state';
import { LogTab } from './LogTab';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/log' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const pathOf = (s: Session): string => sessionPath(s.date, s.id);

async function mount(sessions: Session[], meta: Record<string, unknown> = {}) {
  const db = await openDb(new IDBFactory());
  let data: Data | undefined;
  const store = new Store(db, { onChange: (p) => void data?.refresh(p) });
  const files: [FileKind, string, unknown][] = [['exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL])], ...sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)])];
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, NOW);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(meta)) await store.setMeta(key, value);
  data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const deps: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
  return { data, store, router: deps.router };
}

async function sessionFiles(store: Store): Promise<SessionFile[]> {
  return (await store.sessions()).map((r) => r.file);
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  referenceLoadedFor.value = undefined;
  entryDraft.value = new Map();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** happy-dom has no window.confirm; the stub is undone after each test. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

async function fileOf(store: Store, s: Session): Promise<SessionFile> {
  return (await store.getRow(pathOf(s)))?.content as SessionFile;
}

// 2030-03-05 is a Tuesday.
const pastPush = (): Session =>
  session([block(ladder([8, 8], { completedAt: '2030-03-05T10:05:00.000Z' }), { exerciseId: 'dips-bar' }), block(ladder([17, 16, 15]), { exerciseId: 'push-ups', order: 1 })], {
    date: '2030-03-05',
    startedAt: '2030-03-05T10:00:00.000Z',
  });

describe('LogTab without an open session', () => {
  it('starts a session against the chosen reference: writes the file with startedAt and stores the choice', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const sheet = screen.getByRole('dialog', { name: 'Train against' });
    const row = within(sheet).getByRole('button', { name: /Tue 05 Mar/ });
    expect(row.textContent).toContain('Dips (Bar) · Push-ups');
    expect(row.textContent).toContain('proposed');
    fireEvent.click(row);

    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const started = (await sessionFiles(store)).find((f) => f.session.id !== past.id)?.session;
    expect(started?.startedAt).toBe(NOW.toISOString());
    expect(started?.date).toBe(localDate(NOW));
    expect(started?.blocks).toEqual([]);
    const id = started?.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe(past.id));
    // The open session now shows, with the reference in the header and its cards not started.
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card--not-started')).toHaveLength(2);
  });

  it('a double tap on a picker row starts one session', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const row = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: /Tue 05 Mar/ });
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('a double tap on No reference starts one session; the rows are disabled while it runs', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }) as HTMLButtonElement;
    fireEvent.click(none);
    await waitFor(() => expect(none.disabled).toBe(true));
    fireEvent.click(none);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('stores none for No reference', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.click(screen.getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const id = (await sessionFiles(store)).find((f) => f.session.startedAt === NOW.toISOString())?.session.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });
});

describe('LogTab with an open session', () => {
  function openToday(): Session {
    return session([block(ladder([8, 8], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'dips-bar' })], {
      date: '2030-03-07',
      startedAt: '2030-03-07T10:00:00.000Z',
    });
  }

  it('shows the cards; Start on a not-started card adds a block and makes it current', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    expect(dips.className).toContain('log-card--current');
    expect(within(dips).getByText('today 16 · 2 sets')).toBeTruthy();
    const push = screen.getByRole('article', { name: 'Push-ups' });
    expect(push.className).toContain('log-card--not-started');

    fireEvent.click(within(push).getByRole('button', { name: 'Start' }));
    await waitFor(async () => {
      const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
      expect(file.session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
    });
    const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
    const added = file.session.blocks[1];
    expect(added?.updatedAt).toBe(NOW.toISOString());
    expect(currentBlockId.value).toBe(added?.id);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
  });

  it("flags a block with an unknown exercise or a metric mismatch under its name, today's or, on a not-started card, the reference's", async () => {
    const past = session([block(ladder([5]), { exerciseId: 'gone' })], { date: '2030-03-05', startedAt: '2030-03-05T10:00:00.000Z' });
    const today = session(
      [
        block(ladder([5], { completedAt: '2030-03-07T10:05:00.000Z' }), { exerciseId: 'nope', order: 0 }),
        block([timedSet({ completedAt: '2030-03-07T10:10:00.000Z' })], { exerciseId: 'pull-ups', order: 1 }),
        block(ladder([8], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'dips-bar', order: 2 }),
      ],
      { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' },
    );
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'nope' })).toBeTruthy());
    const flagsOf = (name: string): string[] =>
      within(screen.getByRole('article', { name })).queryAllByText(/^(unknown exercise|metric mismatch)$/).map((e) => e.textContent ?? '');
    expect(flagsOf('nope')).toEqual(['unknown exercise']);
    expect(flagsOf('Pull-ups')).toEqual(['metric mismatch']);
    expect(flagsOf('Dips (Bar)')).toEqual([]);
    // The reference's block of an unknown exercise, not started today: the Sync tab lists it too.
    expect(flagsOf('gone')).toEqual(['unknown exercise']);
    // Under the name: after the heading, not inside it.
    const card = screen.getByRole('article', { name: 'nope' });
    const heading = within(card).getByRole('heading', { name: 'nope' });
    const flag = within(card).getByText('unknown exercise');
    expect(heading.contains(flag)).toBe(false);
    expect(heading.compareDocumentPosition(flag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a double tap on Start adds one block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    await new Promise((r) => setTimeout(r, 30));
    expect((await fileOf(store, today)).session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
  });

  it('Start stays held after its write until the refreshed row shows the block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const refresh = data.refresh.bind(data);
    const pending: (() => void)[] = [];
    vi.spyOn(data, 'refresh').mockImplementation((path: string) => new Promise<void>((resolve) => {
      pending.push(() => void refresh(path).then(resolve));
    }));
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    fireEvent.click(start);
    await waitFor(async () => expect((await fileOf(store, today)).session.blocks).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    await new Promise((r) => setTimeout(r, 20));
    expect((await fileOf(store, today)).session.blocks).toHaveLength(2);
    act(() => { for (const run of pending) run(); });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
  });

  it("the header's Details opens the session page of the open session", async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(router.route.value).toEqual({ tab: 'days', sessionId: today.id });
  });

  it('a double tap on a row of the change picker stores the choice once', async () => {
    const past = pastPush();
    const today = openToday();
    const { data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const setMeta = vi.spyOn(data, 'setMeta');
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' });
    fireEvent.click(none);
    fireEvent.click(none);
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(setMeta.mock.calls.filter(([key]) => key === `reference:${today.id}`)).toHaveLength(1);
  });

  it('tapping a finished card makes it current again', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    fireEvent.click(dips.querySelector('.log-card__body') as Element);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it('the finished card has a keyboard target: a focusable button that Enter or Space makes current', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const target = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / });
    expect(target.tabIndex).toBe(0);
    fireEvent.keyDown(target, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
    // The current card offers no make-current target.
    expect(within(screen.getByRole('article', { name: 'Dips (Bar)' })).queryByRole('button', { name: /^Make Dips \(Bar\) current/ })).toBeNull();
  });

  it('Space on the make-current target works as Enter does', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block(ladder([17], { completedAt: '2030-03-07T10:25:00.000Z' }), { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    fireEvent.keyDown(within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / }), { key: ' ' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it("a tap on a finished card's today chip opens the set sheet and does not make the card current", async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const chip = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getAllByRole('button', { name: '8' })[0] as HTMLElement;
    fireEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Set' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
    expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current');
  });

  it('renders no card before the stored reference is read, so the proposal never flashes', async () => {
    const past = pastPush();
    const today = openToday();
    const db = await openDb(new IDBFactory());
    const store = new Store(db);
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL]), NOW);
    for (const s of [past, today]) await store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    const data = new Data({ store, now: () => NOW });
    await data.load();
    let answer: (v: string) => void = () => {};
    vi.spyOn(data, 'getMeta').mockImplementation(<T,>() => new Promise<T | undefined>((resolve) => { answer = (v) => resolve(v as T); }));
    const sync: SyncActions = {
      connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
      updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
    };
    const ui = {
      connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    };
    render(<AppContext.Provider value={{ data, router: new Router(fakeWindow()), sync, ui }}><LogTab /></AppContext.Provider>);
    await new Promise((r) => setTimeout(r, 10));
    // The proposal (Tue 05 Mar) would show the Push-ups card; nothing shows until the read finished.
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^vs / })).toBeNull();
    answer('none');
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(screen.queryByRole('article', { name: 'Push-ups' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy();
  });

  it('takes write times from data.clock(), not from the ticking now signal', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    // The screen re-renders with a later tick (the session stays open), so a handler that read
    // data.now at render time would write 10:31.
    act(() => { data.now.value = new Date(NOW.getTime() + 60_000); });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }));
    await waitFor(async () => expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks).toHaveLength(2));
    expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks[1]?.updatedAt).toBe(NOW.toISOString());
  });

  it('re-proposes when the stored reference is gone, and changing it writes only the meta key', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: 'deleted-session' });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await store.getMeta(`reference:${today.id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new asks first and writes nothing when declined', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    const confirm = answerConfirm(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^A session from \d\d:\d\d is still open\. Start a new one anyway\?$/);
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new, confirmed, writes a new session that takes over the screen', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(3));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });

  it('Done goes to the Days tab', async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(router.route.value).toEqual({ tab: 'days' });
  });

  it('Done writes nothing: no file write, the queue unchanged (spec 4 U7)', async () => {
    const today = openToday();
    const { store } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    const queueBefore = await store.queue();
    const rowBefore = await store.getRow(pathOf(today));
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).not.toHaveBeenCalled();
    expect(await store.queue()).toEqual(queueBefore);
    expect(await store.getRow(pathOf(today))).toEqual(rowBefore);
  });
});
```

Replace the whole content of `src/ui/components/sync/SyncTab.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import type { SyncStatus } from '../../../sync/engine';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import type { Issue, IssueReason } from '../../../sync/store';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { Router, type RouterWindow } from '../../router';
import { SyncTab } from './SyncTab';

const URL_WITH_QUERY = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';
const STATUS: SyncStatus = { phase: 'idle', online: true, connected: false, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/sync' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const NOW = new Date('2030-03-04T11:00:00.000Z');

async function deps(over: { connected?: boolean; pasteMode?: boolean; pasteUrl?: string; status?: Partial<SyncStatus>; issues?: Issue[]; sessions?: Session[]; exercises?: Exercise[] } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  if (over.exercises !== undefined) await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(over.exercises), NOW);
  for (const s of over.sessions ?? []) await store.writeFile('session', sessionPath(s.date, s.id), sessionFile(s), NOW);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  data.status.value = { ...STATUS, ...over.status };
  data.issues.value = over.issues ?? [];
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(over.connected ?? false), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(over.pasteMode ?? false), pasteUrl: signal<string | undefined>(over.pasteUrl), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const all: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  return { ...all, mount: () => render(<AppContext.Provider value={all}><SyncTab /></AppContext.Provider>) };
}

describe('SyncTab, not connected', () => {
  it('Connect and Paste a code call their actions', async () => {
    const d = await deps();
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Dropbox' }));
    expect(d.sync.connect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a code instead' }));
    expect(d.sync.startPaste).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Not connected.')).toBeTruthy();
  });

  it('still lists the issues and the data the badge counts; no Status without a connection', async () => {
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'c1000000-0000-4000-8000-000000000001', date: '2030-03-02' });
    const d = await deps({
      sessions: [unknown],
      exercises: [exercise()],
      issues: [{ path: '/sessions/2030/2030-03-01_x.json', reason: 'held-back', detail: '/session/date: bad' }],
    });
    d.mount();
    expect(screen.getByText('Held back')).toBeTruthy();
    expect(screen.getByText('Unknown exercise')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeTruthy();
    expect(screen.getByText('Build b1 · storage persistent')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('says Connect again and keeps the data when the device holds local rows', async () => {
    const d = await deps({ status: { queueLength: 2 } });
    d.mount();
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
    expect(screen.getByText(/queued changes are kept/)).toBeTruthy();
  });

  it('shows the Dropbox link as a real link next to the code field (ported shell test)', async () => {
    const d = await deps({ pasteMode: true, pasteUrl: URL_WITH_QUERY });
    d.mount();
    const link = screen.getByRole('link', { name: 'Open Dropbox to get the code' });
    expect(link.getAttribute('href')).toBe(URL_WITH_QUERY);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(document.getElementById('code')).toBeTruthy();
    expect(screen.getByText('Dropbox may ask you to log in inside this sheet')).toBeTruthy();
  });

  it('shows the code field but no link while the login is being prepared; neither outside paste mode', async () => {
    const d = await deps({ pasteMode: true });
    d.mount();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Preparing the Dropbox link…')).toBeTruthy();
    expect(document.getElementById('code')).toBeTruthy();
    act(() => { d.ui.pasteMode.value = false; });
    expect(document.getElementById('code')).toBeNull();
  });

  it('Finish login passes the typed code, kept across a re-render (ported shell test)', async () => {
    const d = await deps({ pasteMode: true, pasteUrl: URL_WITH_QUERY });
    d.mount();
    const field = document.getElementById('code') as HTMLInputElement;
    fireEvent.input(field, { target: { value: ' abc123 ' } });
    act(() => { d.ui.loginError.value = 'login failed'; });
    expect(screen.getByText('login failed')).toBeTruthy();
    expect((document.getElementById('code') as HTMLInputElement).value).toBe(' abc123 ');
    fireEvent.click(screen.getByRole('button', { name: 'Finish login' }));
    expect(d.sync.submitCode).toHaveBeenCalledWith('abc123');
  });
});

describe('SyncTab, connected', () => {
  it('Sync now, Sign out and the status rows', async () => {
    const d = await deps({ connected: true, status: { connected: true, queueLength: 3, heldBackCount: 1, lastError: 'boom' } });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(d.sync.syncNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(d.sync.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3 (1 held back)')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Build b1 · storage persistent')).toBeTruthy();
  });

  it('says Connected in one line and orders the sections as spec 4 §7: Connection, Update, Status, Issues, Data', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    expect(screen.getByText('Connected to Dropbox.')).toBeTruthy();
    const order = Array.from(document.querySelectorAll('.sync section')).map((s) => s.querySelector('h2')?.textContent ?? s.querySelector('button')?.textContent);
    expect(order).toEqual(['Dropbox', 'Update app', 'Status', 'Issues', 'Data']);
  });

  it('the empty-folder choice follows the connection card', async () => {
    const d = await deps({ connected: true, status: { connected: true, emptyFolder: true } });
    d.mount();
    const titles = Array.from(document.querySelectorAll('.sync section h2')).map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual(['Dropbox', 'Empty Dropbox folder']);
  });

  it('counts the retry down as the clock ticks', async () => {
    const d = await deps({ connected: true, status: { connected: true, retryInMs: 10_000 } });
    d.mount();
    expect(screen.getByText('idle · retry in 10 s')).toBeTruthy();
    act(() => { d.data.now.value = new Date(NOW.getTime() + 3_000); });
    expect(screen.getByText('idle · retry in 7 s')).toBeTruthy();
    act(() => { d.data.now.value = new Date(NOW.getTime() + 30_000); });
    expect(screen.getByText('idle · retry in 0 s')).toBeTruthy();
  });

  it('Sync now is disabled while the engine works', async () => {
    const d = await deps({ connected: true, status: { connected: true, phase: 'pulling' } });
    d.mount();
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty folder offers the two choices', async () => {
    const d = await deps({ connected: true, status: { connected: true, emptyFolder: true } });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start with the seed catalog' }));
    expect(d.sync.chooseEmptyFolder).toHaveBeenCalledWith('seed');
    fireEvent.click(screen.getByRole('button', { name: "I'll copy files in, then sync" }));
    expect(d.sync.chooseEmptyFolder).toHaveBeenCalledWith('copy');
  });

  const CARDS: ReadonlyArray<readonly [IssueReason, string, string]> = [
    ['quarantined', 'Quarantined', "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it."],
    ['read-only', 'Read-only', 'Written by a newer app; update this app.'],
    ['needs-update', 'Needs a newer app', 'Written by a newer app; update this app.'],
    ['held-back', 'Held back', 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.'],
    ['duplicate', 'Duplicate file', 'Remove the second file in Dropbox; the first one holds the merged content.'],
    ['remote-deleted', 'Removed from Dropbox', 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.'],
    ['unexpected-file', 'Unexpected file', 'Not a CalisTally file; ignored.'],
    ['push-error', 'Upload failed', 'Retried automatically on the next sync.'],
  ];

  it.each(CARDS)('renders a %s card with its title, path, detail and advice', async (reason, title, advice) => {
    const d = await deps({ connected: true, status: { connected: true }, issues: [{ path: '/sessions/2030/2030-03-04_a.json', reason, detail: `the ${reason} detail` }] });
    d.mount();
    expect(document.querySelectorAll('.sync-issue')).toHaveLength(1);
    const card = document.querySelector('.sync-issue') as HTMLElement;
    expect(within(card).getByText(title)).toBeTruthy();
    expect(within(card).getByText('/sessions/2030/2030-03-04_a.json')).toBeTruthy();
    expect(within(card).getByText(`the ${reason} detail`)).toBeTruthy();
    expect(within(card).getByText(advice)).toBeTruthy();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('renders a soft card for a session with an unknown exercise, linking to its page', async () => {
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'c1000000-0000-4000-8000-000000000002', date: '2030-03-02' });
    const d = await deps({ connected: true, status: { connected: true }, sessions: [unknown], exercises: [exercise()] });
    d.mount();
    const card = document.querySelector('.sync-issue--soft') as HTMLElement;
    expect(within(card).getByText('Unknown exercise')).toBeTruthy();
    expect(within(card).getByText(/block 1: unknown exercise nope/)).toBeTruthy();
    expect(within(card).getByText('Nothing is blocked; the block carries the same flag on the session page.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open the session' }).getAttribute('href')).toBe(`#/days/${unknown.id}`);
  });

  it('shows None without issues', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    d.mount();
    expect(screen.getByText('None.')).toBeTruthy();
  });
});

describe('SyncTab, update', () => {
  it("hides the button without a waiting build; tapping it runs 'reloading' and stays Updating…", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    d.mount();
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
    act(() => { d.ui.updateAvailable.value = true; });
    const button = screen.getByRole('button', { name: 'Update app' });
    fireEvent.click(button);
    expect(d.sync.updateApp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();
    const after = screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement;
    expect(after.disabled).toBe(true);
  });

  it("'busy' once → Still syncing and a second call; 'busy' twice → Could not update, enabled again", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    // The second call stays pending until the test releases it, so the DOM shows the retrying state.
    let release: (r: 'reloading' | 'busy') => void = () => undefined;
    (d.sync.updateApp as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('busy')
      .mockImplementationOnce(() => new Promise<'reloading' | 'busy'>((r) => { release = r; }));
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Still syncing, trying again' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Still syncing, trying again' }) as HTMLButtonElement).disabled).toBe(true);
    release('busy');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Could not update; try again after sync' })).toBeTruthy());
    expect(d.sync.updateApp).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Could not update; try again after sync' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("'busy' then 'reloading' stays Updating…", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    (d.sync.updateApp as ReturnType<typeof vi.fn>).mockResolvedValueOnce('busy').mockResolvedValueOnce('reloading');
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    await waitFor(() => expect(d.sync.updateApp).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
  });

  it('a rejected update ends in Could not update, enabled again', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    (d.sync.updateApp as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no service worker'));
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    const button = await screen.findByRole('button', { name: 'Could not update; try again after sync' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the too-new notice when a newer build wrote files and no update is offered', async () => {
    const d = await deps({ connected: true, status: { connected: true, tooNewSeen: true } });
    d.mount();
    expect(screen.getByText(/A newer version of the app wrote some files/)).toBeTruthy();
  });
});
```

Replace the whole content of `src/ui/components/sync/sync.vm.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../../../sync/engine';
import type { Issue, IssueReason } from '../../../sync/store';
import type { SoftIssue } from '../../data';
import { formatDayLong, formatTime, localDate } from '../../format';
import { block, session } from '../../../model/test-fixtures';
import { syncVm, type SyncVmInput, type UpdateState } from './sync.vm';

const STATUS: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };
const COUNTS = { sessions: 0, exercises: 0, bodyweight: 0 };
const URL = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';

function input(over: Partial<SyncVmInput> = {}): SyncVmInput {
  return {
    status: STATUS, retryLeftMs: undefined, issues: [], softIssues: [], sessions: [], connected: true, loginError: undefined, homeScreenHint: false,
    pasteMode: false, pasteUrl: undefined, persisted: true, updateAvailable: false, updateState: 'idle', buildId: 'b1', counts: COUNTS, ...over,
  };
}

const status = (over: Partial<SyncStatus>): SyncStatus => ({ ...STATUS, ...over });

describe('syncVm connection', () => {
  it('not connected, nothing local', () => {
    expect(syncVm(input({ connected: false })).connection).toEqual({ kind: 'disconnected', hasLocal: false, hint: false, error: undefined, pasteMode: false, pasteUrl: undefined });
  });

  it('not connected with local data or a queue: connect again, data kept', () => {
    expect(syncVm(input({ connected: false, counts: { sessions: 3, exercises: 0, bodyweight: 0 } })).connection).toMatchObject({ kind: 'disconnected', hasLocal: true });
    expect(syncVm(input({ connected: false, status: status({ queueLength: 2 }) })).connection).toMatchObject({ kind: 'disconnected', hasLocal: true });
  });

  it('home-screen hint and login error', () => {
    expect(syncVm(input({ connected: false, homeScreenHint: true })).connection).toMatchObject({ hint: true });
    expect(syncVm(input({ connected: false, loginError: 'login failed' })).connection).toMatchObject({ error: 'login failed' });
  });

  it('shows the last sync error when there is no login error', () => {
    expect(syncVm(input({ connected: false, status: status({ lastError: 'expired' }) })).connection).toMatchObject({ error: 'Last error: expired' });
    expect(syncVm(input({ connected: false, loginError: 'bad code', status: status({ lastError: 'expired' }) })).connection).toMatchObject({ error: 'bad code' });
  });

  it('paste mode with and without url', () => {
    expect(syncVm(input({ connected: false, pasteMode: true })).connection).toMatchObject({ pasteMode: true, pasteUrl: undefined });
    expect(syncVm(input({ connected: false, pasteMode: true, pasteUrl: URL })).connection).toMatchObject({ pasteMode: true, pasteUrl: URL });
  });

  it('empty folder: connected, with the choice card until the owner chooses to copy', () => {
    const empty = syncVm(input({ status: status({ emptyFolder: true }) }));
    expect(empty.connection).toEqual({ kind: 'connected' });
    expect(empty.emptyFolder).toBe(true);
    const copying = syncVm(input({ status: status({ emptyFolder: true, emptyFolderChoice: 'copy' }) }));
    expect(copying.emptyFolder).toBe(false);
    expect(copying.emptyFolderNote).toBe(true);
    expect(syncVm(input({ connected: false, status: status({ emptyFolder: true }) })).emptyFolder).toBe(false);
  });

  it('connected', () => {
    expect(syncVm(input()).connection).toEqual({ kind: 'connected' });
    expect(syncVm(input()).emptyFolder).toBe(false);
  });

  it('Status only when connected; Issues and Data in every state', () => {
    expect(syncVm(input()).showStatus).toBe(true);
    const off = syncVm(input({ connected: false, issues: [{ path: 'p', reason: 'held-back', detail: 'd' }] }));
    expect(off.showStatus).toBe(false);
    expect(off.issues).toHaveLength(1);
  });
});

describe('syncVm update', () => {
  const cases: ReadonlyArray<readonly [UpdateState, string, boolean]> = [
    ['idle', 'Update app', false],
    ['updating', 'Updating…', true],
    ['retrying', 'Still syncing, trying again', true],
    ['failed', 'Could not update; try again after sync', false],
  ];
  it.each(cases)('%s → %s (disabled %s)', (state, label, disabled) => {
    const u = syncVm(input({ updateAvailable: true, updateState: state })).update;
    expect(u).toMatchObject({ show: true, label, disabled, tooNew: false });
    expect(u.note).toBe('A new version of the app is ready.');
  });

  it('is hidden without a waiting build; tooNew only then', () => {
    expect(syncVm(input()).update).toMatchObject({ show: false, tooNew: false, note: undefined });
    expect(syncVm(input({ status: status({ tooNewSeen: true }) })).update).toMatchObject({ show: false, tooNew: true });
    expect(syncVm(input({ status: status({ tooNewSeen: true }), updateAvailable: true })).update).toMatchObject({ show: true, tooNew: false });
  });
});

describe('syncVm status rows', () => {
  const rows = (s: Partial<SyncStatus>) => syncVm(input({ status: status(s) })).statusRows;
  const row = (s: Partial<SyncStatus>, label: string) => rows(s).find((r) => r.label === label);

  it('phase alone, with offline marker and the retry seconds left (counted down by Data, not the raw delay)', () => {
    expect(row({}, 'Phase')).toEqual({ label: 'Phase', value: 'idle' });
    expect(row({ phase: 'pulling', online: false }, 'Phase')).toEqual({ label: 'Phase', value: 'pulling · offline', error: true });
    const phase = (retryLeftMs: number | undefined, retryInMs: number) =>
      syncVm(input({ status: status({ retryInMs }), retryLeftMs })).statusRows.find((r) => r.label === 'Phase');
    expect(phase(4400, 10_000)).toEqual({ label: 'Phase', value: 'idle · retry in 4 s' });
    expect(phase(0, 10_000)).toEqual({ label: 'Phase', value: 'idle · retry in 0 s' });
    expect(phase(undefined, 10_000)).toEqual({ label: 'Phase', value: 'idle' });
  });

  it('last pull and push as local day and time, never when unknown', () => {
    expect(row({}, 'Last pull')).toEqual({ label: 'Last pull', value: 'never' });
    expect(row({}, 'Last push')).toEqual({ label: 'Last push', value: 'never' });
    const iso = '2030-03-04T11:05:00.000Z';
    const expected = `${formatDayLong(localDate(new Date(iso)))} ${formatTime(iso)}`;
    expect(row({ lastPullAt: iso }, 'Last pull')).toEqual({ label: 'Last pull', value: expected });
    expect(row({ lastPushAt: iso }, 'Last push')).toEqual({ label: 'Last push', value: expected });
  });

  it('queued with the held-back count', () => {
    expect(row({ queueLength: 2 }, 'Queued')).toEqual({ label: 'Queued', value: '2' });
    expect(row({ queueLength: 2, heldBackCount: 1 }, 'Queued')).toEqual({ label: 'Queued', value: '2 (1 held back)' });
  });

  it('error row only when there is one', () => {
    expect(row({}, 'Error')).toBeUndefined();
    expect(row({ lastError: 'boom' }, 'Error')).toEqual({ label: 'Error', value: 'boom', error: true });
    expect(rows({ lastError: 'boom' }).map((r) => r.label)).toEqual(['Phase', 'Last pull', 'Last push', 'Queued', 'Error']);
  });

  it('Sync now is disabled unless idle; the copy note shows while the folder stays empty', () => {
    expect(syncVm(input()).syncNowDisabled).toBe(false);
    expect(syncVm(input({ status: status({ phase: 'pushing' }) })).syncNowDisabled).toBe(true);
    expect(syncVm(input()).emptyFolderNote).toBe(false);
    expect(syncVm(input({ status: status({ emptyFolder: true, emptyFolderChoice: 'copy' }) })).emptyFolderNote).toBe(true);
  });
});

describe('syncVm issues', () => {
  const issue = (reason: IssueReason, detail = 'detail'): Issue => ({ path: `sessions/2030/2030-03-04-x.json`, reason, detail });
  const ADVICE: Record<IssueReason, string> = {
    'quarantined': "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it.",
    'read-only': 'Written by a newer app; update this app.',
    'needs-update': 'Written by a newer app; update this app.',
    'held-back': 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.',
    'duplicate': 'Remove the second file in Dropbox; the first one holds the merged content.',
    'remote-deleted': 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.',
    'unexpected-file': 'Not a CalisTally file; ignored.',
    'push-error': 'Retried automatically on the next sync.',
  };

  it.each(Object.keys(ADVICE) as IssueReason[])('one card per %s with its advice', (reason) => {
    const cards = syncVm(input({ issues: [issue(reason, 'the detail')] })).issues;
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toMatchObject({ path: 'sessions/2030/2030-03-04-x.json', reason, detail: 'the detail', advice: ADVICE[reason] });
    expect(card?.title.length).toBeGreaterThan(0);
    expect(card?.sessionId).toBeUndefined();
  });

  it('hard issues come first, then one soft card per session with its session id', () => {
    const s = session([block([], { exerciseId: 'foo', order: 0 }), block([], { order: 1 }), block([], { exerciseId: 'plank', order: 2 })], { id: 'b1000000-0000-4000-8000-000000000001', date: '2030-03-04' });
    const soft: SoftIssue = {
      path: 'sessions/2030/2030-03-04-s.json', sessionId: s.id, date: '2030-03-04',
      issues: [
        { level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise foo' },
        { level: 'soft', path: '/session/blocks/2/sets/1/reps', message: 'plank is measured in seconds' },
      ],
    };
    const cards = syncVm(input({ issues: [issue('held-back')], softIssues: [soft], sessions: [s] })).issues;
    expect(cards.map((c) => c.reason)).toEqual(['held-back', 'soft']);
    expect(cards[1]).toMatchObject({ path: soft.path, sessionId: s.id, title: 'Unknown exercise, metric mismatch' });
    expect(cards[1]?.detail).toBe(`${formatDayLong('2030-03-04')} · block 1: unknown exercise foo · block 3: plank is measured in seconds`);
    expect(cards[1]?.advice).toBe('Nothing is blocked; the block carries the same flag on the session page.');
  });

  it('numbers a block by its canonical position on the session page, not by its index in the file', () => {
    // File order: plank (order 5), a deleted block (order 0), foo (order 1). The page shows foo, then plank.
    const s = session(
      [
        block([], { exerciseId: 'plank', order: 5 }),
        block([], { exerciseId: 'dips', order: 0, deletedAt: '2030-03-04T12:00:00.000Z' }),
        block([], { exerciseId: 'foo', order: 1 }),
      ],
      { id: 'b1000000-0000-4000-8000-000000000002', date: '2030-03-04' },
    );
    const soft: SoftIssue = {
      path: 'p', sessionId: s.id, date: '2030-03-04',
      issues: [
        { level: 'soft', path: '/session/blocks/0/sets/0/reps', message: 'plank is measured in seconds' },
        { level: 'soft', path: '/session/blocks/2/exerciseId', message: 'unknown exercise foo' },
      ],
    };
    const card = syncVm(input({ softIssues: [soft], sessions: [s] })).issues[0];
    expect(card?.detail).toBe(`${formatDayLong('2030-03-04')} · block 2: plank is measured in seconds · block 1: unknown exercise foo`);
  });

  it('leaves the block number out when the session is not at hand', () => {
    const soft: SoftIssue = { path: 'p', sessionId: 'gone', date: '2030-03-04', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise foo' }] };
    expect(syncVm(input({ softIssues: [soft] })).issues[0]?.detail).toBe(`${formatDayLong('2030-03-04')} · unknown exercise foo`);
  });

  it('soft titles name the one kind when there is one', () => {
    const one = (message: string): SoftIssue => ({ path: 'p', sessionId: 's', date: '2030-03-04', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message }] });
    expect(syncVm(input({ softIssues: [one('unknown exercise foo')] })).issues[0]?.title).toBe('Unknown exercise');
    expect(syncVm(input({ softIssues: [one('plank is measured in seconds')] })).issues[0]?.title).toBe('Metric mismatch');
  });

  it('keys are unique across cards for the same path', () => {
    const cards = syncVm(input({ issues: [issue('duplicate'), issue('remote-deleted')] })).issues;
    expect(new Set(cards.map((c) => c.key)).size).toBe(2);
  });
});

describe('syncVm counts and footer', () => {
  it('passes the counts through', () => {
    expect(syncVm(input({ counts: { sessions: 3, exercises: 20, bodyweight: 5 } })).counts).toEqual({ sessions: 3, exercises: 20, bodyweight: 5 });
  });

  it('footer with persistent, not persistent, unknown', () => {
    expect(syncVm(input({ persisted: true })).footer).toBe('Build b1 · storage persistent');
    expect(syncVm(input({ persisted: false })).footer).toBe('Build b1 · storage not persistent');
    expect(syncVm(input({ persisted: undefined })).footer).toBe('Build b1 · storage unknown');
  });
});
```

Create `src/ui/soft-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set, T0, timedSet } from '../model/test-fixtures';
import { blockFlags } from './soft-flags';

const PULL = exercise();
const PLANK = exercise({ id: 'plank', name: 'Plank', metric: 'seconds' });
const OLD = exercise({ id: 'old-hang', name: 'Old hang', metric: 'seconds', deletedAt: T0 });
const catalog = [PULL, PLANK, OLD];

describe('blockFlags', () => {
  it('is empty for a session that matches the catalog, a tombstoned exercise included', () => {
    const s = session([block(ladder([5])), block([timedSet()], { exerciseId: 'old-hang', order: 1 })]);
    expect(blockFlags(s, catalog).size).toBe(0);
  });

  it('flags an unknown exercise and a metric mismatch on the block that has it', () => {
    const unknown = block(ladder([5]), { exerciseId: 'nope' });
    const fine = block(ladder([5]), { order: 1 });
    const mismatch = block([set()], { exerciseId: 'plank', order: 2 });
    const flags = blockFlags(session([unknown, fine, mismatch]), catalog);
    expect([...flags.entries()]).toEqual([
      [unknown.id, ['unknown exercise']],
      [mismatch.id, ['metric mismatch']],
    ]);
  });

  it('names a metric mismatch once for a block with several mismatched sets', () => {
    const mismatch = block([set({ order: 0 }), set({ order: 1 }), timedSet({ order: 2 })], { exerciseId: 'plank' });
    expect(blockFlags(session([mismatch]), catalog).get(mismatch.id)).toEqual(['metric mismatch']);
  });

  it("maps the issue pointer's array index to the block at that index, not to its canonical position", () => {
    // File order: the mismatched plank block first with the highest order, then a fine pull-ups block.
    const mismatch = block([set()], { exerciseId: 'plank', order: 5 });
    const deleted = block(ladder([5]), { exerciseId: 'nope', order: 0, deletedAt: T0 });
    const fine = block(ladder([5]), { order: 1 });
    const flags = blockFlags(session([mismatch, deleted, fine]), catalog);
    expect([...flags.keys()]).toEqual([mismatch.id]);
  });

  it('flags nothing on a deleted session', () => {
    const s = session([block(ladder([5]), { exerciseId: 'nope' })], { deletedAt: T0 });
    expect(blockFlags(s, catalog).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/days/SessionPage.test.tsx src/ui/components/log/LogTab.test.tsx src/ui/components/sync/SyncTab.test.tsx src/ui/components/sync/sync.vm.test.ts src/ui/soft-flags.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/soft-flags.test.ts: Error: Cannot find module './soft-flags' imported from src/ui/soft-flags.test.ts
```


- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/ui/components/days/SessionPage.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { liveBlocks, liveSets } from '../../../model/derive';
import { addBlock, deleteSession, setSessionFields, undeleteSession } from '../../../model/edit';
import type { Session, WorkoutSet } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { useApp } from '../../context';
import { sessionRowById, type SessionRow } from '../../data';
import { lockedSessionRows } from '../../locked';
import { blockFlags } from '../../soft-flags';
import { showToast } from '../../toast';
import { BackBar, Button, Marks, SetChips, Sheet } from '../shared';
import { BlockSheet } from '../log/BlockSheet';
import { ExerciseSearch } from '../log/ExerciseSearch';
import { editSession, editSessionQuiet, showHeldBack } from '../log/outcome';
import { SetSheet } from '../log/SetSheet';
import { justCreated } from './PastSessionSheet';
import { SessionHeaderSheet } from './SessionHeaderSheet';
import { notesChanged, readOnlyReason, sessionPageVm, type BlockRow, type SetRow } from './session-page.vm';

type Open =
  | { kind: 'header' }
  | { kind: 'notes' }
  | { kind: 'tag' }
  | { kind: 'set'; setId: string }
  | { kind: 'add-set'; blockId: string }
  | { kind: 'block'; blockId: string; name: string; up: boolean; down: boolean }
  | { kind: 'search' };

/** The ok row (editable unless tombstoned), or a refused row's session, read-only with the banner's reason. */
type Resolved = { session: Session; row: SessionRow; reason: undefined } | { session: Session; row: undefined; reason: string };

/**
 * Spec 4 §5: the same lookup as the Days list, so the list and the page agree on which file an id
 * opens: the ok row first, then the refused rows `lockedSessionRows` lists (never a duplicate loser).
 */
function resolve(rows: readonly SessionRow[], refused: readonly FileRow[], id: string): Resolved | undefined {
  const row = sessionRowById(rows, id);
  if (row !== undefined) return { session: row.file.session, row, reason: undefined };
  const locked = lockedSessionRows(refused, new Set(rows.map((r) => r.file.session.id))).find((l) => l.session.id === id);
  return locked === undefined ? undefined : { session: locked.session, row: undefined, reason: readOnlyReason(locked.row) };
}

/**
 * Spec 4 §5 "Session page" (`#/days/<sessionId>`): header (date, label, tags, notes), the blocks in
 * canonical order with their sets, totals and indicators, and the edits (set and block sheets, Add
 * set without completedAt, Add block, Delete session with Undo). A refused row is shown read-only
 * with a banner and no edit control; a tombstoned session shows "Deleted" with Undo. An open session
 * renders and edits here too (spec 4 §5); its Days row still goes to the Log tab.
 */
export function SessionPage(p: { sessionId: string }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  /** One write at a time for the page's own buttons (tag chips, Undo): a second tap is ignored. */
  const busy = useSignal(false);
  const close = (): void => {
    open.value = undefined;
  };

  const found = resolve(data.sessions.value, data.refusedRows.value, p.sessionId);
  const pending = found === undefined && justCreated.value === p.sessionId;
  useEffect(() => {
    // The row arrived: the loading state has done its job.
    if (found !== undefined && justCreated.value === p.sessionId) justCreated.value = undefined;
  }, [found !== undefined, p.sessionId]);
  // Just created here (Add past session opens its page at once, spec 4 §5): the store's change has
  // not refreshed the signals yet, so show a loading state instead of "not found".
  if (pending) return <section class="session" aria-busy="true" />;
  if (found === undefined) {
    return (
      <section class="session">
        <BackBar title="Session" onBack={() => router.back()} />
        <p class="session__missing">This session is not here.</p>
      </section>
    );
  }

  const { session, row } = found;
  const vm = sessionPageVm({ session, allSessions: data.liveSessions.value, catalog: data.exerciseById.value, readOnlyReason: found.reason });
  // Edit controls only on an ok row of a live session (spec 4 §5 "Refused rows").
  const editable = row !== undefined && !vm.deleted ? row : undefined;
  const setsById = new Map<string, WorkoutSet>(liveBlocks(session).flatMap(liveSets).map((s) => [s.id, s]));
  // The soft issues the Sync tab lists (none without a catalog, as there), on the block they name.
  const flags = data.catalog.value === undefined ? new Map<string, string[]>() : blockFlags(session, data.exercises.value);

  /** Runs one page write unless one is running; the flag clears when it settles. */
  const guarded = async (write: () => Promise<unknown>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const removeTag = (r: SessionRow, tag: string): void => {
    const now = data.clock();
    void guarded(() => editSession(data, r.path, (f) => setSessionFields(f, { tags: f.session.tags.filter((t) => t !== tag) }, now)));
  };

  const deleteThis = async (r: SessionRow): Promise<void> => {
    if (!window.confirm('Delete this session? Undo is offered for a few seconds.')) return;
    const now = data.clock();
    const path = r.path;
    const written = await editSessionQuiet(data, path, (f) => deleteSession(f, now));
    if (!written.ok) return;
    router.navigate({ tab: 'days' });
    showToast('Session deleted', { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteSession(f, data.clock())) }, 6000);
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  };

  const addBlockTo = async (r: SessionRow, exerciseId: string): Promise<void> => {
    const now = data.clock();
    await editSession(data, r.path, (f) => addBlock(f, exerciseId, now).file);
  };

  const sheet = open.value;
  return (
    <section class="session">
      <BackBar
        title={vm.title}
        onBack={() => router.back()}
        right={editable !== undefined && <Button onClick={() => (open.value = { kind: 'header' })}>Edit</Button>}
      />

      {vm.readOnly !== undefined && (
        <div class="session__banner" role="alert">
          {vm.readOnly.reason}. Open the <a class="session__banner-link" href="#/sync">Sync tab</a> for details.
        </div>
      )}

      {vm.deleted && row !== undefined && (
        <div class="session__deleted">
          <span>Deleted</span>
          <Button disabled={busy.value} onClick={() => void guarded(() => editSession(data, row.path, (f) => undeleteSession(f, data.clock())))}>Undo</Button>
        </div>
      )}

      <div class="session-head">
        {vm.uncertain && (
          <p class="session-head__uncertain">
            <span aria-hidden="true">? </span>
            <span>date estimated by the migration</span>
          </p>
        )}
        <div class="session-head__line">
          {vm.label !== undefined && <span class="session-head__label">{vm.label}</span>}
          {vm.tags.map((t) =>
            editable !== undefined ? (
              <button key={t} type="button" class="session-head__tag" aria-label={`Remove tag ${t}`} disabled={busy.value} onClick={() => removeTag(editable, t)}>
                {t} ×
              </button>
            ) : (
              <span key={t} class="session-head__tag">{t}</span>
            ),
          )}
          {editable !== undefined && (
            <button type="button" class="session-head__tag session-head__tag--add" aria-label="Add tag" onClick={() => (open.value = { kind: 'tag' })}>
              + tag
            </button>
          )}
        </div>
        {editable !== undefined ? (
          <button type="button" class="session-head__notes" aria-label="Edit notes" onClick={() => (open.value = { kind: 'notes' })}>
            {vm.notes ?? <span class="session-head__placeholder">Notes</span>}
          </button>
        ) : (
          vm.notes !== undefined && <p class="session-head__notes">{vm.notes}</p>
        )}
      </div>

      {vm.blocks.map((b) => (
        <BlockView
          key={b.blockId}
          block={b}
          setsById={setsById}
          flags={flags.get(b.blockId) ?? []}
          editable={editable !== undefined}
          onName={() => router.navigate({ tab: 'more', page: 'exercise', id: b.exerciseId })}
          onOptions={() => (open.value = { kind: 'block', blockId: b.blockId, name: b.name, up: b.canMoveUp, down: b.canMoveDown })}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onAddSet={() => (open.value = { kind: 'add-set', blockId: b.blockId })}
        />
      ))}

      {editable !== undefined && (
        <div class="session__foot">
          <Button onClick={() => (open.value = { kind: 'search' })}>Add block</Button>
          <Button kind="danger" onClick={() => void deleteThis(editable)}>Delete session</Button>
        </div>
      )}

      {editable !== undefined && sheet?.kind === 'header' && <SessionHeaderSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'notes' && <NotesSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'tag' && <TagSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'set' && <SetSheet row={editable} setId={sheet.setId} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'add-set' && <SetSheet row={editable} blockId={sheet.blockId} create timed={false} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'block' && (
        <BlockSheet row={editable} blockId={sheet.blockId} name={sheet.name} move={{ up: sheet.up, down: sheet.down }} onClose={close} />
      )}
      {editable !== undefined && sheet?.kind === 'search' && <ExerciseSearch onPick={(id) => addBlockTo(editable, id)} onClose={close} />}
    </section>
  );
}

function BlockView(p: {
  block: BlockRow;
  setsById: ReadonlyMap<string, WorkoutSet>;
  /** Soft-issue flags of the block (soft-flags.ts), shown under its name. */
  flags: readonly string[];
  editable: boolean;
  onName(): void;
  onOptions(): void;
  onTapSet(setId: string): void;
  onAddSet(): void;
}): JSX.Element {
  const b = p.block;
  return (
    <article class="session-block" aria-label={b.name}>
      <div class="session-block__head">
        <h3 class="session-block__name">
          <button type="button" class="session-block__namebtn" onClick={p.onName}>{b.name}</button>
          {b.archived && <span class="session-block__flag">archived</span>}
        </h3>
        {b.load !== undefined && <span class="session-block__load">{b.load}</span>}
        {p.editable && (
          <button type="button" class="session-block__options" aria-label="Block options" onClick={p.onOptions}>⋯</button>
        )}
      </div>
      {p.flags.length > 0 && (
        <p class="session-block__flags">
          {p.flags.map((f) => (
            <span key={f} class="flag">{f}</span>
          ))}
        </p>
      )}
      {b.note !== undefined && <p class="session-block__note">{b.note}</p>}
      {b.noteOnly ? (
        <p class="session-block__empty">no sets recorded</p>
      ) : (
        <div class="session-block__sets">
          {b.sets.map((r) => (
            <SetCell key={r.setId} row={r} set={p.setsById.get(r.setId)} {...(p.editable ? { onTap: p.onTapSet } : {})} />
          ))}
        </div>
      )}
      <div class="session-block__totals">
        {!b.noteOnly && <span>{b.totals}</span>}
        <Marks amount={b.marks.amount} load={b.marks.load} />
        <span class="session-block__exmark">
          exercise <Marks amount={b.exerciseMark} />
        </span>
      </div>
      {p.editable && (
        <div class="session-block__actions">
          <Button onClick={p.onAddSet}>Add set</Button>
        </div>
      )}
    </article>
  );
}

/** One set: its chip (SetChips with one set) and the small line with load, interval and rest below
 *  it. The interval and the rest carry spoken labels, so '+1:02' is never read as rest. */
function SetCell(p: { row: SetRow; set: WorkoutSet | undefined; onTap?(setId: string): void }): JSX.Element | null {
  if (p.set === undefined) return null;
  const meta: { text: string; label: string | undefined }[] = [];
  if (p.row.load !== undefined) meta.push({ text: p.row.load, label: undefined });
  if (p.row.interval !== undefined) meta.push({ text: p.row.interval, label: p.row.intervalLabel });
  if (p.row.rest !== undefined) meta.push({ text: p.row.rest, label: p.row.restLabel });
  const onTap = p.onTap;
  return (
    <div class="session-set">
      <SetChips sets={[p.set]} variant="today" {...(onTap !== undefined ? { onTap: (s: WorkoutSet) => onTap(s.id) } : {})} />
      {meta.length > 0 && (
        <div class="session-set__meta">
          {meta.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              {m.label === undefined ? <span>{m.text}</span> : <span role="img" aria-label={m.label}>{m.text}</span>}
            </Fragment>
          ))}
        </div>
      )}
      {p.row.note !== undefined && <div class="session-set__note">{p.row.note}</div>}
    </div>
  );
}

/** Spec 4 §5: the session notes, multi-line; a blank text removes them (edit.ts trims). A save that
 *  does not change the words the sheet opened with writes nothing (`notesChanged`), so a migrated note
 *  keeps its whitespace and notes another device wrote meanwhile are not overwritten. */
function NotesSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  // The notes as the sheet opened; never re-read from a refreshed row.
  const opened = useRef(p.row.file.session.notes);
  const draft = useSignal(opened.current ?? '');
  const edited = useSignal(false);
  const busy = useSignal(false);
  const save = async (): Promise<void> => {
    if (busy.value) return;
    const text = draft.value;
    if (!edited.value || !notesChanged(opened.current, text)) {
      p.onClose();
      return;
    }
    busy.value = true;
    try {
      const now = data.clock();
      if (await editSession(data, p.row.path, (f) => setSessionFields(f, { notes: text }, now))) p.onClose();
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title="Notes" onClose={p.onClose}>
      <textarea
        class="sessionsheet__notes"
        aria-label="Notes"
        rows={6}
        value={draft.value}
        onInput={(e) => {
          draft.value = e.currentTarget.value;
          edited.value = true;
        }}
      />
      <Button kind="primary" disabled={busy.value} onClick={() => void save()}>Save</Button>
    </Sheet>
  );
}

/** Spec 4 §5: add a tag from those seen in all sessions, or type a new one. */
function TagSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const draft = useSignal('');
  const busy = useSignal(false);
  const own = new Set(p.row.file.session.tags);
  const seen = [...new Set(data.liveSessions.value.flatMap((s) => s.tags))].filter((t) => !own.has(t)).sort((a, b) => a.localeCompare(b));
  const add = async (raw: string): Promise<void> => {
    if (busy.value) return;
    const tag = raw.trim();
    if (tag === '') return;
    busy.value = true;
    try {
      const now = data.clock();
      const ok = await editSession(data, p.row.path, (f) => (f.session.tags.includes(tag) ? f : setSessionFields(f, { tags: [...f.session.tags, tag] }, now)));
      if (ok) p.onClose();
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title="Add tag" onClose={p.onClose}>
      {seen.length > 0 && (
        <div class="tagsheet__seen">
          {seen.map((t) => (
            <button key={t} type="button" class="session-head__tag" disabled={busy.value} onClick={() => void add(t)}>{t}</button>
          ))}
        </div>
      )}
      <input
        class="tagsheet__input"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="New tag"
        aria-label="New tag"
        value={draft.value}
        onInput={(e) => (draft.value = e.currentTarget.value)}
      />
      <Button kind="primary" disabled={busy.value || draft.value.trim() === ''} onClick={() => void add(draft.value)}>Add</Button>
    </Sheet>
  );
}
```

Replace the whole content of `src/ui/components/log/LogScreen.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { addBlock, findBlock } from '../../../model/edit';
import type { Session } from '../../../model/types';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { blockFlags } from '../../soft-flags';
import { Button, Marks, SetChips } from '../shared';
import type { CardVm, LogScreenVm } from './log-screen.vm';
import { currentBlockId } from './log-state';
import { BlockSheet } from './BlockSheet';
import { ExerciseSearch } from './ExerciseSearch';
import { editSession } from './outcome';
import { SetSheet } from './SetSheet';
import { PickerSheet } from './StartPicker';
import { useWriteGuard } from './use-write-guard';

type Open =
  | { kind: 'picker'; mode: 'start' | 'change' }
  | { kind: 'set'; setId: string }
  | { kind: 'block'; blockId: string; name: string }
  | { kind: 'search' };

/** Spec 4 §4 "The screen": header, cards, Other exercise…, Done. The entry area is rendered by LogTab.
 *  `reference` is the session the cards compare against (for the soft-issue flags of its blocks). */
export function LogScreen(p: { row: SessionRow; vm: LogScreenVm; reference?: Session | undefined }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  const close = (): void => {
    open.value = undefined;
  };
  const { header } = p.vm;
  const path = p.row.path;

  // One Start at a time (a card's Start, or a pick in the search), held until the card shows the
  // new block: a second tap would add a second block of the exercise, an unpaired extra card.
  const guard = useWriteGuard((blockId) => findBlock(p.row.file.session, blockId) !== undefined);

  const startBlock = (exerciseId: string): Promise<void> =>
    guard.run(async () => {
      const now = data.clock();
      let added: string | undefined;
      const ok = await editSession(data, path, (f) => {
        const result = addBlock(f, exerciseId, now);
        added = result.blockId;
        return result.file;
      });
      if (!ok || added === undefined) return undefined;
      currentBlockId.value = added;
      return added;
    });

  // The soft issues the Sync tab lists (none without a catalog, as there), on the block they name:
  // today's block of the card, else (a not-started card) the reference's block.
  const noFlags = new Map<string, string[]>();
  const catalogHere = data.catalog.value !== undefined;
  const flags = catalogHere ? blockFlags(p.row.file.session, data.exercises.value) : noFlags;
  const refFlags = catalogHere && p.reference !== undefined ? blockFlags(p.reference, data.exercises.value) : noFlags;
  const flagsOf = (c: CardVm): string[] =>
    (c.todayBlockId !== undefined ? flags.get(c.todayBlockId) : c.referenceBlockId !== undefined ? refFlags.get(c.referenceBlockId) : undefined) ?? [];

  const sheet = open.value;
  return (
    <section class="log">
      <header class="log-head">
        <div class="log-head__when">
          {header.date} · {header.startedAt}
        </div>
        <div class="log-head__actions">
          <button type="button" class="log-head__ref" onClick={() => (open.value = { kind: 'picker', mode: 'change' })}>
            {header.reference ?? 'No reference'} ▾
          </button>
          {/* Spec 4 §4 header: label, notes, tags, date and late entries live on the session page (§5). */}
          <Button onClick={() => router.navigate({ tab: 'days', sessionId: p.row.file.session.id })}>Details</Button>
          {header.offline && <span class="log-head__offline">offline</span>}
          <Button onClick={() => (open.value = { kind: 'picker', mode: 'start' })}>Start new</Button>
        </div>
      </header>

      {p.vm.cards.map((c) => (
        <Card
          key={c.key}
          card={c}
          counter={p.vm.counter}
          flags={flagsOf(c)}
          starting={guard.held()}
          onStart={() => void startBlock(c.exerciseId)}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onTapName={(blockId) => (open.value = { kind: 'block', blockId, name: c.name })}
        />
      ))}

      <div class="log-foot">
        <Button onClick={() => (open.value = { kind: 'search' })}>Other exercise…</Button>
        <Button onClick={() => router.navigate({ tab: 'days' })}>Done</Button>
      </div>

      {sheet?.kind === 'picker' && <PickerSheet mode={sheet.mode} sessionId={p.row.file.session.id} onClose={close} />}
      {sheet?.kind === 'set' && <SetSheet row={p.row} setId={sheet.setId} onClose={close} />}
      {sheet?.kind === 'block' && <BlockSheet row={p.row} blockId={sheet.blockId} name={sheet.name} onClose={close} />}
      {sheet?.kind === 'search' && <ExerciseSearch onPick={startBlock} onClose={close} />}
    </section>
  );
}

function Card(p: {
  card: CardVm;
  counter: string | undefined;
  /** Soft-issue flags of the card's block (soft-flags.ts): today's, else the reference's; shown under its name. */
  flags: readonly string[];
  /** A Start is running or waiting for its block to show: every Start is disabled. */
  starting: boolean;
  onStart(): void;
  onTapSet(setId: string): void;
  onTapName(blockId: string): void;
}): JSX.Element {
  const c = p.card;
  const started = c.state !== 'not-started';
  const current = c.state === 'current';
  const todayBlockId = c.todayBlockId;
  // Spec 4 §4: tapping a finished card makes it current again, so a forgotten set can be added there.
  const makeCurrent =
    c.state === 'finished' && todayBlockId !== undefined
      ? () => {
          currentBlockId.value = todayBlockId;
        }
      : undefined;
  // The keyboard and screen-reader target is the part of the body without controls of its own
  // (last time's chips, the note, the totals); a pointer tap anywhere on the body works too.
  const target: JSX.HTMLAttributes<HTMLDivElement> =
    makeCurrent !== undefined
      ? {
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            makeCurrent();
          },
        }
      : {};
  return (
    <article class={`log-card log-card--${c.state}`} aria-label={c.name}>
      <div class="log-card__head">
        <h3 class="log-card__name">
          {todayBlockId === undefined ? (
            c.name
          ) : (
            <button type="button" class="log-card__namebtn" onClick={() => p.onTapName(todayBlockId)}>{c.name}</button>
          )}
          {c.archived && <span class="log-card__archived">archived</span>}
        </h3>
        {started ? <span class="log-card__load">{c.loadText}</span> : <Button kind="primary" disabled={p.starting} onClick={p.onStart}>Start</Button>}
      </div>
      {p.flags.length > 0 && (
        <p class="log-card__flags">
          {p.flags.map((f) => (
            <span key={f} class="flag">{f}</span>
          ))}
        </p>
      )}
      <div class="log-card__body" onClick={makeCurrent}>
        {started && (
          <>
            {c.referenceSets.length > 0 && <div class="log-card__caption">Today</div>}
            {/* A chip tap opens the set sheet only; it never also makes the card current. */}
            <div class="log-card__today" onClick={(e) => e.stopPropagation()}>
              <SetChips
                sets={c.todaySets}
                variant="today"
                proposed={c.proposed}
                onTap={(s) => p.onTapSet(s.id)}
                {...(current && c.todaySets.length > 0 ? { lastIndex: c.todaySets.length - 1 } : {})}
              />
            </div>
          </>
        )}
        <div class={`log-card__rest${makeCurrent !== undefined ? ' is-target' : ''}`} {...target}>
          {/* The target's name comes from its content (so the marks stay readable); this line leads it. */}
          {makeCurrent !== undefined && <span class="visually-hidden">Make {c.name} current. </span>}
          {c.referenceSets.length > 0 && (
            <>
              {started && <div class="log-card__caption">Last time</div>}
              <SetChips sets={c.referenceSets} variant="reference" {...(c.markIndex !== undefined ? { markIndex: c.markIndex } : {})} />
            </>
          )}
          {c.blockNote !== undefined && <p class="log-card__note">{c.blockNote}</p>}
          {c.totals !== undefined && (
            <div class="log-card__totals">
              <span>{c.totals.today}</span>
              {c.totals.reference !== '' && <span>{c.totals.reference}</span>}
              {c.marks !== undefined && <Marks amount={c.marks.amount} load={c.marks.load} provisional />}
              {current && p.counter !== undefined && (
                <span class="log-card__counter" aria-label="Since the last set">{p.counter}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
```

Replace the whole content of `src/ui/components/log/LogTab.tsx` with:

```tsx
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { EntryArea } from './EntryArea';
import { logScreenVm, resolveReference } from './log-screen.vm';
import { currentBlockId, referenceId, referenceLoadedFor } from './log-state';
import { LogScreen } from './LogScreen';
import { StartPicker } from './StartPicker';

/** Spec 4 §4: the start picker without an open session, else the open session (Resume). */
export function LogTab(): JSX.Element {
  const { data } = useApp();
  const row = data.openSession.value;
  return row === undefined ? <StartPicker /> : <OpenSession row={row} />;
}

function OpenSession(p: { row: SessionRow }): JSX.Element {
  const { data } = useApp();
  const today = p.row.file.session;
  const id = today.id;

  // Load the reference choice whenever the open session changes. Until `referenceLoadedFor`
  // names this session nothing is rendered, so the proposal never flashes in before the stored
  // choice (a missing choice re-proposes, §4). A remount for the same session (a tab switch)
  // keeps the choice already read and renders at once.
  useEffect(() => {
    if (referenceLoadedFor.value === id) return;
    let live = true;
    referenceId.value = undefined;
    void data.getMeta<string>(`reference:${id}`).then(
      (v) => {
        if (!live) return;
        referenceId.value = v;
        referenceLoadedFor.value = id;
      },
      () => {
        if (live) referenceLoadedFor.value = id;
      },
    );
    return () => {
      live = false;
    };
  }, [data, id]);

  if (referenceLoadedFor.value !== id) return <section class="log" aria-busy="true" />;

  const reference = resolveReference(referenceId.value, data.liveSessions.value, data.exercises.value, id);
  const vm = logScreenVm({
    today,
    reference,
    catalog: data.exerciseById.value,
    currentBlockId: currentBlockId.value,
    now: data.now.value,
    online: data.status.value.online,
  });
  return (
    <>
      <LogScreen row={p.row} vm={vm} reference={reference} />
      {vm.current !== undefined && <EntryArea row={p.row} current={vm.current} />}
    </>
  );
}
```

Replace the whole content of `src/ui/components/sync/sync.vm.ts` with:

```ts
import { liveBlocks } from '../../../model/derive';
import type { Session } from '../../../model/types';
import type { SyncStatus } from '../../../sync/engine';
import type { Issue, IssueReason } from '../../../sync/store';
import type { SoftIssue } from '../../data';
import { formatDayLong, formatTime, localDate } from '../../format';

/** Spec 4 §7: the Sync tab's pure view model; replaces the shell of spec 3 §12 one to one and adds the soft issues. */

export type UpdateState = 'idle' | 'updating' | 'retrying' | 'failed';

export interface SyncVmInput {
  status: SyncStatus;
  /** `Data.retryLeftMs`: the engine's retry delay counted down against `now`. */
  retryLeftMs: number | undefined;
  issues: Issue[];
  softIssues: SoftIssue[];
  /** The sessions the soft issues name, to number their blocks as the session page shows them. */
  sessions: readonly Session[];
  connected: boolean;
  loginError: string | undefined;
  homeScreenHint: boolean;
  pasteMode: boolean;
  pasteUrl: string | undefined;
  persisted: boolean | undefined;
  updateAvailable: boolean;
  updateState: UpdateState;
  buildId: string;
  counts: { sessions: number; exercises: number; bodyweight: number };
}

export interface IssueCard {
  key: string;
  path: string;
  reason: IssueReason | 'soft';
  title: string;
  detail: string;
  advice: string;
  sessionId?: string;
}

export interface SyncVm {
  connection:
    | { kind: 'disconnected'; hasLocal: boolean; hint: boolean; error: string | undefined; pasteMode: boolean; pasteUrl: string | undefined }
    | { kind: 'connected' };
  /** Spec 3 §11: the first pull found no data files and the owner has not chosen yet. */
  emptyFolder: boolean;
  /** Spec 4 §7: Status only when connected; Issues and Data in every state, so the badge is always explained. */
  showStatus: boolean;
  update: { show: boolean; label: string; disabled: boolean; note: string | undefined; tooNew: boolean };
  statusRows: { label: string; value: string; error?: boolean }[];
  syncNowDisabled: boolean;
  emptyFolderNote: boolean;
  issues: IssueCard[];
  counts: { sessions: number; exercises: number; bodyweight: number };
  footer: string;
}

const UPDATE_LABEL: Record<UpdateState, string> = {
  idle: 'Update app',
  updating: 'Updating…',
  retrying: 'Still syncing, trying again',
  failed: 'Could not update; try again after sync',
};

const UPDATE_NOTE = 'A new version of the app is ready.';

/** Spec 4 §7's table: the title and the action that applies, per reason. */
const CARD_TEXT: Record<IssueReason, { title: string; advice: string }> = {
  'quarantined': { title: 'Quarantined', advice: "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it." },
  'read-only': { title: 'Read-only', advice: 'Written by a newer app; update this app.' },
  'needs-update': { title: 'Needs a newer app', advice: 'Written by a newer app; update this app.' },
  'held-back': { title: 'Held back', advice: 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.' },
  'duplicate': { title: 'Duplicate file', advice: 'Remove the second file in Dropbox; the first one holds the merged content.' },
  'remote-deleted': { title: 'Removed from Dropbox', advice: 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.' },
  'unexpected-file': { title: 'Unexpected file', advice: 'Not a CalisTally file; ignored.' },
  'push-error': { title: 'Upload failed', advice: 'Retried automatically on the next sync.' },
};

// Spec 4 §7: the session page flags the block the card names (src/ui/soft-flags.ts).
const SOFT_ADVICE = 'Nothing is blocked; the block carries the same flag on the session page.';

function when(iso: string | undefined): string {
  if (iso === undefined) return 'never';
  return `${formatDayLong(localDate(new Date(iso)))} ${formatTime(iso)}`;
}

function phaseRow(s: SyncStatus, retryLeftMs: number | undefined): { label: string; value: string; error?: boolean } {
  let value: string = s.phase;
  if (!s.online) value += ' · offline';
  if (retryLeftMs !== undefined) value += ` · retry in ${Math.round(retryLeftMs / 1000)} s`;
  return s.online ? { label: 'Phase', value } : { label: 'Phase', value, error: true };
}

function statusRows(s: SyncStatus, retryLeftMs: number | undefined): SyncVm['statusRows'] {
  const rows: SyncVm['statusRows'] = [
    phaseRow(s, retryLeftMs),
    { label: 'Last pull', value: when(s.lastPullAt) },
    { label: 'Last push', value: when(s.lastPushAt) },
    { label: 'Queued', value: `${s.queueLength}${s.heldBackCount > 0 ? ` (${s.heldBackCount} held back)` : ''}` },
  ];
  if (s.lastError !== undefined) rows.push({ label: 'Error', value: s.lastError, error: true });
  return rows;
}

/**
 * 'block N: ' with N the block's 1-based position among the session's live blocks in canonical order,
 * as the session page lists them (the pointer's index is the file's array position, which carries no
 * meaning, spec 1 §3). Empty when the session or the block is not at hand.
 */
function blockNumber(pointer: string, session: Session | undefined): string {
  const m = /^\/session\/blocks\/(\d+)/.exec(pointer);
  if (m?.[1] === undefined || session === undefined) return '';
  const target = session.blocks[Number(m[1])];
  const position = target === undefined ? -1 : liveBlocks(session).indexOf(target);
  return position < 0 ? '' : `block ${position + 1}: `;
}

function softCard(soft: SoftIssue, session: Session | undefined): IssueCard {
  const unknown = soft.issues.some((i) => i.message.startsWith('unknown exercise'));
  const metric = soft.issues.some((i) => !i.message.startsWith('unknown exercise'));
  const kinds: string[] = [];
  if (unknown) kinds.push('Unknown exercise');
  if (metric) kinds.push(unknown ? 'metric mismatch' : 'Metric mismatch');
  return {
    key: `soft:${soft.path}`,
    path: soft.path,
    reason: 'soft',
    title: kinds.join(', '),
    detail: [formatDayLong(soft.date), ...soft.issues.map((i) => `${blockNumber(i.path, session)}${i.message}`)].join(' · '),
    advice: SOFT_ADVICE,
    sessionId: soft.sessionId,
  };
}

export function syncVm(input: SyncVmInput): SyncVm {
  const s = input.status;
  const c = input.counts;
  const hasLocal = s.queueLength > 0 || c.sessions > 0 || c.exercises > 0 || c.bodyweight > 0;

  let connection: SyncVm['connection'];
  if (!input.connected) {
    connection = {
      kind: 'disconnected',
      hasLocal,
      hint: input.homeScreenHint,
      error: input.loginError ?? (s.lastError !== undefined ? `Last error: ${s.lastError}` : undefined),
      pasteMode: input.pasteMode,
      pasteUrl: input.pasteUrl,
    };
  } else {
    connection = { kind: 'connected' };
  }

  const update: SyncVm['update'] = {
    show: input.updateAvailable,
    label: UPDATE_LABEL[input.updateState],
    disabled: input.updateState === 'updating' || input.updateState === 'retrying',
    note: input.updateAvailable ? UPDATE_NOTE : undefined,
    tooNew: !input.updateAvailable && s.tooNewSeen,
  };

  const hard: IssueCard[] = input.issues.map((i, n) => ({
    key: `${i.reason}:${i.path}:${n}`,
    path: i.path,
    reason: i.reason,
    title: CARD_TEXT[i.reason].title,
    detail: i.detail,
    advice: CARD_TEXT[i.reason].advice,
  }));

  const byId = new Map(input.sessions.map((x) => [x.id, x]));
  return {
    connection,
    emptyFolder: input.connected && s.emptyFolder && s.emptyFolderChoice !== 'copy',
    showStatus: input.connected,
    update,
    statusRows: statusRows(s, input.retryLeftMs),
    syncNowDisabled: s.phase !== 'idle',
    emptyFolderNote: s.emptyFolder && s.emptyFolderChoice === 'copy',
    issues: [...hard, ...input.softIssues.map((soft) => softCard(soft, byId.get(soft.sessionId)))],
    counts: { ...c },
    footer: `Build ${input.buildId} · storage ${input.persisted === undefined ? 'unknown' : input.persisted ? 'persistent' : 'not persistent'}`,
  };
}
```

Create `src/ui/soft-flags.ts`:

```ts
import { checkCatalogRules } from '../model/validate';
import type { Exercise, Session } from '../model/types';

export type BlockFlag = 'unknown exercise' | 'metric mismatch';

const POINTER = /^\/session\/blocks\/(\d+)\/(exerciseId|sets\/)/;

/**
 * Spec 4 §7 and §12: the soft catalog issues of `session` (`checkCatalogRules`, spec 1 §5) per
 * block id, each kind once, so the session page and the Log cards flag the block the Sync tab's
 * soft card names. The pointer's index is the block's position in the file's `blocks` array.
 * Blocks without an issue are absent.
 */
export function blockFlags(session: Session, catalog: readonly Exercise[]): Map<string, string[]> {
  const flags = new Map<string, BlockFlag[]>();
  for (const issue of checkCatalogRules(session, catalog)) {
    const m = POINTER.exec(issue.path);
    if (m?.[1] === undefined) continue;
    const blockId = session.blocks[Number(m[1])]?.id;
    if (blockId === undefined) continue;
    const flag: BlockFlag = m[2] === 'exerciseId' ? 'unknown exercise' : 'metric mismatch';
    const list = flags.get(blockId) ?? [];
    if (!list.includes(flag)) list.push(flag);
    flags.set(blockId, list);
  }
  return flags;
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .flag (soft-issue badge under a block name: days/SessionPage, log/LogScreen; src/ui/soft-flags.ts) ---- */
.flag {
  display: inline-block; padding: 1px 8px; border: 1px solid var(--accent); border-radius: 999px;
  color: var(--accent); font-size: 12px; line-height: 18px; white-space: nowrap;
}
.session-block__flags, .log-card__flags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 88 test files and 1227 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/days/SessionPage.test.tsx src/ui/components/days/SessionPage.tsx src/ui/components/log/LogScreen.tsx src/ui/components/log/LogTab.test.tsx src/ui/components/log/LogTab.tsx src/ui/components/sync/SyncTab.test.tsx src/ui/components/sync/sync.vm.test.ts src/ui/components/sync/sync.vm.ts src/ui/soft-flags.test.ts src/ui/soft-flags.ts src/ui/theme.css
git commit -m "Flag blocks with soft catalog issues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


### Task 7: Corrections from using 4a, device checklist, CLAUDE.md, push and PR

Spec 4 §12 lists "corrections the owner collected while using 4a" as part of plan 4b. They are not known while this plan is written, so this task is a procedure, not code.

- [ ] **Step 1: Collect the corrections**

Ask the owner for the list of corrections they collected while training with plan 4a (or read it where they keep it). For each one, agree in one sentence what changes and in which screen. A correction that changes the spec (a new behaviour, a changed rule) is first written into spec 4 with the date and the owner's approval; one that only fixes code to match the spec needs no spec change.

- [ ] **Step 2: Fix each correction test-first**

For each correction, in the plan 4a/4b style: a failing test in the view model or component test file of the screen (Node first, happy-dom only when the correction is an interaction), the minimal change, `npm test` and `npm run typecheck` green, one commit per correction with an imperative message.

- [ ] **Step 3: Verify everything**

Run: `npm test`, `npm run typecheck`, `npm run build`. Expected: all green; the counts of Task 6's last step plus the tests the corrections added.

- [ ] **Step 4: Update CLAUDE.md**

Status: spec 4 implemented (plans 4a and 4b). Repo layout: `src/ui/components/more/` (exercise list and history, calendar, bodyweight, catalog), `src/model/edit-bodyweight.ts`, `src/model/edit-catalog.ts`, `src/ui/soft-flags.ts`, `components/shared/ExerciseForm.tsx`, `ClashSheet.tsx`. "To fill in later": remove the plan 4b line; keep CSV export (deferred, U10), v1.1 overload calculations, lint/format tooling.

```bash
git add CLAUDE.md
git commit -m "Record plan 4b in CLAUDE.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/training-views-4b
gh pr create --base main --head feat/training-views-4b --title "Training views, part 4b: the More tab" --body-file pr-body.md
```

`pr-body.md` (not committed): what 4b delivers, the corrections applied, the test counts, the device checklist below as unticked boxes, and the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The owner merges.

- [ ] **Step 6: Device checklist (after the merge and deploy, with the owner)**

On the installed iPhone app, one step at a time:

1. Update the app from the Sync tab.
2. More → Exercises: grouped by family, last date per exercise; archived ones collapsed. Open one: its history, newest first, with run numbers, totals, indicators and load; a row opens the session.
3. More → Calendar: the current month on top with coloured dots; scrolling down loads earlier months; a day opens its sessions; the streak is plausible.
4. More → Bodyweight: the line above the list; add an entry (it appears in `bodyweight.json` after a sync); edit it; delete and Undo.
5. More → Catalog: rename an exercise (its history keeps it); a rename onto an existing name offers that entry instead; archive and unarchive; Delete is offered only for an exercise without history; metric and per side are shown locked.
6. A block whose exercise is unknown (only if one exists) shows the flag on the session page and the Sync tab names it.
