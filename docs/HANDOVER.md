# Handover: CalisTally (calisthenics tracker)

Project name: **CalisTally** (repo `calistally`, display name CalisTally).

This file is the starting brief for a new Claude Code session (VS Code extension) in the project's GitHub repository. It summarises the analysis done so far and the decisions the owner made. Nothing has been built yet.

Related: the full option analysis is in `analysis/tracker-options.md` (in the Claude project files). The source data is `Calisthenics_Tracker_2026.xlsx` (Dropbox, folder "Calisthenics Tracker").

---

## 1. Goal

Replace the free-text XLSX with a tracker that:
- works on the phone and on several PCs, from anywhere;
- costs nothing to run (no paid server);
- keeps the data in the owner's **Dropbox**;
- makes logging on the phone fast (less fiddly than a spreadsheet);
- shows **each training day in detail** (exactly what was done, set by set, for progressive overload);
- has a **dashboard** with visuals (progress per exercise, volume, PRs, consistency, split balance, bodyweight).

**The data model comes first.** The owner agreed that the real problem with the XLSX is the lack of structure, not the spreadsheet UI.

## 2. Decisions (made by the owner, 06.10.2026)

| # | Question | Decision |
|---|---|---|
| 1 | Architecture | **Option C:** a static web app (PWA) on free hosting that reads and writes data files in the owner's Dropbox through the Dropbox API. No backend. |
| 2 | Bodyweight | **Track it**, as its own time series. |
| 3 | Pyramids / ladders | **Log every set in detail.** Patterns must be fully custom, not just symmetric pyramids, e.g. `1 2 3 5 6 5 4 2 5`. |
| 4 | Effort (RPE / RIR) | **None.** Too detailed for the owner's needs. |

The owner is experienced, wants his reasoning challenged, wants tradeoffs shown with evidence so he can decide, and does not want "good enough".

## 3. Proposed data model (draft, needs review before building)

> **Superseded.** The data model and storage layout are now defined by [superpowers/specs/2026-10-06-data-model-design.md](superpowers/specs/2026-10-06-data-model-design.md) (spec 1). This section is kept for history. Where it disagrees with the spec, the spec wins.

The core rule is **one record per set**. Day views, volume, PRs and charts are all *derived* from sets and never stored.

### Entities

**Exercise** (a catalog the user picks from, not free text)
- `id` (slug, e.g. `pullup`, `australian-pullup`, `dip`)
- `name` (display name; German or English, the owner mixes both)
- `pattern`: `pull` | `push` | `legs` | `core` | `other`, used for split balance and default grouping
- `metric`: `reps` | `seconds`, for holds if they ever appear
- `variantOptions`: the variant attributes that make sense for this exercise (see below)
- `defaultLoadType`
- `archived` flag (never delete exercises that have history)

**Session** (one training day or block)
- `id` (uuid), `date` (ISO `YYYY-MM-DD`), optional `startedAt`
- `type`: `pull` | `push` | `legs` | `mixed` | `other`. This is a label only and must not constrain which exercises can be logged. The XLSX failed exactly because the day type was mistaken for the exercise.
- `notes` (context such as "erkältet", "nach Frühstück")
- `tags` (optional, e.g. `sick`, `fed`, so the dashboard can mark them)

**Set**
- `id` (uuid), `sessionId`, `order` (position within the session)
- `exerciseId`
- `variant`: attributes such as `equipment` (bar / rings / dip-bar / cable / dumbbell / band / floor), `grip`, `angle` (Australian rows: steeper/flatter, ideally a number or ordinal), `style` (`normal` | `negative` | `jump` | `diamond` | `deficit` …). The exercise defines which keys are allowed.
- `reps` (number; **decimals allowed** because the owner logs partial reps such as `16,5`), or `seconds`
- `loadKg` and `loadType`:
  - `bodyweight`: nothing added (loadKg 0)
  - `added`: vest or dumbbell on top of bodyweight (e.g. Australian rows +11.5 kg, dips +10 kg)
  - `assist`: band assistance (reduces load)
  - `external`: dumbbell, barbell or machine stack where bodyweight is irrelevant (curls, face pulls, RDL)
  - `band`: nominal band resistance as the main load (e.g. "Bands 50kg" on RDL or calf raises). This is not comparable to kg, so chart it separately.
