# Spec 1: Data model and Dropbox file layout

- **Date:** 2026-10-06
- **Status:** awaiting the owner's approval (revised 2026-10-06 after a spec review; the owner's answers to the open points are recorded in §11)
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

The second use case is **entering a session or a set after the fact** (phone forgotten, a set not tapped in). The model must take such entries without inventing timestamps (D16).

**Progressive overload** is mainly judged by the owner, by reading chronological lists. He adds a small increment roughly once a month: one more set, one more rep, or one more set of 20. The app's job in v1 is lists, filters and up/down indicators. Overload calculations (trends, best sets, effective load) are a later v1.1 layer. **The aim is that v1.1 needs no restructuring of the stored data.** If v1.1 does need something new, it should be an optional field with a no-op upgrade step (§5), never a rewrite of existing records. One known limit of this aim is described under D2.

## 2. Decisions recorded (2026-10-06)

| # | Decision | Replaces |
|---|---|---|
| D1 | Structure: **Session → Block → Set**. A second run of the same exercise in one session is a second block. | HANDOVER `SetGroup` with `pattern`/`kind` (dropped; the block's sets *are* the pattern) |
| D2 | **Flat exercise catalog**: every distinct thing trained is its own entry (e.g. `Dips (Rings)`), optionally grouped by `family`. Small tweaks (steeper, deep, handles) go in a block note. **Known limit:** a tweak that lives in a note is invisible to the ↑↓ indicators and to any v1.1 trend, so a steeper block and a flatter block are compared as equals. Rule of thumb: a tweak the owner wants to track as progression (e.g. bar angle on Australian pull-ups) gets its own catalog entry in the same `family`; one-off remarks go in the note. | HANDOVER `variant` attributes / `variantOptions` |
| D3 | Catalog is **user-extensible in the app** (create while logging, edit on a catalog screen) and **developer-extensible** through a seed file in the repo. | Catalog only as a fixed list |
| D4 | `pattern` ∈ `push, pull, legs, core, shoulders, neck, conditioning, other`. Day-list filter chips: Push · Pull · Legs · Other · All. The filter uses **each block's exercise pattern**, not the session label. | Filter by session `type` |
| D5 | **One Dropbox file per session.** | One file per year |
| D6 | Storage backend: **Dropbox App folder**. Firestore, Supabase, Cloudflare D1, Google Drive and GitHub were considered and rejected. | (confirms HANDOVER) |
| D7 | Rest between live sets is **derived from `completedAt` timestamps**, never entered. The derived value is the interval between two sets and is labelled as such (§7). | Stored `restSec` on every set |
| D8 | **Tombstones**: every record has `updatedAt` and an optional `deletedAt`. Deleting a record means marking it, never removing it. Without this, merge-by-id brings deleted records back. The exact semantics are in §3 "Record rules". | Not covered |
| D9 | A file with a **newer `schemaVersion` than the app** is never written by that app. | Not covered |
| D10 | Language: **English** for UI and seed exercise names. | HANDOVER open question 5 |
| D11 | Bodyweight factors / effective load are **out of v1**, deferred to v1.1 and always labelled as estimates. | HANDOVER open question 6 |
| D12 | A session file's **path never changes** after it is first written. The date in the name is the session's date at creation. | Earlier draft: "the app moves the file when the date changes" |
| D13 | **Two validation levels.** Rules that can be checked inside one file are hard (failure → quarantine). Rules that need the catalog are soft (failure → flagged, never quarantined). | Earlier draft: all cross-field rules equal |
| D14 | **Schema-first.** One schema definition in code is the single source; the TS types are inferred from it and the JSON Schema files are emitted from it. | Earlier draft: JSON Schema generated from plain TS types |
| D15 | **One model version** for all file types. Any change to the stored shape bumps it, including a new optional field. | Not covered |
| D16 | `completedAt` and `startedAt` mean **"logged in real time"** and are optional. Entries made after the fact have no timestamps. `source` is `'app'` or `'migrated'`. | Earlier draft: `completedAt` required on every set of a `'live'` session |
| D17 | **No `side` field on sets.** A `perSide` exercise is always logged as both sides. A set done on one side only is a normal set with a set note saying so. | Earlier draft: `side?: 'L' \| 'R'` |
| D18 | **`reps > 0`.** A failed attempt is not a set; it goes in the block note. | Not covered |

## 3. Entities

The interfaces below are the normative shape. In the code they are inferred from the schema definition (D14) and exported from `src/model/types.ts`.

Common fields on every stored record:

```ts
interface RecordMeta {
  updatedAt: string;    // UTC timestamp; covers this record's OWN fields, not its child arrays
  deletedAt?: string;   // UTC timestamp; present = tombstone
}
```

### Record rules (every stored record)

These rules are part of the data model because the merge in spec 3 is built on them.

- **Timestamp format.** Every timestamp is UTC in exactly the form `YYYY-MM-DDTHH:mm:ss.sssZ` (the output of `Date.prototype.toISOString()`). With a fixed format, string order is time order.
- **What `updatedAt` covers.** It covers the record's own fields, i.e. everything except its child array (`blocks` on a session, `sets` on a block). Adding, changing or deleting a child never changes the parent's `updatedAt`. Otherwise a set logged on one device would overwrite a session note edited earlier on another.
- **Setting `updatedAt`.** On every change: `updatedAt = max(now, previous updatedAt + 1 ms)`. An edit made after a merge therefore always wins, even on a device whose clock runs slow.
- **Merge unit (for spec 3).** Each record is merged on its own: the copy with the newer `updatedAt` supplies all of the record's own fields, including `deletedAt`. Child arrays are merged by `id`, recursively. If both copies have the same `updatedAt`, a tombstone wins; spec 3 defines a deterministic tie-break for the rest.
- **Clock skew** between devices is accepted. the owner is the only user and his devices sync their clocks; the damage a skewed clock can do is limited to one record's own fields.
- **Delete.** Deleting sets `deletedAt` and `updatedAt` to the same instant. A tombstone **keeps the full record**, so it stays schema-valid, can be undeleted, and (for exercises) can still be resolved by old references.
- **Undelete.** Removing `deletedAt` and setting `updatedAt` restores a record. It wins by the ordinary newer-`updatedAt` rule.
- **No cascade.** Deleting a parent marks only the parent. Its children are left as they are, and every reader treats everything under a tombstoned parent as deleted. Undeleting the parent brings the children back unchanged.
- **Deleted sessions keep their file.** The file stays in Dropbox with `session.deletedAt` set; the app never deletes a session file. Tombstones are not garbage-collected in v1 (they cost a few hundred bytes each).
- **Sibling order.** `order` is a sort key and nothing more. It is any finite number and need not be unique or contiguous. Appending uses `max + 1`; inserting between two siblings uses their midpoint, so no sibling has to be renumbered. Two devices that each append a set produce the same `order`; that is legal and resolved by the canonical order in §7. Array position in the file carries no meaning.

### Exercise (catalog, `exercises.json`)

```ts
type Pattern = 'push' | 'pull' | 'legs' | 'core' | 'shoulders' | 'neck' | 'conditioning' | 'other';
type LoadType = 'bodyweight' | 'added' | 'assist' | 'external' | 'band';

interface Exercise extends RecordMeta {
  id: string;            // slug from the name at creation, e.g. "dips-rings"; never changes on rename
  name: string;          // display name, English; unique among non-deleted exercises
  family?: string;       // grouping for per-exercise history, e.g. "Dips"
  pattern: Pattern;
  metric: 'reps' | 'seconds';   // IMMUTABLE after creation
  perSide: boolean;      // true: reps count per side (single-leg RDL); IMMUTABLE after creation
  defaultLoadType: LoadType;
  cues?: string;         // standing form cues, e.g. "clean elbows, slow, full extension"
  archived: boolean;     // exercises with history are archived, never deleted
}
```

- **Slug rule:**
  1. Transliterate `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`; then strip remaining diacritics (Unicode NFKD, drop combining marks).
  2. Lowercase. Anything other than a–z and 0–9 becomes `-`, repeated `-` are collapsed, and leading or trailing `-` are trimmed.
  3. If the result is empty, use `exercise`.
  4. If an exercise with a different name already uses the slug (tombstoned ones count), append `-2`, `-3` and so on.
- **Name uniqueness.** Names are compared case-insensitively after trimming and collapsing whitespace. Creating a name that already exists never makes a second record: the app offers the existing entry, unarchiving or undeleting it if needed. The check looks at names, not at slugs, so it also catches an entry whose id no longer matches its (renamed) name.
- Creating the same name offline on two devices produces the same id, so the merge yields one entry. Two *different* names that happen to produce the same id offline on two devices also merge into one entry (the newer name wins). That is accepted as too rare to design for.
- **`metric` and `perSide` are immutable**, because the meaning of every logged set depends on them. To change one, create a new exercise and archive the old one.
- An exercise referenced by any non-deleted block cannot be tombstoned, only archived. Two devices can still race (one deletes an unused exercise while the other logs it offline). The reader heals that: a tombstoned exercise referenced by a non-deleted block is restored as archived (undelete, `archived: true`) on the next catalog write.

### Session (one file per session)

```ts
interface Session extends RecordMeta {
  id: string;            // uuid (crypto.randomUUID)
  date: string;          // 'YYYY-MM-DD', the owner's LOCAL calendar day
  dateUncertain?: true;  // migrated only: `date` is a best estimate (undated or doubtful XLSX rows)
  startedAt?: string;    // UTC; set when the session is started in the live log, absent otherwise
  label?: 'pull' | 'push' | 'legs' | 'mixed' | 'other';  // display only; never filters, never constrains exercises
  notes?: string;
  tags: string[];        // e.g. "sick", "after-meal"
  source: 'app' | 'migrated';   // where the record was created
  blocks: Block[];       // may be empty
}
```

`source: 'app'` covers both live logging and entries made after the fact. The difference between the two is carried by the timestamps (`startedAt`, `completedAt`), not by `source`.

### Block

```ts
interface Block extends RecordMeta {
  id: string;            // uuid
  order: number;         // sort key among the session's blocks (see "Sibling order")
  exerciseId: string;
  note?: string;         // per-block tweaks: "steeper", "deep", "with handles", "started with 1 min rest"
  sets: WorkoutSet[];    // may be empty: a block just started, a block whose sets were deleted, or a migrated note-only block (§6)
}
```

### WorkoutSet

The type is called `WorkoutSet` so it doesn't shadow the built-in `Set<T>`. The text keeps calling it a set.

```ts
interface WorkoutSet extends RecordMeta {
  id: string;            // uuid
  order: number;         // sort key among the block's sets (see "Sibling order")
  reps?: number;         // exactly one of reps / seconds; decimals allowed (16.5)
  seconds?: number;
  loadType: LoadType;
  loadKg: number;        // 0 for bodyweight. 'assist' kg reduces load; 'band' kg is nominal band resistance
  completedAt?: string;  // UTC; set when the set is logged in real time, absent otherwise
  restSec?: number;      // stated rest for sets without completedAt (migrated "every 2 minutes")
  aggregate?: true;      // migrated "100 Diamonds": total reps, set count unknown (see §6)
  note?: string;
}
```

**`completedAt` means "logged in real time".** The live log sets it when the owner enters a set during the workout. Sets entered after the fact (a forgotten set, a whole session typed in that evening) and migrated sets have none. Later edits to reps or load never change it. Nothing is derived from a timestamp that isn't there.

**Load is stored per set**, because loads change within a block in the real data, e.g. `17,4kg 30x 28,9kg 30x`. The UI makes it sticky: each new set inherits the previous set's load, so live logging costs no extra taps.

**Load type meanings:**

| `loadType` | Meaning | `loadKg` | Example from the XLSX |
|---|---|---|---|
| `bodyweight` | nothing added | `= 0` | pull-up ladders |
| `added` | vest or held weight on top of bodyweight | `> 0` | Australian pull-ups +11.5 kg, split squats with 12.4 kg |
| `assist` | band assistance, reduces load | `> 0` | (none yet) |
| `external` | machine, cable or bar; bodyweight irrelevant | `>= 0` | bicep curls 35 kg cable |
| `band` | nominal band resistance as the main load; not comparable to kg | `>= 0` | single-leg RDL "Bands 50kg" |

`added` or `assist` with 0 kg is the same thing as `bodyweight`, so the app stores it as `bodyweight`.

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

SetGroup/pattern (the block's sets are the pattern), variant attributes (flat catalog), RPE/RIR, a `side` on sets (D17), sets with 0 reps (D18), stored rest for live sets, and any stored totals, deltas, PRs or session end time. All of these are either derived or out of scope.

## 4. Dropbox file layout

```
/Apps/<app-folder>/                     name depends on Dropbox app-name availability (spec 3)
  exercises.json                        { "schemaVersion": 1, "exercises": Exercise[] }
  bodyweight.json                       { "schemaVersion": 1, "entries": BodyweightEntry[] }
  sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json   { "schemaVersion": 1, "session": Session }
  export/sets.csv                       generated on demand, one row per set; never read by the app
```

- `/Apps/<app-folder>/` is where the files appear in the owner's Dropbox. Through the API an App-folder app sees that folder as its root, so the app addresses `/exercises.json`, `/sessions/…` and so on.
- `<id8>` is the first 8 characters of the session uuid.
- **The content inside a file is the truth, not its name.** The path exists so the folder is easy to browse.
- **The path never changes (D12).** `<YYYY>` and `<YYYY-MM-DD>` are the session's `date` when the file is first written. If the date is edited later, the file keeps its name and the reader goes by the content. Moving the file would be a second, non-atomic operation that an offline device holding the old path and `rev` can collide with; a slightly stale file name after a rare date edit is the cheaper problem.
- **Two files with the same session id** should never exist (it takes a manual copy in Dropbox). If the reader finds them, it merges them by the record rules in §3, writes the result to the path that sorts first, leaves the other file untouched and reports it to the owner.
- Expected size: a set is about 170–230 bytes of JSON, and a session has roughly 40–60 sets, so a session file is about 7–14 KB. At 150–200 sessions a year that is 1–3 MB a year.
- Why one file per session (D5): live logging uploads after every set, often over weak gym signal. A session file is small and written by one device, so conflicts are practically limited to deliberate edits from two devices. Merging stays a safety net rather than a normal path. The cost is the first load on a new device, which means fetching many files (spec 3 evaluates Dropbox `download_zip` from the browser).

## 5. Versioning, validation, seed merge

### Schema versioning
- **One model version (D15).** A single integer, starting at 1, shared by all file types. Every file the app writes carries the current value in `schemaVersion`. A bump that doesn't change a given file type gets a no-op step for it.
- **What bumps it:** any change to the stored shape, including a new optional field. The schema rejects unknown properties, and an old app that let them through would drop them on its next write. With the bump, an old app stops writing the file instead of damaging it.
- `upgrade(file)` applies the step functions `v1→v2→…` in memory on read. The next write stores the current version. Files in Dropbox may therefore sit at different versions for a while; that is fine.
- **If a file's version is higher than the app knows (D9):** the app never writes that file and the UI asks to update the app. It shows the content only if the file still validates against the schema the app knows; otherwise it just lists the file as "needs app update". Changes already queued for that file are kept until the app is updated (spec 3). This stops a stale cached PWA from overwriting newer data.

### Validation

**Single source (D14).** A schema definition in code (`src/model/schema.ts`) is the single source. The TS types are inferred from it, and the JSON Schema files are emitted from it and committed, so the three can't drift. Plain TS interfaces can't be the source because they can't express the constraints below. The alternative, hand-written interfaces with JSDoc constraint tags fed to a generator, was rejected: the constraints would live in comments that the compiler doesn't check, and a mistyped tag is silently ignored.

**Constraints the schema must carry:**
- `date`: pattern `YYYY-MM-DD`;
- every timestamp: the fixed UTC format from §3;
- `id` of sessions, blocks, sets and bodyweight entries: uuid; `id` of exercises: `^[a-z0-9]+(-[a-z0-9]+)*$`;
- `reps`, `seconds` and bodyweight `kg`: `> 0`; `loadKg` and `restSec`: `>= 0`; `order`: a finite number;
- exactly one of `reps` / `seconds` on a set;
- `aggregate` and `dateUncertain`: only the literal `true`;
- `name`: non-empty; `tags`: non-empty strings;
- no unknown properties, at every level.

**When.** The app validates every file it reads **and every file before it writes it**. A file that fails before a write is not written; that is an app bug, it is shown as an error, and the last valid version stays in place. The migration script (spec 2) validates every file it writes against the same schema.

**Two levels (D13).**

*File rules (hard).* The schema, plus these rules that can be checked inside one file:
- `date` is a real calendar date;
- all non-deleted sets of one block use the same one of `reps` / `seconds`;
- `loadKg = 0` when `loadType = 'bodyweight'`, and `loadKg > 0` when it is `added` or `assist`;
- `restSec` appears only on sets without `completedAt`;
- `aggregate` and `dateUncertain` appear only in `source: 'migrated'` sessions;
- record ids are unique within the file.

A file that fails a hard rule on read is **quarantined**: kept unchanged, reported to the owner, never overwritten, never auto-fixed. The rest of the data stays usable. If the quarantined file is the catalog, sessions stay readable (blocks show the raw `exerciseId`), and creating or editing exercises is blocked until the owner has resolved it.

*Catalog rules (soft).* These need `exercises.json` as well as the session file:
- `exerciseId` refers to a catalog entry (a tombstoned entry counts, and is restored as archived, see §3);
- the set's `reps` / `seconds` matches the exercise's `metric`.

A soft failure **never quarantines**. The block is flagged in the UI (e.g. "unknown exercise"), listed on an issues screen, and the file stays readable and writable. The reasons: the session file and the catalog are two separate uploads, so another device can see a session before the catalog entry it refers to; and a catalog problem must not be able to lock away training history.

### Seed catalog
- `seed-exercises.json` in the repo. Each entry follows the `Exercise` shape.
- **Every seed `id` equals `slug(name)`.** A test enforces it, so the seed and in-app creation can never produce two ids for one name.
- **Every seed entry carries a fixed `updatedAt`** in the seed file (the day it was added to the seed), and the seed merge copies it unchanged. A seed entry is therefore always older than anything the owner did to that entry, so a fresh install that seeds while offline can't overwrite his edits or bring back an entry he deleted when the two catalogs merge.
- On first run, and on every app start after a deploy, entries whose `id` is **missing** from the Dropbox catalog are added. Existing entries are **never** modified, even if the seed changed. A tombstoned or archived id is never re-added.
- Initial seed: derived from the XLSX. the owner confirmed the three points below the table on 2026-10-06; the rest of the table is approved together with this spec. All entries have `metric: 'reps'` and `archived: false`.

| id | name | family | pattern | defaultLoadType | perSide |
|---|---|---|---|---|---|
| australian-pull-ups-bar | Australian Pull-ups (Bar) | Australian Pull-ups | pull | added | no |
| pull-ups | Pull-ups | Pull-ups | pull | bodyweight | no |
| negative-pull-ups | Negative Pull-ups | Pull-ups | pull | bodyweight | no |
| bicep-curls-cable | Bicep Curls (Cable) | Bicep Curls | pull | external | no |
| bicep-curls-ez-bar | Bicep Curls (EZ Bar) | Bicep Curls | pull | external | no |
| face-pulls-cable | Face Pulls (Cable) | Face Pulls | pull | external | no |
| dips-bar | Dips (Bar) | Dips | push | added | no |
| dips-rings | Dips (Rings) | Dips | push | bodyweight | no |
| push-ups | Push-ups | Push-ups | push | added | no |
| diamond-push-ups | Diamond Push-ups | Push-ups | push | bodyweight | no |
| ring-deficit-push-ups | Ring Deficit Push-ups | Push-ups | push | bodyweight | no |
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

Confirmed by the owner (2026-10-06):
- "Dips (Bar)" with a vest and without one are **one exercise**; the load type per set tells them apart.
- The single-leg RDL dumbbell load is **`external`**.
- **`perSide`** is true for Single-leg RDL, Single-leg RDL (Band) and Split Squats, and false for everything else in the seed. It can't be changed after creation.

## 6. Legacy data that can't be fully reconstructed

These rules let the migration (spec 2) record incomplete history honestly, without inventing numbers:

- **Total known, set count unknown** (`100 Diamonds`): a block with one set where `reps = 100` and `aggregate: true`. It counts towards volume totals and is excluded from the block ↑↓ comparison.
- **Activity known, no numbers** (`Burpees, Pyramide Pullups`): a block with an empty `sets` array and a `note` (a "note-only block").
- **Date missing or doubtful** (XLSX rows 3–5, dates the owner can't confirm): `date` holds the best estimate and `dateUncertain: true` marks it. Views show the mark. The undated rows 3–5 **are imported**: the migration proposes a date before the first dated row and puts each one on the review list, where the owner confirms or corrects it. A date the owner confirms as exact loses the flag. How the proposal is calculated is part of spec 2.
- All three appear on the migration review list so the owner can fill in real values if he remembers them. `aggregate` and `dateUncertain` are not allowed in `source: 'app'` sessions. An empty block in an app session simply means nothing has been logged in it yet.

## 7. Derived-value rules (pure functions, defined here, used by every view)

All functions ignore tombstoned records and everything under a tombstoned parent. Totals and loads are rounded to 2 decimals before they are compared, so decimal reps such as `17.2` can't turn an `=` into `↑` through floating-point error.

| Rule | Definition |
|---|---|
| Sibling order | Blocks in a session and sets in a block are read in **canonical order**: by `order`; then (sets only) by `completedAt`, sets without one last; then by `id`. Array position is ignored. |
| Session order | By `date`; then by time key, which is `startedAt` or else the earliest `completedAt` in the session, sessions without a time key first; then by `id`. This order is total, so two migrated sessions on one date always sort the same way. |
| Block totals | `totalReps` = sum of `reps` (or `totalSeconds` for timed exercises); `setCount` = number of non-aggregate sets. For `perSide` exercises the total is in per-side units, exactly as logged; nothing is doubled. |
| Exercise session total | The sum of the block totals over all blocks of exercise X in the session. Aggregate sets count. |
| Block load | **Load group:** `bodyweight`, `added` and `assist` form one group on a signed axis (`bodyweight` = 0, `added` = +kg, `assist` = −kg); `external` and `band` are separate groups. The block's **main group** is the group of most sets (on a tie, the first set's group). **Block load** = max signed kg over the sets in the main group. |
| Previous occurrence | For block *n* (the *n*-th block of exercise X in session S), the comparison target is block *n* of exercise X in the most recent session before S (session order) that has at least *n* blocks of X. If no session has, there is no comparison. |
| ↑↓ per block | Two separate indicators per block: **amount** (↑ / ↓ / = on `totalReps` or `totalSeconds`) and **load** (↑ / ↓ / = on block load; hidden if both sides are plain bodyweight). If the two blocks' main load groups differ, load shows `≠` (not comparable). Less assist counts as ↑. Blocks with an aggregate set or no sets, on either side, show `–`. |
| ↑↓ per exercise | One indicator (↑ / ↓ / =) on the exercise session total, against the most recent earlier session that has a block of X. It shows `–` if either session is migrated and has a note-only block of X, because the numbers are unknown. There is no load indicator at this level. |
| Set interval | For two sets that follow each other in a block and **both** have `completedAt`: the difference, if positive. For the first set of a block: the gap from the latest earlier `completedAt` anywhere in the session. This is end-of-set to end-of-set, so it includes the duration of the later set; the UI labels it as an interval, not as pure rest. Where a timestamp is missing or the order is reversed, nothing is shown. Sets without `completedAt` show `restSec` if present. |
| Session open/closed | A session is "open" if it has `startedAt`, less than 3 h have passed since its latest timestamp (`startedAt` or any `completedAt`), and no session with a later `startedAt` exists. Sessions without `startedAt` (migrated, or entered after the fact) are never open. Never stored. |
| Day-list filter | A session matches chip C if any non-deleted block's exercise has a `pattern` that maps to C: `push → Push`, `pull → Pull`, `legs → Legs`, and everything else → `Other`. One session can match several chips. |

**Why two ↑↓ levels.** The per-block comparison is positional (block *n* against block *n*). It is the right comparison when the session has the same shape as last time, and it misleads when the shape changes: if last time was an up-ladder followed by a down-ladder and today is only the down-ladder, block 1 is compared with the up-ladder. The per-exercise indicator doesn't depend on block structure. Spec 4 decides how the views show the two; this spec only guarantees both are available.

**Indicators in an open session are provisional**, because the block isn't finished. Spec 4 decides whether to show them before the session closes.

**Two blocks open at once.** The model allows a session where the owner alternates two exercises set by set: each exercise is one block, and the sets carry their own `completedAt`. The set interval within a block then spans the other exercise's set, which is the true interval between two sets of that exercise. the owner doesn't train this way today, so the v1 live log has one open block at a time; the rule stays here so that adding it later needs no model change.

The v1.1 overload layer (trends, best set, "+X since last month", effective load = estimate) will be added as further pure functions over this same data. No new stored fields are expected, with the limit noted under D2.

## 8. Deliverables of this spec

1. Minimal TS project: `package.json`, `tsconfig.json`, Vitest, plus the build step that emits the JSON Schema. (Prerequisite: Node.js LTS installed on the dev PC.)
2. `src/model/schema.ts`: the schema definition for the entities in §3 with the constraints in §5. `src/model/types.ts`: the TS types inferred from it.
3. The emitted JSON Schema (e.g. `schema/*.schema.json`), committed, with a test that fails if it no longer matches the schema definition.
4. `src/model/validate.ts`: schema validation plus the hard and soft rules in §5, returning structured errors that say which level failed.
5. `src/model/upgrade.ts`: the version-step framework (only v1 exists, so it's the framework plus the "too new → don't write" result).
6. `src/model/record.ts`: the record helpers from §3 (set `updatedAt`, delete, undelete, next `order`, midpoint `order`).
7. `src/model/slug.ts`, the name-uniqueness check and the seed merge function.
8. `src/model/derive.ts`: the rules in §7.
9. `seed-exercises.json`: the table in §5 after the owner's review.
10. Once this spec is approved: update `CLAUDE.md` (its core rules still describe SetGroup patterns and a session `type`; fill in "To fill in" as far as this spec settles it) and mark HANDOVER.md §3 as replaced by this spec.

The library choices (schema library, validator) are made in the implementation plan, with the reasons stated.

## 9. Testing

- Tests come first for:
  - **validation:** valid and invalid files; every hard rule; every soft rule, including that a soft failure never quarantines; an empty block in an app session is valid; `aggregate` and `dateUncertain` are rejected in app sessions; a file that fails validation is not written;
  - **versioning:** upgrade steps and the too-new result;
  - **record helpers:** `updatedAt` moves forward even when the clock doesn't; a child change leaves the parent's `updatedAt` alone; delete keeps the record's content; undelete; a tombstoned parent hides its children;
  - **slug and catalog:** the slug rule, transliteration, the empty result and collisions; every seed `id` equals `slug(name)`; the name-uniqueness check;
  - **seed merge:** adds missing entries, never overwrites, never resurrects tombstones, keeps the fixed `updatedAt`;
  - **ordering:** sibling order with duplicate and fractional `order` values; session order with same-date sessions with and without timestamps;
  - **derived values:** tombstone filtering in every function; every ↑↓ case (equal, up, down, aggregate, no previous occurrence, block *n* matching, mixed load groups → `≠`, assist decreasing → ↑, equality after rounding, timed exercises); the per-exercise indicator, including the changed-shape case from §7; set intervals with missing and reversed timestamps and with two interleaved blocks; session open/closed with and without `startedAt`.
- **Fixtures are synthetic.** They are written in the XLSX's notation style with made-up numbers and dates. Real training data is never committed (CLAUDE.md). Spec 2 runs against the real XLSX locally, outside git.

## 10. Out of scope (later specs)

- **Spec 2, XLSX migration:** parser, review list, and the open questions (meaning of `N down` when not written out, `13,2x` / `11,2x`, suspicious dates, the date proposal for the undated rows 3–5, `10Kg` face pulls in D41, `(R 1x 15)` in M16, which under D17 becomes a normal set with a note).
- **Spec 3, sync and hosting:** Dropbox PKCE with a refresh token, IndexedDB copy, write queue (catalog writes queued ahead of the session writes that depend on them), `rev`-checked upload, the merge itself (built on the record rules in §3), first load on a new device, hosting choice (GitHub Pages vs Cloudflare Pages), redirect URIs.
- **Spec 4+, UI:** live log (sticky load, last-time reference, create an exercise inline, entering sets and sessions after the fact), day list with filter chips and ↑↓, per-exercise history, calendar/consistency, bodyweight log, catalog screen, issues screen for quarantined files and soft validation failures.
- **v1.1:** overload calculations.

## 11. the owner's answers to the review's open points (2026-10-06)

The spec review left nine points where the choice was the owner's. His answers are below, and the sections named are written accordingly.

| # | Point | Answer | Where |
|---|---|---|---|
| 1 | Tweaks that are overload levers | They stay in the block note; a tweak he wants to track as progression gets **its own catalog entry**. No `level` field on Block. | D2 |
| 2 | Single source for types and schema | **Schema-first.** | D14, §5 |
| 3 | Session file path after a date edit | The file **never moves**. | D12, §4 |
| 4 | Entries made after the fact | **Optional timestamps**; `source` is `'app'` or `'migrated'`. | D16, §3 |
| 5 | Undated XLSX rows 3–5 | **Imported with an estimated date**, marked `dateUncertain`, each one on the review list. | §6 |
| 6 | Alternating two exercises set by set | **Not now, maybe later.** The model rule stays; the v1 live log has one open block. | §7 |
| 7 | One-sided sets on per-side exercises | **No `side` field.** Such a set is a normal set with a note. | D17 |
| 8 | Sets with 0 reps | **Not allowed**; `reps > 0`. A failed attempt goes in the block note. | D18, §5 |
| 9 | Seed catalog | Dips (Bar) with and without a vest is **one exercise**; single-leg RDL dumbbell load is **`external`**; `perSide` is true for **Single-leg RDL, Single-leg RDL (Band) and Split Squats** only. | §5 |
