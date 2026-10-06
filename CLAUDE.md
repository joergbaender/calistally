# CalisTally

A calisthenics training tracker built as a static PWA. It reads and writes JSON data files in the user's Dropbox through the Dropbox API (App folder, OAuth 2 PKCE). There is no backend and no paid infrastructure. It replaces a free-text XLSX log.

**Status:** pre-build. The repo has docs only; no code has been written yet. Update this file as the structure takes shape (see "To fill in" below).

## Read first

- [docs/HANDOVER.md](docs/HANDOVER.md): the brief. Covers goals, the owner's decisions, the draft data model, Dropbox storage design, v1 features, XLSX migration rules, open questions and next steps. It's the source of truth until code replaces it.
- [docs/tracker-options.md](docs/tracker-options.md): the option analysis behind the chosen architecture, and what's wrong with the XLSX data. (HANDOVER.md calls this `analysis/tracker-options.md`; in this repo it lives in `docs/`.)

## Core rules (from HANDOVER.md, do not drift)

- **One record per set.** Day views, volume, PRs and charts are derived and never stored.
- **Sets are the source of truth.** SetGroup patterns (pyramids/ladders, fully custom such as `1 2 3 5 6 5 4 2 5`) exist only for display and "repeat last time".
- Session `type` is a label and must never constrain which exercises can be logged.
- Reps may be decimal (partial reps). No RPE/RIR field.
- Bodyweight is its own time series. Anything computed from bodyweight factors is labelled an estimate.
- Exercises come from a catalog, and exercises with history are archived, never deleted.
- Dropbox writes use `mode: update` + last known `rev`. On a conflict: download, merge by record `id` (uuid), retry. Never produce "conflicted copy" files.
- Offline-first: IndexedDB local copy plus a pending-write queue.
- Migration never guesses silently. Anything ambiguous goes on a review list for the owner.

## Never commit

Training data, the XLSX (`*.xlsx` is gitignored), Dropbox tokens, `.env` files, or any local data folder. The repo may become public (GitHub Pages).

## Planned stack

Vite + TypeScript PWA (chart library not chosen yet). Hosting: GitHub Pages or Cloudflare Pages (open question). Migration script in Node or Python.

## To fill in once the code exists

- Repo layout
- Commands: install, dev server, build, test, lint, migration script
- Where the TypeScript types and JSON schema for the data model live
- Dropbox app name, redirect URIs (prod + `http://localhost:<port>`)
- Testing approach (sync/merge conflict tests come first)
