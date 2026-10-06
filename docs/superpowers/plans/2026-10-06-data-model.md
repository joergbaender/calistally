# Data Model Implementation Plan (spec 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-model layer of CalisTally: schema, inferred types, emitted JSON Schema, validation, versioning, record helpers, slug and catalog helpers, seed catalog and derived-value functions, all covered by tests, with no UI, sync or XLSX code.

**Architecture:** One TypeBox schema definition (`src/model/schema.ts`) is the single source. TS types are inferred from it and JSON Schema files are emitted from it. Everything else is pure functions over those types: `validate.ts` (two validation levels), `upgrade.ts` + `read.ts` (version gate), `record.ts` (tombstones, `updatedAt`, `order`), `slug.ts` + `catalog.ts` (ids and names), `seed.ts`, and `derive/` (ordering, totals, indicators, intervals, filter). No I/O except the schema-emit script.

**Tech Stack:** Node.js LTS, TypeScript (strict), Vitest, `@sinclair/typebox` (schema + `Value` validator), `tsx` to run the emit script. No Vite yet (that comes with the UI in spec 4).

**Spec:** `docs/superpowers/specs/2026-10-06-data-model-design.md`. The plan argues from the spec; executors read both. Section references below (§3, §5, §7 …) are to the spec.

**Why TypeBox and not Zod 4.** Both infer TS types and can produce JSON Schema. The difference that matters for D14 ("the three can't drift"): a TypeBox schema object *is* a JSON Schema, so the emitted file equals the object the app validates with, byte for byte after `JSON.stringify`. Zod emits JSON Schema by translation, and anything the translation can't express (refinements, some transforms) silently weakens the file that spec 2's migration script will validate against. TypeBox's `Value.Check` also needs no `new Function`, which Ajv needs and which a PWA's content-security policy may forbid. Cost: TypeBox's error messages are plainer, and the `WorkoutSet` "exactly one of `reps`/`seconds`" rule is written as a union of two object shapes rather than a refinement.

**One deviation from the spec's file names.** Spec §8 lists `src/model/derive.ts`. The derived rules are split into `src/model/derive/{order,totals,compare,time,filter}.ts` with an `index.ts` barrel, because each file then holds one group of §7 rules and its tests. Everything else uses the spec's paths.

## Global Constraints

- Node.js LTS (22 or newer) must be installed; it is not installed on the dev PC at the time of writing (`winget` is).
- TypeScript `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. An optional field is **absent**, never `undefined`; helpers remove keys rather than set `undefined`.
- `MODEL_VERSION = 1`. Every file carries `schemaVersion`.
- Timestamps are UTC in exactly `YYYY-MM-DDTHH:mm:ss.sssZ` (`Date.prototype.toISOString()`); dates are `YYYY-MM-DD`.
- Record ids: uuid (lowercase) for sessions, blocks, sets, bodyweight entries; `^[a-z0-9]+(-[a-z0-9]+)*$` for exercises.
- `reps`, `seconds`, bodyweight `kg` > 0; `loadKg`, `restSec` ≥ 0; `loadKg = 0` iff `bodyweight`; `added`/`assist` need `loadKg > 0`.
- No `side` field on sets (D17). No 0-rep sets (D18).
- Strict schemas reject unknown properties; the lenient variant (too-new files only) ignores them.
- English for UI strings and seed names (D10).
- **Never commit training data.** All fixtures are synthetic: made-up numbers, dates in 2030.
- Commit messages: plain imperative sentence, as in the repo's history (`Add …`, `Revise …`). End every commit message with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commit to the branch `spec/data-model`. Do not push.

## Review Focus

Input classes the spec implies but no task's tests originally exercised. Each has been pinned to a test in the owning task.

1. A session whose `date` was edited after live logging, so `startedAt` is on a different day: session order must follow `date`, not the timestamps. → Task 10, test "orders by date before time key".
2. A block whose `exerciseId` resolves only to a tombstoned catalog entry: the day-list filter must still place the session under that exercise's pattern, not drop it. → Task 13, test "uses a tombstoned exercise's pattern".
3. A set interval that crosses midnight UTC (`23:59` → `00:01` next day): string order of timestamps and `Date.parse` must agree. → Task 13, test "spans midnight".
4. A block whose sets were all deleted: it still counts as block *n* for positional matching and shows `–`. → Task 12, test "a block with only deleted sets counts as block n and shows none".
5. An in-memory object with explicit `undefined` values (`{ note: undefined }`): write-time validation must validate the JSON that will actually be stored, where the key is gone. → Task 6, test "validateForWrite validates the JSON form".

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `package-lock.json` (generated), `tsconfig.json`
- Create: `src/model/schema.ts` (only `MODEL_VERSION` for now)
- Test: `src/model/schema.test.ts`

**Interfaces:**
- Produces: `npm test` (Vitest), `npm run typecheck` (tsc), `MODEL_VERSION` from `src/model/schema.ts`.

- [ ] **Step 1: Install Node.js LTS (ask the owner before installing system software)**

Run in PowerShell:
```powershell
winget install OpenJS.NodeJS.LTS
```
Open a **new** terminal afterwards so `PATH` is refreshed, then:
```powershell
node --version   # expected: v22.x or newer
npm --version
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "calistally",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "emit-schema": "tsx scripts/emit-schema.ts"
  }
}
```

- [ ] **Step 3: Install dependencies**

```powershell
npm install @sinclair/typebox
npm install --save-dev typescript vitest tsx @types/node
```
Expected: `node_modules/` appears (already gitignored), `package-lock.json` is created.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 5: Write the first failing test**

`src/model/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MODEL_VERSION } from './schema';

