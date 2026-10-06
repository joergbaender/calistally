# Spec 1: Data model and Dropbox file layout

- **Date:** 2026-10-06
- **Status:** awaiting the owner's review
- **Scope:** the foundation every later spec depends on: TypeScript types, JSON Schema, validation, schema upgrades, the seed exercise catalog, the Dropbox file layout and the derived-value rules. This spec covers **no UI, no sync code and no XLSX parser**.

This spec replaces HANDOVER.md §3 (draft data model) and the storage part of §3. Where they disagree, this spec wins.

---

## 1. Purpose and usage model

CalisTally replaces a free-text XLSX. The central use case is **live logging during a workout**. the owner starts a block, does a set, enters its rep count, rests (often around 1 min), does the next set, enters it, and so on. The app is his notepad and shows where he is in the current ladder and what he did last time.

Examples of real patterns:
- Down-ladder with a combined tail: `17 16 15 … 5`, then `10` (the 4+3+2+1 done as one set). Next month the tail may be `11`.
- Up-down ladder with a finisher: `1 2 3 5 6 5 3 2 5`.
- Constant sets: Diamond push-ups `20 20 20 20 20 20 20`.
- Two runs of one exercise in a session: pull-ups `1 2 3 … 5`, then later `8 7 6 5 4 3 2 5`.

The tail or finisher set is **part of the block**, not a separate set type.

**Progressive overload** is mainly judged by the owner, by reading chronological lists. He adds a small increment roughly once a month: one more set, one more rep, or one more set of 20. The app's job in v1 is lists, filters and up/down indicators. Overload calculations (trends, best sets, effective load) are a later v1.1 layer. **This model must hold everything v1.1 needs, so v1.1 won't require a data migration.**

## 2. Decisions recorded (2026-10-06)

