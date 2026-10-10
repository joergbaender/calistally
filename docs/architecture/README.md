# Architecture

Diagrams and guides that explain how CalisTally fits together. The specs under [../superpowers/specs/](../superpowers/specs/) stay the source of truth; where a picture and a spec disagree, the spec wins and the picture is fixed.

## Index

| File | Shows |
|---|---|
| [system-overview.svg](system-overview.svg) | The whole system on one page: UI, Data, Store, IndexedDB, Engine, Dropbox client, Dropbox App folder, hosting, migration |

![CalisTally system overview](system-overview.svg)

## Reading the overview

- **Blue is the gateway.** Every read and write of training data goes through the Store (spec 3 §5). Screens never call Dropbox; the only arrow that leaves the browser starts at the Dropbox client.
- **Writes land locally first.** A screen edit becomes `writeFile`, which validates, saves to IndexedDB and queues the file. The Engine is nudged and pushes later, so the app works offline.
- **One engine per device.** Several tabs may write; only the tab holding the Web Lock `calistally-sync` runs the Engine, and a BroadcastChannel tells the other tabs which paths changed (spec 3 §5).
- **The model is pure.** `src/model` has no I/O and is used by the UI, the sync layer and the migration script (spec 1).
- **Dashed means manual and one-off.** The XLSX migration runs on a PC and its output is copied into the App folder by hand (spec 3 §11).

## Where each part is specified

| Part | Spec |
|---|---|
| Entities, validation, versions, file layout, derived values | [spec 1](../superpowers/specs/2026-10-06-data-model-design.md) |
| XLSX migration | [spec 2](../superpowers/specs/2026-10-07-xlsx-migration-design.md) |
| Dropbox login and client, IndexedDB, write queue, merge, engine, app update, hosting | [spec 3](../superpowers/specs/2026-10-07-sync-hosting-design.md) |
| UI layer, tabs, signals, edits, routing | [spec 4](../superpowers/specs/2026-10-10-training-views-design.md) |

## Maintaining the diagrams

- SVGs are hand-authored and self-contained: one file, no external fonts or images, colours as CSS variables with a `prefers-color-scheme: dark` block, so they render in GitHub, an editor preview and a browser tab alike.
- Keep one claim per diagram. A new subject (the sync drain step by step, the data model, the login flow) gets its own file and a row in the index above.
- No personal data, dates or real file names in a diagram: the repository is public.
- Update the overview when a layer, a module boundary or an external system changes; a feature inside a tab does not belong here.
