# Spec 2: XLSX migration

- **Date:** 2026-10-07
- **Status:** approved 2026-10-07; amended 2026-10-07 after implementation review
- **Scope:** a one-off, deterministic script that turns the single-sheet workbook `Calisthenics_Tracker_2026.xlsx` into spec 1 files (session files, catalog, bodyweight), a review list for everything it cannot decide, and the small decisions file the owner answers it with. This spec covers **no upload to Dropbox, no UI and no sync**; the output is a local folder in the Dropbox layout of spec 1 §4.

Builds on [spec 1](2026-10-06-data-model-design.md) (the target format; its hard rules win over anything here) and answers HANDOVER.md §5 and §6. Where HANDOVER.md disagrees with this spec, this spec wins.

---

## 1. Purpose and success

The sheet is one tab, "Calisthenics Plan", with three side-by-side blocks (Pull `A–D`, Push `F–J` where `J` is "Extra", Legs `L–O`), headers in row 2 and one row per training day from row 3. Every exercise cell is free text that mixes load, reps, set counts, rest, equipment, context and the exercise itself, in at least seven notations (HANDOVER §5, tracker-options §2).

The migration is **done** when the owner has worked through the review list, the script exits with no open items, and the resulting folder passes `validateFile` and `checkCatalogRules` for every file. From then on the folder is the history, the XLSX is an archive, and the script is kept only for its tests, which document the notations.

Two rules carry over from spec 1 and HANDOVER §5 and are not negotiable:

- **Nothing ambiguous is guessed silently.** Every doubtful cell is a review item with a proposal; the owner decides.
- **No training data in git.** The XLSX, the decisions file and the output folder stay outside the repository. Fixtures are synthetic (dates in 2030, made-up numbers).

## 2. Decisions recorded (2026-10-07)

the owner's answers to the open questions of HANDOVER §6 and spec 1 §10, given while grounding this spec in the real cells.

| # | Question | Answer |
|---|---|---|
| M1 | `N down` | A ladder N, N−1, … 1. A written-out list (`Downs 15x 14x … 4x 10x`) is taken literally, finisher included. |
| M2 | `Rings Downs 12x Start with 1m Rest`, `Rings 20x 18x` and `Ring deficit pushups 12 down` (dips column) | All **ring deficit push-ups**, done when no dip bars were available. Dips were always on bars; `Dips (Rings)` leaves the seed. `Start with 1m Rest` means 60 s rest on every set. |
| M3 | G9 `6,5kg 13,2x 11,2x` | Dips with an 6.5 kg backpack, `13x 13x 11x 11x`. A one-off notation; handled by a decision, not a rule. |
| M4 | M16 `20x 2 mit 15,4 kg (R 1x 15)` | Only `20x 2 mit 15,4 kg` counts; the parenthesis is ignored (D17: no per-side values). Per-side exercises are always logged with the reps of both sides. |
| M5 | Face pulls, bicep curls, triceps pulldowns, lateral raises | Always **bands** (nominal kg printed on the band), except C9 `SZ Hantel` (EZ bar, external) and D9 `Maschine` (cable machine, external), both on one gym day. D41 `10Kg 25x 25x 25x 25x` is a 10 kg band. |
| M6 | Lateral raises without a kg (M33, O37) | 10 kg band. the owner stopped writing the load down. |
| M7 | Australian pull-ups | Always on **rings**, kg = backpack on the chest (`added`). B29 `Aust Pullups Stange` is the one bar day and gets its own catalog entry. |
| M8 | `<reps>x <sets>` | `20x 3`, `12 x 3`, `25x2`, `15x 4`, `10x 7 every 2 minutes` are *sets of reps*. H38 `Diamonds 4x 20` is the one exception (4 sets of 20) and is handled by a decision. |
| M9 | M6 `Bands 50kg 20x 60kg 15x x2` | Three sets: 20 @ 50, 15 @ 60, 15 @ 60. |
| M10 | J30 `Pullups 2x die 5er Pyramide`, J31 `Pullups 5er Pyramide` | Expand to `1 2 3 4 5 4 3 2 1`, two blocks for J30, one for J31. |
| M11 | G29 `Dips Downs 12x Start with 1m Rest / plus 8x 3` | The three eights are the tail of the same block. `dann …` after a pyramid is a second block (spec 1 D1). |
| M12 | B40 `Jump Squats 12x 4`, D40 `Calve Raises 25x 3` (pull-day row, no kg) | Bodyweight. |
| M13 | `(schräger)`, `flacher` | Block notes. No extra catalog entries for the bar angle. |
| M14 | Original wording | Kept: the session `notes` holds the raw row text. |
| M15 | Bodyweight | One `bodyweight.json` entry at the earliest session date, marked as an estimate; the kg comes from the `--bodyweight` option (spec 3 §10), never from the repo. |
| M16 | Review loop | A decisions file next to the XLSX (§9), not edits to the XLSX and not interactive prompts. |

