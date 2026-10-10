# CalisTally

A calisthenics training tracker built as a static PWA. It reads and writes JSON data files in the owner's Dropbox through the Dropbox API (App folder, OAuth 2 PKCE). There is no backend and no paid infrastructure. It replaces a free-text XLSX log.

**Status:** spec 1 (data model), spec 2 (XLSX migration script) and spec 3 (sync and hosting) implemented as tested TypeScript under `src/model/`, `src/migration/`, `src/sync/` and `src/app/`. The real migration run reached FINAL on 2026-10-07; its output sits outside git and is copied into the Dropbox App folder by hand (spec 3 §11). The app is a diagnostic shell (connect, sync status, issues, update) deployed to GitHub Pages. Spec 4 (the training views) is approved; its implementation plans 4a (the gym build: Log, Days, session page, Sync tab replacing the shell) and 4b (More tab) are written with full code on branch `spec/training-views` and not yet implemented.

## Read first

- [docs/superpowers/specs/2026-10-06-data-model-design.md](docs/superpowers/specs/2026-10-06-data-model-design.md): **spec 1, the data model.** Source of truth for the entities, validation, versioning, file layout and derived-value rules. Where HANDOVER.md disagrees, the spec wins.
- [docs/superpowers/specs/2026-10-07-xlsx-migration-design.md](docs/superpowers/specs/2026-10-07-xlsx-migration-design.md): **spec 2, the XLSX migration.** Cell grammar, exercise aliases, date rules, the review list and the decisions file. It also amended the seed catalog (rings, bands).
- [docs/superpowers/specs/2026-10-07-sync-hosting-design.md](docs/superpowers/specs/2026-10-07-sync-hosting-design.md): **spec 3, sync and hosting.** Dropbox login and client, the IndexedDB store and write queue, the merge, the sync engine, the app update, GitHub Pages, and how the repository went public.
- [docs/superpowers/specs/2026-10-10-training-views-design.md](docs/superpowers/specs/2026-10-10-training-views-design.md): **spec 4, the training views.** Live log against a whole reference session, day list, session page, More tab, the Sync tab replacing the shell; Preact 10 with signals, view models tested in Node, happy-dom for the few component tests. Plans: [4a](docs/superpowers/plans/2026-10-10-training-views-4a.md) (gym build) and [4b](docs/superpowers/plans/2026-10-10-training-views-4b.md) (More tab), executed in that order.
- [docs/HANDOVER.md](docs/HANDOVER.md): the original brief. §3 (draft data model) is superseded by spec 1; the rest (goals, XLSX migration notes, open questions) still applies.
- [docs/tracker-options.md](docs/tracker-options.md): the option analysis behind the chosen architecture, and what's wrong with the XLSX data. (HANDOVER.md calls it `analysis/tracker-options.md`; in this repo it lives in `docs/`.)

## Core rules (from specs 1 and 3, do not drift)

