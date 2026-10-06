# Calisthenics Tracker: what the sheet tells us, and options

## 1. What's in the workbook today

One sheet, three side-by-side blocks, one row per session. Nothing is structured: every cell is free text mixing load, reps, sets and notes.

| Block | Columns (header → what actually ended up there) | Sessions | Date range |
|---|---|---|---|
| Pull (A–D) | Australian Pull Ups, Bicep Curls, Face Pulls | 50 | Feb → 30.09.2026 |
| Push (F–J) | Dips, Push Ups, Triceps Pulldowns, Extra | 52 | Jan → Oct 2026 |
| Legs (L–O) | Single Leg RDL, Split Squats, Calf Raises | 32 | 30.01 → **19.08.2026** |

Observation worth a second look: leg day has had no entries for ~7 weeks, while pull and push keep going. A dashboard would have shown that on day 10.

## 2. Weaknesses in the data (why a prettier UI alone won't fix it)

**The column header stopped meaning the exercise.** This is the biggest problem for progressive overload, because a chart per column would plot different exercises as one line.
- "Bicep Curls" (C) holds negative pull-ups from late April, then pull-up pyramids from late May onward.
- "Single Leg RDL" (M) holds lateral raises (M33) and a whole pull-up + dip session (M27).
- "Australian Pull Ups" (B) holds jump squats (B40) and dip negatives (B29).
- "Calf Raises" (O) holds knee raises; "Split Squats" (N) holds normal and jump squats; "Face Pulls" (D) has "Calve Raises 25x 3" (D40).
- "Push Ups" (H) became diamond push-ups from mid-year; "Triceps Pulldowns" (I) once holds Australian pull-ups.

**At least seven different notations for the same thing.** `20x 15x 12x` · `25kg x 20 x3` · `20 x 3 mit 6kg` · `30kg 20x 3` · `35kg 25x2` · `Bands 50kg 20x 19x 20x` · `10x 7 every 2 minutes` · `15 down` · pyramids `1x 2x 3x 4x 5x 4x 3x 2x 5x dann 8x 7x …`. Whether `x3` means "3 sets" or "3 reps" depends on position.

**Dates are unreliable.**
- Mixed types: 10/6/10 cells are real Excel dates, the rest text (`31.01.26`, `09.02.2026`).
- Typos: `27.04.206` (L20), `02,05.2026` (F22), `06,05.2026` (F23), `03.07..2026` (A34).
- Probably wrong: `05.08.2026` (A49) sits between 31.08 and 08.09, so likely 05.09. F27 is 24.**06** between 20.05 and 28.05, so likely 24.05. A33 (06.07) comes before A34 (03.07).
- Rows 3–5 have no dates at all in every block. The "Extra" column embeds dates in text (`12.06.2026 Pullups…`), i.e. separate days hidden inside another session's row.

**Load is ambiguous.** `11,5kg` on Australian rows is added weight, `35kg` on curls/face pulls is a machine stack, `Bands 50kg` is nominal band resistance, `Bodyweight` sometimes explicit, mostly implied. Your bodyweight itself is never recorded, which matters for dips/pull-ups.

**Fractional reps** (`16,5x`, `13,2x`, `12,5x`). Half reps are fine, but `13,2x` needs a definition or it'll skew volume.

**Difficulty changes that aren't captured as fields.** Bar angle ("schräger", "flacher"), bar vs rings, band assistance, tempo ("langsam"), rest ("1m Rest", "every 2 minutes"). These *are* your progressive-overload levers in calisthenics, and today they're buried in notes. Same for context (erkältet, nach Essen), which is useful for explaining dips in a graph.

**Missing entirely:** effort (RPE / reps in reserve), session duration, bodyweight, and whether a set hit failure.

## 3. What any good solution needs (independent of tool)

One record per **set**: date, session type (Pull/Push/Legs/Other), exercise, variant (rings, diamond, angle, band…), added load (kg, can be negative for assistance), reps, optional rest/RPE/note. Exercises come from a list you pick from, not free text. Everything else (day view, PRs, volume, charts) is computed from that. Old data gets migrated once, with the ambiguous cells above flagged for you to confirm.

## 4. Options

| | A. Restructured Excel in Dropbox | B. Google Form → Sheet → Looker Studio | C. Own web app (PWA), data as a file in your Dropbox | D. Off-the-shelf app (Hevy, Strong…) |
|---|---|---|---|---|
| Cost | 0 | 0 | 0 (free static hosting + free Dropbox API app) | 0 for free tier, limits apply |
| Anywhere | Yes, via Dropbox | Yes, needs Google account | Yes, any browser, installable on phone, works offline | Yes |
| Phone input | Still a spreadsheet on a phone; better, still fiddly | Form is OK, but variable set counts and pyramids are clumsy | Built for your workouts: "repeat last session", +/− steppers, pyramid templates | Excellent |
| Day view | Filter/pivot, basic | Basic | Exactly what you described | Good, generic |
| Dashboard | Excel charts, limited on phone | Looker Studio: decent, clunky to customise | Fully custom (heatmap calendar, per-exercise progress, volume, PRs, split balance) | Fixed set of charts |
| Fits calisthenics (variants, bands, angles, ladders) | If you design it | Partly | Yes, by design | Poorly: weight-room model, variants become separate exercises |
| Data ownership | Yours, in Dropbox | Google | Yours, plain JSON/CSV in Dropbox | Vendor; CSV export |
| Effort / risk | Low effort, but discipline-dependent: free text creeps back | Medium; leaves Dropbox | Highest: I build it, someone maintains it; Dropbox token setup once per device | None to build; lock-in, may change pricing |

Notes on the tradeoffs:
- **A** is the cheapest change but doesn't solve your stated pain (phone input). Excel on a phone via Dropbox also risks "conflicted copy" files when two devices edit.
- **B** works today with zero code, but moves you off Dropbox and the dashboard tool is generic.
- **C** is the only one that meets every requirement you listed *and* keeps Dropbox. The app is static files (free hosting such as GitHub Pages or Cloudflare Pages); it reads/writes a data file in your Dropbox app folder through Dropbox's API, so your data never sits on someone else's server. Writes can be revision-checked to avoid conflicted copies. The cost is that it's software: bugs, a phone browser update could break something, and changes need someone (me) to make them.
- **D** is the fastest path to a nice phone experience, but your training is exactly the kind they model badly (pyramids, "15 down", band assistance, rings vs bar), and I haven't verified current free-tier limits; check before committing.

## 5. Recommendation

**C**, with a one-time migration of the XLSX into the set-level format, flagging every ambiguous cell (≈ the list in section 2) for you to confirm rather than guessing.

Where I'd challenge the brief: the real problem isn't that XLS is fiddly, it's that there's no data model. Any tool you pick, including C, only produces useful progressive-overload graphs if exercise, variant, load and reps are separate fields. If you'd rather not own software, **A with a strict log tab** fixes the data problem at low cost and C can come later on top of it.

## 6. Decisions I need from you before building

1. Option: C (recommended), A, B or D?
2. Track bodyweight? (Needed for meaningful dip/pull-up load and for weight-vest vs bodyweight comparisons.)
3. Pyramids/ladders: count as individual sets (precise, more taps) or one "ladder" entry with a pattern (fast)?
4. Effort field: RPE, reps-in-reserve, or none?