## 3. Architecture

A pure library under `src/migration/` and a thin CLI in `scripts/migrate-xlsx.ts`, the pattern of `scripts/emit-schema.ts`. The library does no I/O except in the two edge functions, so every stage is unit-tested on synthetic grids.

```
readWorkbook(path)                exceljs → Grid                      (input I/O)
splitRows(grid)                   Grid → SourceRow[]                  (§4)
parseCell(text, header)           line grammar → ParsedBlock[]        (§5)
buildSessions(rows, decisions, seed)
                                  → { sessions, catalog, bodyweight, review, report }   (§4–§7)
validateAll(result)               validateForWrite + checkCatalogRules + id uniqueness   (§8)
writeOutput(dir, result)          files, review.md, report.md         (output I/O)
```

**Grid.** `Map<CellAddress, { kind: 'text' | 'date'; value: string }>` where a date cell's value is `YYYY-MM-DD` (exceljs returns a `Date` at UTC midnight for date-formatted cells; the calendar day is taken from the UTC fields). Rich-text cells are flattened to their text. Formulas do not occur; if one does, its cached result is used.

**CLI.** `npm run migrate -- --xlsx <path> --decisions <path> --out <dir>`. All three are required and have no defaults. A missing, mistyped or malformed option exits 2 with the usage line. `--out` inside the repository is refused, and so is an `--out` whose `sessions/` holds any file the migration did not write (not a `.json` file holding `{ session: { source: 'migrated' } }`): both exit 2 before anything is read or deleted, because the run replaces `sessions/` wholesale (§8). Exit code 0 only when the review list is empty (§9); otherwise the files are still written and the report is headed **NOT FINAL**.

**Determinism.** Same inputs → byte-identical output (§8). This is what makes the review loop usable: after one decision, the diff shows exactly that decision's effect.

**Reader library.** `exceljs` (devDependency). It is maintained on npm, MIT-licensed, returns real `Date` objects for date cells and reads rich text. The npm package `xlsx` (SheetJS) is frozen at 0.18.5 from 2022 with open security advisories; SheetJS's current builds are not on npm. Python was rejected because the hard rules of spec 1 live in `src/model/validate.ts`, and a TypeScript script calls them directly instead of reimplementing them (CLAUDE.md "Planned stack").

## 4. From grid to sessions (structure rules)

**Column blocks.** Pull: date `A`, exercises `B C D`, label `pull`. Push: date `F`, exercises `G H I`, Extra `J`, label `push`. Legs: date `L`, exercises `M N O`, label `legs`. Data rows run from 3 to the last row with any content. A row in a column block becomes one session if its date cell or any exercise cell is non-empty (for Push, a J cell counts only when it has no leading date; see below). A row with a date and no cells is an empty session and a review item (`empty-row`). Any non-empty cell from row 3 down outside columns `A–D`, `F–J`, `L–O` is not migrated; it is a review item (`outside-blocks`, proposal: ignored; answer `accept`).

