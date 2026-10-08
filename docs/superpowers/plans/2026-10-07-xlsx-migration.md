# XLSX Migration Implementation Plan (spec 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the one-off, deterministic migration that turns the `Calisthenics_Tracker_2026.xlsx` sheet into spec 1 files (one session file per training day, the catalog, one bodyweight entry), a review list for every doubtful cell and a decisions file the owner answers it with, all without any training data entering git.

**Architecture:** A pure library under `src/migration/` with I/O only at its two edges (`readWorkbook` in `grid.ts`, `writeOutput` in `output.ts`) and a thin CLI (`scripts/migrate-xlsx.ts` → `src/migration/cli.ts`). The pipeline is `Grid → SourceRow[] → (per cell) ParsedLine → CellBlock[] → Session[]`, plus dates resolved per column block, decisions applied before parsing, review items and report entries collected along the way, and a validation gate (`validateForWrite`, `checkCatalogRules`) before anything is written. Ids are UUID v5 over cell addresses and every `updatedAt` is one fixed stamp, so reruns are byte-identical.

**Tech Stack:** Node.js 24 (LTS), TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest, `exceljs` 4.4 as the only new dependency (devDependency), `node:crypto` for SHA-1, the existing `src/model/` library for types, validation and the seed.

**Spec:** `docs/superpowers/specs/2026-10-07-xlsx-migration-design.md` (spec 2). Section references below (§4, §5 …) are to spec 2 unless marked "spec 1". Executors read spec 2 before starting; spec 1 §3–§6 explain the target format.

**The code in this plan was prototyped against the real workbook while planning.** Every module below was run over all 389 exercise cells and 147 sessions of the real sheet: zero unparseable lines, every output file valid under `validateForWrite` and `checkCatalogRules`, 25 review items exactly as spec 2 §9 predicts, and `tsc` clean under the repo's strict settings. Copy the code as written; where a test and the code disagree, the code is the reference and the test has a typo.

## Global Constraints

- Node.js LTS (v24.19.0 installed, npm 11.x). Run everything from the repo root, in PowerShell or Git Bash.
- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (existing `tsconfig.json`). An optional field is **absent**, never `undefined`: build objects with conditional spreads (`...(x !== undefined ? { x } : {})`) and remove keys with `delete`, never assign `undefined`.
- Every emitted record follows spec 1: timestamps exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, uuids lowercase, `reps > 0`, `loadKg = 0` iff `bodyweight`, `added`/`assist` need `loadKg > 0`, `aggregate` and `dateUncertain` only in `source: 'migrated'` sessions, `order` 0, 1, 2 ….
- Fixed constants (spec 2 §3, §8): `SHEET_YEAR = 2026`, `MIGRATION_STAMP = '2026-10-07T00:00:00.000Z'`, `MIGRATION_NAMESPACE = 'c7a1f3d2-8e4b-4c6a-9f0d-2b5e7a9c1d3f'`. Never change them after the first real run.
- **No training data in git.** Tests use synthetic cells with dates in 2030 and invented numbers (the header strings of row 2 and the notation forms are fine). The XLSX, `decisions.json` and the output folder stay outside the repo; `--out` inside the repo is refused.
- `exceljs@^4.4.0` is the only new dependency, as a devDependency. Do not add `uuid`, `xlsx` or a CLI-args library (`node:util` `parseArgs` is enough).
- English for every string the output carries (notes copied from the sheet keep their original German).
- Commit messages: plain imperative sentence, as in the repo's history (`Add …`, `Revise …`), ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit to the branch `spec/xlsx-migration`. Do not push until Task 14 says so.
- Writing files from Bash: the Bash tool's wrapper corrupts single quotes and backslashes inside heredocs. Create and edit source files with the Write/Edit tools, never with `cat <<EOF`.

## Review Focus

Input classes spec 2 implies but that no task's tests originally exercised. Each is pinned to a test in the owning task.

