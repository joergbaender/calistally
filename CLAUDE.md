# CalisTally

A calisthenics training tracker built as a static PWA. It reads and writes JSON data files in the user's Dropbox through the Dropbox API (App folder, OAuth 2 PKCE). There is no backend and no paid infrastructure. It replaces a free-text XLSX log.

**Status:** spec 1 (data model) and spec 2 (XLSX migration script) implemented as tested TypeScript under `src/model/` and `src/migration/`. The migration has not yet been run to FINAL against the real workbook. No UI, no sync yet.

## Read first

- [docs/superpowers/specs/2026-10-06-data-model-design.md](docs/superpowers/specs/2026-10-06-data-model-design.md): **spec 1, the data model.** Source of truth for the entities, validation, versioning, file layout and derived-value rules. Where HANDOVER.md disagrees, the spec wins.
- [docs/superpowers/specs/2026-10-07-xlsx-migration-design.md](docs/superpowers/specs/2026-10-07-xlsx-migration-design.md): **spec 2, the XLSX migration.** Cell grammar, exercise aliases, date rules, the review list and the decisions file. It also amended the seed catalog (rings, bands).
- [docs/HANDOVER.md](docs/HANDOVER.md): the original brief. §3 (draft data model) is superseded by spec 1; the rest (goals, XLSX migration notes, open questions) still applies.
- [docs/tracker-options.md](docs/tracker-options.md): the option analysis behind the chosen architecture, and what's wrong with the XLSX data. (HANDOVER.md calls it `analysis/tracker-options.md`; in this repo it lives in `docs/`.)

## Core rules (from spec 1, do not drift)

- **Session → Block → Set. One record per set.** Day views, totals, indicators and charts are derived and never stored. The block's sets *are* the pattern; there is no SetGroup.
- Session `label` is display only. It never filters and never constrains which exercises can be logged. The day-list filter uses each block's exercise `pattern`.
- Reps may be decimal and must be > 0. No RPE/RIR, no `side` field, no stored rest for live sets.
- Bodyweight is its own time series. Bodyweight factors / effective load are out of v1 and, when added (v1.1), are always labelled estimates (D11).
- Exercises come from a catalog. `metric` and `perSide` are immutable after creation. Exercises with history are archived, never deleted.
- Every record has `updatedAt` (its own fields only, not children) and an optional `deletedAt` tombstone. Deleting marks, never removes. Timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ`.
- `order` is a sort key only (any finite number); the canonical order is in `src/model/derive/order.ts`.
- Every file carries `schemaVersion`; `MODEL_VERSION` lives in `src/model/schema.ts`. Any shape change, including a new optional field, bumps it and adds an upgrade step for every file kind in `src/model/upgrade.ts` (a no-op where that kind is unchanged). A too-new file is read leniently and never written.
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
- `src/migration/`: the XLSX migration (spec 2). `grid.ts` reads the workbook (exceljs), `rows.ts` splits column blocks and Extra sessions, `tokenize.ts` + `parse-line.ts` + `parse-cell.ts` are the cell grammar, `exercises.ts`/`phrases.ts` the alias and phrase tables, `dates.ts` the date rules, `decisions.ts` the decisions file, `build.ts` assembles sessions and review items, `review.ts`/`output.ts` render and write, `cli.ts` runs it all. Tests sit next to the code.
- `scripts/migrate-xlsx.ts`: the CLI entry for `npm run migrate`.
- `docs/superpowers/specs/`, `docs/superpowers/plans/`: specs and implementation plans.

## Commands

- `npm install`
- `npm test` (Vitest, single run), `npm run test:watch`
- `npm run typecheck` (tsc, strict)
- `npm run emit-schema` (writes `schema/*.schema.json`)
- `npm run migrate -- --xlsx <workbook> --decisions <decisions.json> --out <dir>`: the migration. All three paths live **outside** the repo (`--out` inside it is refused). Exit 0 = FINAL, 1 = review items open (files still written), 2 = usage, 3 = validation failed (nothing written).

## Never commit

Training data, the XLSX (`*.xlsx` is gitignored), the migration's `decisions.json` and its output folder (`migration-out/`, both gitignored), Dropbox tokens, `.env` files, or any local data folder. Fixtures are synthetic. The repo may become public (GitHub Pages).

## Planned stack

Vite + TypeScript PWA (chart library not chosen yet). Hosting: GitHub Pages or Cloudflare Pages (open question, spec 3). Migration script (spec 2): TypeScript in this repo, calling `validateFile` directly. `schema/*.schema.json` is necessary but not sufficient: the hard rules (real calendar dates and timestamps, unique ids, load rules and so on) are deliberately not in the JSON Schema (D13), so every migrated file must also pass `validateFile` (or a faithful reimplementation of the hard rules in `src/model/validate.ts`). Timestamps are exactly `YYYY-MM-DDTHH:mm:ss.sssZ` (milliseconds, `Z`); uuids are lowercase.

## To fill in later

- Dropbox app name, redirect URIs (prod + `http://localhost:<port>`): spec 3.
- Sync and merge-conflict tests come first: spec 3.
- Lint/format tooling (none yet).