**Label.** The column block's label, even when the row contains other patterns (row 40's jump squats on a pull day). Spec 1 D4: the label is display only; the day-list filter uses each block's exercise pattern. Extra-column sessions (below) get `other`.

**Extra column `J`.** If the cell's first token is a date (`12.06.2026 Pullups …`, `09.07. 100x Dipbar Knee Raises`) the cell is its own session with that date and label `other`. Otherwise (`Lat Raise Bands 10kg 22x 22x`, `Overhead Press Bands …`) its blocks join the row's push session, after the `I` block. Header `Extra` is never an exercise fallback: a J line without an exercise alias is a review item (`unknown-exercise`). A J cell holding only a date is an empty Extra session with review item `empty-row`. A `skip` decision on a dated J cell drops that Extra session entirely (no file; report entry), and its date plays no part in the bodyweight date.

**Cells to blocks.** Each non-empty line of a cell is parsed on its own (§5). A line that names an exercise uses it; a line without one falls back to the column header, **except** when the previous line of the same cell named an exercise and produced no sets: then the line continues that exercise (`Overhead Press Bands` followed by `10kg 15x 15x easy`). A line with neither numbers nor an exercise alias is note text for the preceding block of that cell (`nach Essen, voller Bauch`: tag plus note, §7). `dann …` opens a second block of the same exercise; `plus …` continues the current block; `nichts` yields nothing.

**Block order.** Column order (`B`, `C`, `D`; `G`, `H`, `I`, `J`), then line order within a cell. A block whose line contains the phrase `vor den Australians` is moved to the front of the session (only pull-up blocks in C27–C29 carry it). `order` is then assigned 0, 1, 2, …; sets likewise within the block.

**Dates.** A date cell of kind `date` is taken as-is. A text date accepts `d.m.yy`, `d.m.yyyy`, `.` or `,` as separator, repeated separators, surrounding spaces, and a missing year, which is completed with the sheet's year (2026, the only year in the file; it is a constant in the script, not detected). Two-digit years are `20yy`. Each such repair is a **report** entry, because the result is unambiguous. A three-digit year (`27.04.206`) is repaired by inserting the missing digit of the sheet year, but the result is a **review item** (`date-repaired-doubtful`) with `dateUncertain: true`. Any other text in a date cell is a review item (`date-unreadable`); the session is then treated as undated so it still has a file: above the first dated row it takes the rows-3–5 proposal below, elsewhere the undated rows between two dated rows of its column block are spread evenly between them (the k-th of n undated rows gets `lower + floor(k·gap/(n+1))` days, `gap` being the days between the two dated rows; for a single row this is the midpoint, rounded down), and at the end of the block a row takes the row above plus one day. Both carry `dateUncertain: true`. (Even spreading rather than one shared midpoint: the owner, 2026-10-07.) (No such cell exists in the real file; the rule is here so the script never has an undefined case.)

**Out-of-order and duplicate dates.** Within one column block the dates must increase strictly down the rows. For each violation the script proposes a repair only when a single edit restores the order: a month typo (`05.08` between `31.08` and `08.09` → `05.09`; `24.06` between `20.05` and `28.05`, and a duplicate of a later `24.06` → `24.05`). Where two rows are simply swapped (`06.07` above `03.07`) no proposal is made and both keep their written dates. In every case the session gets `dateUncertain: true` and a review item (`date-out-of-order`); a `dateExact: true` decision removes the flag, a `date` decision replaces the date. A duplicate date within a column block is always an item, even when the order holds.

**Undated rows 3–5.** They are imported (spec 1 §6, §11 point 5). Proposal: let `d1` be the date of the first dated row of the column block and `g` the median gap in days between that block's first four dated sessions (rounded to whole days, at least 1); the k-th undated row above the first dated row gets `d1 − k·g`. With the real file every block has `g = 6`. Each such session has `dateUncertain: true` and a review item (`date-proposed`); `accept: true` keeps the proposal and the flag, a `date` decision sets a confirmed date (no flag, unless the order check still objects to it).