- `restSec` (optional; covers "every 2 minutes" and "1m rest")
- `groupId` (optional; links the sets of one ladder, pyramid or EMOM block so they can be shown as one unit)
- `note` (optional)

**SetGroup** (optional; for ladders and pyramids)
- `id`, `sessionId`, `kind`: `pyramid` | `ladder` | `emom` | `custom`, `label`, and `pattern` as entered (e.g. `[1,2,3,5,6,5,4,2,5]`)
- The UI expands a pattern into individual Set records. The pattern is kept only to make "repeat last time" and display easy. **Sets are the source of truth**, so a pattern that wasn't completed (e.g. planned 6, did 5) is just an edited set.

**BodyweightEntry**
- `date`, `kg`, optional `note`
- For bodyweight exercises the dashboard can compute *effective load* = bodyweight × exercise factor + added − assist. The factors (e.g. dips ≈ 1.0, push-ups ≈ 0.65, Australian rows ≈ 0.5, depending on angle) are approximations. Keep them configurable and label anything derived from them as an estimate.

### Things the model must handle (taken from the real XLSX)

- Descending ladders written as `15 down` or `10 down` → a SetGroup of 15, 14, … 1? **Confirm with the owner what "down" means.** In the sheet, "Dips 15x 14x … 4x 10x" also ends with an extra set.
- Compound blocks: `Pullups 1 2 3 4 5 4 3 2 5 dann 8 7 6 5 4 3 2 5` → two SetGroups in one session.
- Interval work: `10x 7 every 2 minutes` → 7 sets of 10 with `restSec` 120 (or EMOM group).
- Same weight for all sets: `25x 3 mit 12,4kg` → 3 sets of 25 at 12.4 kg.
- Mixed loads within one exercise: `normal Squats 17,4kg 30x 28,9kg 30x 20x` → per-set load.
- Mixed bands: `Bands 50kg 20x 60kg 15x x2`.
- Form cues repeated in every row ("sauber (Ellbogen), langsam, gestreckt") belong in the exercise's notes, not in each set.

### Storage in Dropbox (recommendation, open to change)

- Use a Dropbox **App folder** app (scoped access to `/Apps/<app-name>/` only).
- Suggested files:
  - `exercises.json`
  - `bodyweight.json`
  - `sessions/2026.json` (sessions and sets for one year; this keeps files small and limits merge scope)
  - `schema-version` inside each file, to allow future migrations
- Writes: upload with `mode: update` + the last known `rev`. On a conflict, download, merge by record `id` (uuids make that safe), and retry. This avoids Dropbox "conflicted copy" files when the phone and a PC edit around the same time.
- Offline: keep a local copy and a pending-write queue in IndexedDB, and sync when online. Logging in a gym with bad signal must still work.
- Auth: OAuth 2 **PKCE** (no client secret in the static app), with a refresh token stored locally per device. A Dropbox app in development mode is fine for a single user.
- Also write a flat `export/sets.csv` occasionally (or on demand), so the data stays usable without the app.

### Hosting

- GitHub Pages or Cloudflare Pages (both free). With GitHub Pages on a free account the repo must be **public**. The code being public is fine, but **never commit training data, the XLSX or tokens.** Add `*.xlsx` and any local data folder to `.gitignore` from the first commit.
- The Dropbox OAuth redirect URI must match the hosting URL, plus `http://localhost:<port>` for development.

## 4. App features (first version)