| # | Decision | Replaces |
|---|---|---|
| D1 | Structure: **Session → Block → Set**. A second run of the same exercise in one session is a second block. | HANDOVER `SetGroup` with `pattern`/`kind` (dropped; the block's sets *are* the pattern) |
| D2 | **Flat exercise catalog**: every distinct thing trained is its own entry (e.g. `Dips (Rings)`), optionally grouped by `family`. Small tweaks (steeper, deep, handles) go in a block note. | HANDOVER `variant` attributes / `variantOptions` |
| D3 | Catalog is **user-extensible in the app** (create while logging, edit on a catalog screen) and **developer-extensible** through a seed file in the repo. | Catalog only as a fixed list |
| D4 | `pattern` ∈ `push, pull, legs, core, shoulders, neck, conditioning, other`. Day-list filter chips: Push · Pull · Legs · Other · All. The filter uses **each block's exercise pattern**, not the session label. | Filter by session `type` |
| D5 | **One Dropbox file per session.** | One file per year |
| D6 | Storage backend: **Dropbox App folder**. Firestore, Supabase, Cloudflare D1, Google Drive and GitHub were considered and rejected. | (confirms HANDOVER) |
| D7 | Rest between live sets is **derived from `completedAt` timestamps**, never entered. | Stored `restSec` on every set |
| D8 | **Tombstones**: every record has `updatedAt` and an optional `deletedAt`. Deleting a record means marking it, never removing it. Without this, merge-by-id brings deleted records back. | Not covered |
| D9 | A file with a **newer `schemaVersion` than the app** makes the app read-only for that file. | Not covered |
| D10 | Language: **English** for UI and seed exercise names. | HANDOVER open question 5 |
| D11 | Bodyweight factors / effective load are **out of v1**, deferred to v1.1 and always labelled as estimates. | HANDOVER open question 6 |

## 3. Entities

All types live in `src/model/types.ts`. Common fields on every stored record:

```ts
interface RecordMeta {
  updatedAt: string;    // UTC ISO 8601, set on every change
  deletedAt?: string;   // UTC ISO 8601; present = tombstone
}
```

### Exercise (catalog, `exercises.json`)

```ts
type Pattern = 'push' | 'pull' | 'legs' | 'core' | 'shoulders' | 'neck' | 'conditioning' | 'other';
type LoadType = 'bodyweight' | 'added' | 'assist' | 'external' | 'band';

interface Exercise extends RecordMeta {
  id: string;            // slug from the name at creation, e.g. "dips-rings"; never changes on rename
  name: string;          // display name, English
  family?: string;       // grouping for per-exercise history, e.g. "Dips"
  pattern: Pattern;
  metric: 'reps' | 'seconds';
  perSide: boolean;      // true: reps count per side (single-leg RDL)
  defaultLoadType: LoadType;
  cues?: string;         // standing form cues, e.g. "clean elbows, slow, full extension"
  archived: boolean;     // exercises with history are archived, never deleted
}
```

- **Slug rule:** lowercase, ASCII; anything other than a–z and 0–9 becomes `-`, repeated `-` are collapsed, and leading or trailing `-` are trimmed. If an exercise with a different name already uses the slug, append `-2`, `-3` and so on. Creating the same name offline on two devices produces the same id, so the merge yields one entry.
- An exercise referenced by any non-deleted block cannot be tombstoned, only archived.

### Session (one file per session)

```ts
interface Session extends RecordMeta {
  id: string;            // uuid (crypto.randomUUID)
  date: string;          // 'YYYY-MM-DD', the owner's LOCAL calendar day
  label?: 'pull' | 'push' | 'legs' | 'mixed' | 'other';  // display only; never filters, never constrains exercises
  notes?: string;
  tags: string[];        // e.g. "sick", "after-meal"
  source: 'live' | 'migrated';
  blocks: Block[];
}
```

### Block

```ts
interface Block extends RecordMeta {
  id: string;            // uuid
  order: number;         // position in the session, 0-based
  exerciseId: string;
  note?: string;         // per-block tweaks: "steeper", "deep", "with handles", "started with 1 min rest"
  sets: Set[];           // may be empty only for migrated note-only blocks (see §6)
}
```

### Set

```ts
interface Set extends RecordMeta {
  id: string;            // uuid
  order: number;         // position in the block, 0-based
  reps?: number;         // required when exercise.metric = 'reps'; decimals allowed (16.5)
  seconds?: number;      // required when exercise.metric = 'seconds'
  loadType: LoadType;
  loadKg: number;        // >= 0; 0 for bodyweight. 'assist' kg reduces load; 'band' kg is nominal band resistance
  side?: 'L' | 'R';      // only for perSide exercises, for one-off single-side sets
  completedAt?: string;  // UTC ISO; ALWAYS present on live sets, absent on migrated sets
  restSec?: number;      // migrated data only (e.g. "every 2 minutes"); live sets derive rest
  aggregate?: true;      // migrated "100 Diamonds": total reps, set count unknown (see §6)
  note?: string;
}
```

**Load is stored per set**, because loads change within a block in the real data, e.g. `17,4kg 30x 28,9kg 30x`. The UI makes it sticky: each new set inherits the previous set's load, so live logging costs no extra taps.

**Load type meanings:**

| `loadType` | Meaning | Example from the XLSX |
|---|---|---|
| `bodyweight` | nothing added, `loadKg = 0` | pull-up ladders |
| `added` | vest or held weight on top of bodyweight | Australian pull-ups +11.5 kg, split squats with 12.4 kg |
| `assist` | band assistance, reduces load | (none yet) |
| `external` | machine, cable or bar; bodyweight irrelevant | bicep curls 35 kg cable |
| `band` | nominal band resistance as the main load; not comparable to kg | single-leg RDL "Bands 50kg" |

### BodyweightEntry (`bodyweight.json`)

```ts
interface BodyweightEntry extends RecordMeta {
  id: string;            // uuid
  date: string;          // 'YYYY-MM-DD' local
  kg: number;
  note?: string;
}
```

### Not in the model, on purpose

SetGroup/pattern (the block's sets are the pattern), variant attributes (flat catalog), RPE/RIR, stored rest for live sets, and any stored totals, deltas, PRs or session end time. All of these are either derived or out of scope.

## 4. Dropbox file layout

```
/Apps/<app-folder>/                     name depends on Dropbox app-name availability (spec 3)
  exercises.json                        { "schemaVersion": 1, "exercises": Exercise[] }
  bodyweight.json                       { "schemaVersion": 1, "entries": BodyweightEntry[] }
  sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json   { "schemaVersion": 1, "session": Session }
  export/sets.csv                       generated on demand, one row per set; never read by the app
```

- `<id8>` is the first 8 characters of the session uuid.
- **The content inside a file is the truth, not its name.** The path exists so the folder is easy to browse. When a session's date changes, the app moves the file. If the path and the content disagree, the reader goes by the content.
- Expected size: about 2–5 KB per session file, 150–200 sessions a year, so under 1 MB a year.
- Why one file per session (D5): live logging uploads after every set, often over weak gym signal. A session file is small and written by one device, so conflicts are practically limited to deliberate edits from two devices. Merging stays a safety net rather than a normal path. The cost is the first load on a new device, which means fetching many files (spec 3 evaluates Dropbox `download_zip` from the browser).

## 5. Versioning, validation, seed merge

### Schema versioning
- Every file has an integer `schemaVersion` (starting at 1).
- `upgrade(file)` applies the step functions `v1→v2→…` in memory on read. The next write stores the current version.
- **If a file's version is higher than the app knows (D9):** that file is read-only in this app instance and the UI asks to update the app. This stops a stale cached PWA from overwriting newer data.

### Validation
- **Single source:** the TS types. The JSON Schema is **generated** from them by a build step, so the two can't drift.
- The app validates every file it reads. An invalid file is **quarantined** (kept unchanged, reported to the owner, never overwritten, never auto-fixed). The rest of the data stays usable.
- The migration script (spec 2) validates every file it writes against the same schema.
- Cross-field rules the schema can't express are checked in code:
  - `reps` is present iff `metric = 'reps'`, and `seconds` iff `metric = 'seconds'`;
  - `side` only appears when `perSide` is true;
  - `exerciseId` refers to a catalog entry;
  - `order` values are unique among the non-deleted siblings;
  - `loadKg = 0` when `loadType = 'bodyweight'`;
  - `completedAt` is present on every set of a `source: 'live'` session;
  - `aggregate` and empty blocks appear only in `source: 'migrated'` sessions.

### Seed catalog
- `seed-exercises.json` in the repo. Each entry follows the `Exercise` shape.
- On first run, and on every app start after a deploy, entries whose `id` is **missing** from the Dropbox catalog are added. Existing entries are **never** modified, even if the seed changed. A tombstoned or archived id is never re-added.
- Initial seed: derived from the XLSX (draft, for the owner's review before the implementation merges it):

| id | name | family | pattern | defaultLoadType | perSide |
|---|---|---|---|---|---|
| australian-pullups-bar | Australian Pull-ups (Bar) | Australian Pull-ups | pull | added | no |
| pullups | Pull-ups | Pull-ups | pull | bodyweight | no |
| negative-pullups | Negative Pull-ups | Pull-ups | pull | bodyweight | no |
| bicep-curls-cable | Bicep Curls (Cable) | Bicep Curls | pull | external | no |
| bicep-curls-ez-bar | Bicep Curls (EZ Bar) | Bicep Curls | pull | external | no |
| face-pulls-cable | Face Pulls (Cable) | Face Pulls | pull | external | no |
| dips-bar | Dips (Bar) | Dips | push | added | no |
| dips-rings | Dips (Rings) | Dips | push | bodyweight | no |
| pushups | Push-ups | Push-ups | push | added | no |
| diamond-pushups | Diamond Push-ups | Push-ups | push | bodyweight | no |
| ring-deficit-pushups | Ring Deficit Push-ups | Push-ups | push | bodyweight | no |
| triceps-pulldowns-cable | Triceps Pulldowns (Cable) | Triceps Pulldowns | push | external | no |
| overhead-press-band | Overhead Press (Band) | Overhead Press | shoulders | band | no |
| lateral-raises | Lateral Raises | Lateral Raises | shoulders | external | no |
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

Things to confirm in review: whether "Dips (Bar)" with a vest and "Dips (Bar)" without one are really one exercise (load type per set handles both); whether the single-leg RDL dumbbell load counts as `external` or `added`; and whether `perSide` is correct for single-leg RDL and split squats.

## 6. Legacy data that can't be fully reconstructed

These rules let the migration (spec 2) record incomplete history honestly, without inventing numbers:

- **Total known, set count unknown** (`100 Diamonds`): a block with one set where `reps = 100` and `aggregate: true`. It counts towards volume totals and is excluded from ↑↓ comparisons.
- **Activity known, no numbers** (`Burpees, Pyramide Pullups`): a block with an empty `sets` array and a `note`.
- Both appear on the migration review list so the owner can fill in real sets if he remembers them. Neither form is allowed in `source: 'live'` sessions.

## 7. Derived-value rules (pure functions, defined here, used by every view)

All functions ignore tombstoned records.

| Rule | Definition |
|---|---|
| Block totals | `totalReps` = sum of `reps` (or `totalSeconds` for timed exercises); `setCount` = number of non-aggregate sets |
| Block load | **Load group:** `bodyweight`, `added` and `assist` form one group on a signed axis (`bodyweight` = 0, `added` = +kg, `assist` = −kg); `external` and `band` are separate groups. The block's **main group** is the group of most sets (on a tie, the first set's group). **Block load** = max signed kg over the sets in the main group. |
| Previous occurrence | For block *n* (the *n*-th non-deleted block of exercise X in session S), the comparison target is block *n* of exercise X in the most recent session before S (by `date`, then the first set's `completedAt`) that has at least *n* blocks of X. If that session has fewer, there is no comparison. |
| ↑↓ indicator | Two separate indicators per block: **reps** (↑ / ↓ / = on `totalReps`) and **load** (↑ / ↓ / = on block load; hidden if both sides are plain bodyweight). If the two blocks' main load groups differ, load shows `≠` (not comparable). Less assist counts as ↑. Blocks with an aggregate set or no sets, on either side, show `–`. |
| Rest between live sets | `completedAt[i] − completedAt[i−1]` within a block; between blocks it's the gap from the previous block's last set. Not shown for migrated sets, which use `restSec` if present. |
| Session open/closed | A live session is "open" until 3 h pass after its last `completedAt`, or a new session is started. Never stored. |
| Day-list filter | A session matches chip C if any non-deleted block's exercise has a `pattern` that maps to C: `push → Push`, `pull → Pull`, `legs → Legs`, and everything else → `Other`. One session can match several chips. |

The v1.1 overload layer (trends, best set, "+X since last month", effective load = estimate) will be added as further pure functions over this same data. No new stored fields are expected.

## 8. Deliverables of this spec

1. Minimal TS project: `package.json`, `tsconfig.json`, Vitest, plus the build step that generates the schema. (Prerequisite: Node.js LTS installed on the dev PC.)
2. `src/model/types.ts`: the entities in §3.
3. The generated JSON Schema (e.g. `schema/*.schema.json`), committed, with a test that fails if it no longer matches the types.
4. `src/model/validate.ts`: schema validation plus the cross-field rules in §5, returning structured errors.
5. `src/model/upgrade.ts`: the version-step framework (only v1 exists, so it's the framework plus the "too new → read-only" result).
6. `src/model/slug.ts` and the seed merge function.
7. `src/model/derive.ts`: the rules in §7.
8. `seed-exercises.json`: the table in §5 after the owner's review.

Library choices (schema generator, validator) are made in the implementation plan, with the reasons stated.

## 9. Testing

- Tests come first for: validation (valid and invalid files, each cross-field rule), upgrade and the too-new result, the slug rule and its collisions, the seed merge (adds missing, never overwrites, never resurrects tombstones), tombstone filtering in every derived function, and every ↑↓ case (equal, up, down, aggregate, no previous occurrence, block *n* matching, mixed load groups → `≠`, assist decreasing → ↑).
- **Fixtures are synthetic.** They are written in the XLSX's notation style with made-up numbers and dates. Real training data is never committed (CLAUDE.md). Spec 2 runs against the real XLSX locally, outside git.

## 10. Out of scope (later specs)

- **Spec 2, XLSX migration:** parser, review list, and the open questions (meaning of `N down` when not written out, `13,2x` / `11,2x`, suspicious dates, undated rows 3–5, `10Kg` face pulls in D41, `(R 1x 15)` in M16).
- **Spec 3, sync and hosting:** Dropbox PKCE with a refresh token, IndexedDB copy, write queue, `rev`-checked upload, merge by id using `updatedAt` and tombstones, first load on a new device, hosting choice (GitHub Pages vs Cloudflare Pages), redirect URIs.
- **Spec 4+, UI:** live log (sticky load, last-time reference, create an exercise inline), day list with filter chips and ↑↓, per-exercise history, calendar/consistency, bodyweight log, catalog screen.
- **v1.1:** overload calculations.