**No merging.** Two sessions on one date (a pull row and an Extra push day, say) stay two sessions with two files. Nothing is merged across rows or blocks.

## 5. Cell grammar

### Tokens

A line is split on whitespace after `,` inside a number becomes `.`, `12,4 kg` is glued to one token, and `Kg`/`kg` are equal. A `,` at the end of a word is dropped (`Burpees,`), and a lone `/` is a separator with no meaning (`20x ohne / 20x mit 12,4kg`). Parentheses are stripped from a token's ends but remembered (`(schräger)` → note `schräger`; a parenthesised group containing a number is a review item, `parenthesised-numbers`).

Multi-word phrases (exercise aliases, the note phrase `ohne Griffe`, the tag and cue phrases of §7, `every N minutes`, `Start with Nm Rest`, `vor den Australians`) are matched before single keywords, longest first, so `ohne Griffe` is a note and never the `ohne` load keyword.

| Token | Pattern | Example |
|---|---|---|
| `LOAD` | number + `kg` | `6kg`, `12.4kg`, `10Kg` |
| `REPS` | number + `x` | `20x`, `16.5x`, `17.2x` |
| `NUM` | bare number | `3` |
| `X` | `x` alone | `x` |
| `REPSxSETS` | number `x` number, no spaces | `25x2` |
| `XSETS` | `x` + number | `x2`, `x3` |
| word | anything else; matched against the exercise aliases (§6), the keywords below and the phrases of §7; otherwise note text | |

Keywords: `mit`, `ohne`, `Bodyweight`, `Bands`, `down`, `Downs`, `dann`, `plus`, `nichts`, `every N minutes`, `Start with Nm Rest`, `Mx die`, `Ner Pyramide`, `Stange`, `SZ Hantel`, `Maschine`.

### Set-building rules

Applied left to right with a *current load* that sticks until the next `LOAD`, and a list of sets built so far on the line.

| Form | Meaning | Example |
|---|---|---|
| `REPS REPS …` | one set each, at the current load | `20x 15x 12x` |
| `REPS NUM`, `NUM X NUM`, `REPSxSETS`, `REPS XSETS` | NUM sets of REPS | `20x 3`, `12 x 3`, `25x2`, `15x x2` |
| `LOAD X NUM [XSETS]` | NUM reps at LOAD, optionally × sets | `25kg x 20 x3` |
| `LOAD` before sets | sets the current load | `17,4kg 30x 28,9kg 30x 20x` |
| `mit LOAD` | load for every earlier set on the line that has none yet | `20 x 3 mit 6kg`, `15x mit 17,4kg 20x mit 12,4kg` |
| `ohne`, `Bodyweight` | the sets without a load so far (`ohne`) or the following sets (`Bodyweight`) are explicitly bodyweight; `mit` no longer touches them | `20x ohne / 20x mit 12,4kg` |
| `Bands` | load type `band` for the line; picks the band variant of the header's family where one exists (§6) | `Bands 50kg 20x 60kg 15x x2` |
| `N down`; `Downs REPS` with no further `REPS` | ladder N, N−1, … 1 | `10 down`, `Rings Downs 15x` |
| `Downs REPS REPS …` | literal list | `Dips Downs 15x 14x … 4x 10x` |
| `Start with Nm Rest`, `every N minutes` | `restSec` = 60·N on every set of the block; the phrase stays in the block note | |
| `dann` | second block, same exercise | `… 2x 5x dann 8x 7x …` |
| `plus` | continues the current block | `plus 10x 3` |
| `Mx die Ner Pyramide`, `Ner Pyramide` | M blocks (default 1) of `1 … N … 1`; review item `pyramid-expanded` | `2x die 5er Pyramide` |
| a number before the exercise alias and nothing else | aggregate: one set with that total and `aggregate: true`; review item `aggregate` | `100 Diamonds`, `100x Dipbar Knee Raises` |
| exercise aliases only, no numbers | one note-only block per alias, `note` = the alias as written; review item `note-only` | `Burpees, Pyramide Pullups` |