1. **Log screen (phone first):** pick a session type → see last session of that type pre-filled ("repeat last time") → adjust reps/load with steppers → enter custom pyramid patterns as a list of numbers (`1 2 3 5 6 5 4 2 5`), which expand to sets.
2. **Day view:** one session, every set, grouped by exercise and set group, with a comparison to the previous time that exercise was done (Δ reps, Δ load, Δ volume).
3. **Exercise history:** per exercise and variant, a chart over time of best set, total reps and volume.
4. **Dashboard:** training calendar heatmap, sessions per week by pattern (pull/push/legs balance; legs have had no entries since 19.08.2026, and that's the kind of thing this should show), PR timeline, bodyweight trend, total weekly reps/volume.
5. **Bodyweight entry**: quick, from the log screen.

## 5. Migrating the XLSX

> **Superseded.** The migration is specified in [superpowers/specs/2026-10-07-xlsx-migration-design.md](superpowers/specs/2026-10-07-xlsx-migration-design.md) (spec 2) and implemented under `src/migration/`. This section is kept for history; where it disagrees with spec 2, spec 2 wins.

Write a one-off migration script (e.g. Node or Python) that parses the XLSX into the new JSON format and produces a **review list** of every cell it could not parse confidently. The owner confirms those entries; nothing ambiguous gets guessed silently.

Sheet layout: one sheet "Calisthenics Plan", three side-by-side blocks, Pull `A–D`, Push `F–J` (J = "Extra"), Legs `L–O`. Row 2 holds the headers and data starts at row 3. 134 session rows in total (Pull 50, Push 52, Legs 32).

Known problems the script must handle or flag:
- **Column header ≠ exercise.** Detect the exercise from the cell text first and fall back to the header. Examples: C ("Bicep Curls") holds negative pull-ups from late April and pull-up pyramids from late May; M27 holds pull-ups and dip negatives; B29 holds dip negatives; B40 jump squats; D40 calf raises; O35/O37 knee raises and lateral raises; N31+ squats and jump squats; H is diamond push-ups from late June; I11 holds Australian pull-ups.
- **"Extra" column (J) contains separate days** with dates inside the text (`12.06.2026 Pullups 2x die 5er Pyramide`) → split them into their own sessions.
- **Dates** are mixed real Excel dates and text (`31.01.26`, `09.02.2026`). Typos: L20 `27.04.206`, F22 `02,05.2026`, F23 `06,05.2026`, A34 `03.07..2026`. Probably wrong (flag for confirmation): A49 `05.08.2026` (between 31.08 and 08.09, likely 05.09), F27 24.06 (between 20.05 and 28.05, likely 24.05), and A33 06.07 placed before A34 03.07. Rows 3–5 have no dates in any block. Import them as "undated, before first dated row" or ask the owner.
- **Notations to parse:** `20x 15x 12x`, `25kg x 20 x3`, `20 x 3 mit 6kg`, `30kg 20x 3`, `35kg 25x2`, `25x 3 mit 12,4 kg`, `Bands 50kg 20x 60kg 15x x2`, `10x 7 every 2 minutes`, `15 down`, `Rings Downs 12x Start with 1m Rest`, `100 Diamonds`, `Diamonds 4x 20`, pyramids with `dann`. Decimal comma. Free-text notes (`erkältet`, `nach Essen, voller Bauch`, `Deeep`, `schräger`, `flacher`, `kurze Pause`).
- **Partial reps:** `16,5x` is clear, but `13,2x` and `11,2x` (G9) are odd. Ask the owner.
- **Implied load:** Australian rows, dips and push-ups carry an added weight (vest) when a kg value is given; `Bodyweight` is sometimes explicit. Curls and face pulls use a cable stack or SZ bar (C9 `8kg SZ Hantel`, D9 `12kg Maschine`), which are different equipment from the 35–40 kg cable values, so they need different variants.
- **Bodyweight history** doesn't exist in the XLSX. Start fresh.

Keep the raw XLSX in Dropbox only, out of git.

## 6. Open questions for the owner

> Questions 1–3 are answered in spec 2 §2 (decisions M1–M16); 5 and 6 were answered in spec 1 (D10, D11). Question 4 (hosting) is open for spec 3.

1. What exactly does `N down` mean (N, N−1, …, 1)? And the trailing extra set in the dips ladders?
2. `13,2x` / `11,2x`: typo, or a meaning?
3. Confirm the suspicious dates listed in section 5.
4. Hosting: GitHub Pages (public repo) or Cloudflare Pages (works with a private repo)?
5. Language of the UI: German, English, or mixed as in the sheet?
6. Bodyweight factors for effective load: show estimates, or skip effective load entirely?

## 7. Suggested first steps for the new session

1. Agree the data model (section 3) with the owner and write it down as TypeScript types plus a JSON schema in the repo.
2. Build the XLSX migration script and review list against the real file (section 5), and get the owner's confirmations.
3. Scaffold the PWA (a light stack such as Vite + TypeScript; chart library to be chosen) with the Dropbox PKCE login and the read/write/merge sync layer, tested for conflicts first.
4. Then the log screen, day view, exercise history and dashboard, in that order.
