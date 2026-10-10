# Spec 4: Training views

- **Date:** 2026-10-10
- **Status:** approved by the owner on 2026-10-10 (design agreed section by section; the owner's decisions are recorded in §2). Amended on 2026-10-10 while plans 4a and 4b were written and reviewed; each amendment is marked in place.
- **Scope:** every screen of the app: the live log, the day list and session page, per-exercise history, calendar, bodyweight log, catalog screen, and the Sync tab that replaces the diagnostic shell of spec 3 §12. It also fixes the UI framework, the test approach for views, navigation and the session lifecycle. This spec covers **no overload calculations** (v1.1), **no CSV export** (deferred, §13) and **no model change**: every file keeps the shape of spec 1 at `MODEL_VERSION` 1.

Builds on [spec 1](2026-10-06-data-model-design.md) (entities, record rules, derived values; its rules win over anything here), [spec 2](2026-10-07-xlsx-migration-design.md) (the migrated shapes the views must show: `dateUncertain`, `aggregate`, note-only blocks, `restSec`, raw-row `notes`) and [spec 3](2026-10-07-sync-hosting-design.md) (the store as the only door to data, the write guard, `heldBack`, the engine status, the prompted update). Where HANDOVER.md §4 disagrees with this spec, this spec wins; HANDOVER's analytics-first feature list is not the usage model (spec 1 §1).

---

## 1. Purpose and success

The owner logs each set right after doing it, with about a minute of rest between sets, one-handed, on the installed iPhone app, often without signal. During that minute he wants to see two things: **the whole reference session**, meaning last push day's dips, push-ups and diamonds with every set, so that today he does the same or a little more; and **today's position in the ladder**, because after four sets it is hard to remember whether the last one was 12 or 11. Everything else (day list, history, calendar, bodyweight, catalog, sync state) is secondary and read by eye; progressive overload is the owner's judgement, helped by the ↑↓ indicators of spec 1 §7.

Spec 4 is done when:

1. the owner has logged a full workout on the installed iPhone app with the Log tab, in airplane mode for part of it, and every set reached Dropbox on the next sync;
2. the Days tab shows the migrated history and the new sessions with chips and indicators, and the session page edits and deletes as tombstones with the `updatedAt` rules of spec 1 §3;
3. the Sync tab does everything the shell of spec 3 §12 did, plus the soft issues, and the shell is gone;
4. the More tab's four screens work (plan 4b, §12);
5. the tests of §11 pass in Node, and the manual device checklist of plan 4a is ticked on the iPhone and in PC Chrome.

## 2. Decisions recorded (2026-10-10)

| # | Decision | Alternative rejected |
|---|---|---|
| U1 | **The reference during a workout is a whole session**, chosen by the owner when the session starts (a tap on one of the recent sessions, with a proposed one on top, §4). The per-exercise "previous occurrence" of spec 1 §7 drives the indicators and the history screen, not the live log. | Automatic from the first exercise logged (appears only after the first set, guesses wrong on shared warm-ups); from today's label (the label never filters, spec 1 D4) |
| U2 | **Additions to the scope:** Undo after a delete; editing session notes, tags, label and date; renaming an exercise; a "since last set" counter in the live log if it fits (it does, §4). | — |
| U3 | **UI framework: Preact 10.x with `@preact/signals`, TSX.** About 7 KB gzipped together; keyed virtual DOM keeps focus and scroll; `tsc` typechecks TSX with `jsx: react-jsx`, `jsxImportSource: preact`; Vite needs no plugin. Preact 11.0.1 was published on 2026-10-08 and is not used yet. | Plain DOM as the shell (re-rendering `innerHTML` resets focus and scroll on every status tick; eight screens of hand-written partial updates); Lit 3 (custom elements and shadow DOM for a one-page app, browser-first testing); Svelte 5 or Solid (a compiler replacing `tsc`, or JSX that behaves unlike React); React 19 (about 45 KB gzipped for the same API) |
| U4 | **Tests in two layers.** Everything that can be tested without a DOM is: view models, the edit functions, the live-log rules. Component tests run per file under `happy-dom` with `@testing-library/preact`, only for interactions that write data. Layout and keyboard stay on the manual device checklist. | jsdom (slower, no need); no DOM library (no automated test for "a tap writes the wrong record"); real-browser tests (a browser in CI for checks the owner does on the devices anyway) |
| U5 | **No chart library.** The calendar is a CSS grid; the bodyweight line is an inline SVG polyline from a pure function. | uPlot or Chartist (10–15 KB for two charts); Chart.js (about 70 KB) |
| U6 | **Navigation: a bottom tab bar** with Log · Days · More · Sync; deep pages are pushed with a back control and addressed by URL hash. | Day list as home with the log as an overlay and the rest behind a menu |
| U7 | **Session lifecycle without a stored end** (spec 1 §7 "open/closed" is the rule): start writes the session file at once; resume is automatic wherever an open session exists; "Done" only navigates; a session closes by the 3 h rule or when the next one starts. | An explicit "Finish" stored locally (invisible to the other device, a lie in the UI) or stored in the file (a model change spec 1 left out on purpose) |
| U8 | **Entry control: a stepper** showing the proposed next value with − and +, and one Add button; a tap on the number opens a number pad for decimals and jumps. | A number pad as the primary control (more buttons, less room for the reference ladder) |
| U9 | **One spec, two implementation plans, two PRs.** 4a is the gym build (skeleton, Log, Days and session page, Sync tab, shell removal); 4b the More tab and corrections from using 4a. | Two specs (shared decisions written twice, 4b designed before 4a was used); one plan and one very large PR |
| U10 | **CSV export is left out** of spec 4. Spec 1 §4's `export/sets.csv` is not built; when a consumer exists it will be a file handed to the device (share sheet or download), never a Dropbox write outside the store. | Writing to Dropbox as spec 1 said (the only write outside the store and its guard) |
| U11 | **Colours are tokens.** One token block in one file; components never contain a literal colour; a re-theme edits that block only. | — |
| U12 | **Shell leftovers:** "Update app" gets visible states while it waits (§7); the paste-code login stays unchanged as the fallback, with one line saying Dropbox may ask for a login inside its sheet. | — |
| U13 | **Two runs of one exercise** pair positionally: the reference session's blocks are cards in their order, and today's *n*-th block of exercise X pairs with the reference's *n*-th block of X (the rule of spec 1 §7 "previous occurrence"). | — |

## 3. Architecture of the UI layer

### Layout

`src/app/main.ts` keeps building `Db`, `Store`, `Auth`, `DropboxHttpClient`, `Engine`, the service-worker update and the triggers exactly as today (spec 3 §12, §13), handles the OAuth redirect before anything renders, then mounts one Preact `<App>` into `#app`. `src/app/shell.ts`, `shell.css` and `shell.test.ts` are deleted; `config.ts`, `sw-update.ts` and `triggers.ts` stay.

New code lives in `src/ui/`:

| File | Responsibility |
|---|---|
| `data.ts` | The signals over the store and the engine; `write` with replay (below) |
| `router.ts` | Hash routing; the route signal; `navigate` |
| `theme.css` | The token block (U11) and the base styles |
| `app.tsx` | `<App>`: tab bar, route switch, toasts |
| `components/log/` | Log tab: start picker, session screen, cards, entry area, load sheet, exercise search and inline create |
| `components/days/` | Days tab: chips, list, session page |
| `components/more/` | More tab: exercises, exercise history, calendar, bodyweight, catalog |
| `components/sync/` | Sync tab |
| `components/shared/` | Toast, sheet, stepper, number pad, set chips, indicator marks |
| `*.vm.ts` next to each component | Pure view models: rows → what the component shows |
| `format.ts` | Dates, times, durations, numbers for display |

Pure edit functions over files live in `src/model/edit.ts`, next to `record.ts`, because they are model logic (spec 1 §3) and test in Node. The reference proposal, the card pairing and the stepper rules live in `src/model/derive/live.ts` beside the other derived-value functions: they are pure, defined here, and reusable by v1.1.

### Signals over the store

`data.ts` exports one `Data` object with a signal per slice:

```ts
interface SessionRow { path: string; file: SessionFile; version: number }
interface Data {
  sessions: Signal<SessionRow[]>;          // status ok, not duplicateOf (store.sessions() plus version)
  catalog: Signal<ExercisesFile | undefined>;
  bodyweight: Signal<BodyweightFile | undefined>;
  refusedRows: Signal<FileRow[]>;          // read-only, needs-update, quarantined, duplicateOf: listed read-only except duplicates (§5)
  status: Signal<SyncStatus>;              // engine.subscribe
  issues: Signal<Issue[]>;                 // store.issues(), refreshed with status and on change
  now: Signal<Date>;                       // ticks every second while the Log or Sync tab is visible (counter, retry countdown), else every minute (amended 2026-10-10, plan 4a)
  write(kind, path, file, expectedVersion): Promise<WriteOutcome>;
}
```

`store.onChange(path)` and the BroadcastChannel (spec 3 §5, so a second tab follows) reload only that path. Everything derived is a `computed`: sorted sessions (`sortSessions`), the open session (`isSessionOpen` against `now`), sessions by exercise, chip sets, indicators, soft issues. Preact signals memoise them, so a status tick re-renders the Sync badge and nothing else.

### Edits

A screen never mutates a file. It calls a pure function from `edit.ts` that takes the current file and returns a new one with `updatedAt` set on the edited record only, through `touch` and `tombstone` of `record.ts`:

```ts
startSession(now: Date, localDate: string): SessionFile
createPastSession(date: string, now: Date): SessionFile
setSessionFields(file, fields: { date?; label?; notes?; tags? }, now): SessionFile   // touches the session only
deleteSession(file, now) / undeleteSession(file, now)
addBlock(file, exerciseId, now): { file; blockId }                                    // order = nextOrder(blocks)
setBlockNote(file, blockId, note, now) / deleteBlock / undeleteBlock
moveBlock(file, blockId, direction: 'up' | 'down', now): SessionFile                  // orderBetween; touches the moved block only
addSet(file, blockId, set: { reps? | seconds?; loadType; loadKg; note?; completedAt? }, now): { file; setId }
setSetFields(file, setId, fields: { reps? | seconds?; loadType?; loadKg?; note? }, now)  // never touches completedAt
deleteSet(file, setId, now) / undeleteSet(file, setId, now)
```

`addSet` normalises `added`/`assist` with 0 kg to `bodyweight` (spec 1 §3) and refuses `reps <= 0` (D18). Catalog edits use `createExercise`, `touch` and `tombstone` from `catalog.ts` and `record.ts`; bodyweight edits are the same three-liners over `entries`.

Then the screen calls `data.write(kind, path, file, expectedVersion)`, which is `store.writeFile` with the row `version` the screen read:

- `ok` → done; `ok` with `heldBack` → the toast "Saved here, not uploaded (app bug)" once per path, the Sync badge counts it.
- `changed` (the row moved under the screen, e.g. a pull merged the file) → the screen's edit is **replayed once** on the fresh row, because every edit is a function of the file; a second `changed` shows "Changed elsewhere, try again" and the screen re-reads.
- `read-only`, `needs-update`, `quarantined`, `duplicate` → unreachable by construction (refused rows never show edit controls, §5); if it happens, a toast names the reason. The store's guard stays the last line.

### Device-local UI state

Goes to the `meta` store, never into files: `reference:<sessionId>` (the chosen reference session id), `daysChip` (the last active chip), `lastRoute`. Losing it costs nothing; a second device re-derives the proposal.

### Routing

By URL hash, one `computed` over `location.hash`, no router dependency:

| Route | Screen |
|---|---|
| `#/log` | Log tab (start picker or the open session) |
| `#/days` | Days list |
| `#/days/<sessionId>` | Session page |
| `#/more` | More menu |
| `#/more/exercises`, `#/more/exercise/<id>` | Exercise list, one exercise's history |
| `#/more/calendar`, `#/more/bodyweight`, `#/more/catalog`, `#/more/catalog/<id>` | The other More screens |
| `#/sync` | Sync tab |

An unknown hash goes to `#/log`. On start: the OAuth redirect (query string on the base URL) is handled before mount as today and then routes to `#/sync`; otherwise `#/log` while a session is open (§4 Resume: a reload or an app update lands back on it; amended 2026-10-10, plan 4a); otherwise `meta.lastRoute`, else `#/log`; with no local data and no connection, `#/sync`. Deep pages show a back control that goes to their tab's root; the browser back button works through the hash history.

### Offline and not connected

Not special states for screens: every tab reads local rows and writes to the queue. Only the Sync tab talks about the connection; the Log header shows the word "offline" when `status.online` is false so the owner knows without leaving the screen.

### Rendering size

The Days list renders every live session (about 150 a year) as plain rows; no virtualisation in v1. Revisit when the list is slow on the phone.

## 4. The Log tab

### Start

With no open session the tab shows one button, **Start session**. Tapping it opens the picker: the last ten live sessions in session order, newest first, one line each: weekday and date, the label if any, then the exercise names in block order (de-duplicated). The **proposed reference** is moved to the top and marked; **No reference** is the last line.

**Proposal rule** (pure, `derive/live.ts`). The *day type* of a session is the chip (push, pull, legs, other; `chipOf` over each live block's exercise pattern) that most of its live blocks have; on a tie, the chip of the first block in canonical order; a session without live blocks has none. For each day type take its most recent session; propose the one of those with the **oldest date** (on equal dates, the lower in session order). With a push, pull, legs rotation this proposes the right day; one tap on another line corrects it.

Tapping a line (or No reference) calls `startSession`: `id` = `crypto.randomUUID()`, `date` = today's local calendar day, `startedAt` = now, `tags: []`, `source: 'app'`, no label, no blocks. The file is **written at once** through the store at `sessionPath(date, id)`, so it exists before the first set and the other device sees the open session on its next pull. The reference choice goes to `meta` as `reference:<sessionId>`.

Starting while a session is open (the tab shows the open session, and its header has "Start new") asks once: "A session from 14:05 is still open. Start a new one anyway?" Yes starts the new one, which closes the old one by the rule of spec 1 §7.

### Resume

Whenever the Log tab renders and `isSessionOpen(session, all, now)` is true for a session, that session is shown. Closing the app, a reload, an app update or a second device all land back here. A missing `meta` reference (other device) is re-derived by the proposal rule; a reference that points to a deleted session counts as missing.

### The screen

```
┌──────────────────────────────────────────┐
│ Thu 2030-03-04 · 14:05    vs Thu 2030-02-27 ▾ │
├──────────────────────────────────────────┤
│ Dips (Bar) ✓                     +11.5 kg │
│ [8][8][8][8][8][8]                        │  today
│ (8)(8)(8)(8)(8)(8)                        │  last time
│ today 48 · 6 sets   last 48 · 6 sets   = = │
├──────────────────────────────────────────┤  ← current block, accent outline
│ Push-ups                        bodyweight │
│ TODAY                                      │
│ [17][16][15][14*][13¦]                     │  * last set (green)  ¦ proposed (dashed)
│ LAST TIME                                  │
│ (17)(16)(15)(14)(13)(12)(11)(10)(9)…(5)(10)│  position 5 marked
│ today 62 · 4 sets   last 143 · 14 sets ⏱ 0:48│
├──────────────────────────────────────────┤
│ Diamond Push-ups                   [Start] │
│ (20)(20)(20)(20)(20)(20)                   │
├──────────────────────────────────────────┤
│ [ Other exercise… ]            [ Done ]    │
├──────────────────────────────────────────┤
│ Set 14 deleted                      Undo   │  ← toast, 6 s
├──────────────────────────────────────────┤
│ Push-ups · set 5        bodyweight ▾  note │
│  ┌────┐  ┌──────────────┐  ┌────┐          │
│  │ −  │  │      13      │  │ +  │          │
│  └────┘  └──────────────┘  └────┘          │
│  [          Add set · 13          ]        │
├──────┬────────┬────────┬─────────────────┤
│ ●Log │  Days  │  More  │  Sync ①          │
└──────┴────────┴────────┴─────────────────┘
```

**Cards.** One card per live block of the reference session, in its canonical order, each paired with today's block of the same exercise at the same position (U13): the *k*-th reference block of exercise X pairs with the *k*-th live block of X in today's session. Today's blocks without a counterpart (a new exercise, or a third run) follow as cards of their own in canonical order. With No reference there are only today's cards. A card is in one of three states:

- **Not started:** exercise name, last time's sets in muted chips, a **Start** button.
- **Current** (accent outline): exercise name and the block's load; today's sets as chips with the last one outlined green and the proposed next value as a dashed accent chip; last time's sets with the same position marked; a totals row: today's total and set count, last time's total and set count, the counter.
- **Finished:** today's sets above last time's sets, the totals row with the two block indicators (amount, load) of `compareBlockPair(today, reference)`.

The indicators on a card compare against the block **shown on that card**, so what the owner reads is what is compared; the Days list and the history use spec 1 §7's previous occurrence, which may be a different session when the reference is not the latest one. In an open session the marks are rendered dimmed (provisional, spec 1 §7).

A card's exercise name opens a small sheet: block note (editable), "Make current", "Delete block" (Undo toast).

**Current block.** The block the owner last started or added a set to (in-memory state); after a reload, the last live block of today in canonical order. Tapping a finished card makes it current again, so a forgotten set can still be added there. Start on a not-started card calls `addBlock` and makes the new block current.

### Entry area

Pinned above the tab bar, within the safe-area inset, shown only while a current block exists.

- The top row: exercise name and "set *n*" (*n* = today's live sets in the block + 1); the **load button** showing the sticky load ("bodyweight", "+11.5 kg", "−10 kg assist", "35 kg", "band 50"); **note** (a set note, rare).
- **Stepper.** The value is the proposed next: last time's set at position *n* (`amountOf` of the paired block's *n*-th live set), else today's previous set in this block, else empty. − and + step by 1 for `reps`, by 5 for `seconds`; the value never drops below 1. Tapping the number opens the **number pad** (digits, `.`, backspace, Add) for decimals (16.5) and jumps (30). The pad opens empty with the current value as a placeholder, so the first key starts a fresh number, and its Add logs the set at once (amended 2026-10-10, plan 4a). An empty value disables Add. The stepper's typed value, a pending set note and a chosen load survive a tab switch during rest; they are kept per block and the typed value only for the set number it was typed for.
- **Add set** calls `addSet` with `completedAt = now`, the sticky load, the metric of the exercise, `order = nextOrder(sets)`. The stepper then shows the next proposal.
- **Sticky load** (pure): this block's last live set's `loadType` and `loadKg`; else the paired reference block's first live set; else the exercise's `defaultLoadType` with 0 kg. When that leaves `added` or `assist` at 0 kg (a weight is required, spec 1 §5), the **load sheet** opens before the first write of the block, once. The sheet has the five load types and a kg field; it is also what the load button opens.
- Tapping one of today's chips opens the **set sheet**: the stepper on that set's value, load, note, Delete. Edits call `setSetFields` and never touch `completedAt` (D16).

### Delete and Undo

A delete writes the tombstone at once and shows a toast for 6 s: "Set 14 deleted · Undo" (or block, session, bodyweight entry, exercise). Undo writes the undelete. Only the latest delete is undoable; a new delete replaces the toast. Both are ordinary writes; tombstones are cheap and the merge handles them (spec 1 D8).

### Exercises

**Other exercise…** opens the catalog search: a text field with the live entries filtered by name as you type (archived entries in a collapsed group below), grouped by `family`. Tapping an entry adds a block. When no live entry matches the typed name exactly (`normalizeName`), the last line offers **Create "…"** with a short form: name (prefilled), pattern, metric (`reps` default), per side (off), default load type (`bodyweight` default), family (optional). It calls `createExercise`, which returns an existing entry when the name already exists under another id (unarchived or undeleted as needed, spec 1 §3). When that entry's metric or per side differ from the form's, nothing is written and a sheet "An exercise named “X” exists" names the difference, with **Use it** (the existing entry, as it is) and Cancel (back to the form) (amended 2026-10-10, plan 4b). The catalog is written first, then the block; spec 3 S12 carries the catalog upload ahead of the session. With the catalog file quarantined or not yet pulled, Create is disabled with the reason (spec 1 §5) and existing entries can still be picked.

### Header and the rest

Date and start time; **vs <reference> ▾** reopens the picker to change the reference (the choice is updated in `meta`); **Start new** (the confirm above); **Details** opens the open session's page (§5, `#/days/<sessionId>`) for untimed edits (amended 2026-10-10, plan 4a); "offline" when `status.online` is false. **Done** navigates to the Days tab; nothing is written (U7). The **counter** shows mm:ss (h:mm:ss above an hour) since the latest `completedAt` of a live set in the session and is hidden before the first set; it reads the `now` signal and stores nothing.

### Rules

Everything added in the Log tab is timestamped now. Untimed late entries (a forgotten set, a whole session after the fact) go through the session page (§5). A session the other device opened appears here too, by the open rule, with the reference re-proposed.

## 5. The Days tab and the session page

### Days list

Chips at the top: **All · Push · Pull · Legs · Other**, one active, remembered in `meta.daysChip`. The filter is `matchesChip` over each block's exercise pattern (spec 1 §7, D4); the label never filters. Sessions in spec 1 §7 session order, newest first, grouped by month with a sticky month header. **Add past session** sits above the list.

One row per live session:

```
Thu 04 Mar   Push   Dips ↑  Push-ups =  Diamonds ↑          48 min
Tue 02 Mar   Pull   Pull-ups ↑  Australians ≠  Face Pulls ↓
Sun 28 Feb?  —      Squats –  Split Squats ↑
```

- Weekday and date; `?` after the date for `dateUncertain` (spec 1 §6).
- The label if the session has one, display only.
- Every exercise of the session in block order, de-duplicated, each with its **per-exercise indicator** (`exerciseIndicator`, spec 1 §7): ↑ ↓ = or – (none). An exercise whose id is not in the catalog shows the raw id.
- Live sessions show the span from `startedAt` (else the earliest `completedAt`) to the latest `completedAt`, when both exist and differ; migrated sessions show nothing.
- An open session carries the word **open** and tapping it goes to the Log tab; any other row opens the session page.

Sessions on refused rows (`read-only`, `needs-update`, `quarantined`; `data.refusedRows`) whose content still parses as a session are listed with a lock mark and open read-only; a quarantined file that does not parse is only on the Sync tab. Two kinds of refused row are not listed (amended 2026-10-10, plan 4a), because the route `#/days/<sessionId>` carries only the id and the session page resolves the ok row first, so their row would open another file: the loser of a duplicate pair (`duplicateOf`), which spec 3 §6 already hides from views (its content was merged into the ok twin, which is the one row, editable; the Sync tab's "Duplicate file" card names both paths); and any refused row whose session id an ok row (tombstoned included) or an earlier refused row already holds. Both stay on the Sync tab.

### Session page (`#/days/<sessionId>`)

For every session, app-made and migrated alike, the open one included (amended 2026-10-10, plan 4a): the Days row of the open session still goes to the Log tab, and the Log header's **Details** opens its page. The page works the same for an open session; a set added here carries no `completedAt` either.

- **Header:** date (editable; the file keeps its name, spec 1 D12, and the page says so once when the date changes), label (editable, one of the five or none), tags (remove with a tap; add from the tags seen in all sessions plus free text), notes (editable multi-line text; migrated sessions hold the raw sheet row, spec 2 §7). Each edit calls `setSessionFields` and touches only the session.
- **Blocks** in canonical order. Each shows the exercise name (tap → exercise history), the block note (editable), the sets as chips with the load shown where it differs from the block's first set, the totals, both block indicators (`blockIndicator`) and the per-exercise indicator. Between timestamped sets the **set interval** of spec 1 §7 is shown as "+1:02" (labelled as an interval in the help text, not as rest); a set with `restSec` shows it as "rest 120 s".
- **Edits:** tap a set → the set sheet (value, load, note, Delete); **Add set** adds one **without** `completedAt` (D16), `order = nextOrder`; **Add block** opens the exercise search of §4; a block's sheet has note, Move up, Move down (`moveBlock` uses `orderBetween` with the neighbours, nothing else is renumbered), Delete. Every delete gets the Undo toast.
- **Delete session** at the bottom, behind a confirm: `deleteSession` tombstones the session only (no cascade, spec 1 §3), the file stays, the row leaves the Days list; Undo via the toast.
- **Migrated shapes:** an `aggregate` set shows "100 total, set count unknown" and cannot be edited except for its note or deleted; a note-only block shows "no sets recorded"; `dateUncertain` shows the `?` with "date estimated by the migration"; the date sheet of such a session has a **date is exact** switch, and saving with it on drops `dateUncertain` (saving with it off keeps the flag even if the date changed).
- **Refused rows** show the content read-only with a banner naming the reason (newer app, quarantined) and a link to the Sync tab. No edit control is rendered. The page resolves its id in `data.sessions` first, then in the refused rows the Days list shows (`lockedSessionRows` in `src/ui/locked.ts`; amended 2026-10-10, plan 4a), so the list and the page agree on which file an id opens; a duplicate loser is never reached (above).

### New past session

**Add past session** asks for the date (default today, local) and creates the session with `createPastSession` (no `startedAt`, `source: 'app'`, no blocks), writes it, and opens its page. It never appears in the Log tab (spec 1 §7: sessions without `startedAt` are never open).

## 6. The More tab

A menu of four lines: **Exercises · Calendar · Bodyweight · Catalog**.

### Exercise list and history

`#/more/exercises` lists every exercise grouped by `family`, live entries first, archived in a collapsed group; each line shows the name and the date of its last block, with the year when it is not the current one (amended 2026-10-10, plan 4b). `#/more/exercise/<id>` is also reached from any exercise name in the app. It lists every live block of that exercise, newest session first, one row per block:

```
Thu 04 Mar   17 16 15 14 13 12 11 10 9 8 7 6 5 10    143 · 14 sets  ↑  bw
Thu 27 Feb   17 16 15 14 13 12 11 10 9 8 7 6 5  9    142 · 14 sets  =  bw
Thu 27 Feb ②  8 7 6 5 4 3 2 5                         40 · 8 sets   –  bw
```

Date (with `?` when uncertain), the sets as written, total and set count, the block's amount indicator and load indicator against its previous occurrence (`blockIndicator`), and the block load (`bw`, `+11.5`, `−10`, `35 kg`, `band 50`). Two runs in one session are two rows, the second and later numbered. An `aggregate` set shows as `100*`; a note-only block shows its note. Tapping a row opens the session page. The rows sit under a heading per year; the open session's marks are dimmed as provisional (§14) (amended 2026-10-10, plan 4b). No chart (U5).

### Calendar

`#/more/calendar`: month grids, newest month first, scrolling back to the first session. Each day cell shows up to three dots coloured by the chips of its sessions (push, pull, legs, other; `sessionChips`), hollow when every session that day is `dateUncertain`. Above each month: sessions and training days in that month. At the top once: the current streak of calendar weeks (Monday to Sunday, local) with at least one session. Tapping a day lists its sessions; tapping one opens the session page (or the Log tab if it is open). The newest months mount first; earlier ones mount as the list end scrolls near, or with **Show earlier months** (amended 2026-10-10, plan 4b).

### Bodyweight

`#/more/bodyweight`: the entries newest first (date, kg, note), with the **line** above the list when there are at least two entries: an inline SVG `polyline` from a pure function (`bodyweightLine(entries, width, height)` → points, with the min and max labelled, nothing else). **Add entry** asks kg (positive, one decimal), date (default today) and note; tapping an entry edits or deletes it (Undo toast). Writes go to `bodyweight.json` through the store; the migrated single entry carries spec 2's note.

### Catalog

`#/more/catalog`: every exercise, live first by family, then archived; each line shows name, pattern, metric, per side and default load type. Tapping opens `#/more/catalog/<id>`, the edit form:

- **Name** (rename keeps the id; the uniqueness check of spec 1 §3 runs on save against every entry, deleted ones included, and, on a clash, offers the existing entry instead of saving; a deleted one can then be restored from its page), **family**, **pattern**, **default load type**, **cues** (amended 2026-10-10, plan 4b).
- **Metric** and **per side** are displayed and locked, with the line "fixed at creation; create a new exercise instead" (spec 1 §3).
- **Archive / Unarchive.**
- **Delete** is shown only when no live block of any live session references the exercise; otherwise only Archive is offered, with the reason. Delete tombstones (Undo toast). A race with the other device is healed by `restoreReferenced` (spec 1 §3).
- **Create** at the top of the list uses the same form as the inline create of §4. A name that exists opens that entry when it is live with the same metric and per side; otherwise the clash sheet of §4 asks first, also before bringing back an archived or deleted entry (amended 2026-10-10, plan 4b).
- A deleted exercise's page (reached by a link or "Use it") shows its fields read-only with **Restore** as the only action. Delete counts the locked sessions of §5 too (amended 2026-10-10, plan 4b).
- A rename clashes with any entry of that name, deleted ones included (spec 1 §3: tombstoned names count), and the clash sheet offers that entry; a deleted one can then be restored from its page. **Restore** and the delete's **Undo** still check the name first, for the offline race spec 1 §3 accepts (another device naming an entry alike before the sync): while a non-deleted entry holds it, nothing is written; Restore opens the clash sheet ("Use it" opens that entry), Undo shows "Not restored: an exercise named “X” exists" with **Open**. The engine's `restoreReferenced` heal is unchanged (spec 1 §3) (amended 2026-10-10, plan 4b).

With the catalog file quarantined, this screen is read-only with a banner (spec 1 §5). A read-only or needs-update file (written by a newer app) still lists its entries without edit controls; the bodyweight page does the same (amended 2026-10-10, plan 4b).

## 7. The Sync tab

Replaces the shell of spec 3 §12 one to one and adds the soft issues. Top to bottom:

- **Connection.** Not connected: **Connect to Dropbox**; **Paste a code instead** with the panel exactly as spec 3 §3 describes (link, code field, Finish login), plus the line "Dropbox may ask you to log in inside this sheet"; the home-screen hint on iOS outside the installed app; after a revoked token **Connect again** with "your data and queued changes are kept". Connected: one line.
- **Empty folder** (first pull found no data files): the two choices of spec 3 §11, unchanged.
- **Update.** **Update app** when a build waits. States: tapped → disabled, "Updating…"; the engine did not go idle within 10 s → "Still syncing, trying again" and one more wait of 10 s; still not idle → enabled again, "Could not update; try again after sync". The reload itself happens on `controllerchange` as today. The too-new notice of spec 3 §8 when a newer build wrote files and no update is offered yet.
- **Status** (connected only). Phase; "offline" marker; retry countdown; last pull; last push; queued count with the held-back count; last error; **Sync now** (disabled unless idle).
- **Issues.** One card per issue in plain words with the action that applies:

| Reason | Card text (besides the path) |
|---|---|
| `quarantined` | the validation messages; "fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it" |
| `read-only`, `needs-update` | "written by a newer app; update this app" |
| `held-back` | the record path and message; "saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed" |
| `duplicate` | both paths; "remove the second file in Dropbox; the first one holds the merged content" |
| `remote-deleted` | "removed from Dropbox; the local copy is kept and re-uploaded only if you change it" |
| `unexpected-file` | "not a CalisTally file; ignored" |
| `push-error` | the error text |
| **soft** (new) | "unknown exercise" or "metric mismatch" with the block, one card per session, linking to its page where the block carries the same flag |

Soft issues are a `computed` over `data.sessions` and `data.catalog` with `checkCatalogRules` (spec 1 §5, D13). They never block anything.

- **Issues** and **Data** render in every connection state, so a badge raised while disconnected is always explained (amended 2026-10-10, plan 4a).
- **Data.** Counts of live sessions, exercises and bodyweight entries; the build id; "storage persistent" or not; **Sign out** with the queue confirm as today.

**Badge** on the Sync tab: the number of issues (hard and soft) plus held-back writes; a dot alone when not connected or when an update waits. Nothing else in the app shows sync state except the "offline" word in the Log header.

## 8. Theme, layout and interaction rules

- **Tokens** (U11) in `src/ui/theme.css` on `:root`: `--bg`, `--panel`, `--panel-2`, `--text`, `--muted`, `--accent`, `--ok`, `--danger`, `--outline`, plus `--on-accent` (text on the accent colour) and the calendar's `--chip-push`, `--chip-pull`, `--chip-legs`, `--chip-other` (amended 2026-10-10, plans 4a and 4b). The values start from the mockup the owner approved (dark: `#111827`, `#1f2937`, `#273449`, `#e5e7eb`, `#9ca3af`, `#f59e0b`, `#34d399`, `#f87171`, `#374151`). A component stylesheet may only reference tokens; a test greps `src/ui` for literal colours outside `theme.css` and fails on any.
- **Touch targets** at least 44 × 44 px. The entry area and tab bar respect `env(safe-area-inset-*)`. The stepper and Add sit in the bottom third of the screen.
- **Text** is English (spec 1 D10). Dates show the weekday and the local calendar day; times are local; durations are mm:ss or h:mm:ss; decimals use the device locale for display only (the file always stores JSON numbers).
- **Indicators** are rendered as ↑ ↓ = ≠ –, with a text alternative for screen readers; the amount mark first, then the load mark, load hidden when both blocks are plain bodyweight (spec 1 §7).
- **Sheets** (load, set, block, exercise form, date) slide up from the bottom and close on a swipe down or the Cancel button; a sheet never loses typed input to a re-render (signals re-render only the parts that changed).
- **Toasts** stack at most one; 6 s for Undo, 4 s for errors.

## 9. Error handling

| Situation | Behaviour |
|---|---|
| `write` returns `changed` | Replay the edit once on the fresh row; a second `changed` shows "Changed elsewhere, try again" and the screen re-reads |
| `write` returns `heldBack` | Toast "Saved here, not uploaded (app bug)" once per path; Sync badge counts it; the content stays local and queued (spec 3 §5) |
| `write` refused (`read-only`, `needs-update`, `quarantined`, `duplicate`) | Unreachable by construction (no edit controls on refused rows); if it happens, a toast names the reason |
| Catalog missing (quarantined, or not pulled yet) | Blocks show raw exercise ids; create and edit of exercises disabled with the reason; sets can still be logged against existing ids |
| Not connected, or offline | No change for any screen; writes queue; the Log header says "offline"; the Sync tab explains |
| Open session on both devices | Both show it; each writes its own sets; the merge unions them by id (spec 3 §6); the cards update on the next pull |
| Reference session deleted meanwhile | The reference counts as missing and is re-proposed |
| The exercise of a block was archived | The card and the page show it normally with an "archived" mark; new blocks of it can be started from the reference card, and the search lists it only in its archived group |

Nothing in the UI waits for Dropbox.

## 10. Module layout and dependencies

Runtime dependencies added: `preact` (10.x) and `@preact/signals`. Dev dependencies added: `happy-dom`, `@testing-library/preact`. Nothing else; no router, no CSS framework, no chart library, no date library.

Config: `tsconfig.json` gets `"jsx": "react-jsx"`, `"jsxImportSource": "preact"`; `vitest.config.ts` keeps the Node environment as default, component test files opt in with `// @vitest-environment happy-dom`; `vite.config.ts` is unchanged except that `shell.css` is replaced by `theme.css` in `index.html`.

| File | Responsibility |
|---|---|
| `src/model/edit.ts` | The pure edit functions of §3 |
| `src/model/derive/live.ts` | Day type, reference proposal, card pairing, stepper proposal, sticky load, counter source |
| `src/ui/data.ts` | Signals over store and engine; `write` with replay; soft issues |
| `src/ui/router.ts` | Hash routing |
| `src/ui/theme.css` | Tokens and base styles |
| `src/ui/app.tsx` | Tab bar, route switch, toast host |
| `src/ui/components/**` | The screens of §4–§7, each with its `*.vm.ts` |
| `src/ui/format.ts` | Display formatting |
| `src/app/main.ts` | Bootstrap (unchanged logic) and mount |

## 11. Testing

Tests come first and run in Node unless marked. Fixtures are synthetic, dates in 2030, via `src/model/test-fixtures.ts` and `src/sync/test-fixtures.ts`.

- **`edit.ts`:** every function; `updatedAt` moves on the edited record only (a set edit leaves block and session alone, a block move leaves the session alone); tombstone and undelete round-trip; `addBlock`/`addSet` use `nextOrder`; `moveBlock` uses the midpoint and renumbers nothing; `addSet` from the session page carries no `completedAt`; `setSetFields` never touches `completedAt`; `added`/`assist` at 0 kg becomes `bodyweight`; `reps <= 0` refused; every result passes `validateForWrite`.
- **`derive/live.ts`:** day type with ties and empty sessions; the proposal with a push/pull/legs rotation, with one day type only, with no sessions; card pairing with two runs, with a new exercise, with No reference; the stepper proposal (reference position, fall back to the previous set, empty), steps for reps and seconds, the floor at 1; sticky load (block, reference, default, the 0 kg `added` case that opens the sheet); the counter source.
- **View models:** Days rows (chips, `?`, span, open marker, raw exercise ids), session page (interval labels, `restSec`, aggregate and note-only shapes, refused rows read-only), exercise history rows (run numbering, load text), calendar months (dots, hollow, counts, streak over a year boundary), bodyweight line points (min and max labels, fewer than two entries), Sync cards (every reason, the soft issues), the badge.
- **`data.ts`** against a `Store` on fake-indexeddb: signals update on `onChange` and on channel messages; `write` passes `expectedVersion`; replay on `changed` once and surfacing on the second; `heldBack` surfaces once per path.
- **Router:** every route, unknown hash, the start route rules.
- **Theme:** no literal colour outside `theme.css`.
- **Components** (happy-dom, `@testing-library/preact`): Add set writes a set with `completedAt`, the sticky load and the next proposal shown; tapping a chip then Delete writes a tombstone and Undo writes the undelete; inline create writes the catalog before the session; Start session writes the file and stores the reference; the Sync tab renders every issue reason and the Update button states; the session page's Add set writes no `completedAt`.
- **Manual device checklist** (in plan 4a; the owner does every click): install from Pages on the iPhone, log a full session one-handed, the entry area above the keyboard and inside the safe area, airplane mode for part of the session and the queue draining afterwards, kill and reopen the app during a session (resume), the open session visible on the PC, an edit on the PC merged on the phone, the update prompt and its states, the Sync badge for a held-back write (forced by a test build), the paste login panel text.

## 12. Deliverables and the two plans

**Plan 4a, the gym build** (one PR against `main`):

1. Dependencies and config (§10); `src/ui/theme.css`; `src/ui/app.tsx` with the tab bar and router; `data.ts`.
2. `src/model/edit.ts` and `src/model/derive/live.ts` with their tests.
3. The Sync tab (§7) with every shell function, then the removal of `shell.ts`, `shell.css`, `shell.test.ts` and the shell rendering in `main.ts`.
4. The Log tab (§4).
5. The Days tab and the session page (§5), Add past session.
6. The device checklist (§11), `CLAUDE.md` (status, layout, UI rules, commands unchanged).

**Plan 4b, the rest** (a second PR):

1. The More tab: exercise list and history, calendar, bodyweight with the line, catalog screen (§6).
2. Soft-issue flags on blocks in the session page and the Log cards.
3. Corrections the owner collected while using 4a.

Each plan is written with the writing-plans skill, with full code and tests, and executed in a fresh session on its own branch; the owner merges.

## 13. Out of scope

CSV export (U10; spec 1 §4's `export/sets.csv` is not built); v1.1 overload calculations (trends, best sets, effective load; all further pure functions over the same data, nothing here blocks them); charts; two blocks open at once (spec 1 §7 keeps the rule); tombstone garbage collection; a light theme (the token block makes it a later addition); Android; any model change.

## 14. Amendments to earlier specs

- **Spec 1 §4:** the line `export/sets.csv` is **not built** (U10).
- **Spec 1 §7:** "Spec 4 decides how the views show the two ↑↓ levels": the Log cards show the block level against the card's own reference block; the Days list shows the exercise level; the session page and the exercise history show both block indicators and the exercise indicator (§5, §6). "Indicators in an open session are provisional": shown dimmed (§4).
- **Spec 3 §12:** the shell is replaced by the Sync tab (§7); the state table of §12 holds for the Sync tab.
- **Spec 3 §16:** CSV export is no longer "spec 4"; it is deferred (U10).