Reps are stored as parsed; decimals are allowed (`16.5`); a value ≤ 0 is a review item (`unparsed-line`). A `REPS NUM` form whose set count exceeds the reps is a review item (`sets-exceed-reps`); the sets are still emitted as read.

### Load type per set

From the exercise's `defaultLoadType`:

| Exercise default | kg present | kg absent |
|---|---|---|
| `bodyweight`, `added` | `added`, that kg | `bodyweight`, 0 |
| `external` | `external`, that kg | review item `load-missing`; set emitted as `external` 0 |
| `band` | `band`, that kg | review item `load-missing`; set emitted as `band` 0 |

An explicit `ohne` or `Bodyweight` on a set wins over this table for every exercise kind: the set is `bodyweight` 0 with no item (`20x 2 ohne weil erkältet` on the single-leg RDL means the RDL was done without the dumbbell). `assist` never occurs in the sheet. `loadKg` is rounded to 2 decimals.

### Failure

A line the grammar cannot consume completely is emitted as a **note-only block** whose `note` is the raw line, with review item `unparsed-line`. The output therefore always validates, and the item stays open until a `text` decision rewrites the line. The failing forms:

- an unknown word in a position where a number was expected, or a dangling `mit`;
- a `LOAD` no set uses (`Dips 6kg`, and `25kg Bodyweight 20x`, where `Bodyweight` takes the sets);
- a `mit LOAD` that applies to no set (`20x mit 5kg mit 6kg`);
- `nichts` together with numbers;
- a leftover word containing a digit (`20x/15x`, `12xx`), never kept as a silent note;
- numbers that would pair across an unrecognised word (`10x kurz 5` is not 5 sets of 10).

A line the grammar cannot place is not always a failure: a leading line that is only note text attaches its note to the next block of the cell. In column `J`, a line that cannot be parsed or names no exercise has no header to fall back on: it is dropped, with review item `unknown-exercise` and a "dropped" proposal.

An unknown word in a note position is not a failure: it goes to the block note and is listed in the report under "unrecognised words" so a misspelt exercise name is noticed.

## 6. Exercise detection and the seed

**Detection.** A closed alias table, matched case-insensitively as whole-word phrases anywhere in the line, longest phrase first (`Dipbar Knee Raises` beats `Dips`). No alias → the column header's exercise. Refinements: `Bands` → band variant of the header's family where one exists (Single-leg RDL, Calf Raises); `Stange` → Australian Pull-ups (Bar); `SZ Hantel` → Bicep Curls (EZ Bar); `Maschine` → Face Pulls (Cable). An alias that is not in the table is a review item (`unknown-exercise`) and never creates a catalog entry.

| Alias phrases in the sheet | Exercise id |
|---|---|
| header `Australian Pull Ups`, `Aust Pullups`, `Aus Pullup`, `Australian Pullups`, `Australians` | `australian-pull-ups-rings` |
| `Pullups`, `Pullup`, `Pyramide Pullups` | `pull-ups` |
| `Neg Pullups` | `negative-pull-ups` |
| header `Bicep Curls` | `bicep-curls-band` |
| header `Face Pulls`, `Facepull` | `face-pulls-band` |
| header `Dips`, `Dips`, `Dips Downs` | `dips-bar` |
| `Rings`, `Rings Downs`, `Ring deficit pushups` | `ring-deficit-push-ups` |
| header `Push Ups` | `push-ups` |
| `Diamond`, `Diamonds` | `diamond-push-ups` |
| header `Triceps Pulldowns` | `triceps-pulldowns-band` |
| `Overhead Press Bands` | `overhead-press-band` |
| `Lat Raise Bands`, `Lateral raises` | `lateral-raises-band` |
| header `Single Leg RDL` (+ `Bands`) | `single-leg-rdl` / `single-leg-rdl-band` |
| header `Split Squats` | `split-squats` |
| `normal Squats` | `squats` |
| `Jump Squats` | `jump-squats` |
| header `Calf Raises`, `Calve Raises` (+ `Bands`) | `calf-raises` / `calf-raises-band` |
| `Knee Raises`, `Dipbar Knee Raises` | `knee-raises-dip-bar` |
| `Burpees` | `burpees` |

