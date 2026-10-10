# CalisTally

A calisthenics training tracker for one person, built as a static web app (PWA). Log a workout set by set on the phone, review past sessions, and keep the history as plain JSON files in your own Dropbox. It replaces a free-text spreadsheet log.

- **No backend, no paid infrastructure.** The app is static files on GitHub Pages; the data lives in a Dropbox App folder you own.
- **Offline first.** Every screen reads and writes a local copy; changes sync to Dropbox when a connection is available, and two devices merge cleanly.
- **Your data stays readable.** One JSON file per session, validated against a documented schema.

## How it fits together

![CalisTally system overview: the browser app talks only to its local store; one sync engine exchanges files with a Dropbox App folder; GitHub Pages serves the static build](docs/architecture/system-overview.svg)

Screens never call Dropbox. They edit through the Store, which validates and saves to IndexedDB and queues the change. A single sync engine per device pulls from and pushes to Dropbox, merging conflicts per record.

## Learn more

- [docs/architecture/](docs/architecture/): diagrams and guides.
- [docs/superpowers/specs/](docs/superpowers/specs/): the design specs (data model, XLSX migration, sync and hosting, training views).
- [CLAUDE.md](CLAUDE.md): project rules, repository layout and commands.