1. A `text` decision whose replacement itself contains `dann` or several lines must go through the full grammar and produce two blocks, not one. → Task 11, test "a text decision is parsed like a cell".
2. An Excel date cell is a `Date` at UTC midnight; the calendar day must come from the UTC fields, never from local time (The owner's PC is UTC+1/+2, so local fields would be right by accident and wrong on another machine). → Task 1, test "takes the calendar day from the UTC fields".
3. Two sessions on the same date (a column-block row and an Extra session) must get two distinct file paths via `<id8>`, never overwrite each other. → Task 12, test "two sessions on one date get two files".
4. A `text` decision identical to the cell changes nothing and must surface as `stale-decision`, otherwise the decisions file silently rots. → Task 11, test "a decision that changes nothing is stale".
5. `writeOutput` must remove only the managed paths and leave anything else in `--out` alone (The owner may keep notes next to the output), and `--out` inside the repository must be refused before anything is read. → Task 12, test "clears only the managed paths"; Task 13, test "refuses an output directory inside the repository".

## File Structure

| File | Responsibility |
|---|---|
| `src/migration/types.ts` | `ReviewKind`, `ReviewItem`, `ReportKind`, `ReportEntry` (shared by parser, build, review) |
| `src/migration/sheet.ts` | The constants: column blocks, header row, sheet year, stamp, bodyweight kg |
| `src/migration/grid.ts` | `Cell`, `Grid`, `convertCell`, `lastRow`, `readWorkbook` (exceljs, input I/O) |
| `src/migration/test-fixtures.ts` | `HEADERS`, `gridOf`, `writeWorkbook` for tests |
| `src/migration/ids.ts` | UUID v5 |
| `src/migration/tokenize.ts` | Line → tokens (§5 "Tokens") |
| `src/migration/phrases.ts` | Tag, cue, note and order phrases; grammar and flag keywords (§5, §7) |
| `src/migration/exercises.ts` | Alias table, header fallback, band variants, refinements, `resolveExercise` (§6) |
| `src/migration/parse-line.ts` | Phrase pass + set grammar for one line (§5) |
| `src/migration/parse-cell.ts` | Lines → `CellBlock[]`: fallback, continuation, `dann`, `plus`, note lines (§4 "Cells to blocks") |
| `src/migration/dates.ts` | Text dates and repairs, order/duplicate check with proposals, undated-row proposals (§4) |
| `src/migration/rows.ts` | Grid → `SourceRow[]` per column block, Extra sessions (§4) |
| `src/migration/decisions.ts` | Decisions file parsing and per-cell application (§9) |
| `src/migration/build.ts` | Rows → sessions, catalog, bodyweight, review items, report entries (§4–§9) |
| `src/migration/review.ts` | `review.md` and `report.md` renderers (§9) |
| `src/migration/output.ts` | File list, validation gate, output directory handling (§8) |
| `src/migration/cli.ts` | `runMigration`: the whole pipeline with exit codes |
| `scripts/migrate-xlsx.ts` | Argument parsing, calls `runMigration` |
| `src/model/seed-exercises.json` | Seed amendment (§6) |

---

### Task 1: Scaffold, grid types and the exceljs reader

**Files:**
- Modify: `package.json` (devDependency `exceljs`), `.gitignore`
- Create: `src/migration/types.ts`, `src/migration/sheet.ts`, `src/migration/grid.ts`, `src/migration/test-fixtures.ts`
- Test: `src/migration/grid.test.ts`

**Interfaces:**
- Produces: `Cell = { kind: 'text' | 'date'; value: string }` (a date cell's value is `YYYY-MM-DD`), `Grid = Map<string, Cell>` keyed by cell address (`'A6'`), `convertCell(value: ExcelJS.CellValue): Cell | undefined`, `lastRow(grid: Grid): number`, `readWorkbook(path: string): Promise<Grid>`; the constants of `sheet.ts`; `ReviewKind` and friends in `types.ts`; test helpers `gridOf(cells, headers?)` and `writeWorkbook(file, cells, headers?)`.

- [ ] **Step 1: Install exceljs**

```powershell
npm install --save-dev exceljs@^4.4.0
```
Expected: `package.json` gains `"exceljs": "^4.4.0"` under `devDependencies`; `package-lock.json` changes.

- [ ] **Step 2: Extend `.gitignore`**

Append to `.gitignore`:
```
# Migration inputs and outputs (training data, never committed)
decisions.json
*.decisions.json
migration-out/
```

- [ ] **Step 3: Create `src/migration/types.ts`**

```ts
/** Spec 2 §9: the kinds of review item. */
export type ReviewKind =
  | 'date-proposed'
  | 'date-repaired-doubtful'
  | 'date-unreadable'
  | 'date-out-of-order'
  | 'empty-row'
  | 'unparsed-line'
  | 'unknown-exercise'
  | 'load-missing'
  | 'sets-exceed-reps'
  | 'parenthesised-numbers'
  | 'aggregate'
  | 'note-only'
  | 'pyramid-expanded'
  | 'stale-decision';

export interface ReviewItem {
  kind: ReviewKind;
  /** The decision key that answers it: a cell address (`G9`) or address#line (`M27#3`). */
  key: string;
  /** `Pull`, `Push`, `Legs`, `Extra`, or `?` for a decision without a cell. */
  block: string;
  row: number;
  date: string | undefined;
  /** The cell text (or line) the item is about; empty for an undated row. */
  raw: string;
  /** What the script did meanwhile. */
  proposal: string;
  detail: string;
}

export type ReportKind = 'repair' | 'dropped' | 'decision' | 'unrecognised' | 'skipped' | 'accepted';

export interface ReportEntry {
  kind: ReportKind;
  /** Cell address or decision key. */
  where: string;
  detail: string;
}
```

- [ ] **Step 4: Create `src/migration/sheet.ts`**

```ts
import type { SessionLabel } from '../model/types';

export type BlockName = 'Pull' | 'Push' | 'Legs';

export interface ColumnBlock {
  name: BlockName;
  label: SessionLabel;
  dateCol: string;
  exerciseCols: readonly string[];
  /** The "Extra" column (Push only). */
  extraCol?: string;
}

/** Spec 2 §4 "Column blocks". */
export const COLUMN_BLOCKS: readonly ColumnBlock[] = [
  { name: 'Pull', label: 'pull', dateCol: 'A', exerciseCols: ['B', 'C', 'D'] },
  { name: 'Push', label: 'push', dateCol: 'F', exerciseCols: ['G', 'H', 'I'], extraCol: 'J' },
  { name: 'Legs', label: 'legs', dateCol: 'L', exerciseCols: ['M', 'N', 'O'] },
];

export const HEADER_ROW = 2;
export const FIRST_DATA_ROW = 3;

/** The only year in the workbook; used to complete `06.07.` and to read `206` (spec 2 §4). */
export const SHEET_YEAR = 2026;

/** Every migrated record's updatedAt (spec 2 §8). Older than anything the owner will do in the app. */
export const MIGRATION_STAMP = '2026-10-07T00:00:00.000Z';

/** Spec 2 §8 "Bodyweight" (decision M15). */
export const BODYWEIGHT_KG = 80;
```

- [ ] **Step 5: Write the failing tests `src/migration/grid.test.ts`**

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertCell, lastRow, readWorkbook } from './grid';
import { gridOf, writeWorkbook } from './test-fixtures';

describe('convertCell', () => {
  it('drops empty and blank cells', () => {
    expect(convertCell(null)).toBeUndefined();
    expect(convertCell(undefined as never)).toBeUndefined();
    expect(convertCell('   ')).toBeUndefined();
  });

  it('keeps text as written, including inner newlines and outer spaces', () => {
    expect(convertCell(' 11,5kg 22x 23x')).toEqual({ kind: 'text', value: ' 11,5kg 22x 23x' });
    expect(convertCell('a\nb')).toEqual({ kind: 'text', value: 'a\nb' });
  });

  it('takes the calendar day from the UTC fields', () => {
    expect(convertCell(new Date('2030-01-19T00:00:00.000Z'))).toEqual({ kind: 'date', value: '2030-01-19' });
    expect(convertCell(new Date('2030-01-19T23:30:00.000Z'))).toEqual({ kind: 'date', value: '2030-01-19' });
  });

  it('stringifies numbers and booleans, flattens rich text, uses formula results and hyperlink text', () => {
    expect(convertCell(42)).toEqual({ kind: 'text', value: '42' });
    expect(convertCell(true)).toEqual({ kind: 'text', value: 'true' });
    expect(convertCell({ richText: [{ text: 'Pullups ' }, { text: '5x 5x' }] })).toEqual({ kind: 'text', value: 'Pullups 5x 5x' });
    expect(convertCell({ formula: 'A1', result: 'x' })).toEqual({ kind: 'text', value: 'x' });
    expect(convertCell({ text: 'linked', hyperlink: 'https://example.invalid' })).toEqual({ kind: 'text', value: 'linked' });
  });
});

describe('readWorkbook', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-grid-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a synthetic workbook into a Grid', async () => {
    const file = path.join(dir, 'synthetic.xlsx');
    const cells = { A6: { date: '2030-01-19' }, B6: '6kg 15x 12x', A7: '25.01.30', B7: 'Pullups 5x 5x', C7: '   ' };
    await writeWorkbook(file, cells);
    const grid = await readWorkbook(file);
    const expected = gridOf({ A6: { date: '2030-01-19' }, B6: '6kg 15x 12x', A7: '25.01.30', B7: 'Pullups 5x 5x' });
    expect([...grid.entries()].sort()).toEqual([...expected.entries()].sort());
    expect(grid.has('C7')).toBe(false);
    expect(lastRow(grid)).toBe(7);
  });

  it('rejects a workbook without a worksheet', async () => {
    await expect(readWorkbook(path.join(dir, 'missing.xlsx'))).rejects.toThrow();
  });
});

describe('gridOf', () => {
  it('fills the header row by default and can leave it out', () => {
    expect(gridOf({}).get('B2')).toEqual({ kind: 'text', value: 'Australian Pull Ups' });
    expect(gridOf({}, false).size).toBe(0);
    expect(lastRow(gridOf({}, false))).toBe(0);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/grid.test.ts
```
Expected: FAIL, "Cannot find module './grid'" (or similar).

- [ ] **Step 7: Create `src/migration/grid.ts`**

```ts
import ExcelJS from 'exceljs';

/** One non-empty cell. A date cell's value is the calendar day `YYYY-MM-DD` (UTC fields). */
export interface Cell {
  kind: 'text' | 'date';
  value: string;
}

/** The sheet as a map from cell address (`A6`) to cell. Empty cells are absent. */
export type Grid = Map<string, Cell>;

function text(value: string): Cell | undefined {
  return value.trim() === '' ? undefined : { kind: 'text', value };
}

/** exceljs cell value → Cell. Spec 2 §3 "Grid". */
export function convertCell(value: ExcelJS.CellValue): Cell | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return { kind: 'date', value: value.toISOString().slice(0, 10) };
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number' || typeof value === 'boolean') return text(String(value));
  if (typeof value === 'object') {
    if ('richText' in value) return text(value.richText.map((t) => t.text).join(''));
    if ('result' in value) return convertCell(value.result as ExcelJS.CellValue);
    if ('text' in value) return typeof value.text === 'string' ? text(value.text) : convertCell(value.text as ExcelJS.CellValue);
  }
  return undefined;
}

export function lastRow(grid: Grid): number {
  let max = 0;
  for (const address of grid.keys()) {
    const row = Number(/\d+$/.exec(address)?.[0] ?? 0);
    if (row > max) max = row;
  }
  return max;
}

/** The first worksheet of the workbook as a Grid. The only input-side I/O of the migration. */
export async function readWorkbook(file: string): Promise<Grid> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new Error(`${file}: workbook has no worksheet`);
  const grid: Grid = new Map();
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const converted = convertCell(cell.value);
      if (converted !== undefined) grid.set(cell.address, converted);
    });
  });
  return grid;
}
```

- [ ] **Step 8: Create `src/migration/test-fixtures.ts`**

```ts
import ExcelJS from 'exceljs';
import type { Grid } from './grid';

/** Row 2 of the real sheet. Header strings are not training data. */
export const HEADERS: Readonly<Record<string, string>> = {
  A2: 'Date',
  B2: 'Australian Pull Ups',
  C2: 'Bicep Curls',
  D2: 'Face Pulls',
  F2: 'Date',
  G2: 'Dips',
  H2: 'Push Ups',
  I2: 'Triceps Pulldowns',
  J2: 'Extra',
  L2: 'Date',
  M2: 'Single Leg RDL',
  N2: 'Split Squats',
  O2: 'Calf Raises',
};

export type CellSpec = string | { date: string };

/** A Grid from `{ A6: '01.02.30', B6: '20x 15x', A7: { date: '2030-02-07' } }`, with the real headers in row 2. */
export function gridOf(cells: Record<string, CellSpec>, headers: boolean = true): Grid {
  const grid: Grid = new Map();
  if (headers) for (const [address, value] of Object.entries(HEADERS)) grid.set(address, { kind: 'text', value });
  for (const [address, spec] of Object.entries(cells)) {
    grid.set(address, typeof spec === 'string' ? { kind: 'text', value: spec } : { kind: 'date', value: spec.date });
  }
  return grid;
}

/** Writes a synthetic workbook with exceljs; `{ date }` specs become real date cells. */
export async function writeWorkbook(file: string, cells: Record<string, CellSpec>, headers: boolean = true): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Calisthenics Plan');
  const all: Record<string, CellSpec> = { ...(headers ? HEADERS : {}), ...cells };
  for (const [address, spec] of Object.entries(all)) {
    sheet.getCell(address).value = typeof spec === 'string' ? spec : new Date(`${spec.date}T00:00:00.000Z`);
  }
  await workbook.xlsx.writeFile(file);
}
```

- [ ] **Step 9: Run the tests and the typecheck**

```powershell
npx vitest run src/migration/grid.test.ts
npm run typecheck
```
Expected: all tests PASS; tsc clean. If tsc complains about the default import of `exceljs`, the repo's `esModuleInterop: true` is missing from `tsconfig.json`; it is present as of spec 1, so check the file rather than changing the import style.

- [ ] **Step 10: Commit**

```powershell
git add package.json package-lock.json .gitignore src/migration/types.ts src/migration/sheet.ts src/migration/grid.ts src/migration/test-fixtures.ts src/migration/grid.test.ts
git commit -m "Add migration scaffold, grid types and the exceljs reader" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Deterministic ids (UUID v5)

**Files:**
- Create: `src/migration/ids.ts`
- Test: `src/migration/ids.test.ts`

**Interfaces:**
- Produces: `uuidV5(name: string, namespace?: string): string` (lowercase RFC 4122 v5), `MIGRATION_NAMESPACE`, `DNS_NAMESPACE`, `URL_NAMESPACE`.

- [ ] **Step 1: Write the failing tests `src/migration/ids.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { UUID_PATTERN } from '../model/schema';
import { DNS_NAMESPACE, MIGRATION_NAMESPACE, URL_NAMESPACE, uuidV5 } from './ids';

describe('uuidV5', () => {
  it('matches the published RFC 4122 v5 vectors', () => {
    expect(uuidV5('hello.example.com', DNS_NAMESPACE)).toBe('fdda765f-fc57-5604-a269-52a7df8164ec');
    expect(uuidV5('www.example.com', DNS_NAMESPACE)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidV5('https://www.w3.org/', URL_NAMESPACE)).toBe('c106a26a-21bb-5538-8bf2-57095d1976c1');
  });

  it('uses the migration namespace by default and satisfies the schema pattern', () => {
    const id = uuidV5('session/Pull!6');
    expect(id).toBe(uuidV5('session/Pull!6', MIGRATION_NAMESPACE));
    expect(new RegExp(UUID_PATTERN).test(id)).toBe(true);
    expect(id[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is deterministic and name-sensitive', () => {
    expect(uuidV5('session/Pull!6')).toBe(uuidV5('session/Pull!6'));
    expect(uuidV5('session/Pull!6')).not.toBe(uuidV5('session/Pull!7'));
    expect(uuidV5('session/Pull!6')).not.toBe(uuidV5('session/Pull!6', DNS_NAMESPACE));
  });

  it('rejects a malformed namespace', () => {
    expect(() => uuidV5('x', 'not-a-uuid')).toThrow(/namespace/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/ids.test.ts
```
Expected: FAIL, cannot find module './ids'.

- [ ] **Step 3: Create `src/migration/ids.ts`**

```ts
import { createHash } from 'node:crypto';

/** Arbitrary but fixed: every migrated id is derived from it (spec 2 §8). Never change it. */
export const MIGRATION_NAMESPACE = 'c7a1f3d2-8e4b-4c6a-9f0d-2b5e7a9c1d3f';
/** RFC 4122 Appendix C namespaces, for the test vectors. */
export const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** RFC 4122 version 5: SHA-1 over namespace bytes + utf8(name), with version and variant bits set. */
export function uuidV5(name: string, namespace: string = MIGRATION_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error(`bad namespace uuid ${namespace}`);
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/migration/ids.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/migration/ids.ts src/migration/ids.test.ts
git commit -m "Add UUID v5 for deterministic migration ids" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Seed amendment (spec 2 §6)

**Files:**
- Modify: `src/model/seed-exercises.json`, `src/model/seed.test.ts`, `docs/superpowers/specs/2026-10-06-data-model-design.md` (§5 seed table)

**Interfaces:**
- Produces: the amended `SEED` (24 entries) that every migration exercise id must belong to: adds `australian-pull-ups-rings`, `face-pulls-band`, `bicep-curls-band`, `triceps-pulldowns-band`; removes `bicep-curls-cable`, `triceps-pulldowns-cable`, `lateral-raises`, `dips-rings`.

- [ ] **Step 1: Update `src/model/seed.test.ts`**

Replace the test `'carries the fixed seed time, metric reps and archived false on every entry'` and add an amendment test. The `SEED_TIME` constant becomes two allowed stamps:

```ts
const SEED_TIMES = ['2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z'];
```

```ts
  it('carries a fixed seed time, metric reps and archived false on every entry', () => {
    for (const e of SEED) {
      expect(SEED_TIMES, e.id).toContain(e.updatedAt);
      expect(e.metric).toBe('reps');
      expect(e.archived).toBe(false);
      expect(e.deletedAt).toBeUndefined();
    }
  });

  it('reflects the spec 2 §6 amendment: bands and rings, no cable curls or ring dips', () => {
    const ids = new Set(SEED.map((e) => e.id));
    for (const id of ['australian-pull-ups-rings', 'australian-pull-ups-bar', 'face-pulls-band', 'face-pulls-cable', 'bicep-curls-band', 'bicep-curls-ez-bar', 'triceps-pulldowns-band', 'lateral-raises-band', 'ring-deficit-push-ups', 'dips-bar']) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const id of ['bicep-curls-cable', 'triceps-pulldowns-cable', 'lateral-raises', 'dips-rings']) expect(ids.has(id), id).toBe(false);
    const rings = SEED.find((e) => e.id === 'australian-pull-ups-rings');
    expect(rings?.defaultLoadType).toBe('added');
    expect(rings?.cues).toBe('clean elbows, slow, full extension');
    expect(rings?.updatedAt).toBe('2026-10-07T00:00:00.000Z');
    for (const id of ['face-pulls-band', 'bicep-curls-band', 'triceps-pulldowns-band']) {
      expect(SEED.find((e) => e.id === id)?.defaultLoadType, id).toBe('band');
    }
  });
```
Remove the old `SEED_TIME` constant (the `mergeSeed` tests do not use it).

- [ ] **Step 2: Run the seed tests to verify they fail**

```powershell
npx vitest run src/model/seed.test.ts
```
Expected: FAIL on the amendment test (ids missing / present).

- [ ] **Step 3: Rewrite `src/model/seed-exercises.json`**

Replace the whole file with (24 entries; the four new ones carry the 2026-10-07 stamp):

```json
[
  { "id": "australian-pull-ups-rings", "name": "Australian Pull-ups (Rings)", "family": "Australian Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "added", "cues": "clean elbows, slow, full extension", "archived": false, "updatedAt": "2026-10-07T00:00:00.000Z" },
  { "id": "australian-pull-ups-bar", "name": "Australian Pull-ups (Bar)", "family": "Australian Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "pull-ups", "name": "Pull-ups", "family": "Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "negative-pull-ups", "name": "Negative Pull-ups", "family": "Pull-ups", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "bicep-curls-band", "name": "Bicep Curls (Band)", "family": "Bicep Curls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-07T00:00:00.000Z" },
  { "id": "bicep-curls-ez-bar", "name": "Bicep Curls (EZ Bar)", "family": "Bicep Curls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "face-pulls-band", "name": "Face Pulls (Band)", "family": "Face Pulls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-07T00:00:00.000Z" },
  { "id": "face-pulls-cable", "name": "Face Pulls (Cable)", "family": "Face Pulls", "pattern": "pull", "metric": "reps", "perSide": false, "defaultLoadType": "external", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "dips-bar", "name": "Dips (Bar)", "family": "Dips", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "push-ups", "name": "Push-ups", "family": "Push-ups", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "added", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "diamond-push-ups", "name": "Diamond Push-ups", "family": "Push-ups", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "ring-deficit-push-ups", "name": "Ring Deficit Push-ups", "family": "Push-ups", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "bodyweight", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
  { "id": "triceps-pulldowns-band", "name": "Triceps Pulldowns (Band)", "family": "Triceps Pulldowns", "pattern": "push", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-07T00:00:00.000Z" },
  { "id": "overhead-press-band", "name": "Overhead Press (Band)", "family": "Overhead Press", "pattern": "shoulders", "metric": "reps", "perSide": false, "defaultLoadType": "band", "archived": false, "updatedAt": "2026-10-06T00:00:00.000Z" },
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

- [ ] **Step 4: Run the whole test suite**

```powershell
npm test
```
Expected: PASS. The existing `mergeSeed` tests still hold (`pull-ups` and `dips-bar` remain, 24 entries). If `'has 24 entries that all validate'` fails, count the entries above.

- [ ] **Step 5: Update spec 1 §5 "Seed catalog"**

In `docs/superpowers/specs/2026-10-06-data-model-design.md`, replace the sentence `- Initial seed: derived from the XLSX. The owner confirmed the three points below the table on 2026-10-06; the rest of the table is approved together with this spec. All entries have `metric: 'reps'` and `archived: false`.` with:

```markdown
- Initial seed: derived from the XLSX. The owner confirmed the three points below the table on 2026-10-06; the rest of the table is approved together with this spec. **Revised by spec 2 §6 on 2026-10-07** after grounding the migration in the real cells: Australian pull-ups were done on rings, face pulls, curls, triceps pulldowns and lateral raises with bands, dips only on bars. All entries have `metric: 'reps'` and `archived: false`; the four entries added on 2026-10-07 carry that day's `updatedAt`.
```

Then replace the table rows so the table reads:

```markdown
| id | name | family | pattern | defaultLoadType | perSide |
|---|---|---|---|---|---|
| australian-pull-ups-rings | Australian Pull-ups (Rings) | Australian Pull-ups | pull | added | no |
| australian-pull-ups-bar | Australian Pull-ups (Bar) | Australian Pull-ups | pull | added | no |
| pull-ups | Pull-ups | Pull-ups | pull | bodyweight | no |
| negative-pull-ups | Negative Pull-ups | Pull-ups | pull | bodyweight | no |
| bicep-curls-band | Bicep Curls (Band) | Bicep Curls | pull | band | no |
| bicep-curls-ez-bar | Bicep Curls (EZ Bar) | Bicep Curls | pull | external | no |
| face-pulls-band | Face Pulls (Band) | Face Pulls | pull | band | no |
| face-pulls-cable | Face Pulls (Cable) | Face Pulls | pull | external | no |
| dips-bar | Dips (Bar) | Dips | push | added | no |
| push-ups | Push-ups | Push-ups | push | added | no |
| diamond-push-ups | Diamond Push-ups | Push-ups | push | bodyweight | no |
| ring-deficit-push-ups | Ring Deficit Push-ups | Push-ups | push | bodyweight | no |
| triceps-pulldowns-band | Triceps Pulldowns (Band) | Triceps Pulldowns | push | band | no |
| overhead-press-band | Overhead Press (Band) | Overhead Press | shoulders | band | no |
| lateral-raises-band | Lateral Raises (Band) | Lateral Raises | shoulders | band | no |
| single-leg-rdl | Single-leg RDL | Single-leg RDL | legs | external | yes |
| single-leg-rdl-band | Single-leg RDL (Band) | Single-leg RDL | legs | band | yes |
| split-squats | Split Squats | Split Squats | legs | added | yes |
| squats | Squats | Squats | legs | added | no |
| jump-squats | Jump Squats | Squats | legs | bodyweight | no |
| calf-raises | Calf Raises | Calf Raises | legs | added | no |
| calf-raises-band | Calf Raises (Band) | Calf Raises | legs | band | no |
| knee-raises-dip-bar | Knee Raises (Dip Bar) | Knee Raises | core | bodyweight | no |
| burpees | Burpees | Burpees | conditioning | bodyweight | no |
```

Only the `cues` column is not in the table; `australian-pull-ups-rings` carries `cues: "clean elbows, slow, full extension"` (spec 2 §7).

- [ ] **Step 6: Commit**

```powershell
git add src/model/seed-exercises.json src/model/seed.test.ts docs/superpowers/specs/2026-10-06-data-model-design.md
git commit -m "Amend the seed catalog per spec 2: rings, bands, no ring dips" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Exercise aliases, header fallback and refinements (§6)

**Files:**
- Create: `src/migration/exercises.ts`
- Test: `src/migration/exercises.test.ts`

**Interfaces:**
- Consumes: `normalizeName` from `src/model/slug.ts`, `SEED` from `src/model/seed.ts` (tests only).
- Produces: `ALIASES: readonly { words: readonly string[]; id: string }[]`, `HEADER_EXERCISES`, `BAND_VARIANTS`, `type Refinement = 'stange' | 'ez-bar' | 'maschine'`, `REFINEMENT_PHRASES`, `resolveExercise(aliasId: string | undefined, header: string, opts: { bands: boolean; refinements: readonly Refinement[] }): string | undefined`, `allTargetIds(): string[]`. Alias and phrase words are lowercase and compared with the `text` of word tokens (Task 5).

- [ ] **Step 1: Write the failing tests `src/migration/exercises.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { ALIASES, HEADER_EXERCISES, allTargetIds, resolveExercise } from './exercises';
import { HEADERS } from './test-fixtures';

const none = { bands: false, refinements: [] as const };

describe('resolveExercise', () => {
  it('uses the alias when there is one, else the column header', () => {
    expect(resolveExercise('pull-ups', 'Bicep Curls', none)).toBe('pull-ups');
    expect(resolveExercise(undefined, 'Bicep Curls', none)).toBe('bicep-curls-band');
    expect(resolveExercise(undefined, '  Single  Leg RDL ', none)).toBe('single-leg-rdl');
  });

  it('has no fallback for the Extra column', () => {
    expect(resolveExercise(undefined, 'Extra', none)).toBeUndefined();
    expect(resolveExercise('burpees', 'Extra', none)).toBe('burpees');
  });

  it('switches to the band variant of the header family on `Bands`, where one exists', () => {
    expect(resolveExercise(undefined, 'Single Leg RDL', { bands: true, refinements: [] })).toBe('single-leg-rdl-band');
    expect(resolveExercise(undefined, 'Calf Raises', { bands: true, refinements: [] })).toBe('calf-raises-band');
    expect(resolveExercise(undefined, 'Face Pulls', { bands: true, refinements: [] })).toBe('face-pulls-band');
    expect(resolveExercise('lateral-raises-band', 'Extra', { bands: true, refinements: [] })).toBe('lateral-raises-band');
  });

  it('applies the refinements only to their own family', () => {
    expect(resolveExercise('australian-pull-ups-rings', 'Australian Pull Ups', { bands: false, refinements: ['stange'] })).toBe('australian-pull-ups-bar');
    expect(resolveExercise(undefined, 'Bicep Curls', { bands: false, refinements: ['ez-bar'] })).toBe('bicep-curls-ez-bar');
    expect(resolveExercise(undefined, 'Face Pulls', { bands: false, refinements: ['maschine'] })).toBe('face-pulls-cable');
    expect(resolveExercise('pull-ups', 'Bicep Curls', { bands: false, refinements: ['stange', 'ez-bar', 'maschine'] })).toBe('pull-ups');
  });
});

describe('alias and header tables', () => {
  it('only ever emit seed ids', () => {
    const seedIds = new Set(SEED.map((e) => e.id));
    for (const id of allTargetIds()) expect(seedIds.has(id), id).toBe(true);
  });

  it('cover every exercise header of the real sheet', () => {
    for (const [address, header] of Object.entries(HEADERS)) {
      if (header === 'Date' || header === 'Extra') continue;
      expect(resolveExercise(undefined, header, none), `${address} ${header}`).toBeDefined();
    }
    expect(Object.keys(HEADER_EXERCISES)).toHaveLength(9);
  });

  it('spells every alias word in lowercase without punctuation', () => {
    for (const a of ALIASES) for (const w of a.words) expect(w).toMatch(/^[a-zäöü0-9]+$/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/exercises.test.ts
```
Expected: FAIL, cannot find module './exercises'.

- [ ] **Step 3: Create `src/migration/exercises.ts`**

```ts
import { normalizeName } from '../model/slug';

/** Spec 2 §6: closed alias table. Words are the lowercased, comma- and parenthesis-stripped word
 *  tokens of tokenize.ts, so `Pullups,` and `(Diamonds)` still match. `Downs` and `Bands` stay
 *  keywords, so `Dips Downs` is the alias `dips` plus the keyword. */
export interface Alias {
  words: readonly string[];
  id: string;
}

export const ALIASES: readonly Alias[] = [
  { words: ['aust', 'pullups'], id: 'australian-pull-ups-rings' },
  { words: ['aus', 'pullup'], id: 'australian-pull-ups-rings' },
  { words: ['australian', 'pullups'], id: 'australian-pull-ups-rings' },
  { words: ['australians'], id: 'australian-pull-ups-rings' },
  { words: ['pyramide', 'pullups'], id: 'pull-ups' },
  { words: ['neg', 'pullups'], id: 'negative-pull-ups' },
  { words: ['pullups'], id: 'pull-ups' },
  { words: ['pullup'], id: 'pull-ups' },
  { words: ['facepull'], id: 'face-pulls-band' },
  { words: ['dipbar', 'knee', 'raises'], id: 'knee-raises-dip-bar' },
  { words: ['knee', 'raises'], id: 'knee-raises-dip-bar' },
  { words: ['dips'], id: 'dips-bar' },
  { words: ['ring', 'deficit', 'pushups'], id: 'ring-deficit-push-ups' },
  { words: ['rings'], id: 'ring-deficit-push-ups' },
  { words: ['diamond'], id: 'diamond-push-ups' },
  { words: ['diamonds'], id: 'diamond-push-ups' },
  { words: ['overhead', 'press'], id: 'overhead-press-band' },
  { words: ['lat', 'raise'], id: 'lateral-raises-band' },
  { words: ['lateral', 'raises'], id: 'lateral-raises-band' },
  { words: ['normal', 'squats'], id: 'squats' },
  { words: ['jump', 'squats'], id: 'jump-squats' },
  { words: ['calve', 'raises'], id: 'calf-raises' },
  { words: ['burpees'], id: 'burpees' },
];

/** Keys are normalizeName(header text of row 2). `Extra` has no entry on purpose (spec 2 §4). */
export const HEADER_EXERCISES: Readonly<Record<string, string>> = {
  'australian pull ups': 'australian-pull-ups-rings',
  'bicep curls': 'bicep-curls-band',
  'face pulls': 'face-pulls-band',
  dips: 'dips-bar',
  'push ups': 'push-ups',
  'triceps pulldowns': 'triceps-pulldowns-band',
  'single leg rdl': 'single-leg-rdl',
  'split squats': 'split-squats',
  'calf raises': 'calf-raises',
};

/** `Bands` on a header family that has a band variant (spec 2 §6). */
export const BAND_VARIANTS: Readonly<Record<string, string>> = {
  'single-leg-rdl': 'single-leg-rdl-band',
  'calf-raises': 'calf-raises-band',
};

export type Refinement = 'stange' | 'ez-bar' | 'maschine';

export const REFINEMENT_PHRASES: readonly { words: readonly string[]; refinement: Refinement }[] = [
  { words: ['stange'], refinement: 'stange' },
  { words: ['sz', 'hantel'], refinement: 'ez-bar' },
  { words: ['maschine'], refinement: 'maschine' },
];

const REFINED: Readonly<Record<Refinement, Readonly<Record<string, string>>>> = {
  stange: { 'australian-pull-ups-rings': 'australian-pull-ups-bar' },
  'ez-bar': { 'bicep-curls-band': 'bicep-curls-ez-bar' },
  maschine: { 'face-pulls-band': 'face-pulls-cable' },
};

export function resolveExercise(
  aliasId: string | undefined,
  header: string,
  opts: { bands: boolean; refinements: readonly Refinement[] },
): string | undefined {
  let id = aliasId ?? HEADER_EXERCISES[normalizeName(header)];
  if (id === undefined) return undefined;
  if (opts.bands) id = BAND_VARIANTS[id] ?? id;
  for (const r of opts.refinements) id = REFINED[r][id] ?? id;
  return id;
}

/** Every id the migration can emit; a test checks they are all seed ids. */
export function allTargetIds(): string[] {
  const ids = new Set<string>();
  for (const a of ALIASES) ids.add(a.id);
  for (const id of Object.values(HEADER_EXERCISES)) ids.add(id);
  for (const id of Object.values(BAND_VARIANTS)) ids.add(id);
  for (const map of Object.values(REFINED)) for (const id of Object.values(map)) ids.add(id);
  return [...ids].sort();
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/migration/exercises.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/exercises.ts src/migration/exercises.test.ts
git commit -m "Add the exercise alias table and header fallback for the migration" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Tokenizer (§5 "Tokens")

**Files:**
- Create: `src/migration/tokenize.ts`
- Test: `src/migration/tokenize.test.ts`

**Interfaces:**
- Produces: `type Token` (union below), `tokenize(line: string): Token[]`, `parseNumber(text: string): number`, `isNumeric(t: Token): boolean`.

- [ ] **Step 1: Write the failing tests `src/migration/tokenize.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isNumeric, parseNumber, tokenize } from './tokenize';

const types = (line: string) => tokenize(line).map((t) => t.type);

describe('tokenize', () => {
  it('reads loads, reps, bare numbers and x in every spelling of the sheet', () => {
    expect(tokenize('25kg x 20 x3')).toEqual([
      { type: 'load', kg: 25, raw: '25kg' },
      { type: 'x', raw: 'x' },
      { type: 'num', value: 20, raw: '20' },
      { type: 'xsets', sets: 3, raw: 'x3' },
    ]);
    expect(tokenize('25x2')).toEqual([{ type: 'repsxsets', reps: 25, sets: 2, raw: '25x2' }]);
    expect(tokenize('10Kg 30x')).toEqual([{ type: 'load', kg: 10, raw: '10Kg' }, { type: 'reps', reps: 30, raw: '30x' }]);
  });

  it('uses the decimal comma and glues `12,4 kg`', () => {
    expect(tokenize('16,5x 12,4 kg 28.9kg')).toEqual([
      { type: 'reps', reps: 16.5, raw: '16,5x' },
      { type: 'load', kg: 12.4, raw: '12,4kg' },
      { type: 'load', kg: 28.9, raw: '28.9kg' },
    ]);
    expect(parseNumber('17,2')).toBe(17.2);
  });

  it('ignores extra whitespace and a lone slash', () => {
    expect(types('  20x  15x / 12x ')).toEqual(['reps', 'reps', 'reps']);
  });

  it('lowercases words, strips trailing commas and remembers parentheses', () => {
    expect(tokenize('Burpees, (schräger) Ellbogen),')).toEqual([
      { type: 'word', text: 'burpees', raw: 'Burpees,', paren: false },
      { type: 'word', text: 'schräger', raw: '(schräger)', paren: true },
      { type: 'word', text: 'ellbogen', raw: 'Ellbogen),', paren: true },
    ]);
  });

  it('reads minutes and keeps `5er` as a word', () => {
    expect(tokenize('1m 5er')).toEqual([
      { type: 'minutes', minutes: 1, raw: '1m' },
      { type: 'word', text: '5er', raw: '5er', paren: false },
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(tokenize('   ')).toEqual([]);
  });

  it('classifies numeric tokens', () => {
    expect(tokenize('6kg 15x 3 x 25x2 x2 1m mit').map(isNumeric)).toEqual([true, true, true, false, true, true, false, false]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/tokenize.test.ts
```
Expected: FAIL, cannot find module './tokenize'.

- [ ] **Step 3: Create `src/migration/tokenize.ts`**

```ts
export type Token =
  | { type: 'load'; kg: number; raw: string }
  | { type: 'reps'; reps: number; raw: string }
  | { type: 'num'; value: number; raw: string }
  | { type: 'x'; raw: string }
  | { type: 'repsxsets'; reps: number; sets: number; raw: string }
  | { type: 'xsets'; sets: number; raw: string }
  | { type: 'minutes'; minutes: number; raw: string }
  | { type: 'word'; text: string; raw: string; paren: boolean };

const NUMBER = /^(\d+(?:[.,]\d+)?)$/;
const REPS = /^(\d+(?:[.,]\d+)?)x$/i;
const LOAD = /^(\d+(?:[.,]\d+)?)kg$/i;
const REPS_X_SETS = /^(\d+)x(\d+)$/i;
const X_SETS = /^x(\d+)$/i;
const MINUTES = /^(\d+)m$/i;
const BARE_KG = /^kg$/i;

export function parseNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

export function isNumeric(t: Token): boolean {
  return t.type === 'load' || t.type === 'reps' || t.type === 'num' || t.type === 'repsxsets' || t.type === 'xsets';
}

/** Spec 2 §5 "Tokens": whitespace split, decimal comma, `12,4 kg` glued, lone `/` dropped,
 *  trailing commas dropped, parentheses stripped but remembered. */
export function tokenize(line: string): Token[] {
  const parts = line.trim().split(/\s+/).filter((p) => p !== '' && p !== '/');
  const glued: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!;
    const next = parts[i + 1];
    if (next !== undefined && NUMBER.test(p) && BARE_KG.test(next)) {
      glued.push(p + next);
      i += 1;
    } else glued.push(p);
  }
  return glued.map(toToken);
}

function toToken(raw: string): Token {
  let core = raw.replace(/,+$/, '');
  let paren = false;
  if (core.startsWith('(')) {
    core = core.slice(1);
    paren = true;
  }
  if (core.endsWith(')')) {
    core = core.slice(0, -1);
    paren = true;
  }
  let m: RegExpExecArray | null;
  if ((m = LOAD.exec(core))) return { type: 'load', kg: parseNumber(m[1]!), raw };
  if ((m = REPS_X_SETS.exec(core))) return { type: 'repsxsets', reps: Number(m[1]), sets: Number(m[2]), raw };
  if ((m = REPS.exec(core))) return { type: 'reps', reps: parseNumber(m[1]!), raw };
  if ((m = X_SETS.exec(core))) return { type: 'xsets', sets: Number(m[1]), raw };
  if (/^x$/i.test(core)) return { type: 'x', raw };
  if ((m = MINUTES.exec(core))) return { type: 'minutes', minutes: Number(m[1]), raw };
  if ((m = NUMBER.exec(core))) return { type: 'num', value: parseNumber(m[1]!), raw };
  return { type: 'word', text: core.toLowerCase(), raw, paren };
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/migration/tokenize.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/tokenize.ts src/migration/tokenize.test.ts
git commit -m "Add the cell tokenizer for the migration grammar" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Phrases and the line grammar (§5, §7)

**Files:**
- Create: `src/migration/phrases.ts`, `src/migration/parse-line.ts`
- Test: `src/migration/parse-line.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `isNumeric`, `Token` (Task 5); `ALIASES`, `REFINEMENT_PHRASES`, `Refinement` (Task 4); `ReviewKind` (Task 1).
- Produces: `ParsedSet { reps: number; kg?: number; bodyweight: boolean }`, `LineSegment { sets: ParsedSet[]; aggregate?: true; noteOnly?: string }`, `LineJoin = 'new' | 'dann' | 'plus'`, `LineIssue { kind: ReviewKind; detail: string }`, `ParsedLine` (fields below), `parseLine(input: string): ParsedLine`; the phrase lists of `phrases.ts`.

- [ ] **Step 1: Create `src/migration/phrases.ts`**

```ts
/** Spec 2 §7 phrase lists and the §5 keywords. Words as produced by tokenize.ts (lowercase). */
export const TAG_PHRASES: readonly { words: readonly string[]; tag: string }[] = [
  { words: ['weil', 'erkältet'], tag: 'sick' },
  { words: ['erkältet'], tag: 'sick' },
  { words: ['nach', 'frühstück'], tag: 'after-meal' },
  { words: ['nach', 'essen'], tag: 'after-meal' },
];

/** Standing cues of Australian Pull-ups (Rings); dropped from blocks, kept once in the seed. */
export const CUE_PHRASES: readonly (readonly string[])[] = [['sauber', 'ellbogen'], ['langsam'], ['gestreckt']];

export const ORDER_FIRST_PHRASE: readonly string[] = ['vor', 'den', 'australians'];

/** Multi-word notes that must not be read as keywords (`ohne Griffe` is not the `ohne` load keyword). */
export const NOTE_PHRASES: readonly (readonly string[])[] = [['ohne', 'griffe']];

/** Words the set grammar consumes. */
export const GRAMMAR_KEYWORDS: ReadonlySet<string> = new Set(['mit', 'ohne', 'bodyweight', 'down', 'downs', 'dann', 'plus']);

/** Words that set a line flag and never reach the grammar. */
export const FLAG_KEYWORDS: ReadonlySet<string> = new Set(['bands', 'nichts']);
```

- [ ] **Step 2: Write the failing tests `src/migration/parse-line.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseLine } from './parse-line';

/** `20@25 15@35 | 5 5` : segments separated by ` | `, sets as reps[@kg|@bw]. */
const show = (line: string): string =>
  parseLine(line)
    .segments.map((s) => s.sets.map((x) => `${x.reps}${x.kg !== undefined ? `@${x.kg}` : x.bodyweight ? '@bw' : ''}`).join(' '))
    .join(' | ');
const kinds = (line: string): string[] => parseLine(line).issues.map((i) => i.kind);

describe('parseLine: set-building rules of spec §5', () => {
  it('one set per REPS, at the current load', () => {
    expect(show('20x  15x 12x')).toBe('20 15 12');
    expect(show('6kg 15x 12x 12x')).toBe('15@6 12@6 12@6');
    expect(show('17,4kg 30x 28,9kg 30x 20x')).toBe('30@17.4 30@28.9 20@28.9');
    expect(show('9,1kg 20,5x 14,5x')).toBe('20.5@9.1 14.5@9.1');
  });

  it('NUM sets of REPS in all four spellings', () => {
    expect(show('20x 3')).toBe('20 20 20');
    expect(show('12 x 3')).toBe('12 12 12');
    expect(show('25x2')).toBe('25 25');
    expect(show('15x x2')).toBe('15 15');
    expect(show('30kg 20x 3')).toBe('20@30 20@30 20@30');
  });

  it('LOAD X NUM, optionally times sets', () => {
    expect(show('25kg x 20  35kg x 15  35kg x 15')).toBe('20@25 15@35 15@35');
    expect(show('25kg x 20 x3')).toBe('20@25 20@25 20@25');
    expect(show('25kg 20 x 3')).toBe('20@25 20@25 20@25');
  });

  it('`mit LOAD` loads every earlier set that has none yet and does not become the current load', () => {
    expect(show('20 x 3 mit 6kg')).toBe('20@6 20@6 20@6');
    expect(show('15 x 3 mit 6 kg')).toBe('15@6 15@6 15@6');
    expect(show('15x mit 17,4kg 20x mit 12,4kg')).toBe('15@17.4 20@12.4');
    expect(show('25x 20x mit 17,4 kg')).toBe('25@17.4 20@17.4');
  });

  it('`ohne` and `Bodyweight` make sets explicitly bodyweight', () => {
    expect(show('20x ohne / 20x mit 12,4kg')).toBe('20@bw 20@12.4');
    expect(show('30x 2 ohne')).toBe('30@bw 30@bw');
    expect(show('Bodyweight 20x 25x')).toBe('20@bw 25@bw');
    expect(show('20x 2 ohne weil erkältet')).toBe('20@bw 20@bw');
    expect(parseLine('20x 2 ohne weil erkältet').tags).toEqual(['sick']);
  });

  it('`Bands` is a flag, the kg stay per set', () => {
    const p = parseLine('Bands 50kg 20x 60kg 15x x2');
    expect(p.bands).toBe(true);
    expect(show('Bands 50kg 20x 60kg 15x x2')).toBe('20@50 15@60 15@60');
    expect(show('Bands 25kg 24x 35kg 25x 50kg 25x')).toBe('24@25 25@35 25@50');
  });

  it('ladders: `N down`, `Downs REPS` alone, and a written-out list', () => {
    expect(show('10 down')).toBe('10 9 8 7 6 5 4 3 2 1');
    expect(show('Ring deficit pushups 15 down').split(' ')).toHaveLength(15);
    expect(show('Rings Downs 15x').split(' ')).toHaveLength(15);
    expect(show('Dips Downs 15x 14x 13x 10x')).toBe('15 14 13 10');
  });

  it('rest phrases set restSec and stay in the note', () => {
    const rings = parseLine('Rings Downs 15x Start with 1m Rest');
    expect(rings.restSec).toBe(60);
    expect(rings.noteWords).toEqual(['Start with 1m Rest']);
    expect(rings.alias?.id).toBe('ring-deficit-push-ups');
    const emom = parseLine('10x 7 every 2 minutes');
    expect(emom.restSec).toBe(120);
    expect(emom.noteWords).toEqual(['every 2 minutes']);
    expect(show('10x 7 every 2 minutes')).toBe('10 10 10 10 10 10 10');
  });

  it('`dann` splits segments, a leading `dann`/`plus` sets join', () => {
    expect(show('Pullups 1x 2x 3x dann 5x 5x')).toBe('1 2 3 | 5 5');
    expect(parseLine('dann 7x 6x').join).toBe('dann');
    expect(show('dann 7x 6x')).toBe('7 6');
    expect(parseLine('plus 10x 3').join).toBe('plus');
    expect(parseLine('Pullups 1x').join).toBe('new');
  });

  it('expands pyramids and flags them', () => {
    expect(show('Pullups 2x die 5er Pyramide')).toBe('1 2 3 4 5 4 3 2 1 | 1 2 3 4 5 4 3 2 1');
    expect(show('Pullups 5er Pyramide')).toBe('1 2 3 4 5 4 3 2 1');
    expect(kinds('Pullups 5er Pyramide')).toEqual(['pyramid-expanded']);
    expect(kinds('Pullups 5er Pyramide 10x')).toEqual(['unparsed-line']);
  });

  it('aggregate: a single number before the exercise name', () => {
    const p = parseLine('100 Diamonds');
    expect(p.segments).toEqual([{ sets: [{ reps: 100, bodyweight: false }], aggregate: true }]);
    expect(p.alias?.id).toBe('diamond-push-ups');
    expect(kinds('100 Diamonds')).toEqual(['aggregate']);
    expect(parseLine('100x Dipbar Knee Raises').alias?.id).toBe('knee-raises-dip-bar');
    expect(kinds('100x Dipbar Knee Raises')).toEqual(['aggregate']);
    expect(kinds('Diamonds 20x')).toEqual([]);
  });

  it('note-only blocks: exercise names without numbers', () => {
    const p = parseLine('Burpees, Pyramide Pullups');
    expect(p.segments).toEqual([{ sets: [], noteOnly: 'Burpees' }, { sets: [], noteOnly: 'Pyramide Pullups' }]);
    expect(kinds('Burpees, Pyramide Pullups')).toEqual(['note-only', 'note-only']);
    expect(parseLine('Overhead Press Bands').segments).toEqual([{ sets: [], noteOnly: 'Overhead Press' }]);
    expect(parseLine('Overhead Press Bands').bands).toBe(true);
  });

  it('`nichts` yields nothing', () => {
    const p = parseLine('nichts');
    expect(p.nichts).toBe(true);
    expect(p.segments).toEqual([]);
    expect(p.issues).toEqual([]);
  });
});

describe('parseLine: phrases, aliases, refinements, notes', () => {
  it('tags and cues are extracted and dropped; leftovers become notes', () => {
    const p = parseLine('nach Essen, voller Bauch');
    expect(p.tags).toEqual(['after-meal']);
    expect(p.noteWords).toEqual(['voller', 'Bauch']);
    expect(p.unrecognised).toEqual(['voller', 'Bauch']);
    expect(p.segments).toEqual([]);
    const cues = parseLine('sauber (Ellbogen), langsam, gestreckt erkältet');
    expect(cues.cuesDropped).toEqual(['sauber (Ellbogen)', 'langsam', 'gestreckt']);
    expect(cues.tags).toEqual(['sick']);
    expect(cues.noteWords).toEqual([]);
  });

  it('`vor den Australians` sets orderFirst and leaves no note', () => {
    const p = parseLine('Pullups 1x 2x 3x vor den Australians');
    expect(p.orderFirst).toBe(true);
    expect(p.noteWords).toEqual([]);
    expect(show('Pullups 1x 2x 3x vor den Australians')).toBe('1 2 3');
  });

  it('`ohne Griffe` is a note phrase, not the load keyword', () => {
    const p = parseLine('35kg 20 x 2 ohne Griffe');
    expect(show('35kg 20 x 2 ohne Griffe')).toBe('20@35 20@35');
    expect(p.noteWords).toEqual(['ohne Griffe']);
    expect(p.unrecognised).toEqual([]);
  });

  it('keeps unknown words as notes in their original spelling', () => {
    expect(parseLine('10kg 20x 16,5x Deeep').noteWords).toEqual(['Deeep']);
    expect(parseLine('11,5kg 12x 19x (schräger)').noteWords).toEqual(['(schräger)']);
    expect(parseLine('flacher 20x 20x').noteWords).toEqual(['flacher']);
    expect(show('flacher 20x 20x')).toBe('20 20');
  });

  it('finds the longest alias first and records all aliases', () => {
    expect(parseLine('Aust Pullups 10kg 17x 14x').alias).toEqual({ id: 'australian-pull-ups-rings', raw: 'Aust Pullups' });
    expect(parseLine('Neg Pullups 10x').alias?.id).toBe('negative-pull-ups');
    expect(parseLine('Pyramide Pullups').alias?.id).toBe('pull-ups');
    expect(parseLine('Lat Raise Bands 10kg 22x 22x').alias?.id).toBe('lateral-raises-band');
    expect(parseLine('normal Squats 17,4kg 30x').alias?.id).toBe('squats');
    expect(parseLine('Calve Raises 25x 3').alias?.id).toBe('calf-raises');
    expect(parseLine('Burpees, Pyramide Pullups').aliases.map((a) => a.id)).toEqual(['burpees', 'pull-ups']);
  });

  it('collects refinements', () => {
    expect(parseLine('Aust Pullups Stange 20x 20x').refinements).toEqual(['stange']);
    expect(parseLine('10kg SZ Hantel 17x 15,5x').refinements).toEqual(['ez-bar']);
    expect(show('10kg SZ Hantel 17x 15,5x')).toBe('17@10 15.5@10');
    expect(parseLine('15kg Maschine 23x 2').refinements).toEqual(['maschine']);
  });
});

describe('parseLine: review triggers and failures', () => {
  it('flags more sets than reps', () => {
    expect(kinds('Diamonds 4x 20')).toEqual(['sets-exceed-reps']);
    expect(show('Diamonds 4x 20').split(' ')).toHaveLength(20);
  });

  it('flags and removes a parenthesised group with numbers', () => {
    const p = parseLine('20x 2 mit 15,4 kg (R 1x 15)');
    expect(show('20x 2 mit 15,4 kg (R 1x 15)')).toBe('25@17.4 25@17.4');
    expect(p.issues).toEqual([{ kind: 'parenthesised-numbers', detail: '(R 1x 15)' }]);
  });

  it('reports grammar failures as unparsed-line with no segments', () => {
    for (const line of ['mit', '6kg', '3', 'x 20', 'Pullups 1x 2x dann', 'Pullups 5x Dips 5x', '0x 3']) {
      const p = parseLine(line);
      expect(p.segments, line).toEqual([]);
      expect(p.issues.map((i) => i.kind), line).toContain('unparsed-line');
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/parse-line.test.ts
```
Expected: FAIL, cannot find module './parse-line'.

- [ ] **Step 4: Create `src/migration/parse-line.ts`**

```ts
import { ALIASES, REFINEMENT_PHRASES, type Refinement } from './exercises';
import { CUE_PHRASES, FLAG_KEYWORDS, GRAMMAR_KEYWORDS, NOTE_PHRASES, ORDER_FIRST_PHRASE, TAG_PHRASES } from './phrases';
import { isNumeric, tokenize, type Token } from './tokenize';
import type { ReviewKind } from './types';

export interface ParsedSet {
  reps: number;
  kg?: number;
  /** true: the sheet says explicitly that no load was used (`ohne`, `Bodyweight`). */
  bodyweight: boolean;
}

export interface LineSegment {
  sets: ParsedSet[];
  aggregate?: true;
  /** Note-only block: the exercise alias as written. */
  noteOnly?: string;
}

export type LineJoin = 'new' | 'dann' | 'plus';

export interface LineIssue {
  kind: ReviewKind;
  detail: string;
}

export interface ParsedLine {
  /** First exercise alias on the line (undefined: use the column header). */
  alias?: { id: string; raw: string };
  /** Every alias on the line, in order. */
  aliases: { id: string; raw: string }[];
  join: LineJoin;
  /** One per block this line produces: split at `dann`, or M pyramid copies, or one per note-only alias. */
  segments: LineSegment[];
  bands: boolean;
  nichts: boolean;
  refinements: Refinement[];
  tags: string[];
  cuesDropped: string[];
  orderFirst: boolean;
  restSec?: number;
  /** Leftover words and note phrases, original spelling and order. */
  noteWords: string[];
  /** Leftover words that matched no list at all (subset of noteWords). */
  unrecognised: string[];
  issues: LineIssue[];
}

class GrammarError extends Error {}

const PAREN_WITH_NUMBER = /\([^)]*\d[^)]*\)/g;
const NER = /^(\d+)er$/;

function wordsMatch(tokens: readonly Token[], at: number, words: readonly string[]): boolean {
  for (let k = 0; k < words.length; k += 1) {
    const t = tokens[at + k];
    if (t === undefined || t.type !== 'word' || t.text !== words[k]) return false;
  }
  return true;
}

function wordAt(tokens: readonly Token[], at: number): string | undefined {
  const t = tokens[at];
  return t?.type === 'word' ? t.text : undefined;
}

/** The original spelling of `count` tokens from `at`, trailing commas dropped. */
function rawOf(tokens: readonly Token[], at: number, count: number): string {
  return tokens.slice(at, at + count).map((t) => t.raw.replace(/,+$/, '')).join(' ');
}

const ALIASES_LONGEST_FIRST = [...ALIASES].sort((a, b) => b.words.length - a.words.length);

/** Spec 2 §5: one line of a cell → segments, flags, notes and review issues. The exercise is not
 *  yet resolved against the header; parse-cell.ts does that. */
export function parseLine(input: string): ParsedLine {
  const out: ParsedLine = {
    aliases: [], join: 'new', segments: [], bands: false, nichts: false, refinements: [], tags: [],
    cuesDropped: [], orderFirst: false, noteWords: [], unrecognised: [], issues: [],
  };
  let line = input;
  const parenGroups = line.match(PAREN_WITH_NUMBER);
  if (parenGroups) {
    out.issues.push({ kind: 'parenthesised-numbers', detail: parenGroups.join(' ') });
    line = line.replace(PAREN_WITH_NUMBER, ' ');
  }
  const tokens = tokenize(line);

  // Phrase pass: words are consumed by phrases, aliases, flags and keywords; everything numeric
  // and every grammar keyword goes to `rest` for the set grammar.
  const rest: Token[] = [];
  let aliasRestIndex: number | undefined;
  let pyramid: { blocks: number; top: number } | undefined;
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    const ner2 = NER.exec(wordAt(tokens, i + 2) ?? '');
    if (t.type === 'reps' && wordAt(tokens, i + 1) === 'die' && ner2 && wordAt(tokens, i + 3) === 'pyramide') {
      pyramid = { blocks: t.reps, top: Number(ner2[1]) };
      i += 4;
      continue;
    }
    if (t.type !== 'word') {
      rest.push(t);
      i += 1;
      continue;
    }
    const ner0 = NER.exec(t.text);
    if (ner0 && wordAt(tokens, i + 1) === 'pyramide') {
      pyramid = { blocks: 1, top: Number(ner0[1]) };
      i += 2;
      continue;
    }
    if (wordsMatch(tokens, i, ORDER_FIRST_PHRASE)) {
      out.orderFirst = true;
      i += ORDER_FIRST_PHRASE.length;
      continue;
    }
    const n1 = tokens[i + 1];
    if (t.text === 'every' && n1?.type === 'num' && wordAt(tokens, i + 2) === 'minutes') {
      out.restSec = 60 * n1.value;
      out.noteWords.push(rawOf(tokens, i, 3));
      i += 3;
      continue;
    }
    const n2 = tokens[i + 2];
    if (wordsMatch(tokens, i, ['start', 'with']) && n2?.type === 'minutes' && wordAt(tokens, i + 3) === 'rest') {
      out.restSec = 60 * n2.minutes;
      out.noteWords.push(rawOf(tokens, i, 4));
      i += 4;
      continue;
    }
    const alias = ALIASES_LONGEST_FIRST.find((a) => wordsMatch(tokens, i, a.words));
    if (alias) {
      out.aliases.push({ id: alias.id, raw: rawOf(tokens, i, alias.words.length) });
      if (aliasRestIndex === undefined) aliasRestIndex = rest.length;
      i += alias.words.length;
      continue;
    }
    const tag = TAG_PHRASES.find((p) => wordsMatch(tokens, i, p.words));
    if (tag) {
      out.tags.push(tag.tag);
      i += tag.words.length;
      continue;
    }
    const cue = CUE_PHRASES.find((p) => wordsMatch(tokens, i, p));
    if (cue) {
      out.cuesDropped.push(rawOf(tokens, i, cue.length));
      i += cue.length;
      continue;
    }
    const note = NOTE_PHRASES.find((p) => wordsMatch(tokens, i, p));
    if (note) {
      out.noteWords.push(rawOf(tokens, i, note.length));
      i += note.length;
      continue;
    }
    const refinement = REFINEMENT_PHRASES.find((p) => wordsMatch(tokens, i, p.words));
    if (refinement) {
      out.refinements.push(refinement.refinement);
      i += refinement.words.length;
      continue;
    }
    if (FLAG_KEYWORDS.has(t.text)) {
      if (t.text === 'bands') out.bands = true;
      else out.nichts = true;
      i += 1;
      continue;
    }
    if (GRAMMAR_KEYWORDS.has(t.text)) {
      rest.push(t);
      i += 1;
      continue;
    }
    out.noteWords.push(t.raw);
    out.unrecognised.push(t.raw);
    i += 1;
  }
  if (out.aliases[0] !== undefined) out.alias = out.aliases[0];

  const first = rest[0];
  if (first?.type === 'word' && (first.text === 'dann' || first.text === 'plus')) {
    out.join = first.text;
    rest.shift();
    if (aliasRestIndex !== undefined && aliasRestIndex > 0) aliasRestIndex -= 1;
  }
  const numeric = rest.filter(isNumeric);

  if (pyramid) {
    const { blocks, top } = pyramid;
    if (numeric.length > 0 || !Number.isInteger(top) || top < 1 || !Number.isInteger(blocks) || blocks < 1) {
      out.issues.push({ kind: 'unparsed-line', detail: 'pyramid phrase mixed with other numbers' });
      return out;
    }
    const reps = [...Array.from({ length: top }, (_, k) => k + 1), ...Array.from({ length: top - 1 }, (_, k) => top - 1 - k)];
    for (let b = 0; b < blocks; b += 1) out.segments.push({ sets: reps.map((r) => ({ reps: r, bodyweight: false })) });
    out.issues.push({ kind: 'pyramid-expanded', detail: `${blocks} × ${reps.join(' ')}` });
    return out;
  }
  if (out.nichts) return out;
  if (numeric.length === 0) {
    if (rest.length > 0) {
      out.issues.push({ kind: 'unparsed-line', detail: `keyword without numbers: ${rest.map((t) => t.raw).join(' ')}` });
      return out;
    }
    for (const a of out.aliases) {
      out.segments.push({ sets: [], noteOnly: a.raw });
      out.issues.push({ kind: 'note-only', detail: a.raw });
    }
    return out;
  }
  // Aggregate: exactly one number, before the single alias, nothing else numeric and no keywords.
  if (out.aliases.length === 1 && aliasRestIndex === 1 && rest.length === 1) {
    const t = rest[0]!;
    const total = t.type === 'num' ? t.value : t.type === 'reps' ? t.reps : undefined;
    if (total !== undefined && total > 0) {
      out.segments.push({ sets: [{ reps: total, bodyweight: false }], aggregate: true });
      out.issues.push({ kind: 'aggregate', detail: `${total} total, set count unknown` });
      return out;
    }
  }
  if (out.aliases.length > 1) {
    out.issues.push({ kind: 'unparsed-line', detail: `several exercise names with numbers: ${out.aliases.map((a) => a.raw).join(', ')}` });
    return out;
  }
  try {
    const { segments, issues } = runGrammar(rest);
    out.segments = segments;
    out.issues.push(...issues);
  } catch (e) {
    if (!(e instanceof GrammarError)) throw e;
    out.issues.push({ kind: 'unparsed-line', detail: e.message });
    out.segments = [];
  }
  return out;
}

/** The set-building rules of spec 2 §5, left to right. */
function runGrammar(rest: readonly Token[]): { segments: LineSegment[]; issues: LineIssue[] } {
  const issues: LineIssue[] = [];
  const segments: LineSegment[] = [{ sets: [] }];
  let sets = segments[0]!.sets;
  let load: number | undefined;
  let bodyweightMode = false;

  const push = (reps: number, count: number): void => {
    if (!(reps > 0) || !Number.isInteger(count) || count < 1) throw new GrammarError(`cannot read ${count} × ${reps}`);
    if (count > reps) issues.push({ kind: 'sets-exceed-reps', detail: `${count} sets of ${reps}` });
    for (let k = 0; k < count; k += 1) {
      sets.push(load !== undefined ? { reps, kg: load, bodyweight: false } : { reps, bodyweight: bodyweightMode });
    }
  };
  const ladder = (top: number): void => {
    if (!Number.isInteger(top) || top < 1) throw new GrammarError(`cannot read ladder ${top} down`);
    for (let r = top; r >= 1; r -= 1) push(r, 1);
  };

  for (let i = 0; i < rest.length; ) {
    const t = rest[i]!;
    const n1 = rest[i + 1];
    const n2 = rest[i + 2];
    const n3 = rest[i + 3];
    switch (t.type) {
      case 'load':
        load = t.kg;
        bodyweightMode = false;
        if (n1?.type === 'x' && n2?.type === 'num') {
          const count = n3?.type === 'xsets' ? n3.sets : 1;
          push(n2.value, count);
          i += n3?.type === 'xsets' ? 4 : 3;
        } else i += 1;
        break;
      case 'reps':
        if (n1?.type === 'num') {
          push(t.reps, n1.value);
          i += 2;
        } else if (n1?.type === 'xsets') {
          push(t.reps, n1.sets);
          i += 2;
        } else {
          push(t.reps, 1);
          i += 1;
        }
        break;
      case 'repsxsets':
        push(t.reps, t.sets);
        i += 1;
        break;
      case 'num':
        if (n1?.type === 'x' && n2?.type === 'num') {
          push(t.value, n2.value);
          i += 3;
        } else if (n1?.type === 'word' && n1.text === 'down') {
          ladder(t.value);
          i += 2;
        } else throw new GrammarError(`bare number ${t.raw}`);
        break;
      case 'word':
        switch (t.text) {
          case 'mit':
            if (n1?.type !== 'load') throw new GrammarError('mit without a load');
            for (const s of sets) if (s.kg === undefined && !s.bodyweight) s.kg = n1.kg;
            i += 2;
            break;
          case 'ohne':
            for (const s of sets) if (s.kg === undefined) s.bodyweight = true;
            i += 1;
            break;
          case 'bodyweight':
            bodyweightMode = true;
            load = undefined;
            i += 1;
            break;
          case 'downs':
            if (n1?.type === 'reps' && n2?.type !== 'reps') {
              ladder(n1.reps);
              i += 2;
            } else i += 1;
            break;
          case 'dann':
            sets = [];
            segments.push({ sets });
            i += 1;
            break;
          case 'plus':
            i += 1;
            break;
          default:
            throw new GrammarError(`unexpected ${t.raw}`);
        }
        break;
      default:
        throw new GrammarError(`unexpected ${t.raw}`);
    }
  }
  if (segments.some((s) => s.sets.length === 0)) throw new GrammarError('a block without sets');
  return { segments, issues };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```powershell
npx vitest run src/migration/parse-line.test.ts
npm run typecheck
```
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```powershell
git add src/migration/phrases.ts src/migration/parse-line.ts src/migration/parse-line.test.ts
git commit -m "Add the line grammar and phrase lists for the migration" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Cell assembly (§4 "Cells to blocks")

**Files:**
- Create: `src/migration/parse-cell.ts`
- Test: `src/migration/parse-cell.test.ts`

**Interfaces:**
- Consumes: `parseLine`, `ParsedSet` (Task 6); `resolveExercise` (Task 4).
- Produces: `CellBlock { line: number; rawLine: string; exerciseId: string | undefined; exerciseRaw: string; sets: ParsedSet[]; aggregate?: true; restSec?: number; note?: string; orderFirst: boolean; bands: boolean }`, `CellIssue { kind: ReviewKind; line: number; rawLine: string; detail: string }`, `CellResult { blocks: CellBlock[]; tags: string[]; cuesDropped: string[]; unrecognised: string[]; issues: CellIssue[] }`, `cellLines(text: string): string[]`, `parseCell(text: string, header: string): CellResult`.

- [ ] **Step 1: Write the failing tests `src/migration/parse-cell.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { cellLines, parseCell } from './parse-cell';

const ids = (text: string, header: string) => parseCell(text, header).blocks.map((b) => b.exerciseId);
const reps = (text: string, header: string) => parseCell(text, header).blocks.map((b) => b.sets.map((s) => s.reps));

describe('cellLines', () => {
  it('trims, drops empty lines and accepts CRLF', () => {
    expect(cellLines('a \n\n b \r\nc')).toEqual(['a', 'b', 'c']);
    expect(cellLines('   ')).toEqual([]);
  });
});

describe('parseCell', () => {
  it('falls back to the column header', () => {
    const r = parseCell('20x 15x', 'Australian Pull Ups');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ line: 1, rawLine: '20x 15x', exerciseId: 'australian-pull-ups-rings', exerciseRaw: 'Australian Pull Ups', orderFirst: false, bands: false });
    expect(r.blocks[0]?.note).toBeUndefined();
    expect(r.issues).toEqual([]);
  });

  it('makes one block per line, each with its own exercise, and a header fallback for lines without one', () => {
    const text = 'Pullups 1x 2x 3x\nDips Downs 15x 14x 10x\n\n20x 2 mit 12,4 kg';
    expect(ids(text, 'Single Leg RDL')).toEqual(['pull-ups', 'dips-bar', 'single-leg-rdl']);
    expect(parseCell(text, 'Single Leg RDL').blocks.map((b) => b.line)).toEqual([1, 2, 3]);
    expect(ids('Pullups 5x 5x 4x\nAust Pullups 10kg 17x 14x', 'Australian Pull Ups')).toEqual(['pull-ups', 'australian-pull-ups-rings']);
  });

  it('a line with only an exercise name is filled by the next line', () => {
    const r = parseCell('Overhead Press Bands\n10kg 15x 15x easy', 'Extra');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ exerciseId: 'overhead-press-band', bands: true, note: 'easy', line: 1 });
    expect(r.blocks[0]?.sets).toEqual([{ reps: 15, kg: 10, bodyweight: false }, { reps: 15, kg: 10, bodyweight: false }]);
    expect(r.issues).toEqual([]);
  });

  it('`dann` on a new line opens a second block of the same exercise', () => {
    const r = parseCell('Pullups 1x 2x 3x 4x 5x 4x 3x 2x 5x\ndann 8x 7x 6x', 'Bicep Curls');
    expect(r.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups', 'pull-ups']);
    expect(r.blocks.map((b) => b.line)).toEqual([1, 2]);
    expect(reps('Pullups 1x 2x dann 5x 5x', 'Bicep Curls')).toEqual([[1, 2], [5, 5]]);
  });

  it('`plus` continues the current block', () => {
    const r = parseCell('Dips Downs 15x Start with 1m Rest\nplus 10x 3', 'Dips');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.sets.map((s) => s.reps)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 10, 10, 10]);
    expect(r.blocks[0]).toMatchObject({ restSec: 60, note: 'Start with 1m Rest' });
  });

  it('a note line attaches to the preceding block and yields tags', () => {
    const r = parseCell('9,1kg 20,5x 14,5x\nnach Essen, voller Bauch', 'Australian Pull Ups');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.note).toBe('voller Bauch');
    expect(r.tags).toEqual(['after-meal']);
    expect(r.unrecognised).toEqual(['voller', 'Bauch']);
    const cues = parseCell('11,5kg 20x 19x\nsauber (Ellbogen), langsam, gestreckt', 'Australian Pull Ups');
    expect(cues.blocks[0]?.note).toBeUndefined();
    expect(cues.cuesDropped).toEqual(['sauber (Ellbogen)', 'langsam', 'gestreckt']);
  });

  it('inline notes, bands and refinements land on the block', () => {
    expect(parseCell('10kg 20x 16,5x Deeep', 'Dips').blocks[0]?.note).toBe('Deeep');
    expect(ids('Bands 50kg 20x 60kg 15x x2', 'Single Leg RDL')).toEqual(['single-leg-rdl-band']);
    expect(ids('Aust Pullups Stange 20x 20x', 'Australian Pull Ups')).toEqual(['australian-pull-ups-bar']);
    expect(ids('15kg Maschine 23x 2', 'Face Pulls')).toEqual(['face-pulls-cable']);
    expect(ids('10kg SZ Hantel 17x 15,5x', 'Bicep Curls')).toEqual(['bicep-curls-ez-bar']);
  });

  it('`vor den Australians` marks the block to go first', () => {
    expect(parseCell('Pullups 1x 2x 3x vor den Australians', 'Bicep Curls').blocks[0]?.orderFirst).toBe(true);
  });

  it('an unparseable line becomes a note-only block with the raw line and an issue', () => {
    const r = parseCell('mit\n20x 20x', 'Dips');
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]).toMatchObject({ sets: [], note: 'mit', line: 1 });
    expect(r.blocks[1]?.sets.map((s) => s.reps)).toEqual([20, 20]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ kind: 'unparsed-line', line: 1, rawLine: 'mit' });
  });

  it('`nichts` yields no block and no issue', () => {
    expect(parseCell('nichts', 'Triceps Pulldowns')).toEqual({ blocks: [], tags: [], cuesDropped: [], unrecognised: [], issues: [] });
  });

  it('flags a line without alias in the Extra column as unknown-exercise', () => {
    const r = parseCell('20x 20x', 'Extra');
    expect(r.blocks[0]?.exerciseId).toBeUndefined();
    expect(r.issues.map((i) => i.kind)).toEqual(['unknown-exercise']);
  });

  it('note-only aliases become one block each', () => {
    const r = parseCell('Burpees, Pyramide Pullups', 'Extra');
    expect(r.blocks.map((b) => [b.exerciseId, b.note, b.sets.length])).toEqual([['burpees', 'Burpees', 0], ['pull-ups', 'Pyramide Pullups', 0]]);
    expect(r.issues.map((i) => i.kind)).toEqual(['note-only', 'note-only']);
  });

  it('aggregates, pyramids and parenthesised numbers pass their issues through with the line', () => {
    expect(parseCell('100 Diamonds', 'Push Ups').blocks[0]).toMatchObject({ aggregate: true, exerciseId: 'diamond-push-ups' });
    expect(parseCell('Pullups 2x die 5er Pyramide', 'Extra').blocks).toHaveLength(2);
    const paren = parseCell('20x 2 mit 15,4 kg (R 1x 15)', 'Single Leg RDL');
    expect(paren.issues).toEqual([{ kind: 'parenthesised-numbers', line: 1, rawLine: '20x 2 mit 15,4 kg (R 1x 15)', detail: '(R 1x 15)' }]);
    expect(paren.blocks[0]?.sets).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/parse-cell.test.ts
```
Expected: FAIL, cannot find module './parse-cell'.

- [ ] **Step 3: Create `src/migration/parse-cell.ts`**

```ts
import { resolveExercise } from './exercises';
import { parseLine, type ParsedSet } from './parse-line';
import type { ReviewKind } from './types';

export interface CellBlock {
  /** 1-based index among the cell's non-empty lines (the `#n` of a decision key). */
  line: number;
  rawLine: string;
  /** undefined: no alias and no header fallback (review item `unknown-exercise`). */
  exerciseId: string | undefined;
  exerciseRaw: string;
  sets: ParsedSet[];
  aggregate?: true;
  restSec?: number;
  note?: string;
  orderFirst: boolean;
  bands: boolean;
}

export interface CellIssue {
  kind: ReviewKind;
  line: number;
  rawLine: string;
  detail: string;
}

export interface CellResult {
  blocks: CellBlock[];
  tags: string[];
  cuesDropped: string[];
  unrecognised: string[];
  issues: CellIssue[];
}

/** The non-empty, trimmed lines of a cell; their 1-based index is the `#n` of a decision key. */
export function cellLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
}

function setNote(block: CellBlock, note: string | undefined): void {
  if (note === undefined) delete block.note;
  else block.note = note;
}

function appendNote(existing: string | undefined, more: string | undefined): string | undefined {
  if (more === undefined || more === '') return existing;
  return existing === undefined ? more : `${existing} ${more}`;
}

/** Spec 2 §4 "Cells to blocks": lines → blocks, with header fallback, continuation, `dann`, `plus`. */
export function parseCell(text: string, header: string): CellResult {
  const lines = cellLines(text);
  const parsed = lines.map(parseLine);
  const result: CellResult = { blocks: [], tags: [], cuesDropped: [], unrecognised: [], issues: [] };
  let current: CellBlock | undefined;

  parsed.forEach((p, idx) => {
    const line = idx + 1;
    const rawLine = lines[idx]!;
    result.tags.push(...p.tags);
    result.cuesDropped.push(...p.cuesDropped);
    result.unrecognised.push(...p.unrecognised);
    const noteText = p.noteWords.length > 0 ? p.noteWords.join(' ') : undefined;
    const exerciseId = resolveExercise(p.alias?.id, header, { bands: p.bands, refinements: p.refinements });
    const exerciseRaw = p.alias?.raw ?? header;
    const make = (sets: ParsedSet[], extra: Partial<CellBlock> = {}): CellBlock => ({
      line,
      rawLine,
      exerciseId,
      exerciseRaw,
      sets,
      orderFirst: p.orderFirst,
      bands: p.bands,
      ...(p.restSec !== undefined ? { restSec: p.restSec } : {}),
      ...extra,
    });
    const pushIssues = (): void => {
      for (const i of p.issues) result.issues.push({ kind: i.kind, line, rawLine, detail: i.detail });
    };

    if (p.nichts) {
      pushIssues();
      return;
    }
    if (p.issues.some((i) => i.kind === 'unparsed-line')) {
      pushIssues();
      result.blocks.push(make([], { note: rawLine }));
      current = undefined;
      return;
    }
    if (p.segments.length === 0) {
      // Pure note line (tags, cues, leftover words): attach to the preceding block of this cell.
      pushIssues();
      if (current !== undefined) setNote(current, appendNote(current.note, noteText));
      else if (noteText !== undefined) result.blocks.push(make([], { note: noteText }));
      return;
    }

    const previous = result.blocks.at(-1);
    const previousLine = idx > 0 ? parsed[idx - 1] : undefined;
    const continuesNoteOnly =
      p.alias === undefined && p.join === 'new' && previous !== undefined && previousLine !== undefined &&
      previousLine.aliases.length === 1 && previous.sets.length === 0 && previous.note === previousLine.alias?.raw &&
      previous.line === idx;
    if (continuesNoteOnly) {
      // `Overhead Press Bands` then `10kg 15x 15x easy`: the second line fills the first line's block.
      const firstSeg = p.segments[0]!;
      result.issues = result.issues.filter((i) => !(i.kind === 'note-only' && i.line === previous.line));
      previous.sets = firstSeg.sets;
      delete previous.note;
      if (noteText !== undefined) previous.note = noteText;
      previous.bands = previous.bands || p.bands;
      if (p.restSec !== undefined) previous.restSec = p.restSec;
      if (firstSeg.aggregate) previous.aggregate = true;
      previous.exerciseId = resolveExercise(previousLine.alias?.id, header, { bands: previous.bands, refinements: p.refinements });
      current = previous;
      for (const seg of p.segments.slice(1)) {
        const b = make(seg.sets, { exerciseId: previous.exerciseId, exerciseRaw: previous.exerciseRaw });
        result.blocks.push(b);
        current = b;
      }
      pushIssues();
      return;
    }
    if (p.join === 'plus' && current !== undefined) {
      const firstSeg = p.segments[0]!;
      current.sets.push(...firstSeg.sets);
      setNote(current, appendNote(current.note, noteText));
      if (p.restSec !== undefined) current.restSec = p.restSec;
      for (const seg of p.segments.slice(1)) {
        const b = make(seg.sets, { exerciseId: current.exerciseId, exerciseRaw: current.exerciseRaw });
        result.blocks.push(b);
        current = b;
      }
      pushIssues();
      return;
    }
    if (p.join === 'dann' && current !== undefined && p.alias === undefined) {
      const inherit = { exerciseId: current.exerciseId, exerciseRaw: current.exerciseRaw };
      p.segments.forEach((seg, k) => {
        const b = make(seg.sets, { ...inherit, ...(k === 0 && noteText !== undefined ? { note: noteText } : {}) });
        result.blocks.push(b);
        current = b;
      });
      pushIssues();
      return;
    }
    p.segments.forEach((seg, k) => {
      const b = make(seg.sets, {
        ...(seg.aggregate ? { aggregate: true as const } : {}),
        ...(seg.noteOnly !== undefined ? { note: seg.noteOnly } : {}),
        ...(k === 0 && noteText !== undefined && seg.noteOnly === undefined ? { note: noteText } : {}),
      });
      if (seg.noteOnly !== undefined && p.aliases.length > 1) {
        const own = p.aliases[k];
        b.exerciseId = resolveExercise(own?.id, header, { bands: p.bands, refinements: p.refinements });
        b.exerciseRaw = own?.raw ?? header;
      }
      result.blocks.push(b);
      current = b;
    });
    if (exerciseId === undefined) result.issues.push({ kind: 'unknown-exercise', line, rawLine, detail: `no exercise for "${exerciseRaw}"` });
    pushIssues();
  });
  return result;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

```powershell
npx vitest run src/migration/parse-cell.test.ts
npm run typecheck
```
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/parse-cell.ts src/migration/parse-cell.test.ts
git commit -m "Add cell assembly: lines to blocks with fallback, continuation, dann and plus" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Dates: text forms, repairs, order check, proposals (§4)

**Files:**
- Create: `src/migration/dates.ts`
- Test: `src/migration/dates.test.ts`

**Interfaces:**
- Consumes: `isCalendarDate` from `src/model/validate.ts`; `Cell` (Task 1); `ReviewKind` (Task 1).
- Produces: `DateStatus` (union below), `parseDateText(text, year): DateStatus`, `classifyDate(cell: Cell | undefined, year): DateStatus`, `addDays(date, days)`, `daysBetween(a, b)`, `singleMonthEdit(date, lower, upper): string | undefined`, `medianGap(dates): number`, `DateItem { kind: ReviewKind; detail: string; proposal?: string }`, `ResolvedDate { key: string; date: string; uncertain: boolean; items: DateItem[]; repairs: string[] }`, `resolveBlockDates(rows: readonly { key: string; status: DateStatus }[], year: number): ResolvedDate[]`.

- [ ] **Step 1: Write the failing tests `src/migration/dates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { addDays, classifyDate, daysBetween, medianGap, parseDateText, resolveBlockDates, singleMonthEdit, type DateStatus } from './dates';

const Y = 2030;
const exact = (date: string): DateStatus => ({ kind: 'exact', date });
const missing: DateStatus = { kind: 'missing' };
const keyed = (statuses: DateStatus[]) => statuses.map((status, i) => ({ key: `r${i}`, status }));

describe('parseDateText', () => {
  it('accepts the plain forms without a repair', () => {
    expect(parseDateText('28.01.30', Y)).toEqual(exact('2030-01-28'));
    expect(parseDateText('07.02.2030', Y)).toEqual(exact('2030-02-07'));
    expect(parseDateText(' 7.2.2030 ', Y)).toEqual(exact('2030-02-07'));
  });

  it('repairs separators and a missing year, and reports the repair', () => {
    expect(parseDateText('01,05.2030', Y)).toEqual({ kind: 'repaired', date: '2030-05-01', repair: 'separator "," read as "."' });
    expect(parseDateText('02.07..2030', Y)).toEqual({ kind: 'repaired', date: '2030-07-02', repair: 'separator ".." read as "."' });
    expect(parseDateText('06.07.', Y)).toEqual({ kind: 'repaired', date: '2030-07-06', repair: 'year completed to 2030' });
  });

  it('reads a three-digit year as the sheet year but doubts it', () => {
    expect(parseDateText('28.04.203', Y)).toEqual({ kind: 'doubtful', date: '2030-04-28', reason: 'three-digit year "203" read as 2030' });
  });

  it('rejects anything else, including impossible dates', () => {
    expect(parseDateText('abc', Y)).toEqual({ kind: 'unreadable', text: 'abc' });
    expect(parseDateText('31.02.2030', Y)).toEqual({ kind: 'unreadable', text: '31.02.2030' });
    expect(parseDateText('2030-02-07', Y)).toEqual({ kind: 'unreadable', text: '2030-02-07' });
  });
});

describe('classifyDate', () => {
  it('handles missing, date and text cells', () => {
    expect(classifyDate(undefined, Y)).toEqual(missing);
    expect(classifyDate({ kind: 'date', value: '2030-04-24' }, Y)).toEqual(exact('2030-04-24'));
    expect(classifyDate({ kind: 'text', value: '25.04.2030' }, Y)).toEqual(exact('2030-04-25'));
  });
});

describe('date arithmetic', () => {
  it('adds days across month ends and measures gaps', () => {
    expect(addDays('2030-01-30', 3)).toBe('2030-02-02');
    expect(addDays('2030-02-01', -6)).toBe('2030-01-26');
    expect(daysBetween('2030-01-26', '2030-02-01')).toBe(6);
  });

  it('proposes exactly one month edit, or none', () => {
    expect(singleMonthEdit('2030-08-03', '2030-08-30', '2030-09-07')).toBe('2030-09-03');
    expect(singleMonthEdit('2030-06-25', '2030-05-21', '2030-05-29')).toBe('2030-05-25');
    expect(singleMonthEdit('2030-07-02', '2030-07-04', '2030-07-08')).toBeUndefined();
    expect(singleMonthEdit('2030-01-05', '2030-01-10', undefined)).toBeUndefined();
  });

  it('medianGap uses the first four dates, rounds, and falls back to 7', () => {
    expect(medianGap(['2030-02-01', '2030-02-07', '2030-02-13', '2030-02-17', '2030-03-30'])).toBe(6);
    expect(medianGap(['2030-02-01', '2030-02-07', '2030-02-11'])).toBe(5);
    expect(medianGap(['2030-02-01'])).toBe(7);
    expect(medianGap([])).toBe(7);
  });
});

describe('resolveBlockDates', () => {
  it('leaves an increasing sequence alone', () => {
    const out = resolveBlockDates(keyed([exact('2030-02-01'), exact('2030-02-07')]), Y);
    expect(out.map((o) => [o.date, o.uncertain, o.items.length])).toEqual([['2030-02-01', false, 0], ['2030-02-07', false, 0]]);
  });

  it('flags the lone outlier with a single-month proposal', () => {
    const out = resolveBlockDates(keyed(['2030-08-26', '2030-08-30', '2030-08-03', '2030-09-07', '2030-09-11'].map(exact)), Y);
    expect(out.map((o) => o.uncertain)).toEqual([false, false, true, false, false]);
    expect(out[2]?.date).toBe('2030-08-03');
    expect(out[2]?.items).toEqual([{ kind: 'date-out-of-order', detail: '2030-08-03 breaks the row order', proposal: '2030-09-03' }]);
  });

  it('flags a month typo that is also a duplicate, and the duplicate itself', () => {
    const out = resolveBlockDates(keyed(['2030-05-21', '2030-06-25', '2030-05-29', '2030-06-02', '2030-06-25'].map(exact)), Y);
    expect(out.map((o) => o.uncertain)).toEqual([false, true, false, false, true]);
    expect(out[1]?.items[0]).toEqual({ kind: 'date-out-of-order', detail: '2030-06-25 breaks the row order', proposal: '2030-05-25' });
    expect(out[4]?.items[0]).toEqual({ kind: 'date-out-of-order', detail: '2030-06-25 appears twice in this column block' });
  });

  it('flags both rows of a swap without a proposal', () => {
    const out = resolveBlockDates(keyed(['2030-06-24', '2030-07-04', '2030-07-02', '2030-07-08'].map(exact)), Y);
    expect(out.map((o) => o.uncertain)).toEqual([false, true, true, false]);
    for (const i of [1, 2]) {
      expect(out[i]?.items[0]?.kind).toBe('date-out-of-order');
      expect(out[i]?.items[0]?.proposal).toBeUndefined();
      expect(out[i]?.items[0]?.detail).toContain('either could be wrong');
    }
  });

  it('proposes dates for undated rows above the first dated one from the median gap', () => {
    const out = resolveBlockDates(keyed([missing, missing, missing, exact('2030-02-01'), exact('2030-02-07'), exact('2030-02-13'), exact('2030-02-17')]), Y);
    expect(out.slice(0, 3).map((o) => o.date)).toEqual(['2030-01-14', '2030-01-20', '2030-01-26']);
    expect(out.slice(0, 3).every((o) => o.uncertain)).toBe(true);
    expect(out[0]?.items).toEqual([{ kind: 'date-proposed', detail: 'no date in the sheet', proposal: '2030-01-14' }]);
    expect(out[3]?.uncertain).toBe(false);
  });

  it('proposes midpoints between dated rows and day steps after the last one', () => {
    expect(resolveBlockDates(keyed([exact('2030-02-01'), missing, exact('2030-02-07')]), Y)[1]?.date).toBe('2030-02-04');
    const two = resolveBlockDates(keyed([exact('2030-02-01'), missing, missing, exact('2030-02-07')]), Y);
    expect([two[1]?.date, two[2]?.date]).toEqual(['2030-02-03', '2030-02-05']);
    const after = resolveBlockDates(keyed([exact('2030-02-01'), missing, missing]), Y);
    expect([after[1]?.date, after[2]?.date]).toEqual(['2030-02-02', '2030-02-03']);
    expect(resolveBlockDates(keyed([missing]), Y)[0]?.date).toBe('2030-01-01');
  });

  it('treats an unreadable date as undated and says so', () => {
    const out = resolveBlockDates(keyed([exact('2030-02-01'), { kind: 'unreadable', text: 'x' }, exact('2030-02-07')]), Y);
    expect(out[1]?.date).toBe('2030-02-04');
    expect(out[1]?.uncertain).toBe(true);
    expect(out[1]?.items).toEqual([{ kind: 'date-unreadable', detail: '"x" is not a date', proposal: '2030-02-04' }]);
  });

  it('carries doubtful dates as uncertain items and repairs as report text', () => {
    const out = resolveBlockDates(keyed([{ kind: 'doubtful', date: '2030-04-28', reason: 'r' }, { kind: 'repaired', date: '2030-05-01', repair: 's' }]), Y);
    expect(out[0]).toEqual({ key: 'r0', date: '2030-04-28', uncertain: true, items: [{ kind: 'date-repaired-doubtful', detail: 'r' }], repairs: [] });
    expect(out[1]).toEqual({ key: 'r1', date: '2030-05-01', uncertain: false, items: [], repairs: ['s'] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/dates.test.ts
```
Expected: FAIL, cannot find module './dates'.

- [ ] **Step 3: Create `src/migration/dates.ts`**

```ts
import { isCalendarDate } from '../model/validate';
import type { Cell } from './grid';
import type { ReviewKind } from './types';

export type DateStatus =
  | { kind: 'exact'; date: string }
  | { kind: 'repaired'; date: string; repair: string }
  | { kind: 'doubtful'; date: string; reason: string }
  | { kind: 'unreadable'; text: string }
  | { kind: 'missing' };

const TEXT_DATE = /^(\d{1,2})([.,]+)(\d{1,2})(?:([.,]+)(\d{2,4})?)?[.,]*$/;
const pad = (n: string | number): string => String(n).padStart(2, '0');

/** Spec 2 §4 "Dates": the accepted text forms and their repairs. */
export function parseDateText(text: string, year: number): DateStatus {
  const m = TEXT_DATE.exec(text.trim());
  if (!m) return { kind: 'unreadable', text };
  const [, day, sep1, month, sep2, yearText] = m;
  const repairs: string[] = [];
  if (sep1 !== '.') repairs.push(`separator "${sep1}" read as "."`);
  if (sep2 !== undefined && sep2 !== '.') repairs.push(`separator "${sep2}" read as "."`);
  let y: number;
  let doubtful: string | undefined;
  if (yearText === undefined) {
    y = year;
    repairs.push(`year completed to ${year}`);
  } else if (yearText.length === 2) y = 2000 + Number(yearText);
  else if (yearText.length === 3) {
    y = year;
    doubtful = `three-digit year "${yearText}" read as ${year}`;
  } else y = Number(yearText);
  const date = `${y}-${pad(month!)}-${pad(day!)}`;
  if (!isCalendarDate(date)) return { kind: 'unreadable', text };
  if (doubtful !== undefined) return { kind: 'doubtful', date, reason: doubtful };
  if (repairs.length > 0) return { kind: 'repaired', date, repair: repairs.join('; ') };
  return { kind: 'exact', date };
}

export function classifyDate(cell: Cell | undefined, year: number): DateStatus {
  if (cell === undefined) return { kind: 'missing' };
  if (cell.kind === 'date') return isCalendarDate(cell.value) ? { kind: 'exact', date: cell.value } : { kind: 'unreadable', text: cell.value };
  return parseDateText(cell.value, year);
}

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

/** The one month change that puts `date` strictly between its neighbours, if exactly one exists. */
export function singleMonthEdit(date: string, lower: string | undefined, upper: string | undefined): string | undefined {
  const candidates: string[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const candidate = `${date.slice(0, 4)}-${pad(m)}-${date.slice(8, 10)}`;
    if (candidate === date || !isCalendarDate(candidate)) continue;
    if ((lower === undefined || candidate > lower) && (upper === undefined || candidate < upper)) candidates.push(candidate);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

export interface DateItem {
  kind: ReviewKind;
  detail: string;
  proposal?: string;
}

export interface ResolvedDate {
  key: string;
  date: string;
  uncertain: boolean;
  items: DateItem[];
  repairs: string[];
}

const DEFAULT_GAP_DAYS = 7;

/** Median gap of the first four dated rows (spec 2 §4), whole days, at least 1; 7 when there is no gap to measure. */
export function medianGap(dates: readonly string[]): number {
  const first = dates.slice(0, 4);
  const gaps: number[] = [];
  for (let i = 1; i < first.length; i += 1) gaps.push(daysBetween(first[i - 1]!, first[i]!));
  if (gaps.length === 0) return DEFAULT_GAP_DAYS;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.max(1, Math.round(median));
}

/** Spec 2 §4: order and duplicate check, single-edit proposals, undated-row proposals, for one column block. */
export function resolveBlockDates(rows: readonly { key: string; status: DateStatus }[], year: number): ResolvedDate[] {
  const out: ResolvedDate[] = rows.map((r) => ({ key: r.key, date: '', uncertain: false, items: [], repairs: [] }));
  const known: { index: number; date: string }[] = [];
  rows.forEach((r, index) => {
    const o = out[index]!;
    if (r.status.kind === 'exact' || r.status.kind === 'repaired' || r.status.kind === 'doubtful') {
      o.date = r.status.date;
      known.push({ index, date: r.status.date });
    }
    if (r.status.kind === 'repaired') o.repairs.push(r.status.repair);
    if (r.status.kind === 'doubtful') {
      o.uncertain = true;
      o.items.push({ kind: 'date-repaired-doubtful', detail: r.status.reason });
    }
  });

  // Out-of-order: which of the two neighbours is the outlier? The one whose removal restores the order.
  const d = known.map((k) => k.date);
  const flagged = new Map<number, DateItem>();
  const fixable = (c: number): boolean => c === 0 || c === d.length - 1 || d[c - 1]! < d[c + 1]!;
  for (let i = 1; i < d.length; i += 1) {
    if (d[i]! > d[i - 1]!) continue;
    const candidates = [i - 1, i].filter(fixable);
    if (candidates.length === 1) {
      const c = candidates[0]!;
      const proposal = singleMonthEdit(d[c]!, c > 0 ? d[c - 1] : undefined, c < d.length - 1 ? d[c + 1] : undefined);
      const item: DateItem = { kind: 'date-out-of-order', detail: `${d[c]} breaks the row order` };
      if (proposal !== undefined) item.proposal = proposal;
      flagged.set(c, item);
    } else {
      for (const c of [i - 1, i]) {
        if (!flagged.has(c)) flagged.set(c, { kind: 'date-out-of-order', detail: `${d[c]} and its neighbour are out of order; either could be wrong` });
      }
    }
  }
  const counts = new Map<string, number>();
  for (const date of d) counts.set(date, (counts.get(date) ?? 0) + 1);
  d.forEach((date, c) => {
    if ((counts.get(date) ?? 0) > 1 && !flagged.has(c)) flagged.set(c, { kind: 'date-out-of-order', detail: `${date} appears twice in this column block` });
  });
  for (const [c, item] of flagged) {
    const o = out[known[c]!.index]!;
    o.uncertain = true;
    o.items.push(item);
  }

  // Undated rows: proposals (spec 2 §4).
  const gap = medianGap(d);
  rows.forEach((r, index) => {
    const o = out[index]!;
    if (o.date !== '') return;
    const before = [...known].reverse().find((k) => k.index < index);
    const after = known.find((k) => k.index > index);
    let proposal: string;
    if (before === undefined && after !== undefined) proposal = addDays(after.date, -(after.index - index) * gap);
    else if (before !== undefined && after !== undefined) {
      const undatedBetween = after.index - before.index - 1;
      const j = index - before.index;
      proposal = addDays(before.date, Math.floor((j * daysBetween(before.date, after.date)) / (undatedBetween + 1)));
    } else if (before !== undefined) proposal = addDays(before.date, index - before.index);
    else proposal = `${year}-01-01`;
    o.date = proposal;
    o.uncertain = true;
    if (r.status.kind === 'unreadable') o.items.push({ kind: 'date-unreadable', detail: `"${r.status.text}" is not a date`, proposal });
    else o.items.push({ kind: 'date-proposed', detail: 'no date in the sheet', proposal });
  });
  return out;
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/migration/dates.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/dates.ts src/migration/dates.test.ts
git commit -m "Add date parsing, order check and proposals for the migration" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rows: column blocks and Extra sessions (§4)

**Files:**
- Create: `src/migration/rows.ts`
- Test: `src/migration/rows.test.ts`

**Interfaces:**
- Consumes: `Cell`, `Grid`, `lastRow` (Task 1); `COLUMN_BLOCKS`, `FIRST_DATA_ROW`, `HEADER_ROW`, `BlockName` (Task 1 `sheet.ts`); `SessionLabel` from `src/model/types.ts`.
- Produces: `SourceCell { address: string; header: string; text: string }`, `SourceRow { key: string; block: BlockName | 'Extra'; row: number; label: SessionLabel; dateAddress: string; dateCell: Cell | undefined; cells: SourceCell[]; noteCells: SourceCell[]; hostKey?: string }`, `leadingDate(text): { dateText: string; rest: string } | undefined`, `headerOf(grid, col): string`, `splitRows(grid: Grid): SourceRow[]`.

- [ ] **Step 1: Write the failing tests `src/migration/rows.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { headerOf, leadingDate, splitRows } from './rows';
import { gridOf } from './test-fixtures';

describe('leadingDate', () => {
  it('splits a leading date off an Extra cell', () => {
    expect(leadingDate('07.06.2030 Pullups 2x die 5er Pyramide')).toEqual({ dateText: '07.06.2030', rest: 'Pullups 2x die 5er Pyramide' });
    expect(leadingDate('06.07. 100x Dipbar Knee Raises')).toEqual({ dateText: '06.07.', rest: '100x Dipbar Knee Raises' });
    expect(leadingDate(' 15.07.2030 Burpees')).toEqual({ dateText: '15.07.2030', rest: 'Burpees' });
  });

  it('leaves cells without a leading date alone', () => {
    expect(leadingDate('Lat Raise Bands 10kg 22x 22x')).toBeUndefined();
    expect(leadingDate('100x Dipbar Knee Raises')).toBeUndefined();
    expect(leadingDate('20x 15x')).toBeUndefined();
  });
});

describe('splitRows', () => {
  const grid = gridOf({
    A6: { date: '2030-02-01' }, B6: '20x', C6: '30kg 20x',
    B8: '20x',
    F6: { date: '2030-02-03' }, G6: 'Dips 10x', J6: 'Lat Raise Bands 10kg 22x 22x',
    F7: '05.06.2030', G7: 'Dips 10x', J7: '07.06.2030 Pullups 5er Pyramide',
    L6: { date: '2030-01-30' },
  });
  const rows = splitRows(grid);

  it('yields one row per session, column block by column block, Extra sessions after their host', () => {
    expect(rows.map((r) => r.key)).toEqual(['Pull!6', 'Pull!8', 'Push!6', 'Push!7', 'J7', 'Legs!6']);
    expect(rows.map((r) => r.label)).toEqual(['pull', 'pull', 'push', 'push', 'other', 'legs']);
  });

  it('collects exercise cells with their headers, in column order', () => {
    const pull = rows[0]!;
    expect(pull).toMatchObject({ block: 'Pull', row: 6, dateAddress: 'A6', dateCell: { kind: 'date', value: '2030-02-01' } });
    expect(pull.cells).toEqual([
      { address: 'B6', header: 'Australian Pull Ups', text: '20x' },
      { address: 'C6', header: 'Bicep Curls', text: '30kg 20x' },
    ]);
    expect(pull.noteCells).toEqual(pull.cells);
    expect(pull.hostKey).toBeUndefined();
  });

  it('keeps an undated row and a row with a date only', () => {
    expect(rows[1]).toMatchObject({ key: 'Pull!8', dateCell: undefined, cells: [{ address: 'B8', header: 'Australian Pull Ups', text: '20x' }] });
    expect(rows[5]).toMatchObject({ key: 'Legs!6', cells: [], dateCell: { kind: 'date', value: '2030-01-30' } });
  });

  it('adds an Extra cell without a leading date to the push row', () => {
    expect(rows[2]?.cells.map((c) => [c.address, c.header])).toEqual([['G6', 'Dips'], ['J6', 'Extra']]);
  });

  it('turns an Extra cell with a leading date into its own session and keeps it out of the push row', () => {
    expect(rows[3]?.cells.map((c) => c.address)).toEqual(['G7']);
    expect(rows[4]).toEqual({
      key: 'J7', block: 'Extra', row: 7, label: 'other', dateAddress: 'J7',
      dateCell: { kind: 'text', value: '07.06.2030' },
      cells: [{ address: 'J7', header: 'Extra', text: 'Pullups 5er Pyramide' }],
      noteCells: [{ address: 'J7', header: 'Extra', text: '07.06.2030 Pullups 5er Pyramide' }],
      hostKey: 'Push!7',
    });
  });

  it('ignores the header rows and empty rows', () => {
    expect(splitRows(gridOf({}))).toEqual([]);
  });
});

describe('headerOf', () => {
  it('reads row 2 and falls back to the column letter', () => {
    expect(headerOf(gridOf({}), 'M')).toBe('Single Leg RDL');
    expect(headerOf(gridOf({}, false), 'M')).toBe('M');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/rows.test.ts
```
Expected: FAIL, cannot find module './rows'.

- [ ] **Step 3: Create `src/migration/rows.ts`**

```ts
import type { SessionLabel } from '../model/types';
import { lastRow, type Cell, type Grid } from './grid';
import { COLUMN_BLOCKS, FIRST_DATA_ROW, HEADER_ROW, type BlockName } from './sheet';

export interface SourceCell {
  address: string;
  header: string;
  text: string;
}

export interface SourceRow {
  /** `Pull!6`, or the J address for an Extra session (`J30`). */
  key: string;
  block: BlockName | 'Extra';
  row: number;
  label: SessionLabel;
  dateAddress: string;
  dateCell: Cell | undefined;
  /** Cells to parse (Extra: the J cell with its leading date removed). */
  cells: SourceCell[];
  /** Cells for the session notes, original text. */
  noteCells: SourceCell[];
  /** Extra sessions: the key of the push row on the same sheet row. */
  hostKey?: string;
}

const LEADING_DATE = /^\s*(\d{1,2}[.,]+\d{1,2}(?:[.,]+\d{2,4})?[.,]*)(?:\s+|$)/;

/** `12.06.2026 Pullups …` → the date text and the rest; undefined when the cell has no leading date. */
export function leadingDate(text: string): { dateText: string; rest: string } | undefined {
  const m = LEADING_DATE.exec(text);
  if (!m) return undefined;
  return { dateText: m[1]!, rest: text.slice(m[0].length) };
}

export function headerOf(grid: Grid, col: string): string {
  return grid.get(`${col}${HEADER_ROW}`)?.value.trim() ?? col;
}

/** Spec 2 §4 "Column blocks" and "Extra column": one SourceRow per session. */
export function splitRows(grid: Grid): SourceRow[] {
  const rows: SourceRow[] = [];
  const last = lastRow(grid);
  for (const block of COLUMN_BLOCKS) {
    for (let r = FIRST_DATA_ROW; r <= last; r += 1) {
      const dateAddress = `${block.dateCol}${r}`;
      const dateCell = grid.get(dateAddress);
      const cells: SourceCell[] = [];
      for (const col of block.exerciseCols) {
        const cell = grid.get(`${col}${r}`);
        if (cell !== undefined) cells.push({ address: `${col}${r}`, header: headerOf(grid, col), text: cell.value });
      }
      let extra: SourceRow | undefined;
      if (block.extraCol !== undefined) {
        const address = `${block.extraCol}${r}`;
        const cell = grid.get(address);
        if (cell !== undefined) {
          const header = headerOf(grid, block.extraCol);
          const lead = leadingDate(cell.value);
          if (lead === undefined) cells.push({ address, header, text: cell.value });
          else {
            extra = {
              key: address,
              block: 'Extra',
              row: r,
              label: 'other',
              dateAddress: address,
              dateCell: { kind: 'text', value: lead.dateText },
              cells: [{ address, header, text: lead.rest }],
              noteCells: [{ address, header, text: cell.value }],
              hostKey: `${block.name}!${r}`,
            };
          }
        }
      }
      if (dateCell !== undefined || cells.length > 0) {
        rows.push({ key: `${block.name}!${r}`, block: block.name, row: r, label: block.label, dateAddress, dateCell, cells, noteCells: [...cells] });
      }
      if (extra !== undefined) rows.push(extra);
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/migration/rows.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/rows.ts src/migration/rows.test.ts
git commit -m "Add row splitting with Extra-column sessions for the migration" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Decisions file (§9)

**Files:**
- Create: `src/migration/decisions.ts`
- Test: `src/migration/decisions.test.ts`

**Interfaces:**
- Consumes: `isCalendarDate` (`src/model/validate.ts`), `cellLines` (Task 7).
- Produces: `Decision { text?: string; date?: string; dateExact?: true; accept?: true; skip?: true; why?: string }`, `Decisions = Readonly<Record<string, Decision>>`, `parseDecisions(json: string): Decisions` (throws on shape errors), `AppliedCell { text: string | undefined; used: string[]; seen: string[] }`, `applyCellDecisions(address, original, decisions): AppliedCell`.

- [ ] **Step 1: Write the failing tests `src/migration/decisions.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { applyCellDecisions, parseDecisions } from './decisions';

describe('parseDecisions', () => {
  it('accepts the documented vocabulary', () => {
    const d = parseDecisions(JSON.stringify({
      G9: { text: '6,5kg 13x 13x', why: 'twice' },
      A49: { date: '2030-09-03' },
      A34: { dateExact: true },
      A3: { accept: true },
      'M27#3': { skip: true },
    }));
    expect(Object.keys(d)).toEqual(['G9', 'A49', 'A34', 'A3', 'M27#3']);
    expect(d['G9']).toEqual({ text: '6,5kg 13x 13x', why: 'twice' });
    expect(parseDecisions('{}')).toEqual({});
  });

  it.each([
    ['[]', /JSON object/],
    ['{"g9": {}}', /cell address/],
    ['{"G9": "x"}', /must be an object/],
    ['{"G9": {"foo": 1}}', /unknown field "foo"/],
    ['{"G9": {"text": 3}}', /text must be a string/],
    ['{"G9": {"date": "2030-02-30"}}', /date must be YYYY-MM-DD/],
    ['{"G9": {"date": "30.02.2030"}}', /date must be YYYY-MM-DD/],
    ['{"G9": {"accept": false}}', /accept must be true/],
    ['{"G9": {"why": 1}}', /why must be a string/],
  ])('rejects %s', (json, message) => {
    expect(() => parseDecisions(json)).toThrow(message);
  });
});

describe('applyCellDecisions', () => {
  const original = 'a\nb\n\nc';

  it('returns the cell unchanged without a decision', () => {
    expect(applyCellDecisions('M27', original, {})).toEqual({ text: 'a\nb\nc', used: [], seen: [] });
  });

  it('replaces the whole cell and records the key as used only if the text changed', () => {
    expect(applyCellDecisions('G9', '6,5kg 13,2x', { G9: { text: '6,5kg 13x 13x' } })).toEqual({ text: '6,5kg 13x 13x', used: ['G9'], seen: ['G9'] });
    expect(applyCellDecisions('G9', '6,5kg 13,2x', { G9: { text: ' 6,5kg 13,2x ' } })).toEqual({ text: '6,5kg 13,2x', used: [], seen: ['G9'] });
  });

  it('skips a cell', () => {
    expect(applyCellDecisions('G9', 'x', { G9: { skip: true } })).toEqual({ text: undefined, used: ['G9'], seen: ['G9'] });
  });

  it('replaces or skips one non-empty line by its 1-based index', () => {
    expect(applyCellDecisions('M27', original, { 'M27#3': { text: 'z' } })).toEqual({ text: 'a\nb\nz', used: ['M27#3'], seen: ['M27#3'] });
    expect(applyCellDecisions('M27', original, { 'M27#2': { skip: true } })).toEqual({ text: 'a\nc', used: ['M27#2'], seen: ['M27#2'] });
    expect(applyCellDecisions('M27', original, { 'M27#1': { text: 'a' } })).toEqual({ text: 'a\nb\nc', used: [], seen: ['M27#1'] });
  });

  it('applies the cell text first, then line decisions on the result', () => {
    expect(applyCellDecisions('M27', original, { M27: { text: 'p\nq' }, 'M27#2': { text: 'r' } })).toEqual({ text: 'p\nr', used: ['M27', 'M27#2'], seen: ['M27', 'M27#2'] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/decisions.test.ts
```
Expected: FAIL, cannot find module './decisions'.

- [ ] **Step 3: Create `src/migration/decisions.ts`**

```ts
import { isCalendarDate } from '../model/validate';
import { cellLines } from './parse-cell';

/** Spec 2 §9 "Decisions file". */
export interface Decision {
  text?: string;
  date?: string;
  dateExact?: true;
  accept?: true;
  skip?: true;
  why?: string;
}

export type Decisions = Readonly<Record<string, Decision>>;

const KEY = /^[A-Z]+\d+(#\d+)?$/;
const FIELDS = new Set(['text', 'date', 'dateExact', 'accept', 'skip', 'why']);

/** Parse and check the decisions file. Throws with the offending key on any shape error. */
export function parseDecisions(json: string): Decisions {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('decisions file must hold a JSON object');
  const out: Record<string, Decision> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY.test(key)) throw new Error(`decision key "${key}" is not a cell address like G9 or M27#3`);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`decision ${key} must be an object`);
    const d = value as Record<string, unknown>;
    for (const field of Object.keys(d)) if (!FIELDS.has(field)) throw new Error(`decision ${key}: unknown field "${field}"`);
    if (d['text'] !== undefined && typeof d['text'] !== 'string') throw new Error(`decision ${key}: text must be a string`);
    if (d['date'] !== undefined && (typeof d['date'] !== 'string' || !isCalendarDate(d['date']))) {
      throw new Error(`decision ${key}: date must be YYYY-MM-DD`);
    }
    for (const flag of ['dateExact', 'accept', 'skip'] as const) {
      if (d[flag] !== undefined && d[flag] !== true) throw new Error(`decision ${key}: ${flag} must be true or absent`);
    }
    if (d['why'] !== undefined && typeof d['why'] !== 'string') throw new Error(`decision ${key}: why must be a string`);
    out[key] = d as Decision;
  }
  return out;
}

export interface AppliedCell {
  /** undefined: the whole cell was skipped. */
  text: string | undefined;
  /** Decision keys that changed something. */
  used: string[];
  /** Decision keys present for this cell (used or not). */
  seen: string[];
}

/** Apply `text` and `skip` decisions to one cell: cell-level first, then per non-empty line (`A1#n`). */
export function applyCellDecisions(address: string, original: string, decisions: Decisions): AppliedCell {
  const used: string[] = [];
  const seen: string[] = [];
  const cell = decisions[address];
  if (cell !== undefined) seen.push(address);
  if (cell?.skip) return { text: undefined, used: [address], seen };
  let lines = cellLines(original);
  if (cell?.text !== undefined) {
    const replaced = cellLines(cell.text);
    if (replaced.join('\n') !== lines.join('\n')) used.push(address);
    lines = replaced;
  }
  const kept: string[] = [];
  lines.forEach((line, i) => {
    const key = `${address}#${i + 1}`;
    const d = decisions[key];
    if (d === undefined) {
      kept.push(line);
      return;
    }
    seen.push(key);
    if (d.skip) {
      used.push(key);
      return;
    }
    if (d.text !== undefined && d.text.trim() !== line) {
      used.push(key);
      kept.push(d.text.trim());
      return;
    }
    kept.push(line);
  });
  return { text: kept.join('\n'), used, seen };
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/migration/decisions.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/decisions.ts src/migration/decisions.test.ts
git commit -m "Add the decisions file parser and per-cell application" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Build sessions, review items and report entries (§4–§9)

**Files:**
- Create: `src/migration/build.ts`
- Test: `src/migration/build.test.ts`

**Interfaces:**
- Consumes: everything above; `Exercise`, `Session`, `Block`, `WorkoutSet`, `BodyweightEntry`, `LoadType` from `src/model/types.ts`; `SEED` (tests).
- Produces: `BuildOptions { year: number; stamp: string; bodyweightKg: number }`, `BuildResult { sessions: Session[]; catalog: Exercise[]; bodyweight: BodyweightEntry[]; review: ReviewItem[]; report: ReportEntry[] }`, `buildSessions(rows, decisions, catalog, options): BuildResult`, `loadOf(set, exercise, bands)`, `round2(n)`.

- [ ] **Step 1: Write the failing tests `src/migration/build.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { MODEL_VERSION } from '../model/schema';
import { checkCatalogRules, validateForWrite } from '../model/validate';
import { buildSessions, loadOf } from './build';
import type { Decisions } from './decisions';
import { uuidV5 } from './ids';
import { splitRows } from './rows';
import { gridOf, type CellSpec } from './test-fixtures';

const STAMP = '2030-10-07T00:00:00.000Z';
const OPTIONS = { year: 2030, stamp: STAMP, bodyweightKg: 80 };
const build = (cells: Record<string, CellSpec>, decisions: Decisions = {}) => buildSessions(splitRows(gridOf(cells)), decisions, SEED, OPTIONS);
const d = (date: string) => ({ date });
const seed = (id: string) => SEED.find((e) => e.id === id)!;

describe('buildSessions: one session per row', () => {
  const r = build({ A6: d('2030-02-01'), B6: '6kg 15x 12x', C6: '35kg 16x 14x' });
  const s = r.sessions[0]!;

  it('fills the session fields from the row', () => {
    expect(r.sessions).toHaveLength(1);
    expect(s).toMatchObject({ id: uuidV5('session/Pull!6'), date: '2030-02-01', label: 'pull', source: 'migrated', tags: [], updatedAt: STAMP });
    expect(s.dateUncertain).toBeUndefined();
    expect(s.notes).toBe('Australian Pull Ups: 6kg 15x 12x\nBicep Curls: 35kg 16x 14x');
    expect(r.review).toEqual([]);
  });

  it('builds blocks and sets in column order with deterministic ids and per-set loads', () => {
    expect(s.blocks.map((b) => [b.exerciseId, b.order, b.id])).toEqual([
      ['australian-pull-ups-rings', 0, uuidV5('session/Pull!6/block/0')],
      ['bicep-curls-band', 1, uuidV5('session/Pull!6/block/1')],
    ]);
    expect(s.blocks[0]?.sets[0]).toEqual({ updatedAt: STAMP, id: uuidV5('session/Pull!6/block/0/set/0'), order: 0, reps: 15, loadType: 'added', loadKg: 6 });
    expect(s.blocks[1]?.sets.map((x) => [x.reps, x.loadType, x.loadKg])).toEqual([[16, 'band', 35], [14, 'band', 35]]);
    expect(s.blocks[0]?.note).toBeUndefined();
  });

  it('emits the seed as catalog and one estimated bodyweight entry at the earliest date', () => {
    expect(r.catalog).toEqual([...SEED]);
    expect(r.bodyweight).toEqual([{ updatedAt: STAMP, id: uuidV5('bodyweight/initial'), date: '2030-02-01', kg: 80, note: 'estimated, constant 80 kg through 2030 (migration)' }]);
  });
});

describe('buildSessions: load types', () => {
  it('maps kg and its absence by exercise kind, with explicit bodyweight winning', () => {
    expect(loadOf({ reps: 1, kg: 6, bodyweight: false }, seed('dips-bar'), false)).toEqual({ loadType: 'added', loadKg: 6, missing: false });
    expect(loadOf({ reps: 1, bodyweight: false }, seed('dips-bar'), false)).toEqual({ loadType: 'bodyweight', loadKg: 0, missing: false });
    expect(loadOf({ reps: 1, kg: 17.4, bodyweight: false }, seed('single-leg-rdl'), false)).toEqual({ loadType: 'external', loadKg: 17.4, missing: false });
    expect(loadOf({ reps: 1, bodyweight: true }, seed('single-leg-rdl'), false)).toEqual({ loadType: 'bodyweight', loadKg: 0, missing: false });
    expect(loadOf({ reps: 1, bodyweight: false }, seed('single-leg-rdl'), false)).toEqual({ loadType: 'external', loadKg: 0, missing: true });
    expect(loadOf({ reps: 1, kg: 50, bodyweight: false }, seed('single-leg-rdl-band'), true)).toEqual({ loadType: 'band', loadKg: 50, missing: false });
    expect(loadOf({ reps: 1, kg: 12.346, bodyweight: false }, seed('squats'), false).loadKg).toBe(12.35);
  });

  it('raises load-missing once per block and still emits the sets', () => {
    const r = build({ L6: d('2030-07-22'), M6: 'Lateral raises 30x 30x 29x 25x', L7: d('2030-07-28'), M7: '20x 2 ohne weil erkältet' });
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['load-missing', 'M6']]);
    expect(r.sessions[0]?.blocks[0]?.sets.map((x) => x.loadType)).toEqual(['band', 'band', 'band', 'band']);
    expect(r.sessions[1]?.blocks[0]?.sets.map((x) => [x.loadType, x.loadKg])).toEqual([['bodyweight', 0], ['bodyweight', 0]]);
    expect(r.sessions[1]?.tags).toEqual(['sick']);
  });
});

describe('buildSessions: blocks', () => {
  it('moves `vor den Australians` blocks to the front', () => {
    const r = build({ A6: d('2030-05-28'), B6: '11,5kg 20x', C6: 'Pullups 1x 2x 3x vor den Australians' });
    expect(r.sessions[0]?.blocks.map((b) => [b.exerciseId, b.order])).toEqual([['pull-ups', 0], ['australian-pull-ups-rings', 1]]);
  });

  it('carries restSec, aggregate and block notes, and drops cue phrases', () => {
    const r = build({ F6: d('2030-05-29'), G6: 'Dips Downs 15x Start with 1m Rest', H6: '100 Diamonds', A6: d('2030-05-28'), B6: '11,5kg 20x 19x\nsauber (Ellbogen), langsam, gestreckt' });
    const push = r.sessions.find((s) => s.label === 'push')!;
    expect(push.blocks[0]?.sets).toHaveLength(15);
    expect(push.blocks[0]?.sets.every((x) => x.restSec === 60)).toBe(true);
    expect(push.blocks[0]?.note).toBe('Start with 1m Rest');
    expect(push.blocks[1]?.sets).toEqual([{ updatedAt: STAMP, id: uuidV5('session/Push!6/block/1/set/0'), order: 0, reps: 100, loadType: 'bodyweight', loadKg: 0, aggregate: true }]);
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['aggregate', 'H6']]);
    expect(r.report).toContainEqual({ kind: 'dropped', where: 'B6', detail: 'cues dropped: sauber (Ellbogen), langsam, gestreckt' });
  });

  it('drops a block without an exercise and flags it', () => {
    const r = build({ F6: d('2030-05-29'), G6: 'Dips 10x', J6: '20x 20x' });
    expect(r.sessions[0]?.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar']);
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['unknown-exercise', 'J6']]);
  });

  it('a date with no cells is an empty session and a review item', () => {
    const r = build({ A6: d('2030-02-01') });
    expect(r.sessions[0]?.blocks).toEqual([]);
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['empty-row', 'A6']]);
  });
});

describe('buildSessions: Extra column', () => {
  const r = build({
    F6: d('2030-06-05'), G6: 'Dips 10x', J6: '07.06.2030 Pullups 5er Pyramide',
    F7: d('2030-06-11'), G7: 'Dips 10x', J7: 'Lat Raise Bands 10kg 22x 22x',
  });

  it('makes a dated Extra cell its own session and keeps it out of the push row', () => {
    expect(r.sessions.map((s) => [s.date, s.label])).toEqual([['2030-06-05', 'push'], ['2030-06-07', 'other'], ['2030-06-11', 'push']]);
    const extra = r.sessions[1]!;
    expect(extra.id).toBe(uuidV5('session/J6'));
    expect(extra.notes).toBe('Extra: 07.06.2030 Pullups 5er Pyramide');
    expect(extra.blocks[0]?.sets.map((x) => x.reps)).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
    expect(r.sessions[0]?.notes).toBe('Dips: Dips 10x');
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['pyramid-expanded', 'J6']]);
  });

  it('adds an undated Extra cell to the push session after the I block', () => {
    expect(r.sessions[2]?.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'lateral-raises-band']);
    expect(r.sessions[2]?.blocks[1]?.sets[0]).toMatchObject({ loadType: 'band', loadKg: 10 });
    expect(r.sessions[2]?.notes).toBe('Dips: Dips 10x\nExtra: Lat Raise Bands 10kg 22x 22x');
  });
});

describe('buildSessions: dates', () => {
  const undated = { B3: '20x 15x', B4: '6kg 15x', B5: '9kg 14x', A6: d('2030-02-01'), B6: 'Bodyweight 20x', A7: d('2030-02-07'), B7: 'Bodyweight 20x', A8: d('2030-02-13'), B8: 'Bodyweight 20x', A9: d('2030-02-17'), B9: 'Bodyweight 20x' };

  it('proposes dates for the undated rows, flags them, and starts the bodyweight there', () => {
    const r = build(undated);
    expect(r.sessions.slice(0, 3).map((s) => [s.date, s.dateUncertain])).toEqual([['2030-01-14', true], ['2030-01-20', true], ['2030-01-26', true]]);
    expect(r.sessions[3]?.dateUncertain).toBeUndefined();
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['date-proposed', 'A3'], ['date-proposed', 'A4'], ['date-proposed', 'A5']]);
    expect(r.review[0]?.proposal).toContain('2030-01-14');
    expect(r.bodyweight[0]?.date).toBe('2030-01-14');
  });

  it('keeps an out-of-order date as written, flags it and proposes the month fix', () => {
    const cells = { A6: d('2030-08-26'), B6: 'Pullups 5x', A7: d('2030-08-30'), B7: 'Pullups 5x', A8: '03.08.2030', B8: 'Pullups 5x', A9: d('2030-09-07'), B9: 'Pullups 5x' };
    const r = build(cells);
    const flagged = r.sessions.find((s) => s.date === '2030-08-03')!;
    expect(flagged.dateUncertain).toBe(true);
    expect(r.review).toHaveLength(1);
    expect(r.review[0]).toMatchObject({ kind: 'date-out-of-order', key: 'A8', date: '2030-08-03', raw: '03.08.2030' });
    expect(r.review[0]?.proposal).toContain('2030-09-03');
    const fixed = build(cells, { A8: { date: '2030-09-03' } });
    expect(fixed.review).toEqual([]);
    expect(fixed.sessions.map((s) => s.date)).toEqual(['2030-08-26', '2030-08-30', '2030-09-03', '2030-09-07']);
    expect(fixed.sessions.every((s) => s.dateUncertain === undefined)).toBe(true);
    const kept = build(cells, { A8: { dateExact: true } });
    expect(kept.review).toEqual([]);
    expect(kept.sessions.find((s) => s.date === '2030-08-03')?.dateUncertain).toBeUndefined();
  });

  it('reports repaired dates and treats an unreadable one as undated', () => {
    const r = build({ A6: '01,02.2030', B6: 'Pullups 5x', A7: 'foo', B7: 'Pullups 5x', A8: d('2030-02-13'), B8: 'Pullups 5x' });
    expect(r.report).toContainEqual({ kind: 'repair', where: 'A6', detail: 'date "01,02.2030" → 2030-02-01 (separator "," read as ".")' });
    expect(r.sessions[1]).toMatchObject({ date: '2030-02-07', dateUncertain: true });
    expect(r.review.map((i) => [i.kind, i.key])).toEqual([['date-unreadable', 'A7']]);
  });

  it('a date decision also works on an Extra cell', () => {
    const r = build({ F6: d('2030-06-05'), G6: 'Dips 10x', J6: '07.06.2030 Pullups 5x' }, { J6: { date: '2030-06-08' } });
    expect(r.sessions[1]?.date).toBe('2030-06-08');
    expect(r.review).toEqual([]);
  });
});

describe('buildSessions: decisions', () => {
  const cells = { A6: d('2030-02-20'), C6: '6,5kg 13,2x 11,2x' };

  it('a text decision is parsed like a cell and leaves the notes untouched', () => {
    const r = build(cells, { C6: { text: '6,5kg 13x 13x 11x 11x', why: 'twice' } });
    expect(r.sessions[0]?.blocks[0]?.sets.map((x) => x.reps)).toEqual([17, 17, 14, 14]);
    expect(r.sessions[0]?.notes).toBe('Bicep Curls: 6,5kg 13,2x 11,2x');
    expect(r.review).toEqual([]);
    expect(r.report).toContainEqual({ kind: 'decision', where: 'C6', detail: 'twice' });
    const two = build(cells, { C6: { text: 'Pullups 1x 2x\ndann 5x 5x' } });
    expect(two.sessions[0]?.blocks.map((b) => [b.exerciseId, b.sets.length])).toEqual([['pull-ups', 2], ['pull-ups', 2]]);
  });

  it('a decision that changes nothing is stale, and so is one without a cell', () => {
    const r = build(cells, { C6: { text: '6,5kg 13,2x 11,2x' }, Z9: { accept: true } });
    expect(r.review.map((i) => [i.kind, i.key, i.detail])).toEqual([
      ['stale-decision', 'C6', 'the decision changes nothing'],
      ['stale-decision', 'Z9', 'no cell or item has this key'],
    ]);
  });

  it('accept closes an item and reports it; skip drops a cell', () => {
    const r = build({ B3: '20x', A4: d('2030-02-01'), B4: '20x' }, { A3: { accept: true } });
    expect(r.review).toEqual([]);
    expect(r.sessions[0]?.dateUncertain).toBe(true);
    expect(r.report.some((e) => e.kind === 'accepted' && e.where === 'A3')).toBe(true);
    const skipped = build(cells, { C6: { skip: true } });
    expect(skipped.sessions[0]?.blocks).toEqual([]);
    expect(skipped.report).toContainEqual({ kind: 'skipped', where: 'C6', detail: 'cell skipped by decision: "6,5kg 13,2x 11,2x"' });
  });

  it('line decisions use address#line keys, as the review items do', () => {
    const lines = { A6: d('2030-07-22'), C6: 'Pullups 1x 2x\nLateral raises 30x 30x' };
    expect(build(lines).review.map((i) => i.key)).toEqual(['C6#2']);
    const r = build(lines, { 'C6#2': { text: 'Lateral raises 10kg 30x 30x' } });
    expect(r.review).toEqual([]);
    expect(r.sessions[0]?.blocks[1]?.sets[0]).toMatchObject({ loadType: 'band', loadKg: 10 });
  });
});

describe('buildSessions: determinism and validity', () => {
  const cells = {
    B3: '20x 15x', A6: d('2030-02-01'), B6: '6kg 15x 12x', C6: 'Neg Pullups 10x 10x', D6: '25kg x 20 x3',
    F5: '28.01.30', G5: '21x 14x', H5: '19x', I5: 'nichts',
    F6: d('2030-02-03'), G6: '6,5kg 15x 13x', H6: '23x 19,5x', I6: '30kg 20 x 2', J6: 'Overhead Press Bands\n10kg 15x 15x easy',
    F7: '09.02.2030', G7: 'Rings Downs 15x Start with 1m Rest', J7: '15.07.2030 Burpees, Pyramide Pullups',
    L6: d('2030-01-30'), M6: 'Bands 50kg 20x 60kg 15x x2', N6: '20x ohne / 20x mit 12,4kg', O6: 'Bands 25kg 24x 35kg 25x 50kg 25x',
    L7: '05.02.2030', M7: '20x 2 mit 15,4 kg (R 1x 15)', N7: 'normal Squats 17,4kg 30x 28,9kg 30x 20x', O7: 'Knee Raises 25x 25x\nLateral Raises 30x 30x',
  };

  it('produces identical results on two runs', () => {
    expect(build(cells)).toEqual(build(cells));
  });

  it('passes the model validation for every file', () => {
    const r = build(cells);
    expect(r.sessions.length).toBeGreaterThan(6);
    for (const s of r.sessions) {
      expect(validateForWrite('session', { schemaVersion: MODEL_VERSION, session: s }).issues, s.notes).toEqual([]);
      expect(checkCatalogRules(s, r.catalog), s.notes).toEqual([]);
    }
    expect(validateForWrite('exercises', { schemaVersion: MODEL_VERSION, exercises: r.catalog }).ok).toBe(true);
    expect(validateForWrite('bodyweight', { schemaVersion: MODEL_VERSION, entries: r.bodyweight }).ok).toBe(true);
    expect(r.sessions.map((s) => s.date)).toEqual([...r.sessions.map((s) => s.date)].sort());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/build.test.ts
```
Expected: FAIL, cannot find module './build'.

- [ ] **Step 3: Create `src/migration/build.ts`**

```ts
import type { Block, BodyweightEntry, Exercise, LoadType, Session, WorkoutSet } from '../model/types';
import { classifyDate, resolveBlockDates, type DateStatus, type ResolvedDate } from './dates';
import { applyCellDecisions, type Decisions } from './decisions';
import { uuidV5 } from './ids';
import { cellLines, parseCell, type CellBlock } from './parse-cell';
import type { ParsedSet } from './parse-line';
import type { SourceRow } from './rows';
import { COLUMN_BLOCKS } from './sheet';
import type { ReportEntry, ReviewItem, ReviewKind } from './types';

export interface BuildResult {
  sessions: Session[];
  catalog: Exercise[];
  bodyweight: BodyweightEntry[];
  review: ReviewItem[];
  report: ReportEntry[];
}

export interface BuildOptions {
  year: number;
  stamp: string;
  bodyweightKg: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Spec 2 §5 "Load type per set". `ohne`/`Bodyweight` are explicit, so they win for any exercise kind. */
export function loadOf(set: ParsedSet, exercise: Exercise, bands: boolean): { loadType: LoadType; loadKg: number; missing: boolean } {
  const kind = exercise.defaultLoadType;
  const bodyKind = kind === 'bodyweight' || kind === 'added' || kind === 'assist';
  if (set.kg !== undefined && set.kg > 0) {
    if (bands) return { loadType: 'band', loadKg: round2(set.kg), missing: false };
    return { loadType: bodyKind ? 'added' : kind, loadKg: round2(set.kg), missing: false };
  }
  if (bodyKind || set.bodyweight) return { loadType: 'bodyweight', loadKg: 0, missing: false };
  return { loadType: bands ? 'band' : kind, loadKg: 0, missing: true };
}

/** Spec 2 §4–§9: rows → sessions, catalog, bodyweight, review items and report entries. */
export function buildSessions(rows: readonly SourceRow[], decisions: Decisions, catalog: readonly Exercise[], options: BuildOptions): BuildResult {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const review: ReviewItem[] = [];
  const report: ReportEntry[] = [];
  const usedKeys = new Set<string>();
  const seenKeys = new Set<string>();

  const statusOf = (row: SourceRow): DateStatus => {
    const d = decisions[row.dateAddress];
    const parsed = classifyDate(row.dateCell, options.year);
    if (d !== undefined) seenKeys.add(row.dateAddress);
    if (d?.date === undefined) return parsed;
    const parsedDate = 'date' in parsed ? parsed.date : undefined;
    if (parsedDate !== d.date) usedKeys.add(row.dateAddress);
    return { kind: 'exact', date: d.date };
  };

  // 1. Dates, per column block; Extra sessions fall back to their host row (spec 2 §4).
  const resolved = new Map<string, ResolvedDate>();
  for (const block of COLUMN_BLOCKS) {
    const blockRows = rows.filter((r) => r.block === block.name);
    for (const rd of resolveBlockDates(blockRows.map((r) => ({ key: r.key, status: statusOf(r) })), options.year)) resolved.set(rd.key, rd);
  }
  for (const r of rows) {
    if (r.block !== 'Extra') continue;
    const status = statusOf(r);
    const host = r.hostKey !== undefined ? resolved.get(r.hostKey) : undefined;
    const rd: ResolvedDate = { key: r.key, date: '', uncertain: false, items: [], repairs: [] };
    if (status.kind === 'exact' || status.kind === 'repaired' || status.kind === 'doubtful') {
      rd.date = status.date;
      if (status.kind === 'repaired') rd.repairs.push(status.repair);
      if (status.kind === 'doubtful') {
        rd.uncertain = true;
        rd.items.push({ kind: 'date-repaired-doubtful', detail: status.reason });
      }
    } else {
      rd.date = host?.date ?? `${options.year}-01-01`;
      rd.uncertain = true;
      const text = status.kind === 'unreadable' ? status.text : '';
      rd.items.push({ kind: 'date-unreadable', detail: `"${text}" is not a date; using the push row's date`, proposal: rd.date });
    }
    resolved.set(r.key, rd);
  }
  for (const r of rows) {
    const d = decisions[r.dateAddress];
    const rd = resolved.get(r.key)!;
    if (d?.dateExact && rd.uncertain) {
      rd.uncertain = false;
      usedKeys.add(r.dateAddress);
    }
  }

  // 2. One session per row.
  const sessions: Session[] = [];
  for (const row of rows) {
    const rd = resolved.get(row.key)!;
    for (const repair of rd.repairs) {
      report.push({ kind: 'repair', where: row.dateAddress, detail: `date "${row.dateCell?.value ?? ''}" → ${rd.date} (${repair})` });
    }
    for (const item of rd.items) {
      const flag = rd.uncertain ? ', flagged dateUncertain' : '';
      let proposal = `date ${rd.date}${flag}`;
      if (item.proposal !== undefined) {
        proposal = item.kind === 'date-out-of-order' ? `proposed ${item.proposal}; written date kept${flag}` : `using proposed ${item.proposal}${flag}`;
      }
      review.push({
        kind: item.kind,
        key: row.dateAddress,
        block: row.block,
        row: row.row,
        date: rd.date,
        raw: row.dateCell?.value ?? '',
        proposal,
        detail: item.detail,
      });
    }
    if (row.cells.length === 0) {
      review.push({ kind: 'empty-row', key: row.dateAddress, block: row.block, row: row.row, date: rd.date, raw: row.dateCell?.value ?? '', proposal: 'session without blocks', detail: 'a date with no exercise cells' });
    }

    const tags = new Set<string>();
    const built: { cell: CellBlock; address: string; exercise: Exercise; lineCount: number }[] = [];
    for (const cell of row.cells) {
      const applied = applyCellDecisions(cell.address, cell.text, decisions);
      for (const k of applied.used) usedKeys.add(k);
      for (const k of applied.seen) seenKeys.add(k);
      if (applied.text === undefined) {
        report.push({ kind: 'skipped', where: cell.address, detail: `cell skipped by decision: ${JSON.stringify(cell.text)}` });
        continue;
      }
      const parsed = parseCell(applied.text, cell.header);
      const lineCount = cellLines(applied.text).length;
      for (const t of parsed.tags) tags.add(t);
      if (parsed.cuesDropped.length > 0) report.push({ kind: 'dropped', where: cell.address, detail: `cues dropped: ${parsed.cuesDropped.join(', ')}` });
      for (const w of parsed.unrecognised) report.push({ kind: 'unrecognised', where: cell.address, detail: `"${w}" kept as note text` });
      const keyFor = (line: number): string => (lineCount > 1 ? `${cell.address}#${line}` : cell.address);
      for (const issue of parsed.issues) {
        review.push({
          kind: issue.kind,
          key: keyFor(issue.line),
          block: row.block,
          row: row.row,
          date: rd.date,
          raw: issue.rawLine,
          proposal: proposalFor(issue.kind, parsed.blocks.filter((b) => b.line === issue.line)),
          detail: issue.detail,
        });
      }
      for (const b of parsed.blocks) {
        const exercise = b.exerciseId !== undefined ? byId.get(b.exerciseId) : undefined;
        if (exercise === undefined) {
          if (b.exerciseId !== undefined) {
            review.push({ kind: 'unknown-exercise', key: keyFor(b.line), block: row.block, row: row.row, date: rd.date, raw: b.rawLine, proposal: 'block dropped', detail: `${b.exerciseId} is not in the catalog` });
          }
          continue;
        }
        built.push({ cell: b, address: cell.address, exercise, lineCount });
      }
    }

    const ordered = [...built.filter((b) => b.cell.orderFirst), ...built.filter((b) => !b.cell.orderFirst)];
    const sessionName = `session/${row.key}`;
    const blocks: Block[] = ordered.map((b, blockIndex) => {
      const blockName = `${sessionName}/block/${blockIndex}`;
      const sets: WorkoutSet[] = b.cell.sets.map((s, setIndex) => {
        const load = loadOf(s, b.exercise, b.cell.bands);
        if (load.missing) {
          review.push({
            kind: 'load-missing',
            key: b.lineCount > 1 ? `${b.address}#${b.cell.line}` : b.address,
            block: row.block,
            row: row.row,
            date: rd.date,
            raw: b.cell.rawLine,
            proposal: `${load.loadType} 0 kg`,
            detail: `${b.exercise.name} is a ${b.exercise.defaultLoadType} exercise and the cell has no kg`,
          });
        }
        return {
          updatedAt: options.stamp,
          id: uuidV5(`${blockName}/set/${setIndex}`),
          order: setIndex,
          reps: s.reps,
          loadType: load.loadType,
          loadKg: load.loadKg,
          ...(b.cell.restSec !== undefined ? { restSec: b.cell.restSec } : {}),
          ...(b.cell.aggregate ? { aggregate: true as const } : {}),
        };
      });
      return {
        updatedAt: options.stamp,
        id: uuidV5(blockName),
        order: blockIndex,
        exerciseId: b.exercise.id,
        ...(b.cell.note !== undefined ? { note: b.cell.note } : {}),
        sets,
      };
    });

    const notes = row.noteCells.map((c) => `${c.header}: ${c.text.trim()}`).join('\n');
    sessions.push({
      updatedAt: options.stamp,
      id: uuidV5(sessionName),
      date: rd.date,
      ...(rd.uncertain ? { dateUncertain: true as const } : {}),
      label: row.label,
      ...(notes !== '' ? { notes } : {}),
      tags: [...tags].sort(),
      source: 'migrated',
      blocks,
    });
  }

  // load-missing is raised once per block, not once per set.
  dedupe(review);

  // 3. accept decisions close items; 4. stale decisions become items.
  const open: ReviewItem[] = [];
  for (const item of review) {
    const address = item.key.split('#')[0]!;
    const d = decisions[item.key] ?? (item.key !== address ? decisions[address] : undefined);
    const key = decisions[item.key] !== undefined ? item.key : address;
    if (d?.accept) {
      usedKeys.add(key);
      seenKeys.add(key);
      report.push({ kind: 'accepted', where: item.key, detail: `${item.kind}: ${item.proposal}${d.why !== undefined ? ` (${d.why})` : ''}` });
    } else open.push(item);
  }
  for (const [key, d] of Object.entries(decisions)) {
    if (d.why !== undefined) report.push({ kind: 'decision', where: key, detail: d.why });
    if (!usedKeys.has(key)) {
      const address = key.split('#')[0]!;
      const row = rows.find((r) => r.dateAddress === address || r.cells.some((c) => c.address === address));
      open.push({
        kind: 'stale-decision',
        key,
        block: row?.block ?? '?',
        row: row?.row ?? 0,
        date: row !== undefined ? resolved.get(row.key)?.date : undefined,
        raw: JSON.stringify(d),
        proposal: 'decision ignored',
        detail: seenKeys.has(key) ? 'the decision changes nothing' : 'no cell or item has this key',
      });
    }
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const earliest = sessions[0]?.date ?? `${options.year}-01-01`;
  const bodyweight: BodyweightEntry[] = [{
    updatedAt: options.stamp,
    id: uuidV5('bodyweight/initial'),
    date: earliest,
    kg: options.bodyweightKg,
    note: `estimated, constant ${options.bodyweightKg} kg through ${options.year} (migration)`,
  }];
  open.sort(compareItems);
  return { sessions, catalog: [...catalog], bodyweight, review: open, report };
}

function proposalFor(kind: ReviewKind, blocks: readonly CellBlock[]): string {
  const summary = blocks
    .map((b) => {
      const sets = b.sets.length === 0
        ? (b.note !== undefined ? `note-only "${b.note}"` : 'no sets')
        : b.sets.map((s) => `${s.reps}${s.kg !== undefined ? `@${s.kg}` : ''}`).join(' ');
      return `${b.exerciseId ?? '?'}: ${sets}${b.aggregate ? ' (aggregate)' : ''}`;
    })
    .join(' | ');
  switch (kind) {
    case 'unparsed-line':
      return `emitted as note-only block with the raw line; ${summary}`;
    case 'unknown-exercise':
      return 'block dropped';
    default:
      return summary;
  }
}

const BLOCK_ORDER: Readonly<Record<string, number>> = { Pull: 0, Push: 1, Legs: 2, Extra: 3, '?': 4 };

function compareItems(a: ReviewItem, b: ReviewItem): number {
  const ba = BLOCK_ORDER[a.block] ?? 9;
  const bb = BLOCK_ORDER[b.block] ?? 9;
  if (ba !== bb) return ba - bb;
  if (a.row !== b.row) return a.row - b.row;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function dedupe(items: ReviewItem[]): void {
  const seen = new Set<string>();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const sig = `${items[i]!.kind}|${items[i]!.key}|${items[i]!.detail}`;
    if (seen.has(sig)) items.splice(i, 1);
    else seen.add(sig);
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

```powershell
npx vitest run src/migration/build.test.ts
npm run typecheck
```
Expected: PASS; tsc clean. If a `toEqual` on a review list fails only in order, the items are sorted by block (Pull, Push, Legs, Extra), then row, then key; align the expectation, not the sort.

- [ ] **Step 5: Commit**

```powershell
git add src/migration/build.ts src/migration/build.test.ts
git commit -m "Build sessions, review items and report entries from the parsed rows" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Review and report renderers, output files and the validation gate (§8, §9)

**Files:**
- Create: `src/migration/review.ts`, `src/migration/output.ts`
- Test: `src/migration/review.test.ts`, `src/migration/output.test.ts`

**Interfaces:**
- Consumes: `BuildResult` (Task 11); `ReviewItem`, `ReportEntry` (Task 1); `MODEL_VERSION`, `validateForWrite`, `checkCatalogRules`, `ValidationIssue` from `src/model/`.
- Produces: `decisionSkeleton(item): string`, `renderReview(items): string`, `ReportMeta { final: boolean; xlsx: string; decisionCount: number }`, `renderReport(result, meta): string`; `OutFile { path: string; content: string }`, `MANAGED_PATHS`, `sessionFilePath(session): string`, `toFiles(result): OutFile[]`, `validateAll(result): ValidationIssue[]`, `isInside(child, parent): boolean`, `writeOutput(dir, files): Promise<void>`.

- [ ] **Step 1: Write the failing tests `src/migration/review.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { buildSessions } from './build';
import { decisionSkeleton, renderReport, renderReview } from './review';
import { splitRows } from './rows';
import { gridOf } from './test-fixtures';
import type { ReviewItem } from './types';

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  kind: 'date-proposed', key: 'A3', block: 'Pull', row: 3, date: '2030-01-14', raw: '', proposal: 'using proposed 2030-01-14, flagged dateUncertain', detail: 'no date in the sheet', ...over,
});

describe('decisionSkeleton', () => {
  it('offers the fields that answer each kind', () => {
    expect(decisionSkeleton(item({}))).toContain('"A3": { "date": "YYYY-MM-DD" }');
    expect(decisionSkeleton(item({ kind: 'date-out-of-order', key: 'A49' }))).toContain('"dateExact": true');
    expect(decisionSkeleton(item({ kind: 'load-missing', key: 'M33', raw: 'Lateral raises 30x' }))).toContain('"M33": { "text": "Lateral raises 30x" }');
    expect(decisionSkeleton(item({ kind: 'aggregate', key: 'H37', raw: '100 Diamonds' }))).toContain('"H37": { "accept": true }');
    expect(decisionSkeleton(item({ kind: 'stale-decision', key: 'Z9' }))).toContain('remove');
    expect(decisionSkeleton(item({ kind: 'empty-row', key: 'A6' }))).toContain('"accept": true');
  });
});

describe('renderReview', () => {
  it('says so when nothing is open', () => {
    expect(renderReview([])).toContain('0 open items');
  });

  it('groups items by column block and shows raw text, problem, proposal and the answer', () => {
    const md = renderReview([item({}), item({ kind: 'aggregate', key: 'H37', block: 'Push', row: 37, raw: '100 Diamonds', proposal: 'diamond-push-ups: 100 (aggregate)', detail: '100 total' })]);
    expect(md).toContain('2 open items');
    expect(md.indexOf('## Pull')).toBeLessThan(md.indexOf('## Push'));
    expect(md).toContain('### A3 · date-proposed · row 3 · 2030-01-14');
    expect(md).toContain('- cell text: (empty)');
    expect(md).toContain('- cell text: `100 Diamonds`');
    expect(md).toContain('- problem: 100 total');
    expect(md).toContain('- done for now: diamond-push-ups: 100 (aggregate)');
    expect(md).toContain('"H37": { "accept": true }');
  });
});

describe('renderReport', () => {
  const result = buildSessions(splitRows(gridOf({ B3: '20x', A6: { date: '2030-02-01' }, B6: '6kg 15x', C6: '35kg 16x', F6: '01,02.2030', G6: 'Dips 10x' })), {}, SEED, { year: 2030, stamp: '2030-10-07T00:00:00.000Z', bodyweightKg: 80 });

  it('heads the report FINAL or NOT FINAL and counts everything', () => {
    const md = renderReport(result, { final: false, xlsx: 'synthetic.xlsx', decisionCount: 0 });
    expect(md.startsWith('# Migration report — NOT FINAL')).toBe(true);
    expect(md).toContain('Source: synthetic.xlsx. Decisions applied: 0. 1 open review item(s).');
    expect(md).toContain('| sessions | 3 |');
    expect(md).toContain('| sessions labelled pull | 2 |');
    expect(md).toContain('| blocks | 4 |');
    expect(md).toContain('| sets | 4 |');
    expect(md).toContain('| sessions with dateUncertain | 1 |');
    expect(md).toContain('| open: date-proposed | 1 |');
    expect(md).toContain('F6: date "01,02.2030" → 2030-02-01 (separator "," read as ".")');
    expect(md).toContain('- australian-pull-ups-rings');
    expect(renderReport({ ...result, review: [] }, { final: true, xlsx: 'x.xlsx', decisionCount: 2 }).startsWith('# Migration report — FINAL')).toBe(true);
  });

  it('writes "none" for empty sections', () => {
    expect(renderReport(result, { final: false, xlsx: 'x', decisionCount: 0 })).toMatch(/## Accepted items\n\n- none/);
  });
});
```

- [ ] **Step 2: Write the failing tests `src/migration/output.test.ts`**

```ts
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { buildSessions, type BuildResult } from './build';
import { isInside, sessionFilePath, toFiles, validateAll, writeOutput } from './output';
import { splitRows } from './rows';
import { gridOf } from './test-fixtures';

const OPTIONS = { year: 2030, stamp: '2030-10-07T00:00:00.000Z', bodyweightKg: 80 };
const result = (): BuildResult =>
  buildSessions(splitRows(gridOf({ A6: { date: '2030-06-05' }, B6: '6kg 15x', F6: { date: '2030-06-05' }, G6: 'Dips 10x', J6: '07.06.2030 Pullups 5x' })), {}, SEED, OPTIONS);

describe('toFiles', () => {
  it('lays the files out as spec 1 §4 does, with pretty JSON and a trailing newline', () => {
    const files = toFiles(result());
    expect(files.map((f) => f.path).slice(0, 2)).toEqual(['exercises.json', 'bodyweight.json']);
    expect(files.slice(2).every((f) => /^sessions\/2030\/2030-06-0[57]_[0-9a-f]{8}\.json$/.test(f.path))).toBe(true);
    const parsed = JSON.parse(files[2]!.content) as { schemaVersion: number; session: { id: string } };
    expect(parsed.schemaVersion).toBe(1);
    expect(files[2]!.content.endsWith('}\n')).toBe(true);
    expect(files[2]!.content).toContain('\n  "session": {');
  });

  it('two sessions on one date get two files', () => {
    const r = result();
    const same = r.sessions.filter((s) => s.date === '2030-06-05');
    expect(same).toHaveLength(2);
    expect(new Set(same.map(sessionFilePath)).size).toBe(2);
  });
});

describe('validateAll', () => {
  it('is empty for a built result', () => {
    expect(validateAll(result())).toEqual([]);
  });

  it('reports hard failures, soft failures and duplicate ids with the file in the path', () => {
    const r = result();
    const broken: BuildResult = {
      ...r,
      sessions: [
        { ...r.sessions[0]!, date: '2030-02-30' },
        { ...r.sessions[1]!, id: r.sessions[0]!.id, blocks: r.sessions[1]!.blocks.map((b) => ({ ...b, exerciseId: 'no-such-exercise' })) },
      ],
    };
    const issues = validateAll(broken);
    expect(issues.some((i) => i.level === 'hard' && i.path.endsWith('/session/date'))).toBe(true);
    expect(issues.some((i) => i.level === 'soft' && i.message.includes('no-such-exercise'))).toBe(true);
    expect(issues.some((i) => i.message.includes('duplicate session id'))).toBe(true);
    expect(issues.every((i) => i.path.startsWith('sessions/'))).toBe(true);
  });
});

describe('isInside', () => {
  it('detects a child path, the directory itself, and nothing else', () => {
    expect(isInside('/repo/migration-out', '/repo')).toBe(true);
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(isInside('/repo/../elsewhere', '/repo')).toBe(false);
    expect(isInside('/other/out', '/repo')).toBe(false);
  });
});

describe('writeOutput', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-out-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('clears only the managed paths and writes every file', async () => {
    await mkdir(path.join(dir, 'sessions', '2029'), { recursive: true });
    await writeFile(path.join(dir, 'sessions', '2029', 'stale.json'), '{}');
    await writeFile(path.join(dir, 'notes.txt'), 'keep me');
    await writeFile(path.join(dir, 'review.md'), 'old');
    const files = [...toFiles(result()), { path: 'review.md', content: 'new' }, { path: 'report.md', content: 'r' }];
    await writeOutput(dir, files);
    expect(await readFile(path.join(dir, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(path.join(dir, 'review.md'), 'utf8')).toBe('new');
    expect(await readdir(path.join(dir, 'sessions'))).toEqual(['2030']);
    expect((await readdir(path.join(dir, 'sessions', '2030'))).length).toBe(3);
    expect(await readFile(path.join(dir, 'exercises.json'), 'utf8')).toBe(files[0]!.content);
  });

  it('creates a missing output directory', async () => {
    const fresh = path.join(dir, 'fresh', 'deeper');
    await writeOutput(fresh, [{ path: 'report.md', content: 'x' }]);
    expect(await readFile(path.join(fresh, 'report.md'), 'utf8')).toBe('x');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/review.test.ts src/migration/output.test.ts
```
Expected: FAIL, cannot find modules './review' and './output'.

- [ ] **Step 4: Create `src/migration/review.ts`**

```ts
import type { BuildResult } from './build';
import type { ReportKind, ReviewItem } from './types';

const BLOCK_TITLES: Readonly<Record<string, string>> = {
  Pull: 'Pull (columns A–D)',
  Push: 'Push (columns F–J)',
  Legs: 'Legs (columns L–O)',
  Extra: 'Extra sessions (column J)',
  '?': 'Decisions without a cell',
};

/** The ready-to-paste answer for one item (spec 2 §9). */
export function decisionSkeleton(item: ReviewItem): string {
  const k = JSON.stringify(item.key);
  const raw = JSON.stringify(item.raw);
  switch (item.kind) {
    case 'date-proposed':
    case 'date-unreadable':
    case 'date-out-of-order':
    case 'date-repaired-doubtful':
      return `${k}: { "date": "YYYY-MM-DD" }   or   ${k}: { "dateExact": true }   or   ${k}: { "accept": true }`;
    case 'unparsed-line':
    case 'unknown-exercise':
    case 'load-missing':
    case 'sets-exceed-reps':
    case 'parenthesised-numbers':
      return `${k}: { "text": ${raw} }   (rewrite the text)   or   ${k}: { "skip": true }`;
    case 'aggregate':
    case 'note-only':
    case 'pyramid-expanded':
      return `${k}: { "accept": true }   or   ${k}: { "text": ${raw} }`;
    case 'empty-row':
      return `${k}: { "accept": true }`;
    case 'stale-decision':
      return `remove the entry ${k} from decisions.json`;
  }
}

/** review.md: every open item with the cell, the raw text, what was done and how to answer. */
export function renderReview(items: readonly ReviewItem[]): string {
  const lines = ['# Migration review', ''];
  if (items.length === 0) {
    lines.push('0 open items. The output is final.', '');
    return lines.join('\n');
  }
  lines.push(`${items.length} open item${items.length === 1 ? '' : 's'}. Answer each with an entry in decisions.json under the key shown, then rerun.`, '');
  let block = '';
  for (const item of items) {
    if (item.block !== block) {
      block = item.block;
      lines.push(`## ${BLOCK_TITLES[block] ?? block}`, '');
    }
    lines.push(`### ${item.key} · ${item.kind} · row ${item.row}${item.date !== undefined ? ` · ${item.date}` : ''}`);
    lines.push(`- cell text: ${item.raw === '' ? '(empty)' : `\`${item.raw.replace(/\r?\n/g, ' | ')}\``}`);
    lines.push(`- problem: ${item.detail}`);
    lines.push(`- done for now: ${item.proposal}`);
    lines.push(`- answer: \`${decisionSkeleton(item)}\``, '');
  }
  return lines.join('\n');
}

export interface ReportMeta {
  final: boolean;
  xlsx: string;
  decisionCount: number;
}

const SECTIONS: readonly { title: string; kind: ReportKind }[] = [
  { title: 'Repairs', kind: 'repair' },
  { title: 'Accepted items', kind: 'accepted' },
  { title: 'Decisions (why)', kind: 'decision' },
  { title: 'Skipped cells', kind: 'skipped' },
  { title: 'Dropped phrases', kind: 'dropped' },
  { title: 'Unrecognised words kept as notes', kind: 'unrecognised' },
];

/** report.md: counts, repairs, decisions, dropped phrases, unrecognised words, catalog (spec 2 §9). */
export function renderReport(result: BuildResult, meta: ReportMeta): string {
  const lines = [
    `# Migration report — ${meta.final ? 'FINAL' : 'NOT FINAL'}`,
    '',
    `Source: ${meta.xlsx}. Decisions applied: ${meta.decisionCount}. ${result.review.length} open review item(s).`,
    '',
    '## Counts',
    '',
    '| what | count |',
    '|---|---|',
    `| sessions | ${result.sessions.length} |`,
  ];
  const byLabel = new Map<string, number>();
  for (const s of result.sessions) byLabel.set(s.label ?? 'none', (byLabel.get(s.label ?? 'none') ?? 0) + 1);
  for (const [label, n] of [...byLabel].sort()) lines.push(`| sessions labelled ${label} | ${n} |`);
  lines.push(`| blocks | ${result.sessions.reduce((n, s) => n + s.blocks.length, 0)} |`);
  lines.push(`| sets | ${result.sessions.reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.sets.length, 0), 0)} |`);
  lines.push(`| sessions with dateUncertain | ${result.sessions.filter((s) => s.dateUncertain).length} |`);
  const byKind = new Map<string, number>();
  for (const i of result.review) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [kind, n] of [...byKind].sort()) lines.push(`| open: ${kind} | ${n} |`);
  lines.push('');
  for (const section of SECTIONS) {
    lines.push(`## ${section.title}`, '');
    const entries = result.report.filter((e) => e.kind === section.kind);
    if (entries.length === 0) lines.push('- none');
    for (const e of entries) lines.push(`- ${e.where}: ${e.detail}`);
    lines.push('');
  }
  lines.push('## Catalog', '', ...result.catalog.map((e) => `- ${e.id}`), '');
  return lines.join('\n');
}
```

- [ ] **Step 5: Create `src/migration/output.ts`**

```ts
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_VERSION } from '../model/schema';
import type { Session } from '../model/types';
import { checkCatalogRules, validateForWrite, type ValidationIssue } from '../model/validate';
import type { BuildResult } from './build';

export interface OutFile {
  /** Relative to the output directory, forward slashes. */
  path: string;
  content: string;
}

/** Everything the migration owns inside `--out`; nothing else is ever touched (spec 2 §8). */
export const MANAGED_PATHS = ['exercises.json', 'bodyweight.json', 'sessions', 'review.md', 'report.md'] as const;

/** Spec 1 §4: sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json */
export function sessionFilePath(session: Session): string {
  return `sessions/${session.date.slice(0, 4)}/${session.date}_${session.id.slice(0, 8)}.json`;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function toFiles(result: BuildResult): OutFile[] {
  return [
    { path: 'exercises.json', content: json({ schemaVersion: MODEL_VERSION, exercises: result.catalog }) },
    { path: 'bodyweight.json', content: json({ schemaVersion: MODEL_VERSION, entries: result.bodyweight }) },
    ...result.sessions.map((s) => ({ path: sessionFilePath(s), content: json({ schemaVersion: MODEL_VERSION, session: s }) })),
  ];
}

/** The validation gate (spec 2 §8): hard rules, soft catalog rules, unique ids and paths across files. */
export function validateAll(result: BuildResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefixed = (file: string, list: readonly ValidationIssue[]): ValidationIssue[] => list.map((i) => ({ ...i, path: `${file}${i.path}` }));
  issues.push(...prefixed('exercises.json', validateForWrite('exercises', { schemaVersion: MODEL_VERSION, exercises: result.catalog }).issues));
  issues.push(...prefixed('bodyweight.json', validateForWrite('bodyweight', { schemaVersion: MODEL_VERSION, entries: result.bodyweight }).issues));
  const seenIds = new Map<string, string>();
  const seenPaths = new Set<string>();
  for (const s of result.sessions) {
    const file = sessionFilePath(s);
    issues.push(...prefixed(file, validateForWrite('session', { schemaVersion: MODEL_VERSION, session: s }).issues));
    issues.push(...prefixed(file, checkCatalogRules(s, result.catalog)));
    const first = seenIds.get(s.id);
    if (first !== undefined) issues.push({ level: 'hard', path: `${file}/session/id`, message: `duplicate session id ${s.id} (first in ${first})` });
    else seenIds.set(s.id, file);
    if (seenPaths.has(file)) issues.push({ level: 'hard', path: file, message: 'two sessions map to the same file' });
    seenPaths.add(file);
  }
  return issues;
}

/** true when `child` is `parent` or lies under it. */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Removes exactly the managed paths, then writes the files. The only output-side I/O of the migration. */
export async function writeOutput(dir: string, files: readonly OutFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const managed of MANAGED_PATHS) await rm(path.join(dir, managed), { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(dir, ...file.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}
```

- [ ] **Step 6: Run the tests and the typecheck**

```powershell
npx vitest run src/migration/review.test.ts src/migration/output.test.ts
npm run typecheck
```
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```powershell
git add src/migration/review.ts src/migration/output.ts src/migration/review.test.ts src/migration/output.test.ts
git commit -m "Render review and report, lay out output files behind the validation gate" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: CLI and end-to-end run

**Files:**
- Create: `src/migration/cli.ts`, `scripts/migrate-xlsx.ts`
- Modify: `package.json` (`migrate` script)
- Test: `src/migration/cli.test.ts`

**Interfaces:**
- Consumes: everything above; `SEED`; the constants of `sheet.ts`.
- Produces: `MigrationArgs { xlsx: string; decisions: string; out: string; repoRoot: string; log?: (line: string) => void }`, `EXIT = { final: 0, open: 1, usage: 2, invalid: 3 }`, `runMigration(args): Promise<number>`; the command `npm run migrate -- --xlsx <file> --decisions <file> --out <dir>`.

- [ ] **Step 1: Write the failing tests `src/migration/cli.test.ts`**

```ts
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, runMigration } from './cli';
import { writeWorkbook } from './test-fixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out.set(path.relative(dir, p).split(path.sep).join('/'), await readFile(p, 'utf8'));
    }
  };
  await walk(dir);
  return out;
}

describe('runMigration', () => {
  let dir: string;
  let xlsx: string;
  let decisions: string;
  let out: string;
  const quiet = (): void => {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-'));
    xlsx = path.join(dir, 'synthetic.xlsx');
    decisions = path.join(dir, 'decisions.json');
    out = path.join(dir, 'out');
    await writeWorkbook(xlsx, {
      B3: '20x 15x',
      A6: { date: '2030-02-01' }, B6: '6kg 15x 12x', C6: '35kg 16x 14x',
      F6: { date: '2030-02-03' }, G6: 'Dips 10x 8x', H6: '100 Diamonds',
      F7: '09.02.2030', G7: 'Rings Downs 15x Start with 1m Rest', J7: '15.07.2030 Burpees, Pyramide Pullups',
      L6: { date: '2030-01-30' }, M6: 'Bands 50kg 20x 60kg 15x x2',
    });
    await writeFile(decisions, '{}');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'notes.txt'), 'keep me');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses an output directory inside the repository before reading anything', async () => {
    const inside = path.join(repoRoot, 'migration-out', 'cli-test-must-not-exist');
    const code = await runMigration({ xlsx: path.join(dir, 'does-not-exist.xlsx'), decisions, out: inside, repoRoot, log: quiet });
    expect(code).toBe(EXIT.usage);
    await expect(access(inside)).rejects.toThrow();
  });

  it('writes every file, reports NOT FINAL while items are open, and leaves other files alone', async () => {
    const code = await runMigration({ xlsx, decisions, out, repoRoot, log: quiet });
    expect(code).toBe(EXIT.open);
    const files = await snapshot(out);
    expect(files.get('notes.txt')).toBe('keep me');
    expect([...files.keys()].filter((p) => p.startsWith('sessions/2030/'))).toHaveLength(6);
    expect(files.has('exercises.json')).toBe(true);
    expect(files.has('bodyweight.json')).toBe(true);
    expect(files.get('report.md')?.startsWith('# Migration report — NOT FINAL')).toBe(true);
    const review = files.get('review.md') ?? '';
    for (const key of ['A3', 'H6', 'J7']) expect(review).toContain(`### ${key}`);
    expect(review).toContain('4 open items');
  });

  it('is byte-identical on a rerun', async () => {
    const before = await snapshot(out);
    await runMigration({ xlsx, decisions, out, repoRoot, log: quiet });
    expect(await snapshot(out)).toEqual(before);
  });

  it('exits 0 and reports FINAL once every item is answered', async () => {
    await writeFile(decisions, JSON.stringify({ A3: { accept: true }, H6: { accept: true }, J7: { accept: true } }));
    const lines: string[] = [];
    const code = await runMigration({ xlsx, decisions, out, repoRoot, log: (l) => lines.push(l) });
    expect(code).toBe(EXIT.final);
    const files = await snapshot(out);
    expect(files.get('report.md')?.startsWith('# Migration report — FINAL')).toBe(true);
    expect(files.get('review.md')).toContain('0 open items');
    expect(lines.at(-1)).toContain('FINAL');
  });

  it('rejects a malformed decisions file', async () => {
    await writeFile(decisions, '{"g9": {}}');
    await expect(runMigration({ xlsx, decisions, out, repoRoot, log: quiet })).rejects.toThrow(/cell address/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npx vitest run src/migration/cli.test.ts
```
Expected: FAIL, cannot find module './cli'.

- [ ] **Step 3: Create `src/migration/cli.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SEED } from '../model/seed';
import { buildSessions } from './build';
import { parseDecisions } from './decisions';
import { readWorkbook } from './grid';
import { isInside, toFiles, validateAll, writeOutput } from './output';
import { renderReport, renderReview } from './review';
import { splitRows } from './rows';
import { MIGRATION_STAMP, SHEET_YEAR } from './sheet';

export interface MigrationArgs {
  xlsx: string;
  decisions: string;
  out: string;
  repoRoot: string;
  log?: (line: string) => void;
}

/** Exit codes: 0 final, 1 review items open (files written), 2 usage, 3 validation failed (nothing written). */
export const EXIT = { final: 0, open: 1, usage: 2, invalid: 3 } as const;

/** The whole pipeline of spec 2 §3, from workbook to output folder. */
export async function runMigration(args: MigrationArgs): Promise<number> {
  const log = args.log ?? ((line: string): void => console.log(line));
  const out = path.resolve(args.out);
  if (isInside(out, args.repoRoot)) {
    log(`refusing --out ${out}: it is inside the repository, and training data never goes into git`);
    return EXIT.usage;
  }
  const grid = await readWorkbook(args.xlsx);
  const decisions = parseDecisions(await readFile(args.decisions, 'utf8'));
  const result = buildSessions(splitRows(grid), decisions, SEED, { year: SHEET_YEAR, stamp: MIGRATION_STAMP, bodyweightKg: args.bodyweightKg });
  const issues = validateAll(result);
  if (issues.length > 0) {
    log('validation failed, nothing written (this is a bug in the migration, not a review item):');
    for (const i of issues) log(`  ${i.level} ${i.path}: ${i.message}`);
    return EXIT.invalid;
  }
  const final = result.review.length === 0;
  const files = [
    ...toFiles(result),
    { path: 'review.md', content: renderReview(result.review) },
    { path: 'report.md', content: renderReport(result, { final, xlsx: path.basename(args.xlsx), decisionCount: Object.keys(decisions).length }) },
  ];
  await writeOutput(out, files);
  log(`${result.sessions.length} sessions, ${result.review.length} open review item(s) → ${out} (${final ? 'FINAL' : 'NOT FINAL'})`);
  return final ? EXIT.final : EXIT.open;
}
```

- [ ] **Step 4: Create `scripts/migrate-xlsx.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, runMigration } from '../src/migration/cli';

const { values } = parseArgs({
  options: { xlsx: { type: 'string' }, decisions: { type: 'string' }, out: { type: 'string' } },
  strict: true,
});

if (values.xlsx === undefined || values.decisions === undefined || values.out === undefined) {
  console.error('usage: npm run migrate -- --xlsx <workbook.xlsx> --decisions <decisions.json> --out <directory outside the repo>');
  process.exitCode = EXIT.usage;
} else {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  runMigration({ xlsx: values.xlsx, decisions: values.decisions, out: values.out, repoRoot }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = EXIT.usage;
    },
  );
}
```

- [ ] **Step 5: Add the npm script**

In `package.json`, under `"scripts"`, add after `emit-schema`:
```json
    "migrate": "tsx scripts/migrate-xlsx.ts"
```

- [ ] **Step 6: Run the tests, the typecheck and a usage check**

```powershell
npx vitest run src/migration/cli.test.ts
npm run typecheck
npm run migrate
```
Expected: tests PASS; tsc clean; the last command prints the usage line and exits with code 2 (`$LASTEXITCODE` in PowerShell).

- [ ] **Step 7: Run the whole suite**

```powershell
npm test
```
Expected: every test file passes (spec 1's 219 tests plus the migration tests).

- [ ] **Step 8: Commit**

```powershell
git add src/migration/cli.ts src/migration/cli.test.ts scripts/migrate-xlsx.ts package.json
git commit -m "Add the migrate CLI and an end-to-end run against a synthetic workbook" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Documentation, push, pull request

**Files:**
- Modify: `docs/HANDOVER.md`, `CLAUDE.md`

- [ ] **Step 1: Mark HANDOVER §5 and §6 as answered**

In `docs/HANDOVER.md`, directly under the heading `## 5. Migrating the XLSX`, insert:

```markdown
> **Superseded.** The migration is specified in [superpowers/specs/2026-10-07-xlsx-migration-design.md](superpowers/specs/2026-10-07-xlsx-migration-design.md) (spec 2) and implemented under `src/migration/`. This section is kept for history; where it disagrees with spec 2, spec 2 wins.
```

Directly under `## 6. Open questions for the owner`, insert:

```markdown
> Questions 1–3 are answered in spec 2 §2 (decisions M1–M16); 5 and 6 were answered in spec 1 (D10, D11). Question 4 (hosting) is open for spec 3.
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the `**Status:**` line with:
```markdown
**Status:** spec 1 (data model) and spec 2 (XLSX migration script) implemented as tested TypeScript under `src/model/` and `src/migration/`. The migration has not yet been run to FINAL against the real workbook. No UI, no sync yet.
```

In "Read first", add after the spec 1 bullet:
```markdown
- [docs/superpowers/specs/2026-10-07-xlsx-migration-design.md](docs/superpowers/specs/2026-10-07-xlsx-migration-design.md): **spec 2, the XLSX migration.** Cell grammar, exercise aliases, date rules, the review list and the decisions file. It also amended the seed catalog (rings, bands).
```

In "Repo layout", add:
```markdown
- `src/migration/`: the XLSX migration (spec 2). `grid.ts` reads the workbook (exceljs), `rows.ts` splits column blocks and Extra sessions, `tokenize.ts` + `parse-line.ts` + `parse-cell.ts` are the cell grammar, `exercises.ts`/`phrases.ts` the alias and phrase tables, `dates.ts` the date rules, `decisions.ts` the decisions file, `build.ts` assembles sessions and review items, `review.ts`/`output.ts` render and write, `cli.ts` runs it all. Tests sit next to the code.
- `scripts/migrate-xlsx.ts`: the CLI entry for `npm run migrate`.
```

In "Commands", add:
```markdown
- `npm run migrate -- --xlsx <workbook> --decisions <decisions.json> --out <dir>`: the migration. All three paths live **outside** the repo (`--out` inside it is refused). Exit 0 = FINAL, 1 = review items open (files still written), 2 = usage, 3 = validation failed (nothing written).
```

In "Never commit", extend the sentence to:
```markdown
Training data, the XLSX (`*.xlsx` is gitignored), the migration's `decisions.json` and its output folder (`migration-out/`, both gitignored), Dropbox tokens, `.env` files, or any local data folder. Fixtures are synthetic. The repo may become public (GitHub Pages).
```

In "Planned stack", replace `Migration script (spec 2) in Node or Python.` with `Migration script (spec 2): TypeScript in this repo, calling `validateFile` directly.`

- [ ] **Step 3: Typecheck, test, commit**

```powershell
npm run typecheck
npm test
git add docs/HANDOVER.md CLAUDE.md
git commit -m "Document the migration in CLAUDE.md and mark HANDOVER sections as answered" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push and open the pull request**

The owner merges PRs himself and cleans up branches; never merge locally.

```powershell
git push -u origin spec/xlsx-migration
gh pr create --base main --head spec/xlsx-migration --title "Spec 2: XLSX migration" --body-file -
```
PR body (paste on stdin):
```markdown
## Summary
- Spec 2 (XLSX migration) and its implementation plan
- `src/migration/`: grid reader (exceljs), row splitting, cell grammar, exercise aliases, date rules, decisions file, session builder, review/report renderers, output with validation gate, CLI (`npm run migrate`)
- Seed amendment (spec 2 §6): Australian pull-ups on rings, face pulls / curls / triceps pulldowns on bands, no ring dips; spec 1 §5 table updated
- Docs: CLAUDE.md, HANDOVER §5/§6

## Verification
- `npm test` and `npm run typecheck` clean
- The grammar was prototyped against the real workbook during planning: 147 sessions, 1737 sets, every file valid, 25 review items as predicted

## Next
Run the migration against the real workbook (outside git) and work through `review.md` with the owner.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Spec coverage checklist (self-review)

| Spec 2 section | Task |
|---|---|
| §3 architecture, Grid, CLI, determinism, exceljs | 1, 13 |
| §4 column blocks, label, Extra column | 9, 11 |
| §4 cells to blocks, block order | 7, 11 |
| §4 dates, repairs, out-of-order, undated proposals, unreadable | 8, 11 |
| §5 tokens, set rules, load type, failure | 5, 6, 11 |
| §6 aliases, header fallback, refinements, seed amendment, catalog = seed | 3, 4, 11 |
| §7 tags, cues, notes, session notes | 6, 7, 11 |
| §8 ids, stamp, bodyweight, output layout, validation gate, managed paths | 2, 11, 12 |
| §9 review kinds, decisions vocabulary, stale decisions, report | 10, 11, 12 |
| §10 tests | every task |
| §11 deliverables 1–5 | 1–14; deliverable 6 (first real run) is done with the owner after the merge |

Review Focus items: 1 → Task 11 "a text decision is parsed like a cell"; 2 → Task 1 "takes the calendar day from the UTC fields"; 3 → Task 12 "two sessions on one date get two files"; 4 → Task 11 "a decision that changes nothing is stale"; 5 → Task 12 "clears only the managed paths" and Task 13 "refuses an output directory inside the repository".