**Seed amendment.** Spec 1's seed table was derived from the sheet under assumptions M2, M5 and M7 now show to be wrong. Nothing is deployed, so the seed is edited in place; spec 1 §5 gets the corrected table and a note pointing here. New entries carry `updatedAt: 2026-10-07T00:00:00.000Z`.

| Change | Entries |
|---|---|
| Add | `australian-pull-ups-rings` (Australian Pull-ups (Rings), family Australian Pull-ups, pull, `added`, cues "clean elbows, slow, full extension"); `face-pulls-band` (Face Pulls (Band), pull, `band`); `bicep-curls-band` (Bicep Curls (Band), pull, `band`); `triceps-pulldowns-band` (Triceps Pulldowns (Band), push, `band`) |
| Keep | `australian-pull-ups-bar` (B29 only), `face-pulls-cable` (D9 only), `bicep-curls-ez-bar` (C9 only), and every other entry |
| Remove | `bicep-curls-cable`, `triceps-pulldowns-cable`, `lateral-raises`, `dips-rings` |

The seed stays at 24 entries. `exercises.json` in the output **is the seed**, unchanged: the migration adds nothing. A test asserts that every alias target and every header fallback is a seed id.

## 7. Tags, cues, notes

| Text | Destination |
|---|---|
| `erkältet`, `weil erkältet` | session tag `sick`; words dropped from the block |
| `nach Frühstück`, `nach Essen` | session tag `after-meal`; words dropped |
| `sauber (Ellbogen)`, `langsam`, `gestreckt` | dropped; they are the standing cues of Australian Pull-ups (Rings), stored once in the seed (`cues`); each occurrence is a report entry |
| `vor den Australians` | block order (§4); dropped |
| every other leftover word | block `note`, original spelling and order (`schräger`, `Deeep`, `kurze Pause`, `Griffe`, `ohne Griffe`, `easy`, `Start with 1m Rest`, `every 2 minutes`) |

Session `notes` = the raw row: one line per non-empty cell of the row, `<header>: <cell text>`, with the cell's own newlines kept (CRLF and CR normalised to LF), in column order. A J cell with a leading date belongs to its own Extra session, whose `notes` is that cell alone; it does not appear in the push row's `notes`. Decisions (`text`) do not change `notes`: it always holds what the sheet says. Tags are sorted and deduplicated.

## 8. Ids, timestamps, output, validation

**Ids.** UUID v5 (RFC 4122, SHA-1) over a fixed namespace with these names: session `session/<block>!<row>` (`session/J30` for an Extra session), block `<session name>/block/<index>`, set `<block name>/set/<index>`, bodyweight entry `bodyweight/initial`. v5 ids are lowercase and match the schema's uuid pattern. A rerun reproduces every id; rewriting one cell changes only that session's content. Node has no built-in v5, so `src/migration/ids.ts` implements it over `node:crypto` and is tested against a published v5 vector.

**Timestamps.** Every record's `updatedAt` is `MIGRATION_STAMP = '2026-10-07T00:00:00.000Z'`. No `startedAt`, `completedAt` or `deletedAt`. The stamp predates any edit the owner makes in the app, so the spec 3 merge can never let a rerun of the migration overwrite an app-side change (the same argument spec 1 §5 makes for seed stamps). Catalog entries keep their seed stamps.

**Session fields.** `source: 'migrated'`; `label` per §4; `tags` per §7; `dateUncertain: true` per §4; `notes` per §7; blocks and sets with `order` 0, 1, 2 … in the order of §4; `restSec` and `aggregate` per §5; `loadKg` rounded to 2 decimals; `reps` as parsed.