describe('model version', () => {
  it('starts at 1', () => {
    expect(MODEL_VERSION).toBe(1);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module './schema'` (or similar).

- [ ] **Step 7: Create `src/model/schema.ts`**

```ts
export const MODEL_VERSION = 1;
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 1 test passes; tsc prints nothing.

- [ ] **Step 9: Commit**

```powershell
git add package.json package-lock.json tsconfig.json src/model/schema.ts src/model/schema.test.ts
git commit -m "Add TypeScript project scaffold with Vitest and TypeBox" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Schema and types for the catalog and bodyweight files

**Files:**
- Modify: `src/model/schema.ts`
- Create: `src/model/types.ts`, `src/model/test-fixtures.ts`
- Test: `src/model/schema.test.ts`

**Interfaces:**
- Produces from `schema.ts`: `MODEL_VERSION`, `DATE_PATTERN`, `TIMESTAMP_PATTERN`, `UUID_PATTERN`, `EXERCISE_ID_PATTERN`, `PATTERNS`, `LOAD_TYPES`, `SESSION_LABELS`, `buildModel(strict: boolean)`, `Strict`, `Lenient` (each with `.Exercise`, `.BodyweightEntry`, `.ExercisesFile`, `.BodyweightFile`; Task 3 adds `.WorkoutSet`, `.Block`, `.Session`, `.SessionFile`).
- Produces from `types.ts`: `Exercise`, `BodyweightEntry`, `ExercisesFile`, `BodyweightFile`, `Pattern`, `LoadType`, `RecordMeta`, `FileKind`.
- Produces from `test-fixtures.ts`: `T0`, `uuid()`, `exercise(over?)`, `bodyweight(over?)`, `exercisesFile(exercises?)`, `bodyweightFile(entries?)`.

- [ ] **Step 1: Write the failing tests**

Replace `src/model/schema.test.ts` with:
```ts
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { Lenient, MODEL_VERSION, Strict } from './schema';
import { T0, bodyweight, bodyweightFile, exercise, exercisesFile } from './test-fixtures';

describe('model version', () => {
  it('starts at 1', () => {
    expect(MODEL_VERSION).toBe(1);
  });
});

describe('Exercise schema', () => {
  it('accepts a complete exercise', () => {
    expect(Value.Check(Strict.Exercise, exercise())).toBe(true);
  });

  it('accepts a tombstone and optional fields', () => {
    const e = exercise({ deletedAt: T0, family: 'Pull-ups', cues: 'slow' });
    expect(Value.Check(Strict.Exercise, e)).toBe(true);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['an uppercase id', { id: 'Pull-Ups' }],
    ['a double hyphen in the id', { id: 'pull--ups' }],
    ['a leading hyphen in the id', { id: '-pull-ups' }],
    ['an unknown pattern', { pattern: 'arms' }],
    ['an unknown metric', { metric: 'distance' }],
    ['an unknown load type', { defaultLoadType: 'chains' }],
    ['a timestamp without milliseconds', { updatedAt: '2030-01-01T10:00:00Z' }],
    ['a timestamp with an offset', { updatedAt: '2030-01-01T10:00:00.000+02:00' }],
    ['an empty family', { family: '' }],
    ['a missing archived flag', { archived: undefined }],
    ['an unknown property', { colour: 'red' }],
  ])('rejects %s', (_label, over) => {
    const value = JSON.parse(JSON.stringify({ ...exercise(), ...over }));
    expect(Value.Check(Strict.Exercise, value)).toBe(false);
  });

  it('ignores unknown properties in lenient mode', () => {
    expect(Value.Check(Lenient.Exercise, { ...exercise(), colour: 'red' })).toBe(true);
  });

  it('still rejects invalid known fields in lenient mode', () => {
    expect(Value.Check(Lenient.Exercise, { ...exercise(), name: '' })).toBe(false);
  });
});

describe('BodyweightEntry schema', () => {
  it('accepts an entry', () => {
    expect(Value.Check(Strict.BodyweightEntry, bodyweight())).toBe(true);
  });

  it.each([
    ['kg of 0', { kg: 0 }],
    ['a negative kg', { kg: -1 }],
    ['a date without zero padding', { date: '2030-1-1' }],
    ['an uppercase uuid', { id: '00000000-0000-4000-8000-00000000000A' }],
    ['an empty note', { note: '' }],
  ])('rejects %s', (_label, over) => {
    expect(Value.Check(Strict.BodyweightEntry, { ...bodyweight(), ...over })).toBe(false);
  });
});

describe('file wrappers', () => {
  it('accepts valid files', () => {
    expect(Value.Check(Strict.ExercisesFile, exercisesFile([exercise()]))).toBe(true);
    expect(Value.Check(Strict.BodyweightFile, bodyweightFile([bodyweight()]))).toBe(true);
  });

  it.each([
    ['version 0', 0],
    ['a fractional version', 1.5],
    ['a string version', '1'],
  ])('rejects %s', (_label, schemaVersion) => {
    expect(Value.Check(Strict.ExercisesFile, { ...exercisesFile(), schemaVersion })).toBe(false);
  });

  it('rejects an unknown top-level property', () => {
    expect(Value.Check(Strict.ExercisesFile, { ...exercisesFile(), extra: 1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Strict` / `./test-fixtures` not found.

- [ ] **Step 3: Write `src/model/schema.ts`**

```ts
import { Type, type TProperties } from '@sinclair/typebox';

export const MODEL_VERSION = 1;

// Patterns are shared with the emitted JSON Schema, so they are plain strings, not RegExp.
export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const EXERCISE_ID_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

export const PATTERNS = ['push', 'pull', 'legs', 'core', 'shoulders', 'neck', 'conditioning', 'other'] as const;
export const LOAD_TYPES = ['bodyweight', 'added', 'assist', 'external', 'band'] as const;
export const SESSION_LABELS = ['pull', 'push', 'legs', 'mixed', 'other'] as const;

function literals<T extends string>(values: readonly T[]) {
  return Type.Union(values.map((v) => Type.Literal(v)));
}

/**
 * Builds every schema. `strict: true` rejects unknown properties and is used for files at the
 * app's own version. `strict: false` ignores unknown properties and is used only to read a file
 * whose schemaVersion is newer than the app (spec §5, D9).
 */
export function buildModel(strict: boolean) {
  const obj = <P extends TProperties>(props: P) =>
    strict ? Type.Object(props, { additionalProperties: false }) : Type.Object(props);

  const DateString = Type.String({ pattern: DATE_PATTERN });
  const Timestamp = Type.String({ pattern: TIMESTAMP_PATTERN });
  const Uuid = Type.String({ pattern: UUID_PATTERN });
  const Text = Type.String({ minLength: 1 });
  const Positive = Type.Number({ exclusiveMinimum: 0 });
  const NonNegative = Type.Number({ minimum: 0 });
  const Version = Type.Integer({ minimum: 1 });

  const meta = { updatedAt: Timestamp, deletedAt: Type.Optional(Timestamp) };

  const Exercise = obj({
    ...meta,
    id: Type.String({ pattern: EXERCISE_ID_PATTERN }),
    name: Text,
    family: Type.Optional(Text),
    pattern: literals(PATTERNS),
    metric: literals(['reps', 'seconds'] as const),
    perSide: Type.Boolean(),
    defaultLoadType: literals(LOAD_TYPES),
    cues: Type.Optional(Text),
    archived: Type.Boolean(),
  });

  const BodyweightEntry = obj({
    ...meta,
    id: Uuid,
    date: DateString,
    kg: Positive,
    note: Type.Optional(Text),
  });

  const ExercisesFile = obj({ schemaVersion: Version, exercises: Type.Array(Exercise) });
  const BodyweightFile = obj({ schemaVersion: Version, entries: Type.Array(BodyweightEntry) });

  return { Exercise, BodyweightEntry, ExercisesFile, BodyweightFile };
}

export const Strict = buildModel(true);
export const Lenient = buildModel(false);
```

- [ ] **Step 4: Write `src/model/types.ts`**

```ts
import type { Static } from '@sinclair/typebox';
import { Strict } from './schema';

export type Exercise = Static<typeof Strict.Exercise>;
export type BodyweightEntry = Static<typeof Strict.BodyweightEntry>;
export type ExercisesFile = Static<typeof Strict.ExercisesFile>;
export type BodyweightFile = Static<typeof Strict.BodyweightFile>;

export type Pattern = Exercise['pattern'];
export type LoadType = Exercise['defaultLoadType'];

/** The fields every stored record has (spec §3). */
export interface RecordMeta {
  updatedAt: string;
  deletedAt?: string;
}

export type FileKind = 'exercises' | 'bodyweight' | 'session';
```

- [ ] **Step 5: Write `src/model/test-fixtures.ts`**

Synthetic data only. Dates are in 2030 so they can never be mistaken for real training history.
```ts
import type { BodyweightEntry, BodyweightFile, Exercise, ExercisesFile } from './types';
import { MODEL_VERSION } from './schema';

export const T0 = '2030-01-01T10:00:00.000Z';

let counter = 0;
/** Deterministic, valid v4-shaped uuids: 00000000-0000-4000-8000-000000000001, …002, … */
export function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function exercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'pull-ups',
    name: 'Pull-ups',
    pattern: 'pull',
    metric: 'reps',
    perSide: false,
    defaultLoadType: 'bodyweight',
    archived: false,
    updatedAt: T0,
    ...over,
  };
}

export function bodyweight(over: Partial<BodyweightEntry> = {}): BodyweightEntry {
  return { id: uuid(), date: '2030-01-01', kg: 80, updatedAt: T0, ...over };
}

export function exercisesFile(exercises: Exercise[] = []): ExercisesFile {
  return { schemaVersion: MODEL_VERSION, exercises };
}

export function bodyweightFile(entries: BodyweightEntry[] = []): BodyweightFile {
  return { schemaVersion: MODEL_VERSION, entries };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; tsc prints nothing. If tsc complains about `{ archived: undefined }` in the `it.each` table, the table's `over` is untyped because of the mixed rows; that is intended (the test builds an invalid object on purpose and the JSON round trip drops the key).

- [ ] **Step 7: Commit**

```powershell
git add src/model/schema.ts src/model/types.ts src/model/test-fixtures.ts src/model/schema.test.ts
git commit -m "Add catalog and bodyweight schemas with inferred types" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Schema and types for sessions, blocks and sets

**Files:**
- Modify: `src/model/schema.ts`, `src/model/types.ts`, `src/model/test-fixtures.ts`
- Test: `src/model/schema.test.ts` (append)

**Interfaces:**
- Produces from `schema.ts`: `Strict.WorkoutSet`, `.Block`, `.Session`, `.SessionFile` (and the `Lenient` twins).
- Produces from `types.ts`: `WorkoutSet` (a union: `{ reps: number, … } | { seconds: number, … }`), `Block`, `Session`, `SessionFile`, `SessionLabel`.
- Produces from `test-fixtures.ts`: `set(over?)`, `timedSet(over?)`, `ladder(reps[], over?)`, `block(sets?, over?)`, `session(blocks?, over?)`, `sessionFile(session?)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/model/schema.test.ts` (and extend the import from `./test-fixtures` with `block, ladder, session, sessionFile, set, timedSet`):
```ts
describe('WorkoutSet schema', () => {
  it('accepts a reps set and a timed set', () => {
    expect(Value.Check(Strict.WorkoutSet, set())).toBe(true);
    expect(Value.Check(Strict.WorkoutSet, timedSet())).toBe(true);
  });

  it('accepts decimal reps', () => {
    expect(Value.Check(Strict.WorkoutSet, set({ reps: 16.5 }))).toBe(true);
  });

  it('accepts every optional field', () => {
    const s = set({ completedAt: T0, note: 'deep' });
    expect(Value.Check(Strict.WorkoutSet, s)).toBe(true);
    expect(Value.Check(Strict.WorkoutSet, set({ restSec: 120, aggregate: true }))).toBe(true);
  });

  it.each([
    ['both reps and seconds', { ...set(), seconds: 30 }],
    ['neither reps nor seconds', { ...set(), reps: undefined }],
    ['0 reps', set({ reps: 0 })],
    ['negative loadKg', set({ loadKg: -1 })],
    ['aggregate: false', { ...set(), aggregate: false }],
    ['an unknown load type', { ...set(), loadType: 'chains' }],
    ['a side field', { ...set(), side: 'L' }],
    ['an unknown property', { ...set(), colour: 'red' }],
  ])('rejects %s', (_label, value) => {
    // JSON round trip: `reps: undefined` becomes a missing key, as it would in the file.
    expect(Value.Check(Strict.WorkoutSet, JSON.parse(JSON.stringify(value)))).toBe(false);
  });

  it('ignores an unknown property in lenient mode', () => {
    expect(Value.Check(Lenient.WorkoutSet, { ...set(), colour: 'red' })).toBe(true);
  });
});

describe('Session schema', () => {
  it('accepts a ladder session', () => {
    const s = session([block(ladder([17, 16, 15, 10]))], { startedAt: T0, label: 'pull', notes: 'sick', tags: ['sick'] });
    expect(Value.Check(Strict.Session, s)).toBe(true);
    expect(Value.Check(Strict.SessionFile, sessionFile(s))).toBe(true);
  });

  it('accepts an empty session and an empty block', () => {
    expect(Value.Check(Strict.Session, session())).toBe(true);
    expect(Value.Check(Strict.Session, session([block()]))).toBe(true);
  });

  it.each([
    ['dateUncertain: "yes"', { dateUncertain: 'yes' }],
    ['a non-timestamp startedAt', { startedAt: '2030-01-01' }],
    ['an unknown label', { label: 'arms' }],
    ['an unknown source', { source: 'live' }],
    ['an empty tag', { tags: [''] }],
    ['missing tags', { tags: undefined }],
    ['an unknown property', { colour: 'red' }],
  ])('rejects %s', (_label, over) => {
    const value = JSON.parse(JSON.stringify({ ...session(), ...over }));
    expect(Value.Check(Strict.Session, value)).toBe(false);
  });

  it('rejects an unknown property on a block', () => {
    expect(Value.Check(Strict.Session, session([{ ...block(), colour: 'red' } as never]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Strict.WorkoutSet` undefined / `set` not exported.

- [ ] **Step 3: Extend `buildModel` in `src/model/schema.ts`**

Insert after `BodyweightEntry` and before the file wrappers:
```ts
  const setCommon = {
    ...meta,
    id: Uuid,
    order: Type.Number(),
    loadType: literals(LOAD_TYPES),
    loadKg: NonNegative,
    completedAt: Type.Optional(Timestamp),
    restSec: Type.Optional(NonNegative),
    aggregate: Type.Optional(Type.Literal(true)),
    note: Type.Optional(Text),
  };
  // "Exactly one of reps / seconds" as a union of two strict shapes: a set with both fails
  // both branches because each branch rejects the other's property.
  const RepsSet = obj({ ...setCommon, reps: Positive });
  const SecondsSet = obj({ ...setCommon, seconds: Positive });
  const WorkoutSet = Type.Union([RepsSet, SecondsSet]);

  const Block = obj({
    ...meta,
    id: Uuid,
    order: Type.Number(),
    exerciseId: Type.String({ pattern: EXERCISE_ID_PATTERN }),
    note: Type.Optional(Text),
    sets: Type.Array(WorkoutSet),
  });

  const Session = obj({
    ...meta,
    id: Uuid,
    date: DateString,
    dateUncertain: Type.Optional(Type.Literal(true)),
    startedAt: Type.Optional(Timestamp),
    label: Type.Optional(literals(SESSION_LABELS)),
    notes: Type.Optional(Text),
    tags: Type.Array(Text),
    source: literals(['app', 'migrated'] as const),
    blocks: Type.Array(Block),
  });

  const SessionFile = obj({ schemaVersion: Version, session: Session });
```
and change the return to:
```ts
  return { Exercise, BodyweightEntry, WorkoutSet, Block, Session, ExercisesFile, BodyweightFile, SessionFile };
```

- [ ] **Step 4: Extend `src/model/types.ts`**

Add:
```ts
export type WorkoutSet = Static<typeof Strict.WorkoutSet>;
export type Block = Static<typeof Strict.Block>;
export type Session = Static<typeof Strict.Session>;
export type SessionFile = Static<typeof Strict.SessionFile>;
export type SessionLabel = NonNullable<Session['label']>;
```

- [ ] **Step 5: Extend `src/model/test-fixtures.ts`**

Add (and extend the type import with `Block, Session, SessionFile, WorkoutSet`):
```ts
export function set(over: Partial<Extract<WorkoutSet, { reps: number }>> = {}): WorkoutSet {
  return { id: uuid(), order: 0, reps: 10, loadType: 'bodyweight', loadKg: 0, updatedAt: T0, ...over };
}

export function timedSet(over: Partial<Extract<WorkoutSet, { seconds: number }>> = {}): WorkoutSet {
  return { id: uuid(), order: 0, seconds: 30, loadType: 'bodyweight', loadKg: 0, updatedAt: T0, ...over };
}

/** A block's sets from a list of rep counts, e.g. ladder([17, 16, 15]). */
export function ladder(reps: number[], over: Partial<Extract<WorkoutSet, { reps: number }>> = {}): WorkoutSet[] {
  return reps.map((r, i) => set({ reps: r, order: i, ...over }));
}

export function block(sets: WorkoutSet[] = [], over: Partial<Block> = {}): Block {
  return { id: uuid(), order: 0, exerciseId: 'pull-ups', sets, updatedAt: T0, ...over };
}

export function session(blocks: Block[] = [], over: Partial<Session> = {}): Session {
  return { id: uuid(), date: '2030-01-01', tags: [], source: 'app', blocks, updatedAt: T0, ...over };
}

export function sessionFile(s: Session = session()): SessionFile {
  return { schemaVersion: MODEL_VERSION, session: s };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 7: Commit**

```powershell
git add src/model/schema.ts src/model/types.ts src/model/test-fixtures.ts src/model/schema.test.ts
git commit -m "Add session, block and set schemas" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Emit the JSON Schema files and guard against drift

**Files:**
- Create: `src/model/schema-files.ts`, `scripts/emit-schema.ts`
- Create (generated): `schema/exercises-file.schema.json`, `schema/bodyweight-file.schema.json`, `schema/session-file.schema.json`
- Test: `src/model/schema-files.test.ts`

**Interfaces:**
- Produces: `SCHEMA_FILES` (name → TypeBox schema), `schemaDocument(schema)` → plain JSON Schema object with `$schema`.

- [ ] **Step 1: Write the failing test**

`src/model/schema-files.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_FILES, schemaDocument } from './schema-files';

describe('emitted JSON Schema files', () => {
  it.each(Object.keys(SCHEMA_FILES))('schema/%s.schema.json matches the schema definition', (name) => {
    const onDisk = JSON.parse(readFileSync(`schema/${name}.schema.json`, 'utf8'));
    const expected = schemaDocument(SCHEMA_FILES[name as keyof typeof SCHEMA_FILES]);
    // If this fails, run `npm run emit-schema` and commit the result.
    expect(onDisk).toEqual(expected);
  });

  it('declares draft-07 and forbids unknown properties at the top level', () => {
    const doc = schemaDocument(SCHEMA_FILES['session-file']) as { $schema: string; additionalProperties: boolean };
    expect(doc.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(doc.additionalProperties).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, `./schema-files` not found.

- [ ] **Step 3: Write `src/model/schema-files.ts`**

```ts
import type { TSchema } from '@sinclair/typebox';
import { Strict } from './schema';

/** The three file formats, by the name of their emitted schema file (schema/<name>.schema.json). */
export const SCHEMA_FILES = {
  'exercises-file': Strict.ExercisesFile,
  'bodyweight-file': Strict.BodyweightFile,
  'session-file': Strict.SessionFile,
} as const;

/** The JSON Schema document for a TypeBox schema: the schema itself (JSON round trip drops
 *  TypeBox's symbol keys) with a draft declaration in front. */
export function schemaDocument(schema: TSchema): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...(JSON.parse(JSON.stringify(schema)) as Record<string, unknown>),
  };
}
```

- [ ] **Step 4: Write `scripts/emit-schema.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCHEMA_FILES, schemaDocument } from '../src/model/schema-files';

mkdirSync('schema', { recursive: true });
for (const [name, schema] of Object.entries(SCHEMA_FILES)) {
  const path = `schema/${name}.schema.json`;
  writeFileSync(path, `${JSON.stringify(schemaDocument(schema), null, 2)}\n`);
  console.log(`wrote ${path}`);
}
```

- [ ] **Step 5: Emit the files, then run tests and typecheck**

Run: `npm run emit-schema && npm test && npm run typecheck`
Expected: three `wrote schema/…` lines; all tests pass. Open `schema/session-file.schema.json` and confirm by eye that a set appears as `anyOf` of two objects, one with `reps` and one with `seconds`, each with `additionalProperties: false`.

- [ ] **Step 6: Commit**

```powershell
git add src/model/schema-files.ts src/model/schema-files.test.ts scripts/emit-schema.ts schema/
git commit -m "Emit JSON Schema files from the TypeBox model and test for drift" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Record helpers (`updatedAt`, tombstones, `order`)

**Files:**
- Create: `src/model/record.ts`
- Test: `src/model/record.test.ts`

**Interfaces:**
- Produces: `nextUpdatedAt(previous?, now?)`, `touch(record, now?)`, `tombstone(record, now?)`, `undelete(record, now?)`, `isDeleted(record)`, `nextOrder(siblings)`, `orderBetween(before, after)`. All return new objects; none mutate.

- [ ] **Step 1: Write the failing tests**

`src/model/record.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isDeleted, nextOrder, nextUpdatedAt, orderBetween, tombstone, touch, undelete } from './record';
import { T0, block, ladder, session } from './test-fixtures';

const later = new Date('2030-01-01T11:00:00.000Z');
const earlier = new Date('2030-01-01T09:00:00.000Z');

describe('nextUpdatedAt', () => {
  it('uses the clock when there is no previous value', () => {
    expect(nextUpdatedAt(undefined, later)).toBe('2030-01-01T11:00:00.000Z');
  });

  it('uses the clock when it is ahead of the previous value', () => {
    expect(nextUpdatedAt(T0, later)).toBe('2030-01-01T11:00:00.000Z');
  });

  it('moves 1 ms past the previous value when the clock is behind or equal', () => {
    expect(nextUpdatedAt(T0, earlier)).toBe('2030-01-01T10:00:00.001Z');
    expect(nextUpdatedAt(T0, new Date(T0))).toBe('2030-01-01T10:00:00.001Z');
  });
});

describe('touch', () => {
  it('bumps updatedAt and leaves children untouched', () => {
    const s = session([block(ladder([5, 4]))]);
    const touched = touch(s, later);
    expect(touched.updatedAt).toBe('2030-01-01T11:00:00.000Z');
    expect(touched.blocks).toBe(s.blocks);
    expect(s.updatedAt).toBe(T0);
  });
});

describe('tombstone and undelete', () => {
  it('sets deletedAt and updatedAt to the same instant and keeps every field', () => {
    const b = block(ladder([5]), { note: 'steep' });
    const dead = tombstone(b, later);
    expect(dead.deletedAt).toBe('2030-01-01T11:00:00.000Z');
    expect(dead.updatedAt).toBe(dead.deletedAt);
    expect(dead.note).toBe('steep');
    expect(dead.sets).toBe(b.sets);
    expect(isDeleted(dead)).toBe(true);
    expect(isDeleted(b)).toBe(false);
  });

  it('undelete removes deletedAt (the key, not just the value) and bumps updatedAt', () => {
    const dead = tombstone(block(), later);
    const back = undelete(dead, earlier);
    expect('deletedAt' in back).toBe(false);
    expect(back.updatedAt).toBe('2030-01-01T11:00:00.001Z');
  });
});

describe('order helpers', () => {
  it('nextOrder is 0 for no siblings and max + 1 otherwise, deleted siblings included', () => {
    expect(nextOrder([])).toBe(0);
    expect(nextOrder([{ order: 2 }, { order: 5 }, { order: 0.5 }])).toBe(6);
  });

  it('orderBetween is the midpoint', () => {
    expect(orderBetween(1, 2)).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `./record` not found.

- [ ] **Step 3: Write `src/model/record.ts`**

```ts
import type { RecordMeta } from './types';

/** Spec §3 "Setting updatedAt": max(now, previous + 1 ms), so a later edit always wins. */
export function nextUpdatedAt(previous: string | undefined, now: Date = new Date()): string {
  const candidate = now.toISOString();
  if (previous === undefined || candidate > previous) return candidate;
  return new Date(Date.parse(previous) + 1).toISOString();
}

/** A copy with a new updatedAt. Child arrays are the same references: a child change never
 *  touches the parent (spec §3 "What updatedAt covers"). */
export function touch<T extends RecordMeta>(record: T, now?: Date): T {
  return { ...record, updatedAt: nextUpdatedAt(record.updatedAt, now) };
}

export function tombstone<T extends RecordMeta>(record: T, now?: Date): T {
  const at = nextUpdatedAt(record.updatedAt, now);
  return { ...record, updatedAt: at, deletedAt: at };
}

export function undelete<T extends RecordMeta>(record: T, now?: Date): T {
  const { deletedAt: _removed, ...rest } = record;
  return { ...(rest as T), updatedAt: nextUpdatedAt(record.updatedAt, now) };
}

export function isDeleted(record: RecordMeta): boolean {
  return record.deletedAt !== undefined;
}

/** Order for a new sibling: max + 1 over all siblings, deleted ones included. */
export function nextOrder(siblings: readonly { order: number }[]): number {
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
}

/** Order for a sibling inserted between two others; nobody else is renumbered. */
export function orderBetween(before: number, after: number): number {
  return (before + after) / 2;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```powershell
git add src/model/record.ts src/model/record.test.ts
git commit -m "Add record helpers for updatedAt, tombstones and order" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Validation with hard and soft levels

**Files:**
- Create: `src/model/validate.ts`
- Test: `src/model/validate.test.ts`

**Interfaces:**
- Consumes: `Strict`, `Lenient` (Task 3), types (Task 3), fixtures.
- Produces: `IssueLevel`, `ValidationIssue { level, path, message }`, `ValidationResult { ok, issues }`, `validateFile(kind, value, mode?)`, `validateForWrite(kind, value)`, `checkCatalogRules(session, catalog)`, `isCalendarDate(date)`.

- [ ] **Step 1: Write the failing tests**

`src/model/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { checkCatalogRules, isCalendarDate, validateFile, validateForWrite } from './validate';
import {
  T0, block, bodyweight, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile, set, timedSet, uuid,
} from './test-fixtures';

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('isCalendarDate', () => {
  it.each(['2030-01-01', '2030-02-29', '2031-12-31'])('accepts %s', (d) => expect(isCalendarDate(d)).toBe(true));
  it.each(['2031-02-29', '2030-02-30', '2030-13-01', '2030-00-10', '2030-1-1', 'x'])('rejects %s', (d) =>
    expect(isCalendarDate(d)).toBe(false),
  );
});

describe('validateFile: schema level', () => {
  it('accepts valid files of every kind', () => {
    expect(validateFile('exercises', exercisesFile([exercise()])).ok).toBe(true);
    expect(validateFile('bodyweight', bodyweightFile([bodyweight()])).ok).toBe(true);
    expect(validateFile('session', sessionFile(session([block(ladder([17, 16]))]))).ok).toBe(true);
  });

  it('reports schema failures with level and path, and does not run hard rules', () => {
    const r = validateFile('exercises', exercisesFile([exercise({ name: '' })]));
    expect(r.ok).toBe(false);
    expect(r.issues.every((i) => i.level === 'schema')).toBe(true);
    expect(r.issues[0]?.path).toBe('/exercises/0/name');
  });

  it('lenient mode ignores unknown properties, strict mode rejects them', () => {
    const file = { ...sessionFile(), future: 1 };
    expect(validateFile('session', file, 'lenient').ok).toBe(true);
    expect(validateFile('session', file, 'strict').ok).toBe(false);
  });
});

describe('validateFile: hard rules', () => {
  const hardPaths = (kind: 'exercises' | 'bodyweight' | 'session', file: unknown) => {
    const r = validateFile(kind, file);
    expect(r.issues.every((i) => i.level === 'hard')).toBe(true);
    return paths(r.issues);
  };

  it('rejects an impossible session date', () => {
    expect(hardPaths('session', sessionFile(session([], { date: '2030-02-30' })))).toEqual(['/session/date']);
  });

  it('rejects an impossible bodyweight date', () => {
    expect(hardPaths('bodyweight', bodyweightFile([bodyweight({ date: '2030-02-30' })]))).toEqual(['/entries/0/date']);
  });

  it('rejects a block that mixes reps and seconds, ignoring deleted sets', () => {
    const mixed = block([set({ order: 0 }), timedSet({ order: 1 })]);
    expect(hardPaths('session', sessionFile(session([mixed])))).toEqual(['/session/blocks/0/sets']);
    const ok = block([set({ order: 0 }), timedSet({ order: 1, deletedAt: T0 })]);
    expect(validateFile('session', sessionFile(session([ok]))).ok).toBe(true);
  });

  it.each([
    ['bodyweight with kg', set({ loadType: 'bodyweight', loadKg: 5 })],
    ['added with 0 kg', set({ loadType: 'added', loadKg: 0 })],
    ['assist with 0 kg', set({ loadType: 'assist', loadKg: 0 })],
  ])('rejects %s', (_label, s) => {
    expect(hardPaths('session', sessionFile(session([block([s])])))).toEqual(['/session/blocks/0/sets/0/loadKg']);
  });

  it('accepts external and band with 0 kg', () => {
    const b = block([set({ loadType: 'external', loadKg: 0, order: 0 }), set({ loadType: 'band', loadKg: 0, order: 1 })]);
    expect(validateFile('session', sessionFile(session([b]))).ok).toBe(true);
  });

  it('rejects restSec on a set with completedAt', () => {
    const s = set({ completedAt: T0, restSec: 60 });
    expect(hardPaths('session', sessionFile(session([block([s])])))).toEqual(['/session/blocks/0/sets/0/restSec']);
  });

  it('rejects aggregate and dateUncertain outside migrated sessions', () => {
    const s = session([block([set({ aggregate: true })])], { dateUncertain: true, source: 'app' });
    expect(hardPaths('session', sessionFile(s))).toEqual(['/session/dateUncertain', '/session/blocks/0/sets/0/aggregate']);
    const m = session([block([set({ aggregate: true })])], { dateUncertain: true, source: 'migrated' });
    expect(validateFile('session', sessionFile(m)).ok).toBe(true);
  });

  it('rejects duplicate ids anywhere in a session file', () => {
    const id = uuid();
    const s = session([block([set({ id, order: 0 })], { order: 0 }), block([set({ id, order: 0 })], { order: 1 })]);
    expect(hardPaths('session', sessionFile(s))).toEqual(['/session/blocks/1/sets/0/id']);
  });

  it('rejects duplicate exercise ids', () => {
    expect(hardPaths('exercises', exercisesFile([exercise(), exercise()]))).toEqual(['/exercises/1/id']);
  });
});

describe('validateForWrite', () => {
  it('validates the JSON form, so explicit undefined keys are fine and Infinity is not', () => {
    const fine = sessionFile(session([block([{ ...set(), note: undefined } as never])]));
    expect(validateForWrite('session', fine).ok).toBe(true);
    const bad = sessionFile(session([block([set({ order: Number.POSITIVE_INFINITY })])]));
    expect(validateForWrite('session', bad).ok).toBe(false);
  });
});

describe('checkCatalogRules (soft)', () => {
  const catalog = [exercise(), exercise({ id: 'plank', name: 'Plank', metric: 'seconds', deletedAt: T0 })];

  it('passes a session that matches the catalog, including a tombstoned exercise', () => {
    const s = session([block(ladder([5]), { exerciseId: 'pull-ups' }), block([timedSet()], { exerciseId: 'plank', order: 1 })]);
    expect(checkCatalogRules(s, catalog)).toEqual([]);
  });

  it('flags an unknown exercise and a metric mismatch at soft level', () => {
    const s = session([block(ladder([5]), { exerciseId: 'nope' }), block([set()], { exerciseId: 'plank', order: 1 })]);
    const issues = checkCatalogRules(s, catalog);
    expect(issues.every((i) => i.level === 'soft')).toBe(true);
    expect(paths(issues)).toEqual(['/session/blocks/0/exerciseId', '/session/blocks/1/sets/0/reps']);
  });

  it('ignores deleted blocks and deleted sets', () => {
    const s = session([
      block(ladder([5]), { exerciseId: 'nope', deletedAt: T0 }),
      block([set({ deletedAt: T0 })], { exerciseId: 'plank', order: 1 }),
    ]);
    expect(checkCatalogRules(s, catalog)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `./validate` not found.

- [ ] **Step 3: Write `src/model/validate.ts`**

```ts
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Lenient, Strict } from './schema';
import type { BodyweightFile, Exercise, ExercisesFile, FileKind, Session, SessionFile } from './types';

export type IssueLevel = 'schema' | 'hard' | 'soft';

export interface ValidationIssue {
  level: IssueLevel;
  /** JSON pointer into the file, e.g. "/session/blocks/0/sets/2/loadKg". */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type ValidationMode = 'strict' | 'lenient';

function schemaFor(kind: FileKind, mode: ValidationMode): TSchema {
  const model = mode === 'strict' ? Strict : Lenient;
  if (kind === 'exercises') return model.ExercisesFile;
  if (kind === 'bodyweight') return model.BodyweightFile;
  return model.SessionFile;
}

/**
 * Schema check, then the hard rules of spec §5. Strict mode is for files at the app's own
 * version; lenient mode (unknown properties ignored) only for too-new files.
 */
export function validateFile(kind: FileKind, value: unknown, mode: ValidationMode = 'strict'): ValidationResult {
  const schemaIssues: ValidationIssue[] = [...Value.Errors(schemaFor(kind, mode), value)].map((e) => ({
    level: 'schema',
    path: e.path,
    message: e.message,
  }));
  if (schemaIssues.length > 0) return { ok: false, issues: schemaIssues };
  const issues = hardRules(kind, value);
  return { ok: issues.length === 0, issues };
}

/** Validates what will actually be stored: the JSON round trip drops undefined keys and turns
 *  NaN/Infinity into null, so the in-memory object and the file can't disagree. */
export function validateForWrite(kind: FileKind, value: unknown): ValidationResult {
  return validateFile(kind, JSON.parse(JSON.stringify(value)), 'strict');
}

export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const hard = (path: string, message: string): ValidationIssue => ({ level: 'hard', path, message });
const soft = (path: string, message: string): ValidationIssue => ({ level: 'soft', path, message });

function duplicateIds(entries: [id: string, path: string][]): ValidationIssue[] {
  const seen = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  for (const [id, path] of entries) {
    const first = seen.get(id);
    if (first === undefined) seen.set(id, path);
    else issues.push(hard(path, `duplicate id ${id} (first at ${first})`));
  }
  return issues;
}

function hardRules(kind: FileKind, value: unknown): ValidationIssue[] {
  if (kind === 'exercises') {
    const file = value as ExercisesFile;
    return duplicateIds(file.exercises.map((e, i) => [e.id, `/exercises/${i}/id`]));
  }
  if (kind === 'bodyweight') {
    const file = value as BodyweightFile;
    const issues = file.entries.flatMap((e, i) =>
      isCalendarDate(e.date) ? [] : [hard(`/entries/${i}/date`, `not a calendar date: ${e.date}`)],
    );
    return [...issues, ...duplicateIds(file.entries.map((e, i) => [e.id, `/entries/${i}/id`]))];
  }
  return sessionHardRules((value as SessionFile).session);
}

function sessionHardRules(session: Session): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const migrated = session.source === 'migrated';
  if (!isCalendarDate(session.date)) issues.push(hard('/session/date', `not a calendar date: ${session.date}`));
  if (session.dateUncertain && !migrated) issues.push(hard('/session/dateUncertain', 'only allowed in migrated sessions'));

  const ids: [string, string][] = [[session.id, '/session/id']];
  session.blocks.forEach((block, bi) => {
    const bp = `/session/blocks/${bi}`;
    ids.push([block.id, `${bp}/id`]);
    const live = block.sets.filter((s) => s.deletedAt === undefined);
    if (new Set(live.map((s) => ('reps' in s ? 'reps' : 'seconds'))).size > 1) {
      issues.push(hard(`${bp}/sets`, 'sets mix reps and seconds'));
    }
    block.sets.forEach((s, si) => {
      const sp = `${bp}/sets/${si}`;
      ids.push([s.id, `${sp}/id`]);
      if (s.loadType === 'bodyweight' && s.loadKg !== 0) issues.push(hard(`${sp}/loadKg`, 'must be 0 for bodyweight'));
      if ((s.loadType === 'added' || s.loadType === 'assist') && s.loadKg <= 0) {
        issues.push(hard(`${sp}/loadKg`, `must be > 0 for ${s.loadType}`));
      }
      if (s.restSec !== undefined && s.completedAt !== undefined) {
        issues.push(hard(`${sp}/restSec`, 'not allowed on a set with completedAt'));
      }
      if (s.aggregate && !migrated) issues.push(hard(`${sp}/aggregate`, 'only allowed in migrated sessions'));
    });
  });
  return [...issues, ...duplicateIds(ids)];
}

/**
 * Soft rules (spec §5): need the catalog, never quarantine. Tombstoned exercises resolve
 * (the catalog passed in must include them); deleted blocks and sets are skipped.
 */
export function checkCatalogRules(session: Session, catalog: readonly Exercise[]): ValidationIssue[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const issues: ValidationIssue[] = [];
  session.blocks.forEach((block, bi) => {
    if (block.deletedAt !== undefined) return;
    const bp = `/session/blocks/${bi}`;
    const ex = byId.get(block.exerciseId);
    if (ex === undefined) {
      issues.push(soft(`${bp}/exerciseId`, `unknown exercise ${block.exerciseId}`));
      return;
    }
    block.sets.forEach((s, si) => {
      if (s.deletedAt !== undefined) return;
      const field = 'reps' in s ? 'reps' : 'seconds';
      if (field !== ex.metric) issues.push(soft(`${bp}/sets/${si}/${field}`, `${ex.id} is measured in ${ex.metric}`));
    });
  });
  return issues;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. If the `'/exercises/0/name'` path assertion fails because TypeBox reports a different first error, print `r.issues` and adjust the expectation to TypeBox's path for that field (it must still point at `name` of entry 0).

- [ ] **Step 5: Commit**

```powershell
git add src/model/validate.ts src/model/validate.test.ts
git commit -m "Add file validation with hard and soft rule levels" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Version upgrade framework and the read pipeline

**Files:**
- Create: `src/model/upgrade.ts`, `src/model/read.ts`
- Test: `src/model/upgrade.test.ts`, `src/model/read.test.ts`

**Interfaces:**
- Consumes: `MODEL_VERSION`, `validateFile` (Task 6).
- Produces from `upgrade.ts`: `UpgradeStep`, `UPGRADE_STEPS`, `UpgradeResult`, `fileVersion(raw)`, `upgradeFile(kind, raw, steps?, current?)`.
- Produces from `read.ts`: `ReadStatus = 'ok' | 'read-only' | 'needs-update' | 'quarantined'`, `ReadResult { status, version, file, issues }`, `readFile(kind, raw, steps?, current?)`.

- [ ] **Step 1: Write the failing tests**

`src/model/upgrade.test.ts`:
```ts
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
```

`src/model/read.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/model/upgrade.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/model/read.ts`**

```ts
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
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```powershell
git add src/model/upgrade.ts src/model/upgrade.test.ts src/model/read.ts src/model/read.test.ts
git commit -m "Add schema version upgrade framework and read pipeline" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Slugs, names and catalog helpers

**Files:**
- Create: `src/model/slug.ts`, `src/model/catalog.ts`
- Test: `src/model/slug.test.ts`, `src/model/catalog.test.ts`

**Interfaces:**
- Consumes: `touch`, `undelete` (Task 5), types.
- Produces from `slug.ts`: `slugify(name)`, `normalizeName(name)`.
- Produces from `catalog.ts`: `findByName(catalog, name)`, `assignExerciseId(name, catalog)`, `NewExerciseFields`, `createExercise(name, fields, catalog, now?)` → `{ catalog, exercise, existing }`, `restoreReferenced(catalog, sessions, now?)`.

- [ ] **Step 1: Write the failing tests**

`src/model/slug.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizeName, slugify } from './slug';

describe('slugify (spec §3 slug rule)', () => {
  it.each([
    ['Pull-ups', 'pull-ups'],
    ['Australian Pull-ups (Bar)', 'australian-pull-ups-bar'],
    ['Bicep Curls (EZ Bar)', 'bicep-curls-ez-bar'],
    ['Single-leg RDL', 'single-leg-rdl'],
    ['  Dips  ', 'dips'],
    ['--Dips--', 'dips'],
    ['Klimmzüge', 'klimmzuege'],
    ['Überzüge', 'ueberzuege'],
    ['Straße', 'strasse'],
    ['Café Curls', 'cafe-curls'],
    ['Push-ups +', 'push-ups'],
    ['???', 'exercise'],
    ['', 'exercise'],
  ])('%j -> %j', (name, slug) => expect(slugify(name)).toBe(slug));
});

describe('normalizeName', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeName('  Pull   ups ')).toBe('pull ups');
    expect(normalizeName('Pull Ups')).toBe(normalizeName('pull ups'));
  });
});
```

`src/model/catalog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { assignExerciseId, createExercise, findByName, restoreReferenced } from './catalog';
import { T0, block, exercise, ladder, session } from './test-fixtures';

const later = new Date('2030-01-01T11:00:00.000Z');
const fields = { pattern: 'push', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight' } as const;

describe('findByName', () => {
  it('matches case- and whitespace-insensitively, tombstoned entries included', () => {
    const dead = exercise({ id: 'dips', name: 'Dips', deletedAt: T0 });
    expect(findByName([exercise(), dead], ' pull  UPS ')).toBeUndefined();
    expect(findByName([exercise(), dead], ' pull-UPS ')?.id).toBe('pull-ups');
    expect(findByName([exercise(), dead], 'dips')?.id).toBe('dips');
  });
});

describe('assignExerciseId', () => {
  it('uses the plain slug when free', () => {
    expect(assignExerciseId('Dips (Rings)', [exercise()])).toBe('dips-rings');
  });

  it('reuses the id when the same name already owns it', () => {
    expect(assignExerciseId('pull ups', [exercise()])).toBe('pull-ups');
  });

  it('appends -2, -3 when a different name owns the slug, tombstones included', () => {
    const catalog = [
      exercise({ id: 'dips-bar', name: 'Bar Dips (weighted)' }),
      exercise({ id: 'dips-bar-2', name: 'Something else', deletedAt: T0 }),
    ];
    expect(assignExerciseId('Dips (Bar)', catalog)).toBe('dips-bar-3');
  });
});

describe('createExercise', () => {
  it('adds a new entry with slug id, archived false and the given time', () => {
    const r = createExercise('Dips (Rings)', fields, [exercise()], later);
    expect(r.existing).toBe(false);
    expect(r.exercise).toMatchObject({ id: 'dips-rings', name: 'Dips (Rings)', archived: false, updatedAt: '2030-01-01T11:00:00.000Z' });
    expect(r.catalog).toHaveLength(2);
  });

  it('returns the existing entry for a name that differs only in case', () => {
    const r = createExercise('PULL-UPS', fields, [exercise()], later);
    expect(r.existing).toBe(true);
    expect(r.catalog).toHaveLength(1);
    expect(r.exercise.updatedAt).toBe(T0);
  });

  it('undeletes a tombstoned entry with the same name', () => {
    const r = createExercise('Pull-ups', fields, [exercise({ deletedAt: T0 })], later);
    expect(r.existing).toBe(true);
    expect('deletedAt' in r.exercise).toBe(false);
    expect(r.exercise.updatedAt).toBe('2030-01-01T11:00:00.000Z');
  });

  it('unarchives an archived entry with the same name', () => {
    const r = createExercise('Pull-ups', fields, [exercise({ archived: true })], later);
    expect(r.exercise.archived).toBe(false);
    expect(r.exercise.updatedAt).toBe('2030-01-01T11:00:00.000Z');
  });
});

describe('restoreReferenced (spec §3: tombstoned exercise referenced by a live block)', () => {
  it('undeletes and archives referenced tombstones, leaves others alone', () => {
    const catalog = [
      exercise({ id: 'dips', name: 'Dips', deletedAt: T0 }),
      exercise({ id: 'rows', name: 'Rows', deletedAt: T0 }),
      exercise(),
    ];
    const sessions = [
      session([block(ladder([5]), { exerciseId: 'dips' })]),
      session([block(ladder([5]), { exerciseId: 'rows' })], { deletedAt: T0 }),
    ];
    const out = restoreReferenced(catalog, sessions, later);
    expect(out.find((e) => e.id === 'dips')).toMatchObject({ archived: true, updatedAt: '2030-01-01T11:00:00.000Z' });
    expect('deletedAt' in out.find((e) => e.id === 'dips')!).toBe(false);
    expect(out.find((e) => e.id === 'rows')?.deletedAt).toBe(T0);
    expect(out.find((e) => e.id === 'pull-ups')).toBe(catalog[2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/model/slug.ts`**

```ts
const TRANSLITERATE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

/** Spec §3 slug rule: German transliteration, strip diacritics, lowercase, [^a-z0-9]+ -> "-",
 *  trim "-", empty -> "exercise". Collision suffixes are handled in catalog.ts. */
export function slugify(name: string): string {
  const slug = name
    .replace(/[äöüßÄÖÜ]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'exercise' : slug;
}

/** Name comparison key (spec §3 "Name uniqueness"): trimmed, whitespace collapsed, lowercased. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
```

- [ ] **Step 4: Write `src/model/catalog.ts`**

```ts
import { touch, undelete } from './record';
import { normalizeName, slugify } from './slug';
import type { Exercise, Session } from './types';

/** Any entry with that name, tombstoned and archived ones included (the caller decides what to do). */
export function findByName(catalog: readonly Exercise[], name: string): Exercise | undefined {
  const wanted = normalizeName(name);
  return catalog.find((e) => normalizeName(e.name) === wanted);
}

/** The slug, or slug-2, slug-3 … if a different name already owns it (tombstones count). */
export function assignExerciseId(name: string, catalog: readonly Exercise[]): string {
  const base = slugify(name);
  const wanted = normalizeName(name);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const owner = byId.get(candidate);
    if (owner === undefined || normalizeName(owner.name) === wanted) return candidate;
  }
}

export type NewExerciseFields = Pick<Exercise, 'pattern' | 'metric' | 'perSide' | 'defaultLoadType'> &
  Partial<Pick<Exercise, 'family' | 'cues'>>;

export interface CreateExerciseResult {
  catalog: Exercise[];
  exercise: Exercise;
  /** true: an entry with that name already existed and was returned (undeleted / unarchived if needed). */
  existing: boolean;
}

/** Spec §3 "Name uniqueness": creating an existing name never makes a second record. */
export function createExercise(
  name: string,
  fields: NewExerciseFields,
  catalog: readonly Exercise[],
  now: Date = new Date(),
): CreateExerciseResult {
  const found = findByName(catalog, name);
  if (found !== undefined) {
    let revived = found;
    if (revived.deletedAt !== undefined) revived = undelete(revived, now);
    if (revived.archived) revived = touch({ ...revived, archived: false }, now);
    const next = revived === found ? [...catalog] : catalog.map((e) => (e === found ? revived : e));
    return { catalog: next, exercise: revived, existing: true };
  }
  const exercise: Exercise = {
    id: assignExerciseId(name, catalog),
    name: name.trim(),
    ...fields,
    archived: false,
    updatedAt: now.toISOString(),
  };
  return { catalog: [...catalog, exercise], exercise, existing: false };
}

/** Spec §3: a tombstoned exercise referenced by a live block of a live session is restored as archived. */
export function restoreReferenced(catalog: readonly Exercise[], sessions: readonly Session[], now: Date = new Date()): Exercise[] {
  const referenced = new Set<string>();
  for (const s of sessions) {
    if (s.deletedAt !== undefined) continue;
    for (const b of s.blocks) if (b.deletedAt === undefined) referenced.add(b.exerciseId);
  }
  // undelete already bumps updatedAt; setting archived in the same copy keeps it to one bump.
  return catalog.map((e) =>
    e.deletedAt !== undefined && referenced.has(e.id) ? { ...undelete(e, now), archived: true } : e,
  );
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean. With `exactOptionalPropertyTypes`, spreading `fields` that contain no `family` key is fine; `fields` must never contain `family: undefined`.

- [ ] **Step 6: Commit**

```powershell
git add src/model/slug.ts src/model/slug.test.ts src/model/catalog.ts src/model/catalog.test.ts
git commit -m "Add slug rule, name uniqueness and catalog helpers" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Seed catalog and seed merge

**Files:**
- Create: `src/model/seed-exercises.json`, `src/model/seed.ts`
- Test: `src/model/seed.test.ts`

**Interfaces:**
- Consumes: `Strict.Exercise`, `slugify`.
- Produces: `SEED: Exercise[]`, `mergeSeed(catalog, seed?)` → `{ catalog, added }`.

- [ ] **Step 1: Write the failing tests**

`src/model/seed.test.ts`:
```ts
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { Strict } from './schema';
import { SEED, mergeSeed } from './seed';
import { slugify } from './slug';
import { T0, exercise } from './test-fixtures';

const SEED_TIME = '2026-10-06T00:00:00.000Z';

describe('seed-exercises.json', () => {
  it('has 24 entries that all validate', () => {
    expect(SEED).toHaveLength(24);
    for (const e of SEED) expect(Value.Check(Strict.Exercise, e), e.id).toBe(true);
  });

  it('every id equals slugify(name), and ids and names are unique', () => {
    for (const e of SEED) expect(e.id, e.name).toBe(slugify(e.name));
    expect(new Set(SEED.map((e) => e.id)).size).toBe(SEED.length);
    expect(new Set(SEED.map((e) => e.name.toLowerCase())).size).toBe(SEED.length);
  });

  it('carries the fixed seed time, metric reps and archived false on every entry', () => {
    for (const e of SEED) {
      expect(e.updatedAt).toBe(SEED_TIME);
      expect(e.metric).toBe('reps');
      expect(e.archived).toBe(false);
      expect(e.deletedAt).toBeUndefined();
    }
  });

  it('marks exactly the confirmed per-side exercises (spec §5)', () => {
    expect(SEED.filter((e) => e.perSide).map((e) => e.id).sort()).toEqual(['single-leg-rdl', 'single-leg-rdl-band', 'split-squats']);
  });

  it('classifies the single-leg RDL dumbbell load as external', () => {
    expect(SEED.find((e) => e.id === 'single-leg-rdl')?.defaultLoadType).toBe('external');
  });
});

describe('mergeSeed', () => {
  it('adds entries whose id is missing, copied verbatim', () => {
    const r = mergeSeed([], SEED);
    expect(r.catalog).toHaveLength(24);
    expect(r.added).toHaveLength(24);
    expect(r.catalog[0]).toEqual(SEED[0]);
    expect(r.catalog[0]).not.toBe(SEED[0]);
  });

  it('never modifies an existing entry, even if the seed differs', () => {
    const mine = exercise({ id: 'pull-ups', name: 'Pull-ups', cues: 'my cues', updatedAt: T0 });
    const r = mergeSeed([mine], SEED);
    expect(r.catalog.find((e) => e.id === 'pull-ups')).toBe(mine);
    expect(r.added).toHaveLength(23);
  });

  it('never re-adds a tombstoned or archived id', () => {
    const dead = exercise({ id: 'pull-ups', deletedAt: T0 });
    const archived = exercise({ id: 'dips-bar', name: 'Dips (Bar)', archived: true });
    const r = mergeSeed([dead, archived], SEED);
    expect(r.catalog.filter((e) => e.id === 'pull-ups')).toEqual([dead]);
    expect(r.catalog.filter((e) => e.id === 'dips-bar')).toEqual([archived]);
    expect(r.added).toHaveLength(22);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `./seed` not found.

- [ ] **Step 3: Write `src/model/seed-exercises.json`**

The table from spec §5, with the three confirmed points applied. Every entry: `metric: "reps"`, `archived: false`, `updatedAt: "2026-10-06T00:00:00.000Z"`.
```json
[
  { "id": "australian-pull-ups-bar", "name": "Australian Pull-ups (Bar)", "family": "Australian Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "pull-ups", "name": "Pull-ups", "family": "Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "negative-pull-ups", "name": "Negative Pull-ups", "family": "Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "bicep-curls-cable", "name": "Bicep Curls (Cable)", "family": "Bicep Curls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "bicep-curls-ez-bar", "name": "Bicep Curls (EZ Bar)", "family": "Bicep Curls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "face-pulls-cable", "name": "Face Pulls (Cable)", "family": "Face Pulls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "dips-bar", "name": "Dips (Bar)", "family": "Dips", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "dips-rings", "name": "Dips (Rings)", "family": "Dips", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "push-ups", "name": "Push-ups", "family": "Push-ups", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "diamond-push-ups", "name": "Diamond Push-ups", "family": "Push-ups", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "ring-deficit-push-ups", "name": "Ring Deficit Push-ups", "family": "Push-ups", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "triceps-pulldowns-cable", "name": "Triceps Pulldowns (Cable)", "family": "Triceps Pulldowns", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "overhead-press-band", "name": "Overhead Press (Band)", "family": "Overhead Press", "pattern": "shoulders", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "lateral-raises", "name": "Lateral Raises", "family": "Lateral Raises", "pattern": "shoulders", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "lateral-raises-band", "name": "Lateral Raises (Band)", "family": "Lateral Raises", "pattern": "shoulders", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "single-leg-rdl", "name": "Single-leg RDL", "family": "Single-leg RDL", "pattern": "legs", "metric": "reps", "perSide": true, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "single-leg-rdl-band", "name": "Single-leg RDL (Band)", "family": "Single-leg RDL", "pattern": "legs", "metric": "reps", "perSide": true, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "split-squats", "name": "Split Squats", "family": "Split Squats", "pattern": "legs", "metric": "reps", "perSide": true, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "squats", "name": "Squats", "family": "Squats", "pattern": "legs", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "jump-squats", "name": "Jump Squats", "family": "Squats", "pattern": "legs", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "calf-raises", "name": "Calf Raises", "family": "Calf Raises", "pattern": "legs", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "calf-raises-band", "name": "Calf Raises (Band)", "family": "Calf Raises", "pattern": "legs", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "knee-raises-dip-bar", "name": "Knee Raises (Dip Bar)", "family": "Knee Raises", "pattern": "core", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "burpees", "name": "Burpees", "family": "Burpees", "pattern": "conditioning", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" }
]
```

- [ ] **Step 4: Write `src/model/seed.ts`**

```ts
import seedJson from './seed-exercises.json';
import type { Exercise } from './types';

/** The developer seed (spec §5). Validated by seed.test.ts; the json import is typed loosely. */
export const SEED: Exercise[] = seedJson as unknown as Exercise[];

export interface SeedMergeResult {
  catalog: Exercise[];
  added: Exercise[];
}

/** Adds seed entries whose id is missing from the catalog, copied verbatim (fixed updatedAt
 *  included). Existing, tombstoned and archived ids are never touched or re-added. */
export function mergeSeed(catalog: readonly Exercise[], seed: readonly Exercise[] = SEED): SeedMergeResult {
  const present = new Set(catalog.map((e) => e.id));
  const added = seed.filter((e) => !present.has(e.id)).map((e) => ({ ...e }));
  return { catalog: [...catalog, ...added], added };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```powershell
git add src/model/seed-exercises.json src/model/seed.ts src/model/seed.test.ts
git commit -m "Add seed exercise catalog and seed merge" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Derived rules: canonical sibling order and session order

**Files:**
- Create: `src/model/derive/order.ts`
- Test: `src/model/derive/order.test.ts`

**Interfaces:**
- Produces: `compareSets(a, b)`, `compareBlocks(a, b)`, `liveSets(block)`, `liveBlocks(session)`, `sessionTimeKey(session)`, `compareSessions(a, b)`, `sortSessions(sessions)`. "live" = non-deleted, in canonical order, new arrays.

- [ ] **Step 1: Write the failing tests**

`src/model/derive/order.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { compareSessions, liveBlocks, liveSets, sessionTimeKey, sortSessions } from './order';
import { T0, block, session, set } from '../test-fixtures';

const at = (hhmm: string) => `2030-01-01T${hhmm}:00.000Z`;

describe('liveSets (spec §7 sibling order)', () => {
  it('sorts by order, then completedAt with absent last, then id, and drops deleted sets', () => {
    const a = set({ id: '00000000-0000-4000-8000-00000000000b', order: 1 });
    const b = set({ id: '00000000-0000-4000-8000-00000000000a', order: 1 });
    const c = set({ order: 1, completedAt: at('10:05') });
    const d = set({ order: 1, completedAt: at('10:01') });
    const e = set({ order: 0, deletedAt: T0 });
    const f = set({ order: 0.5 });
    expect(liveSets(block([a, b, c, d, e, f])).map((s) => s.id)).toEqual([f.id, d.id, c.id, b.id, a.id]);
  });

  it('ignores array position', () => {
    const first = set({ order: 0 });
    const second = set({ order: 1 });
    expect(liveSets(block([second, first]))[0]).toBe(first);
  });
});

describe('liveBlocks', () => {
  it('sorts by order then id and drops deleted blocks', () => {
    const b1 = block([], { order: 2 });
    const b2 = block([], { order: 1 });
    const b3 = block([], { order: 1, deletedAt: T0 });
    expect(liveBlocks(session([b1, b2, b3]))).toEqual([b2, b1]);
  });
});

describe('session order (spec §7)', () => {
  it('time key is startedAt, else the earliest completedAt, else undefined', () => {
    expect(sessionTimeKey(session([], { startedAt: at('09:00') }))).toBe(at('09:00'));
    const s = session([block([set({ completedAt: at('10:30'), order: 0 }), set({ completedAt: at('10:10'), order: 1 })])]);
    expect(sessionTimeKey(s)).toBe(at('10:10'));
    expect(sessionTimeKey(session())).toBeUndefined();
  });

  it('orders by date before time key', () => {
    const earlyDateLateClock = session([], { date: '2030-01-01', startedAt: '2030-01-05T20:00:00.000Z' });
    const lateDateEarlyClock = session([], { date: '2030-01-02', startedAt: '2030-01-02T06:00:00.000Z' });
    expect(compareSessions(earlyDateLateClock, lateDateEarlyClock)).toBeLessThan(0);
  });

  it('on one date: no time key first, then time key, then id', () => {
    const none = session([], { id: '00000000-0000-4000-8000-0000000000ff' });
    const none2 = session([], { id: '00000000-0000-4000-8000-0000000000aa' });
    const early = session([], { startedAt: at('08:00') });
    const late = session([], { startedAt: at('09:00') });
    expect(sortSessions([late, none, early, none2])).toEqual([none2, none, early, late]);
  });

  it('is total: a reversed input sorts the same, and deleted sessions are dropped', () => {
    const list = [session(), session([], { startedAt: at('08:00') }), session([], { date: '2029-12-31' })];
    const dead = session([], { deletedAt: T0 });
    const all = [...list, dead];
    const sorted = sortSessions(all);
    expect(sorted).not.toContain(dead);
    expect(sortSessions([...all].reverse())).toEqual(sorted);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `./order` not found.

- [ ] **Step 3: Write `src/model/derive/order.ts`**

```ts
import type { Block, Session, WorkoutSet } from '../types';

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Canonical set order: order, then completedAt (absent last), then id. */
export function compareSets(a: WorkoutSet, b: WorkoutSet): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.completedAt !== b.completedAt) {
    if (a.completedAt === undefined) return 1;
    if (b.completedAt === undefined) return -1;
    return a.completedAt < b.completedAt ? -1 : 1;
  }
  return byId(a, b);
}

/** Canonical block order: order, then id. */
export function compareBlocks(a: Block, b: Block): number {
  return a.order !== b.order ? a.order - b.order : byId(a, b);
}

export function liveSets(block: Block): WorkoutSet[] {
  return block.sets.filter((s) => s.deletedAt === undefined).sort(compareSets);
}

export function liveBlocks(session: Session): Block[] {
  return session.blocks.filter((b) => b.deletedAt === undefined).sort(compareBlocks);
}

/** startedAt, else the earliest completedAt among live sets, else undefined. */
export function sessionTimeKey(session: Session): string | undefined {
  if (session.startedAt !== undefined) return session.startedAt;
  const stamps = liveBlocks(session)
    .flatMap(liveSets)
    .flatMap((s) => (s.completedAt === undefined ? [] : [s.completedAt]));
  return stamps.length === 0 ? undefined : stamps.reduce((a, b) => (a < b ? a : b));
}

/** Total session order: date, then time key (none first), then id. */
export function compareSessions(a: Session, b: Session): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ka = sessionTimeKey(a);
  const kb = sessionTimeKey(b);
  if (ka !== kb) {
    if (ka === undefined) return -1;
    if (kb === undefined) return 1;
    return ka < kb ? -1 : 1;
  }
  return byId(a, b);
}

export function sortSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => s.deletedAt === undefined).sort(compareSessions);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```powershell
git add src/model/derive/order.ts src/model/derive/order.test.ts
git commit -m "Add canonical sibling order and total session order" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Derived rules: block totals, block load, exercise session total

**Files:**
- Create: `src/model/derive/totals.ts`
- Test: `src/model/derive/totals.test.ts`

**Interfaces:**
- Consumes: `liveSets`, `liveBlocks` (Task 10).
- Produces: `round2(n)`, `amountOf(set)`, `metricOf(set)`, `BlockTotals { metric, amount, setCount, hasAggregate, isEmpty }`, `blockTotals(block)`, `LoadGroup = 'body' | 'external' | 'band'`, `loadGroupOf(loadType)`, `signedKg(set)`, `BlockLoad { group, kg }`, `blockLoad(block)` (undefined for an empty block), `ExerciseTotal { amount, unknown }`, `exerciseSessionTotal(session, exerciseId)`.

- [ ] **Step 1: Write the failing tests**

`src/model/derive/totals.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { blockLoad, blockTotals, exerciseSessionTotal, round2 } from './totals';
import { T0, block, ladder, session, set, timedSet } from '../test-fixtures';

describe('blockTotals (spec §7)', () => {
  it('sums a ladder and counts sets', () => {
    expect(blockTotals(block(ladder([17, 16, 15, 10])))).toEqual({ metric: 'reps', amount: 58, setCount: 4, hasAggregate: false, isEmpty: false });
  });

  it('rounds decimal reps to 2 places so 16.5 + 17.2 is exactly 33.7', () => {
    expect(blockTotals(block(ladder([16.5, 17.2]))).amount).toBe(33.7);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('counts aggregate sets in the amount but not in setCount', () => {
    const t = blockTotals(block([set({ reps: 100, aggregate: true })]));
    expect(t).toMatchObject({ amount: 100, setCount: 0, hasAggregate: true });
  });

  it('ignores deleted sets and reports empty blocks', () => {
    expect(blockTotals(block([set({ deletedAt: T0 })]))).toMatchObject({ amount: 0, setCount: 0, isEmpty: true });
  });

  it('uses seconds for timed blocks', () => {
    expect(blockTotals(block([timedSet({ seconds: 30, order: 0 }), timedSet({ seconds: 45, order: 1 })]))).toMatchObject({ metric: 'seconds', amount: 75 });
  });
});

describe('blockLoad (spec §7)', () => {
  it('is undefined for an empty block and body/0 for plain bodyweight', () => {
    expect(blockLoad(block())).toBeUndefined();
    expect(blockLoad(block(ladder([5, 4])))).toEqual({ group: 'body', kg: 0 });
  });

  it('takes the max signed kg over the main group', () => {
    const b = block(ladder([30, 30, 20], { loadType: 'added', loadKg: 17.4 }));
    b.sets[1] = { ...b.sets[1]!, loadKg: 28.9 };
    expect(blockLoad(b)).toEqual({ group: 'body', kg: 28.9 });
  });

  it('treats assist as negative kg on the body axis', () => {
    const b = block(ladder([5, 5, 5], { loadType: 'assist', loadKg: 20 }));
    b.sets[2] = { ...b.sets[2]!, loadType: 'assist', loadKg: 15 };
    expect(blockLoad(b)).toEqual({ group: 'body', kg: -15 });
  });

  it('picks the group of most sets, and the first set\'s group on a tie', () => {
    const majority = block([
      set({ order: 0, loadType: 'external', loadKg: 35 }),
      set({ order: 1, loadType: 'external', loadKg: 40 }),
      set({ order: 2, loadType: 'bodyweight', loadKg: 0 }),
    ]);
    expect(blockLoad(majority)).toEqual({ group: 'external', kg: 40 });
    const tie = block([set({ order: 0, loadType: 'band', loadKg: 50 }), set({ order: 1, loadType: 'external', loadKg: 35 })]);
    expect(blockLoad(tie)).toEqual({ group: 'band', kg: 50 });
  });
});

describe('exerciseSessionTotal (spec §7)', () => {
  it('sums the blocks of one exercise and ignores other exercises', () => {
    const s = session([
      block(ladder([1, 2, 3, 4, 5]), { order: 0 }),
      block(ladder([5]), { order: 1, exerciseId: 'dips' }),
      block(ladder([8, 7, 6, 5]), { order: 2 }),
    ]);
    expect(exerciseSessionTotal(s, 'pull-ups')).toEqual({ amount: 41, unknown: false });
  });

  it('is unknown for a migrated note-only block, but not for an empty app block', () => {
    const migrated = session([block([], { note: 'Pyramide' })], { source: 'migrated' });
    expect(exerciseSessionTotal(migrated, 'pull-ups').unknown).toBe(true);
    expect(exerciseSessionTotal(session([block()]), 'pull-ups').unknown).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `./totals` not found.

- [ ] **Step 3: Write `src/model/derive/totals.ts`**

```ts
import type { Block, LoadType, Session, WorkoutSet } from '../types';
import { liveBlocks, liveSets } from './order';

/** All totals and loads are rounded to 2 decimals before comparison (spec §7). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function amountOf(set: WorkoutSet): number {
  return 'reps' in set ? set.reps : set.seconds;
}

export function metricOf(set: WorkoutSet): 'reps' | 'seconds' {
  return 'reps' in set ? 'reps' : 'seconds';
}

export interface BlockTotals {
  metric: 'reps' | 'seconds';
  /** totalReps or totalSeconds; for perSide exercises in per-side units as logged, never doubled. */
  amount: number;
  /** Non-aggregate live sets. */
  setCount: number;
  hasAggregate: boolean;
  isEmpty: boolean;
}

export function blockTotals(block: Block): BlockTotals {
  const sets = liveSets(block);
  const first = sets[0];
  return {
    metric: first === undefined ? 'reps' : metricOf(first),
    amount: round2(sets.reduce((sum, s) => sum + amountOf(s), 0)),
    setCount: sets.filter((s) => s.aggregate !== true).length,
    hasAggregate: sets.some((s) => s.aggregate === true),
    isEmpty: sets.length === 0,
  };
}

/** bodyweight, added and assist share one signed axis; external and band stand alone. */
export type LoadGroup = 'body' | 'external' | 'band';

export function loadGroupOf(loadType: LoadType): LoadGroup {
  return loadType === 'external' ? 'external' : loadType === 'band' ? 'band' : 'body';
}

export function signedKg(set: WorkoutSet): number {
  return set.loadType === 'assist' ? -set.loadKg : set.loadKg;
}

export interface BlockLoad {
  group: LoadGroup;
  /** Max signed kg over the live sets of the main group. */
  kg: number;
}

export function blockLoad(block: Block): BlockLoad | undefined {
  const sets = liveSets(block);
  const first = sets[0];
  if (first === undefined) return undefined;
  const counts = new Map<LoadGroup, number>();
  for (const s of sets) {
    const g = loadGroupOf(s.loadType);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  // Start with the first set's group so a tie keeps it.
  let main = loadGroupOf(first.loadType);
  let best = counts.get(main) ?? 0;
  for (const [g, c] of counts) {
    if (c > best) {
      main = g;
      best = c;
    }
  }
  const kg = Math.max(...sets.filter((s) => loadGroupOf(s.loadType) === main).map(signedKg));
  return { group: main, kg: round2(kg) };
}

export interface ExerciseTotal {
  amount: number;
  /** true when a migrated note-only block makes the real number unknown. */
  unknown: boolean;
}

export function exerciseSessionTotal(session: Session, exerciseId: string): ExerciseTotal {
  const blocks = liveBlocks(session).filter((b) => b.exerciseId === exerciseId);
  const unknown = session.source === 'migrated' && blocks.some((b) => liveSets(b).length === 0);
  return { amount: round2(blocks.reduce((sum, b) => sum + blockTotals(b).amount, 0)), unknown };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```powershell
git add src/model/derive/totals.ts src/model/derive/totals.test.ts
git commit -m "Add block totals, block load and exercise session total" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Derived rules: previous occurrence and the ↑↓ indicators

**Files:**
- Create: `src/model/derive/compare.ts`
- Test: `src/model/derive/compare.test.ts`

**Interfaces:**
- Consumes: Task 10 and Task 11 functions.
- Produces: `Trend = 'up' | 'down' | 'same'`, `AmountIndicator = Trend | 'none'`, `LoadIndicator = Trend | 'incomparable' | 'hidden' | 'none'`, `BlockIndicator { amount, load }`, `blocksOf(session, exerciseId)`, `earlierSessions(sessions, session)`, `previousOccurrence(sessions, session, exerciseId, n)`, `compareBlockPair(current, previous)`, `blockIndicator(sessions, session, block)`, `exerciseIndicator(sessions, session, exerciseId)`. `'none'` is the spec's `–`.

- [ ] **Step 1: Write the failing tests**

`src/model/derive/compare.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { blockIndicator, compareBlockPair, exerciseIndicator, previousOccurrence } from './compare';
import { T0, block, ladder, session, set } from '../test-fixtures';

const day = (d: number) => `2030-01-${String(d).padStart(2, '0')}`;
const pullups = (reps: number[], order = 0) => block(ladder(reps), { order });

describe('compareBlockPair (spec §7 ↑↓ per block)', () => {
  it('amount: same, up (one more set), down', () => {
    expect(compareBlockPair(pullups([5, 4, 3]), pullups([5, 4, 3])).amount).toBe('same');
    expect(compareBlockPair(pullups([5, 4, 3, 2]), pullups([5, 4, 3])).amount).toBe('up');
    expect(compareBlockPair(pullups([5, 4]), pullups([5, 4, 3])).amount).toBe('down');
  });

  it('amount is same after rounding decimals', () => {
    expect(compareBlockPair(pullups([16.5, 17.2]), pullups([17.2, 16.5])).amount).toBe('same');
  });

  it('is none without a previous block, with an aggregate set, or with an empty block on either side', () => {
    expect(compareBlockPair(pullups([5]), undefined)).toEqual({ amount: 'none', load: 'none' });
    expect(compareBlockPair(block([set({ reps: 100, aggregate: true })]), pullups([5]))).toEqual({ amount: 'none', load: 'none' });
    expect(compareBlockPair(pullups([5]), block())).toEqual({ amount: 'none', load: 'none' });
  });

  it('load: hidden for plain bodyweight on both sides', () => {
    expect(compareBlockPair(pullups([5]), pullups([5])).load).toBe('hidden');
  });

  it('load: compares kg within one group, less assist is up, groups differing is incomparable', () => {
    const added = (kg: number) => block(ladder([10], { loadType: 'added', loadKg: kg }));
    expect(compareBlockPair(added(12), added(10)).load).toBe('up');
    expect(compareBlockPair(added(10), added(12)).load).toBe('down');
    expect(compareBlockPair(added(10), pullups([10])).load).toBe('up');
    const assist = (kg: number) => block(ladder([10], { loadType: 'assist', loadKg: kg }));
    expect(compareBlockPair(assist(15), assist(20)).load).toBe('up');
    const band = block(ladder([10], { loadType: 'band', loadKg: 50 }));
    const external = block(ladder([10], { loadType: 'external', loadKg: 35 }));
    expect(compareBlockPair(band, external).load).toBe('incomparable');
  });
});

describe('previousOccurrence (spec §7)', () => {
  it('finds block n in the most recent earlier session that has at least n blocks', () => {
    const s1 = session([pullups([1, 2, 3], 0), pullups([8, 7], 1)], { date: day(1) });
    const s2 = session([pullups([9, 8], 0)], { date: day(2) });
    const s3 = session([pullups([2, 3], 0), pullups([9, 9], 1)], { date: day(3) });
    const all = [s3, s1, s2];
    expect(previousOccurrence(all, s3, 'pull-ups', 1)).toBe(s2.blocks[0]);
    expect(previousOccurrence(all, s3, 'pull-ups', 2)).toBe(s1.blocks[1]);
    expect(previousOccurrence(all, s3, 'pull-ups', 3)).toBeUndefined();
    expect(previousOccurrence(all, s1, 'pull-ups', 1)).toBeUndefined();
  });

  it('ignores deleted sessions and deleted blocks, and uses the total session order', () => {
    const dead = session([pullups([99])], { date: day(2), deletedAt: T0 });
    const sameDayEarlier = session([pullups([7])], { date: day(3), startedAt: '2030-01-03T08:00:00.000Z' });
    const current = session([pullups([8])], { date: day(3), startedAt: '2030-01-03T10:00:00.000Z' });
    const withDeletedBlock = session([pullups([50]), block(ladder([60]), { order: 1, deletedAt: T0 })], { date: day(1) });
    const all = [current, dead, sameDayEarlier, withDeletedBlock];
    expect(previousOccurrence(all, current, 'pull-ups', 1)).toBe(sameDayEarlier.blocks[0]);
    expect(previousOccurrence(all, sameDayEarlier, 'pull-ups', 1)).toBe(withDeletedBlock.blocks[0]);
    expect(previousOccurrence(all, sameDayEarlier, 'pull-ups', 2)).toBeUndefined();
  });
});

describe('blockIndicator and exerciseIndicator', () => {
  const last = session([pullups([1, 2, 3, 4, 5], 0), pullups([8, 7, 6, 5, 4, 3, 2, 5], 1)], { date: day(1) });
  const today = session([pullups([8, 7, 6, 5, 4, 3, 2, 5], 0)], { date: day(2) });
  const all = [last, today];

  it('the positional block indicator compares today\'s only block with last time\'s first block', () => {
    expect(blockIndicator(all, today, today.blocks[0]!)).toEqual({ amount: 'up', load: 'hidden' });
  });

  it('the exercise indicator sees the session total drop', () => {
    expect(exerciseIndicator(all, today, 'pull-ups')).toBe('down');
  });

  it('a block with only deleted sets counts as block n and shows none', () => {
    const current = session([block([set({ deletedAt: T0 })], { order: 0 }), pullups([5], 1)], { date: day(3) });
    const everything = [...all, current];
    expect(blockIndicator(everything, current, current.blocks[0]!)).toEqual({ amount: 'none', load: 'none' });
    expect(blockIndicator(everything, current, current.blocks[1]!).amount).toBe('down');
  });

  it('exercise indicator is none without an earlier session or with a migrated note-only block', () => {
    expect(exerciseIndicator([today], today, 'pull-ups')).toBe('none');
    const noteOnly = session([block([], { note: 'Pyramide' })], { date: day(1), source: 'migrated' });
    expect(exerciseIndicator([noteOnly, today], today, 'pull-ups')).toBe('none');
  });

  it('blockIndicator is none for a block that is not in the session', () => {
    expect(blockIndicator(all, today, last.blocks[0]!)).toEqual({ amount: 'none', load: 'none' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `./compare` not found.

- [ ] **Step 3: Write `src/model/derive/compare.ts`**

```ts
import type { Block, Session } from '../types';
import { compareSessions, liveBlocks, sortSessions } from './order';
import { blockLoad, blockTotals, exerciseSessionTotal } from './totals';

export type Trend = 'up' | 'down' | 'same';
/** 'none' is the spec's "–": nothing to compare. */
export type AmountIndicator = Trend | 'none';
export type LoadIndicator = Trend | 'incomparable' | 'hidden' | 'none';

export interface BlockIndicator {
  amount: AmountIndicator;
  load: LoadIndicator;
}

const NONE: BlockIndicator = { amount: 'none', load: 'none' };

function trend(current: number, previous: number): Trend {
  return current > previous ? 'up' : current < previous ? 'down' : 'same';
}

/** Live blocks of one exercise in canonical order; index + 1 is the block's n. */
export function blocksOf(session: Session, exerciseId: string): Block[] {
  return liveBlocks(session).filter((b) => b.exerciseId === exerciseId);
}

/** Live sessions strictly before `session` in session order, most recent first. */
export function earlierSessions(sessions: readonly Session[], session: Session): Session[] {
  return sortSessions(sessions)
    .filter((s) => s.id !== session.id && compareSessions(s, session) < 0)
    .reverse();
}

/** Block n of exercise X in the most recent earlier session that has at least n blocks of X. */
export function previousOccurrence(sessions: readonly Session[], session: Session, exerciseId: string, n: number): Block | undefined {
  for (const s of earlierSessions(sessions, session)) {
    const blocks = blocksOf(s, exerciseId);
    if (blocks.length >= n) return blocks[n - 1];
  }
  return undefined;
}

export function compareBlockPair(current: Block, previous: Block | undefined): BlockIndicator {
  if (previous === undefined) return NONE;
  const c = blockTotals(current);
  const p = blockTotals(previous);
  if (c.isEmpty || p.isEmpty || c.hasAggregate || p.hasAggregate) return NONE;
  const cl = blockLoad(current);
  const pl = blockLoad(previous);
  if (cl === undefined || pl === undefined) return NONE;
  let load: LoadIndicator;
  if (cl.group !== pl.group) load = 'incomparable';
  else if (cl.group === 'body' && cl.kg === 0 && pl.kg === 0) load = 'hidden';
  else load = trend(cl.kg, pl.kg);
  return { amount: trend(c.amount, p.amount), load };
}

export function blockIndicator(sessions: readonly Session[], session: Session, block: Block): BlockIndicator {
  const n = blocksOf(session, block.exerciseId).findIndex((b) => b.id === block.id) + 1;
  if (n === 0) return NONE;
  return compareBlockPair(block, previousOccurrence(sessions, session, block.exerciseId, n));
}

/** Spec §7 ↑↓ per exercise: session total against the most recent earlier session with that exercise. */
export function exerciseIndicator(sessions: readonly Session[], session: Session, exerciseId: string): AmountIndicator {
  const previous = earlierSessions(sessions, session).find((s) => blocksOf(s, exerciseId).length > 0);
  if (previous === undefined) return 'none';
  const c = exerciseSessionTotal(session, exerciseId);
  const p = exerciseSessionTotal(previous, exerciseId);
  if (c.unknown || p.unknown) return 'none';
  return trend(c.amount, p.amount);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 5: Commit**

```powershell
git add src/model/derive/compare.ts src/model/derive/compare.test.ts
git commit -m "Add previous occurrence and up/down indicators" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Derived rules: set intervals, open sessions, day-list filter; derive barrel

**Files:**
- Create: `src/model/derive/time.ts`, `src/model/derive/filter.ts`, `src/model/derive/index.ts`
- Test: `src/model/derive/time.test.ts`, `src/model/derive/filter.test.ts`

**Interfaces:**
- Consumes: Task 10 functions, `Exercise`, `Pattern`.
- Produces from `time.ts`: `SESSION_OPEN_WINDOW_MS`, `setIntervals(session)` → `Map<setId, seconds>`, `isSessionOpen(session, allSessions, now)`.
- Produces from `filter.ts`: `Chip = 'push' | 'pull' | 'legs' | 'other'`, `chipOf(pattern)`, `sessionChips(session, catalog)`, `matchesChip(session, catalog, chip | 'all')`.
- Produces from `index.ts`: re-exports of order, totals, compare, time, filter.

- [ ] **Step 1: Write the failing tests**

`src/model/derive/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isSessionOpen, setIntervals } from './time';
import { T0, block, session, set } from '../test-fixtures';

const at = (hhmmss: string) => `2030-01-01T${hhmmss}.000Z`;

describe('setIntervals (spec §7)', () => {
  it('is the gap between consecutive timestamped sets of a block, in seconds', () => {
    const a = set({ order: 0, completedAt: at('10:00:00') });
    const b = set({ order: 1, completedAt: at('10:01:30') });
    const c = set({ order: 2 });
    const d = set({ order: 3, completedAt: at('10:05:00') });
    const m = setIntervals(session([block([a, b, c, d])]));
    expect(m.get(a.id)).toBeUndefined();
    expect(m.get(b.id)).toBe(90);
    expect(m.get(c.id)).toBeUndefined();
    expect(m.get(d.id)).toBeUndefined();
  });

  it('for the first set of a block uses the latest earlier timestamp anywhere in the session', () => {
    const a = set({ order: 0, completedAt: at('10:00:00') });
    const b = set({ order: 0, completedAt: at('10:03:00') });
    const m = setIntervals(session([block([a], { order: 0 }), block([b], { order: 1 })]));
    expect(m.get(b.id)).toBe(180);
  });

  it('handles two interleaved blocks', () => {
    const p1 = set({ order: 0, completedAt: at('10:00:00') });
    const d1 = set({ order: 0, completedAt: at('10:01:00') });
    const p2 = set({ order: 1, completedAt: at('10:02:00') });
    const m = setIntervals(session([block([p1, p2], { order: 0 }), block([d1], { order: 1, exerciseId: 'dips' })]));
    expect(m.get(p2.id)).toBe(120);
    expect(m.get(d1.id)).toBe(60);
  });

  it('shows nothing for a reversed pair and skips deleted sets', () => {
    const a = set({ order: 0, completedAt: at('10:05:00') });
    const b = set({ order: 1, completedAt: at('10:00:00') });
    const dead = set({ order: 2, completedAt: at('10:06:00'), deletedAt: T0 });
    const c = set({ order: 3, completedAt: at('10:07:00') });
    const m = setIntervals(session([block([a, b, dead, c])]));
    expect(m.get(b.id)).toBeUndefined();
    expect(m.get(c.id)).toBe(420);
  });

  it('spans midnight', () => {
    const a = set({ order: 0, completedAt: '2030-01-01T23:59:00.000Z' });
    const b = set({ order: 1, completedAt: '2030-01-02T00:01:00.000Z' });
    expect(setIntervals(session([block([a, b])])).get(b.id)).toBe(120);
  });
});

describe('isSessionOpen (spec §7)', () => {
  const started = session([block([set({ completedAt: at('10:30:00') })])], { startedAt: at('10:00:00') });

  it('is false without startedAt', () => {
    expect(isSessionOpen(session([block([set({ completedAt: at('10:30:00') })])]), [], new Date(at('10:31:00')))).toBe(false);
  });

  it('is open within 3 h of the latest timestamp and closed at 3 h', () => {
    expect(isSessionOpen(started, [started], new Date(at('13:29:59')))).toBe(true);
    expect(isSessionOpen(started, [started], new Date(at('13:30:00')))).toBe(false);
  });

  it('closes when a newer session was started, unless that session is deleted', () => {
    const newer = session([], { startedAt: at('11:00:00') });
    expect(isSessionOpen(started, [started, newer], new Date(at('11:01:00')))).toBe(false);
    const deletedNewer = session([], { startedAt: at('11:00:00'), deletedAt: T0 });
    expect(isSessionOpen(started, [started, deletedNewer], new Date(at('11:01:00')))).toBe(true);
  });
});
```

`src/model/derive/filter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { chipOf, matchesChip, sessionChips } from './filter';
import { T0, block, exercise, ladder, session } from '../test-fixtures';

const catalog = [
  exercise(),
  exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }),
  exercise({ id: 'knee-raises', name: 'Knee Raises', pattern: 'core' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs', deletedAt: T0 }),
];

describe('chipOf', () => {
  it('maps push, pull, legs to themselves and everything else to other', () => {
    expect(chipOf('push')).toBe('push');
    expect(chipOf('legs')).toBe('legs');
    expect(chipOf('shoulders')).toBe('other');
    expect(chipOf('conditioning')).toBe('other');
  });
});

describe('sessionChips and matchesChip (spec §7 day-list filter)', () => {
  it('uses each block\'s exercise pattern, not the session label', () => {
    const s = session([block(ladder([5]), { exerciseId: 'dips-bar' }), block(ladder([10]), { order: 1, exerciseId: 'knee-raises' })], { label: 'pull' });
    expect([...sessionChips(s, catalog)].sort()).toEqual(['other', 'push']);
    expect(matchesChip(s, catalog, 'push')).toBe(true);
    expect(matchesChip(s, catalog, 'pull')).toBe(false);
    expect(matchesChip(s, catalog, 'all')).toBe(true);
  });

  it('ignores deleted blocks', () => {
    const s = session([block(ladder([5]), { exerciseId: 'dips-bar', deletedAt: T0 })]);
    expect(matchesChip(s, catalog, 'push')).toBe(false);
  });

  it('uses a tombstoned exercise\'s pattern', () => {
    expect(matchesChip(session([block(ladder([5]), { exerciseId: 'squats' })]), catalog, 'legs')).toBe(true);
  });

  it('files an unknown exercise under other so the session stays findable', () => {
    expect(matchesChip(session([block(ladder([5]), { exerciseId: 'nope' })]), catalog, 'other')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/model/derive/time.ts`**

```ts
import type { Session } from '../types';
import { liveBlocks, liveSets } from './order';

export const SESSION_OPEN_WINDOW_MS = 3 * 60 * 60 * 1000;

function liveStamps(session: Session): string[] {
  return liveBlocks(session)
    .flatMap(liveSets)
    .flatMap((s) => (s.completedAt === undefined ? [] : [s.completedAt]));
}

/**
 * Spec §7 "Set interval": seconds from the previous timestamped set, keyed by set id. Within a
 * block the previous set is the canonical predecessor; for a block's first set it is the latest
 * earlier timestamp anywhere in the session. Missing or reversed timestamps give no entry.
 */
export function setIntervals(session: Session): Map<string, number> {
  const out = new Map<string, number>();
  const stamps = liveStamps(session);
  for (const block of liveBlocks(session)) {
    const sets = liveSets(block);
    sets.forEach((set, i) => {
      const at = set.completedAt;
      if (at === undefined) return;
      let previous: string | undefined;
      if (i === 0) {
        const earlier = stamps.filter((t) => t < at);
        previous = earlier.length === 0 ? undefined : earlier.reduce((a, b) => (a > b ? a : b));
      } else {
        previous = sets[i - 1]?.completedAt;
      }
      if (previous === undefined) return;
      const ms = Date.parse(at) - Date.parse(previous);
      if (ms > 0) out.set(set.id, ms / 1000);
    });
  }
  return out;
}

/** Spec §7 "Session open/closed". Never stored. */
export function isSessionOpen(session: Session, allSessions: readonly Session[], now: Date): boolean {
  if (session.deletedAt !== undefined || session.startedAt === undefined) return false;
  const started = session.startedAt;
  const latest = liveStamps(session).reduce((a, b) => (a > b ? a : b), started);
  if (now.getTime() - Date.parse(latest) >= SESSION_OPEN_WINDOW_MS) return false;
  return !allSessions.some(
    (s) => s.id !== session.id && s.deletedAt === undefined && s.startedAt !== undefined && s.startedAt > started,
  );
}
```

- [ ] **Step 4: Write `src/model/derive/filter.ts`**

```ts
import type { Exercise, Pattern, Session } from '../types';
import { liveBlocks } from './order';

export type Chip = 'push' | 'pull' | 'legs' | 'other';

export function chipOf(pattern: Pattern): Chip {
  return pattern === 'push' || pattern === 'pull' || pattern === 'legs' ? pattern : 'other';
}

/** The chips a session matches (spec §7 day-list filter). The catalog must include tombstoned
 *  entries; an exercise that still can't be resolved counts as 'other' so the session stays findable. */
export function sessionChips(session: Session, catalog: readonly Exercise[]): Set<Chip> {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  return new Set(
    liveBlocks(session).map((b) => {
      const ex = byId.get(b.exerciseId);
      return ex === undefined ? 'other' : chipOf(ex.pattern);
    }),
  );
}

export function matchesChip(session: Session, catalog: readonly Exercise[], chip: Chip | 'all'): boolean {
  return chip === 'all' || sessionChips(session, catalog).has(chip);
}
```

- [ ] **Step 5: Write `src/model/derive/index.ts`**

```ts
export * from './order';
export * from './totals';
export * from './compare';
export * from './time';
export * from './filter';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 7: Commit**

```powershell
git add src/model/derive/time.ts src/model/derive/time.test.ts src/model/derive/filter.ts src/model/derive/filter.test.ts src/model/derive/index.ts
git commit -m "Add set intervals, open-session rule and day-list filter" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Documentation: CLAUDE.md and HANDOVER.md (spec deliverable 10)

**Files:**
- Modify: `CLAUDE.md` (whole file), `docs/HANDOVER.md` (one note under the §3 heading)

**Interfaces:** none (docs only).

- [ ] **Step 1: Replace `CLAUDE.md` with**

```markdown
# CalisTally

A calisthenics training tracker built as a static PWA. It reads and writes JSON data files in the user's Dropbox through the Dropbox API (App folder, OAuth 2 PKCE). There is no backend and no paid infrastructure. It replaces a free-text XLSX log.

**Status:** spec 1 (data model) implemented as a tested TypeScript library under `src/model/`. No UI, no sync, no XLSX parser yet.

## Read first

- [docs/superpowers/specs/2026-10-06-data-model-design.md](docs/superpowers/specs/2026-10-06-data-model-design.md): **spec 1, the data model.** Source of truth for the entities, validation, versioning, file layout and derived-value rules. Where HANDOVER.md disagrees, the spec wins.
- [docs/HANDOVER.md](docs/HANDOVER.md): the original brief. §3 (draft data model) is superseded by spec 1; the rest (goals, XLSX migration notes, open questions) still applies.
- [docs/tracker-options.md](docs/tracker-options.md): the option analysis behind the chosen architecture, and what's wrong with the XLSX data.

## Core rules (from spec 1, do not drift)

- **Session → Block → Set. One record per set.** Day views, totals, indicators and charts are derived and never stored. The block's sets *are* the pattern; there is no SetGroup.
- Session `label` is display only. It never filters and never constrains which exercises can be logged. The day-list filter uses each block's exercise `pattern`.
- Reps may be decimal and must be > 0. No RPE/RIR, no `side` field, no stored rest for live sets.
- Exercises come from a catalog. `metric` and `perSide` are immutable after creation. Exercises with history are archived, never deleted.
- Every record has `updatedAt` (its own fields only, not children) and an optional `deletedAt` tombstone. Deleting marks, never removes. Timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ`.
- `order` is a sort key only (any finite number); the canonical order is in `src/model/derive/order.ts`.
- Every file carries `schemaVersion`; `MODEL_VERSION` lives in `src/model/schema.ts`. Any shape change, including a new optional field, bumps it and adds an upgrade step in `src/model/upgrade.ts`. A too-new file is read leniently and never written.
- Validation has two levels: hard rules (in-file; failure quarantines) and soft catalog rules (failure flags, never quarantines). Validate before every write with `validateForWrite`.
- Dropbox writes use `mode: update` + last known `rev`. On a conflict: download, merge per record by `updatedAt`, retry. Never produce "conflicted copy" files. Session files never move.
- Offline-first: IndexedDB local copy plus a pending-write queue.
- Migration never guesses silently. Anything ambiguous goes on a review list for the owner.

## Repo layout

- `src/model/schema.ts`: the TypeBox schema, the single source of truth (D14). `types.ts` infers the TS types from it.
- `schema/*.schema.json`: emitted JSON Schema, committed. Regenerate with `npm run emit-schema`; a test fails when it is stale.
- `src/model/validate.ts`, `read.ts`, `upgrade.ts`: validation levels, read pipeline, version steps.
- `src/model/record.ts`, `slug.ts`, `catalog.ts`, `seed.ts`, `seed-exercises.json`: record helpers, ids and names, seed catalog.
- `src/model/derive/`: the pure derived-value functions of spec §7 (order, totals, compare, time, filter).
- `src/model/test-fixtures.ts`: synthetic fixture builders (dates in 2030). Tests sit next to the code as `*.test.ts`.
- `docs/superpowers/specs/`, `docs/superpowers/plans/`: specs and implementation plans.

## Commands

- `npm install`
- `npm test` (Vitest, single run), `npm run test:watch`
- `npm run typecheck` (tsc, strict)
- `npm run emit-schema` (writes `schema/*.schema.json`)

## Never commit

Training data, the XLSX (`*.xlsx` is gitignored), Dropbox tokens, `.env` files, or any local data folder. Fixtures are synthetic. The repo may become public (GitHub Pages).

## Planned stack

Vite + TypeScript PWA (chart library not chosen yet). Hosting: GitHub Pages or Cloudflare Pages (open question, spec 3). Migration script (spec 2) in Node or Python, validating against `schema/*.schema.json`.

## To fill in later

- Dropbox app name, redirect URIs (prod + `http://localhost:<port>`): spec 3.
- Lint/format tooling (none yet).
```

- [ ] **Step 2: Add a note to `docs/HANDOVER.md`**

Directly under the heading `## 3. Proposed data model (draft, needs review before building)` insert:
```markdown
> **Superseded.** The data model and storage layout are now defined by [superpowers/specs/2026-10-06-data-model-design.md](superpowers/specs/2026-10-06-data-model-design.md) (spec 1). This section is kept for history. Where it disagrees with the spec, the spec wins.
```

- [ ] **Step 3: Run the full suite once more**

Run: `npm test && npm run typecheck`
Expected: all pass, tsc clean.

- [ ] **Step 4: Commit**

```powershell
git add CLAUDE.md docs/HANDOVER.md
git commit -m "Update CLAUDE.md and HANDOVER.md for the implemented data model" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|---|---|
| §3 RecordMeta, record rules (`updatedAt`, delete, undelete, order) | 5 |
| §3 Exercise, slug rule, name uniqueness, immutability, referenced tombstones | 2, 8 |
| §3 Session, Block, WorkoutSet, BodyweightEntry, load types | 2, 3, 6 (loadKg rules) |
| §4 file layout | out of scope here (spec 3 does I/O); file wrappers in 2, 3 |
| §5 versioning, too-new read-only, bump policy | 7 (and the `UPGRADE_STEPS` comment) |
| §5 single source, constraints, emitted schema | 2, 3, 4 |
| §5 validate on read and before write, hard vs soft | 6, 7 |
| §5 seed catalog, fixed `updatedAt`, seed merge | 9 |
| §6 aggregate, note-only blocks, `dateUncertain` | 3, 6, 11, 12 |
| §7 sibling order, session order | 10 |
| §7 block totals, block load, exercise total | 11 |
| §7 previous occurrence, ↑↓ per block, ↑↓ per exercise | 12 |
| §7 set interval, open/closed, day-list filter | 13 |
| §8 deliverable 10 (CLAUDE.md, HANDOVER.md) | 14 |
| §9 test list | spread over 2–13 as listed in each task |

Not covered on purpose: the merge itself, the write queue, held-back writes and the issues screen (spec 3 and 4). `validateForWrite` and `readFile` are the hooks they will call.