- **Session → Block → Set. One record per set.** Day views, totals, indicators and charts are derived and never stored. The block's sets *are* the pattern; there is no SetGroup.
- Session `label` is display only. It never filters and never constrains which exercises can be logged. The day-list filter uses each block's exercise `pattern`.
- Reps may be decimal and must be > 0. No RPE/RIR, no `side` field, no stored rest for live sets.
- Bodyweight is its own time series. Bodyweight factors / effective load are out of v1 and, when added (v1.1), are always labelled estimates (D11).
- Exercises come from a catalog. `metric` and `perSide` are immutable after creation. Exercises with history are archived, never deleted.
- Every record has `updatedAt` (its own fields only, not children) and an optional `deletedAt` tombstone. Deleting marks, never removes. Timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ`.
- `order` is a sort key only (any finite number); the canonical order is in `src/model/derive/order.ts`.
- Every file carries `schemaVersion`; `MODEL_VERSION` lives in `src/model/schema.ts`. Any shape change, including a new optional field, bumps it and adds an upgrade step for every file kind in `src/model/upgrade.ts` (a no-op where that kind is unchanged); a test checks every kind has every step. A too-new file is read leniently and never written.
- Validation has two levels: hard rules (in-file; failure quarantines) and soft catalog rules (failure flags, never quarantines). Validate before every write with `validateForWrite`.
- **All reads and writes go through `src/sync/store.ts`.** Screens never call Dropbox. `writeFile` refuses `read-only`, `needs-update`, `quarantined` and duplicate rows; a write that fails validation stays local and queued (`heldBack`), never reaches Dropbox, and is released when it validates.
- Dropbox writes use `mode: update` + last known `rev` (`add` for a new file), `strict_conflict`, `content_hash`. On a conflict: download, merge per record (`src/sync/merge.ts`: newer `updatedAt` wins, tombstone wins a tie, then canonical JSON; children by `id`), retry. Never produce "conflicted copy" files. Session files never move or get deleted.
- Offline-first: IndexedDB local copy plus a pending-write queue (catalog, bodyweight, then sessions). Only the tab holding the Web Lock `calistally-sync` runs the engine. No Background Sync, no longpoll.
- The app update is prompted, never automatic (`vite-plugin-pwa` in `prompt` mode). Dropbox calls are never cached by the service worker.
- Migration never guesses silently. Anything ambiguous goes on a review list for the owner.
- Nothing in this project touches the owner's Dropbox account or creates the Dropbox app without asking them first.

## Repo layout

- `src/model/schema.ts`: the TypeBox schema, the single source of truth (D14). `types.ts` infers the TS types from it.
- `schema/*.schema.json`: emitted JSON Schema, committed. Regenerate with `npm run emit-schema`; a test fails when it is stale.
- `src/model/validate.ts`, `read.ts`, `upgrade.ts`: validation levels, read pipeline, version steps.
- `src/model/record.ts`, `slug.ts`, `catalog.ts`, `seed.ts`, `seed-exercises.json`: record helpers, ids and names, seed catalog.
- `src/model/derive/`: the pure derived-value functions of spec §7 (order, totals, compare, time, filter).
- `src/model/test-fixtures.ts`: synthetic fixture builders (dates in 2030). Tests sit next to the code as `*.test.ts`.
- `src/migration/`: the XLSX migration (spec 2). `grid.ts` reads the workbook (exceljs), `rows.ts` splits column blocks and Extra sessions, `tokenize.ts` + `parse-line.ts` + `parse-cell.ts` are the cell grammar, `exercises.ts`/`phrases.ts` the alias and phrase tables, `dates.ts` the date rules, `decisions.ts` the decisions file, `build.ts` assembles sessions and review items, `review.ts`/`output.ts` render and write, `cli.ts` runs it all.
- `src/sync/`: the sync layer (spec 3). `dropbox-client.ts` (seven calls over fetch), `auth.ts` (PKCE, tokens), `db.ts` (IndexedDB wrapper), `store.ts` (rows, queue, `writeFile`), `merge.ts`, `paths.ts`, `zip.ts` (first load), `engine.ts` (pull, push, backoff, status), `lock.ts`/`channel.ts` (Web Locks, BroadcastChannel), `fake-dropbox.ts` and `test-fixtures.ts` for tests.
- `src/app/`: the shell (spec 3 §12): `main.ts` wiring, `shell.ts`/`shell.css` the page, `sw-update.ts` the update prompt, `triggers.ts` the browser events, `config.ts` the public app key and URLs.
- `index.html`, `vite.config.ts` (PWA plugin, `base` `/calistally/` for builds), `vitest.config.ts`, `public/` (icons; regenerate PNGs with `npm run make-icons`), `.github/workflows/deploy.yml` (test, typecheck, build, deploy to Pages on push to `main`).
- `scripts/migrate-xlsx.ts`: the CLI entry for `npm run migrate`. `scripts/make-icons.ts`, `scripts/emit-schema.ts`.
- `docs/superpowers/specs/`, `docs/superpowers/plans/`: specs and implementation plans.

## Commands

- `npm install`
- `npm test` (Vitest, single run, Node only: fake-indexeddb, no browser), `npm run test:watch`
- `npm run typecheck` (tsc, strict)
- `npm run dev` (Vite on `http://localhost:5173/`, the registered dev redirect URI), `npm run build` (to `dist/`), `npm run preview`
- `npm run emit-schema` (writes `schema/*.schema.json`), `npm run make-icons` (writes the PNG icons)
- `npm run migrate -- --xlsx <workbook> --decisions <decisions.json> --out <dir> --bodyweight <kg>`: the migration. All three paths live **outside** the repo (`--out` inside it is refused); the bodyweight is never stored in the repo. Exit 0 = FINAL, 1 = review items open (files still written), 2 = usage, 3 = validation failed (nothing written).

## Never commit

Training data, the XLSX (`*.xlsx` is gitignored), the migration's `decisions.json` and its output folder (`migration-out/`, both gitignored), Dropbox tokens, `.env` files, any local data folder, the owner's name, bodyweight or dated training facts. Fixtures are synthetic (dates in 2030). The repo is public (GitHub Pages); the Dropbox app key in `src/app/config.ts` is public by design, there is no secret.

## Stack

Vite + TypeScript PWA (`vite-plugin-pwa`, Workbox precache of the shell only), no UI framework yet: spec 4 chose Preact 10.29 with `@preact/signals` 2 (pinned below 11), TSX through tsconfig and Vite's Oxc, happy-dom and Testing Library for component tests (plan 4a adds them); no chart library (spec 4 U5). Hosting: GitHub Pages at `https://joergbaender.github.io/calistally/`. Dropbox: App-folder app `CalisTally`, scopes `files.metadata.read`, `files.content.read`, `files.content.write`, redirect URIs `https://joergbaender.github.io/calistally/` and `http://localhost:5173/`. Migration script (spec 2): TypeScript in this repo, calling `validateFile` directly. `schema/*.schema.json` is necessary but not sufficient: the hard rules (real calendar dates and timestamps, unique ids, load rules and so on) are deliberately not in the JSON Schema (D13), so every migrated file must also pass `validateFile`. Timestamps are exactly `YYYY-MM-DDTHH:mm:ss.sssZ` (milliseconds, `Z`); uuids are lowercase.

## To fill in later

- Implement spec 4: plan 4a, then plan 4b (whose last task applies the owner's corrections from using 4a).
- CSV export: deferred (spec 4 U10); when wanted, a file handed to the device, never a Dropbox write outside the store.
- Lint/format tooling (none yet).