**Bodyweight.** One entry: `kg` = the `--bodyweight` value, `date` = the earliest session date in the output (a proposed one, usually), `note: "estimated, constant <kg> kg through 2026 (migration)"`.

**Output layout** (spec 1 §4): `<out>/exercises.json`, `<out>/bodyweight.json`, `<out>/sessions/2026/<YYYY-MM-DD>_<id8>.json`, `<out>/review.md`, `<out>/report.md`. JSON is written with 2-space indentation, a trailing newline and keys in schema order. Before writing, the script removes exactly `exercises.json`, `bodyweight.json`, `sessions/`, `review.md` and `report.md` from `<out>` (nothing else), so a cell that stops producing a session leaves no orphan file.

**Validation gate.** `validateForWrite` on every file, `checkCatalogRules` on every session against the emitted catalog, and uniqueness of session ids across files. Any failure aborts the run with the issue list and writes nothing. By construction none should occur; a failure here is a bug in the migration and never a review item.

**Dropbox** is out of scope. When spec 3 exists, the owner copies `<out>` into the App folder (or spec 3 provides an import); the layout is already the one the app reads.

## 9. Review list, decisions, report

### Review list (`review.md`)

Sorted by column block and row. Each item: kind, cell address (and line index for multi-line cells), the session's date, the raw text, what the script did meanwhile (the proposal), and a ready-to-paste decision skeleton.

| Kind | Raised by |
|---|---|
| `date-proposed` | undated row (§4) |
| `date-repaired-doubtful` | three-digit year (§4) |
| `date-unreadable` | date text no rule accepts |
| `date-out-of-order` | order or duplicate violation (§4) |
| `empty-row` | date without any cell |
| `unparsed-line` | grammar failure, reps ≤ 0 |
| `unknown-exercise` | alias missing, or a J line without alias |
| `load-missing` | external/band exercise without kg |
| `sets-exceed-reps` | `REPS NUM` with NUM > REPS |
| `parenthesised-numbers` | `(R 1x 15)` |
| `aggregate`, `note-only`, `pyramid-expanded` | spec 1 §6 reconstructions |
| `outside-blocks` | a non-empty cell outside the column blocks (§4); proposal: ignored |
| `stale-decision` | a decision with a field that has no effect (below) |

Expected from the real file (confirmed by a prototype run while planning): 8 undated rows, 5 doubtful or out-of-order dates, 3 missing band loads (M33, O37 and C50 `10 down`, which the header fallback reads as curls), H38, M16, two aggregates, two note-only blocks, two pyramid expansions: 25 items. G9 raises none (13.2 reps is a legal value) and is answered by the prepared decision. The guards above (`outside-blocks`, the `J` cell rules of §4, the newer `unparsed-line` forms of §5, per-field stale decisions) were added after the prototype run, so the real run may raise more than these 25 items.

### Decisions file (`decisions.json`)

Lives next to the XLSX, never in git. A leading UTF-8 byte order mark is accepted. Keys are cell addresses, optionally with a 1-based line index for multi-line cells (`"M27#3"`). Values:

| Field | Effect |
|---|---|
| `text` | replaces the cell (or the line) before parsing |
| `date` | replaces the row's date (`YYYY-MM-DD`); also valid for an Extra cell. A decided date counts as exact: it takes part in the order check like any written date and carries no flag unless that check objects. Confirming a repaired or doubtful date with the same value counts as used, not stale |
| `dateExact: true` | keeps the written (or proposed) date, removes `dateUncertain` from the session and closes the row's date items |
| `accept: true` | closes the cell's items without changing the result |
| `skip: true` | drops the cell or line; report entry. On a dated J cell it drops the Extra session (§4) |
| `why` | free text, copied into the report |

Example, with the answers of §2 that the first version of the file will contain:

```json
{
  "G9":  { "text": "6,5kg 13x 13x 11x 11x", "why": "13,2x meant 13 twice (M3)" },
  "M16": { "text": "20x 2 mit 15,4 kg", "why": "(R 1x 15) ignored (M4)" },
  "H38": { "text": "Diamonds 20x 20x 20x 20x", "why": "4x 20 = 4 sets of 20 (M8)" },
  "M33": { "text": "Lateral raises 10kg 25x 25x 24x 20x", "why": "band load not written (M6)" },
  "O37#2": { "text": "Lateral Raises 10kg 25x 25x 25x 25x", "why": "same (M6); line 2 of the cell" },
  "A49": { "date": "2026-09-05" },
  "A34": { "dateExact": true },
  "A3":  { "accept": true }
}
```

A decision that changes nothing is itself a review item (`stale-decision`), so the file cannot rot unnoticed. Staleness is checked per field: every present field among `text`, `date`, `dateExact`, `accept` and `skip` that has no effect is listed, even when another field of the same decision is used.

### Report (`report.md`)

Headed **FINAL** or **NOT FINAL**. Lists every repair and every dropped phrase with its cell; every applied decision with the fields that took effect (and its `why`, if given); unrecognised words that went into notes; counts (sessions, blocks, sets per label; review items by kind); the catalog used. It is regenerated every run.

## 10. Testing

Vitest, tests next to the code, all fixtures synthetic (dates in 2030, invented numbers, written in the sheet's notation style).

- **Tokenizer and grammar:** one test per row of the §5 tables; the inconsistent forms (`25x2`, `x2`, `25kg x 20 x3`, `mit` after several groups, `ohne / mit`); decimals, `Kg`, double spaces, leading space; each review trigger; each load-type row of §5.
- **Exercise detection:** every alias row, header fallback, the four refinements, longest-phrase-first, unknown alias → item.
- **Rows:** three column blocks; Extra cells with and without a leading date; a row with a date and no cells; an exercise cell without a date; the last row.
- **Dates:** every accepted text form and its repair; three-digit year; out-of-order with and without a single-edit proposal; duplicates; the rows-3–5 proposal on a synthetic block with a known median gap.
- **Sessions:** multi-line cells (fallback, continuation, `dann`, `plus`, `vor den …`); tags and cue dropping; block and set `order`; `restSec`; aggregate; note-only; pyramid expansion; every decision field including a stale one; determinism (two runs deep-equal); the stamp.
- **End to end:** a synthetic workbook written with exceljs in a temp directory → `readWorkbook` → pipeline → every file passes `validateFile` and `checkCatalogRules`; review and report as expected; `--out` inside the repo refused; the output directory cleanup removes only the listed paths.
- **Seed:** existing seed tests pass with the amended seed; every alias target and header fallback is a seed id.

## 11. Deliverables

1. `src/migration/`: `grid.ts` (Grid types, `readWorkbook`), `rows.ts`, `dates.ts`, `tokenize.ts`, `parse-cell.ts`, `exercises.ts` (aliases, refinements), `phrases.ts` (tags, cues, keywords), `decisions.ts`, `build.ts`, `ids.ts`, `output.ts`, `review.ts`, with tests.
2. `scripts/migrate-xlsx.ts`, the `npm run migrate` script, `exceljs` as devDependency.
3. The seed amendment in `src/model/seed-exercises.json`; spec 1 §5's table updated with a note that spec 2 revised it.
4. Docs: HANDOVER §5/§6 marked as answered here; CLAUDE.md gets the migrate command, the rule that the decisions file and the output live outside the repo, and the new status.
5. `.gitignore`: `decisions.json`, `*.decisions.json`, `migration-out/`.
6. The first `decisions.json` (outside git) from §2, and the first run against the real file, after which the owner and Claude work through `review.md` together.

## 12. Out of scope

Uploading to Dropbox; a UI for the review list; any workbook other than this one; bodyweight beyond the single entry; parsing notations that do not occur in the sheet.
