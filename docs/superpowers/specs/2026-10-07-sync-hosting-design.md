# Spec 3: Sync and hosting

- **Date:** 2026-10-07
- **Status:** awaiting the owner's approval (design agreed section by section on 2026-10-07)
- **Scope:** everything between the data model and the screens: the Dropbox login (OAuth 2 PKCE with a refresh token), the Dropbox client, the IndexedDB local copy, the pending-write queue, `rev`-checked uploads, the merge built on the record rules of spec 1 §3, duplicate session files, first load on a new device, the one-tap app update, the Vite PWA scaffold with a thin diagnostic shell, hosting on GitHub Pages, the steps that make the repository safe to publish, and how the migration output gets into the App folder. This spec covers **no training views** (spec 4) and **no overload calculations** (v1.1).

Builds on [spec 1](2026-10-06-data-model-design.md) (entities, record rules, file layout, validation levels, versioning; its rules win over anything here) and [spec 2](2026-10-07-xlsx-migration-design.md) (the migrated files this spec has to carry into Dropbox). Where HANDOVER.md disagrees with this spec, this spec wins.

---

## 1. Purpose and success

The app is a static PWA with no backend. Every byte of training data lives in two places: the owner's Dropbox App folder and an IndexedDB copy on each device. This spec makes those two agree without ever losing a set that was tapped in at the gym, without ever producing a Dropbox "conflicted copy", and without ever letting a stale app overwrite a file written by a newer one.

Devices: an **iPhone (Safari, installed to the home screen)** and a **Windows PC (Chrome)**. One person, at most two devices writing, usually one at a time.

Spec 3 is done when:

1. the sync library under `src/sync/` passes the tests of §14, all in Node, against a fake Dropbox and a fake IndexedDB;
2. the shell (§12) runs on `https://joergbaender.github.io/calistally/` and on `http://localhost:5173/`, logs in to the real Dropbox app from the PC and from the installed iPhone app, and shows the migrated history (147 session files) after one sync on a fresh device;
3. a set logged offline on the phone reaches Dropbox on the next sync, and an edit made on both devices to the same file merges without a conflicted copy;
4. the repository is public with no name, no bodyweight, no sheet cell and no secret in it or in its history (§10).

## 2. Decisions recorded (2026-10-07)

| # | Decision | Alternative rejected |
|---|---|---|
| S1 | Target devices: iPhone Safari as an installed home-screen app, Windows Chrome. The design optimises for WebKit's storage and redirect behaviour. | Android assumptions |
| S2 | **Hosting: GitHub Pages** from a GitHub Actions workflow; the repository becomes public after the scrub and history rewrite of §10. | Cloudflare Pages (in maintenance mode since 2025) and Cloudflare Workers (private repo possible, second account) |
| S3 | Spec 3 ships the **Vite scaffold and a thin diagnostic shell**, so hosting, redirect URIs, the installed-app login and storage persistence are verified on the real devices now. | Library only (risk moves to spec 4); a first logging screen (spec 4 design pulled forward) |
| S4 | **Sync backbone:** a per-file state machine over IndexedDB, a plain `fetch` client of seven calls, one syncer per origin. No Dropbox SDK. | The SDK (18 KB gzipped, owns the PKCE verifier, generated types between schema and wire); a service-worker-driven queue (Safari has no Background Sync) |
| S5 | **Migration output reaches the App folder by manual copy** through the Dropbox desktop client. The shell treats an empty App folder as a state of its own so the seed cannot race the copy. | An import feature (one-off UI, 149 parallel uploads, the pattern that earns 429s) |
| S6 | **Change detection by cursor pulls** at start, on foreground, after a push, on `online`, and every 5 min while visible. No longpoll, no Background Sync. | Longpoll (one more call, little gain for one user) |
| S7 | **PKCE state lives in IndexedDB**, never sessionStorage, and a **paste-the-code login** exists as a fallback for redirect trouble on iOS. | sessionStorage (WebKit has lost it across cross-origin redirects) |
| S8 | **Tie-break on equal `updatedAt`:** tombstone wins; otherwise the copy whose canonical JSON of own fields sorts higher. Output arrays sorted by `id`. | Device ids, "local wins" (not symmetric) |
| S9 | **First load:** `download_zip` of `/sessions` when more than 20 session files are missing locally, unzipped by an own reader over `DecompressionStream('deflate-raw')`. | Per-file downloads (147 round trips); `fflate` (12 KB gzipped for one function) |
| S10 | **App update is prompted, never automatic.** One button; reload waits for the syncer to be idle. | `autoUpdate` (a reload mid-ladder) |
| S11 | **Git identity:** the owner's personal address; both work addresses are mapped away in the history rewrite. | — |
| S12 | **Queue order:** `/exercises.json`, `/bodyweight.json`, then sessions by enqueue time. A held-back catalog write does not block sessions. | Strict blocking (would lock training data behind an app bug) |
| S13 | The owner creates the Dropbox app; nothing in this project touches the Dropbox account without asking first. | — |

## 3. Dropbox app, login and tokens

### The Dropbox app (created by the owner, when §10 is done and the Pages URL exists)

- App Console → Create app → **Scoped access** → **App folder** → name `CalisTally`, app folder name `CalisTally`. If the name is taken, the next free variant (for example `CalisTally Log`); the folder name is what the owner sees under `Dropbox/Apps/`, the app name is cosmetic.
- Permissions: `files.metadata.read`, `files.content.read`, `files.content.write`. Nothing else.
- Redirect URIs: `https://joergbaender.github.io/calistally/` and `http://localhost:5173/`. Dropbox accepts plain `http` for localhost only.
- Access token expiration: short-lived. The console has no setting for it: new apps only get short-lived access tokens, and `token_access_type=offline` adds the refresh token.
- The **app key is public** and lives in `src/app/config.ts`. There is no client secret anywhere; PKCE replaces it. Development status is fine for one user.

### Login (authorization code with PKCE)

1. The app draws a 64-character `code_verifier` from the unreserved set (`[A-Za-z0-9-._~]`) with `crypto.getRandomValues`, a 32-character `state` the same way, and computes `code_challenge = base64url(SHA-256(verifier))`.
2. It stores `{ verifier, state, createdAt }` in the IndexedDB `auth` store under the key `pending-login` and **awaits the transaction** before navigating. The row expires after 10 minutes.
3. It navigates to `https://www.dropbox.com/oauth2/authorize` with `client_id`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `token_access_type=offline`, `state` and `redirect_uri` (the page's own base URL).
4. Dropbox redirects to the base URL with `code` and `state` (or `error` if the owner declined). On load the app compares `state` with the pending row, posts `grant_type=authorization_code`, `code`, `client_id`, `code_verifier`, `redirect_uri` (form-encoded) to `https://api.dropboxapi.com/oauth2/token`, stores `refresh_token`, `access_token`, `expires_at` under `auth/tokens`, deletes the pending row and cleans the URL with `history.replaceState`.

**On the iPhone the login runs inside the installed app.** A home-screen web app has storage of its own, separate from Safari, so a token obtained in Safari would never reach the app. Navigating to dropbox.com from the installed app opens Dropbox in the in-app sheet; when Dropbox redirects to a URL inside the app's scope, iOS returns to the app with that URL (behaviour since iOS 12.2). The shell detects standalone mode (`display-mode: standalone`, `navigator.standalone`) and, on iOS outside it, shows "add this page to your Home Screen first" above the connect button.

**Fallback: paste the code.** The same flow without `redirect_uri`; Dropbox then shows the authorization code on screen, the owner pastes it into the shell, and the exchange is identical. This exists for the case where the in-app redirect misbehaves on some iOS version; it is not the default. Details (amended 2026-10-09):

- "Paste a code instead" stores the pending login and shows the paste panel with a link, "Open Dropbox to get the code" (`target="_blank"`, `rel="noopener"`), above the code field. The owner taps the link. No `window.open` after the awaited IndexedDB write and SHA-256: WebKit may treat that as a popup without a user gesture and block it.
- iOS may reload the installed app while the owner is in Dropbox. On start, a stored `paste` login younger than 10 minutes brings the panel back with the same link (rebuilt from the stored verifier and state), so the copied code still matches.
- A re-render while the owner types or pastes keeps the field's value, and its focus and selection when it had focus; a render that changes nothing does not touch the page.

### Tokens

- Access tokens expire after 4 hours (`expires_in: 14400`). The client refreshes with `grant_type=refresh_token`, `refresh_token`, `client_id` when a call returns 401 or the token is within 5 minutes of `expires_at`. One refresh per failing call, retried once; concurrent calls share one in-flight refresh promise.
- The refresh token has no time limit. It stops working when the owner unlinks the app in Dropbox's settings or revokes it; the client then reports `unauthorized`, the engine stops, and the shell shows "connect again". **Local data and the queue are kept.**
- **Sign out** calls `POST https://api.dropboxapi.com/2/auth/token/revoke` (revokes the refresh token too), then clears `auth`, `files`, `queue` and `meta`. If the queue is non-empty the shell refuses until the owner confirms losing those writes.
- Tokens are script-readable, in IndexedDB as everything else. The threat is cross-site scripting; the app loads no third-party script and ships a `Content-Security-Policy` meta tag (`default-src 'self'; connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com; img-src 'self' data:`). Pages cannot set response headers, so the meta tag is the available control.

## 4. The Dropbox client

`src/sync/dropbox-client.ts` exports the interface the engine uses and one implementation over `fetch`. The tests use `fake-dropbox.ts`.

```ts
interface DropboxClient {
  listFolder(): Promise<DropboxResult<Listing>>;                 // path '', recursive, limit 2000; follows has_more
  listFolderContinue(cursor: string): Promise<DropboxResult<Listing>>;  // follows has_more; 'reset' → error 'cursor-reset'
  getLatestCursor(): Promise<DropboxResult<string>>;
  download(path: string): Promise<DropboxResult<{ rev: string; text: string }>>;
  upload(path: string, text: string, mode: { add: true } | { rev: string }): Promise<DropboxResult<{ rev: string }>>;
  downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>>;
  revokeToken(): Promise<DropboxResult<void>>;
}
interface Listing { entries: ListingEntry[]; cursor: string }
type ListingEntry =
  | { kind: 'file'; path: string; rev: string; size: number }   // path = path_lower
  | { kind: 'folder'; path: string }
  | { kind: 'deleted'; path: string };
type DropboxResult<T> = { ok: true; value: T } | { ok: false; error: DropboxError; message: string; retryAfterMs?: number };
type DropboxError = 'conflict' | 'missing' | 'cursor-reset' | 'unauthorized' | 'rate-limited' | 'offline' | 'other';
```

- RPC calls go to `https://api.dropboxapi.com/2/…` with a JSON body. Content calls go to `https://content.dropboxapi.com/2/…` with the arguments in the `Dropbox-API-Arg` header as JSON with every non-ASCII character escaped (`\uXXXX`); our paths are ASCII anyway. `download` reads `rev` from the `Dropbox-API-Result` response header.
- `upload` sends `Content-Type: application/octet-stream`, `mode: {".tag": "update", "update": rev}` or `"add"`, `strict_conflict: true`, `mute: true`, `autorename: false`, and `content_hash` (Dropbox's block hash; for files under 4 MB that is `hex(sha256(sha256(bytes)))`), so a body corrupted in transit is rejected instead of stored.
- `downloadZip` is called with `/sessions`; the result is the raw zip.
- Timeouts through `AbortController`: 30 s for RPC calls, 120 s for content calls.
- **Error mapping:** 401 → refresh once and retry; a second 401, or a refresh Dropbox rejects (400/401, or no tokens) → `unauthorized`; a refresh that fails on the network or with a 5xx from the token endpoint → `offline` (the access token lasts 4 h, so the first sync of a workout usually refreshes, often offline). 409 with `error.reason['.tag'] === 'conflict'` on upload (`error_summary` `path/conflict/…`) → `conflict`; 409 with `not_found` on download → `missing`; 409 with `error['.tag'] === 'reset'` on continue → `cursor-reset`. 429 → `rate-limited` with `retryAfterMs` from `Retry-After` (default 1 s). Network failure, abort, or 5xx → `offline`. Anything else → `other` with the `error_summary`.

## 5. Local store and the write path

### IndexedDB

Database `calistally`, version 1, four object stores. All views read from here; nothing reads Dropbox directly.

```ts
interface FileRow {
  path: string;                 // key; the Dropbox path_lower, e.g. '/sessions/2030/2030-03-04_ab12cd34.json'
  kind: FileKind;
  rev: string | null;           // null until the file exists in Dropbox
  content: unknown;             // the upgraded file at MODEL_VERSION when status is 'ok'; the raw file otherwise
  status: ReadStatus;           // from readFile
  issues: ValidationIssue[];
  version: number;              // bumped on every local write; the engine's race guard (§7)
  syncedAt?: string;            // last time content and rev matched Dropbox
  duplicateOf?: string;         // set on the losing path of a duplicate session (§6)
  remoteDeleted?: true;         // the file vanished from Dropbox (§7)
}
interface QueueRow {
  path: string;                 // key; one row per path
  kind: FileKind;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
  heldBack?: ValidationIssue[]; // the write failed validateForWrite; stays local until it passes
  pendingContent?: unknown;     // local content parked while the remote file is too new (§6)
  pendingVersion?: number;      // MODEL_VERSION the pending content is at
}
```

`auth` holds `tokens` and `pending-login` (§3). `meta` holds the `list_folder` cursor, `lastPullAt`, `lastPushAt`, `persisted` (result of `navigator.storage.persist()`), `seededBuild` (§6) and `emptyFolderChoice` (§11).

### Writing

`writeFile(kind, path, file)` is what spec 4's screens call. The caller passes a complete file object whose records already carry their new `updatedAt` (record helpers of spec 1). One IndexedDB transaction over `files` and `queue`:

1. **ReadStatus guard.** If the row exists with status `read-only`, `needs-update` or `quarantined`, or carries `duplicateOf`, the write is refused: `{ ok: false, reason }`. Nothing is stored. The UI must not offer edits on such files, and this guard is what makes that a rule rather than a convention.
2. **Validation.** `validateForWrite(kind, file)`. On failure the content is **still saved and enqueued**, with `heldBack` set to the issues: nothing typed is lost, Dropbox keeps its last valid version, the shell shows the error (spec 1 §5). Every push attempt re-validates, so a fixed app releases the write without any manual step. The result is `{ ok: true, heldBack: issues }`.
3. **Save.** The row's `content` is replaced, `version` incremented, `status` set to `ok`; the queue row is upserted (`enqueuedAt` kept if present, so a session that is being logged does not keep jumping to the back). Then the engine is nudged.

A session's path is fixed when the session is first written: `/sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json` from its `date` and the first 8 characters of its `id` (`paths.ts`). The first upload uses `add`; every later one `update` with the stored `rev`. Files are never deleted or moved (spec 1 D12, §3). Twenty sets tapped into one session are one queue row; the content pushed is always the current row, never a snapshot.

Read helpers: `getRow(path)`, `sessions()` (status `ok`, no `duplicateOf`), `catalog()`, `bodyweight()`, `issues()` (every row that is not plain `ok`, plus queue rows with `heldBack` or `lastError`).

### Tabs and persistence

Any tab may call `writeFile`. The engine runs only in the tab that holds the Web Lock `calistally-sync` (`lock.ts`); other tabs request it and take over when the holder closes. A `BroadcastChannel` named `calistally` (`channel.ts`) announces changed paths so open tabs refresh. Both are behind interfaces with Node fakes. On first run the app calls `navigator.storage.persist()`, stores the result in `meta`, and the shell shows it; WebKit grants it to installed home-screen apps, which is also what exempts the data from the 7-day cleanup.

## 6. The merge

### Per record

`mergeRecord(a, b)` for two copies of one record (same `id`):

1. The copy with the **newer `updatedAt`** supplies all own fields, `deletedAt` included.
2. On **equal `updatedAt`**: a tombstone beats a live copy. If both are live or both tombstoned, the copy whose **canonical JSON** of own fields sorts higher (plain string comparison) wins. Canonical JSON is `JSON.stringify` with object keys sorted recursively, child arrays (`blocks`, `sets`) excluded.
3. **Child arrays** merge by `id`, recursively: a child present on both sides is merged, a child on one side only is kept unchanged (absence means "never seen", never "deleted"; deletion is a tombstone).
4. Output child arrays are **sorted by `id`**. Array position carries no meaning (spec 1 §3); sorting makes `merge(a, b)` and `merge(b, a)` byte-identical.

Properties the tests pin: symmetric, idempotent (`merge(x, x) = x`; merging a tombstone with an older copy or with itself changes nothing), and convergent (`merge(merge(a, b), c) = merge(a, merge(b, c))`). Undelete (newer `updatedAt` without `deletedAt`) wins by rule 1.

### Per file

`mergeFile(kind, local, remote)` applies the above to `exercises[]`, `entries[]`, or `session` → `blocks` → `sets`, and returns the merged file with `schemaVersion: MODEL_VERSION`. Both inputs must be at `MODEL_VERSION`: the engine runs `readFile` (upgrade plus validation) on anything it downloads and `upgradeFile` on parked pending content before merging. The merged result is run through `validateForWrite` before it is saved; a failure there is an app bug and is held back like any other.

**Equal content** (amended 2026-10-09). Whether to push is decided by `sameRecords(merged, remote)`: canonical JSON after every array of records (objects with a string `id`: `exercises`, `entries`, `blocks`, `sets`) has been sorted by `id`, at every level. Other arrays (`tags`) stay positional; a reordered `tags` is a real edit. If the merged file differs from the remote in this sense, the path is queued. If it equals the remote, nothing is queued, and the local copy keeps the remote file as downloaded, record order included, so a later local edit uploads the file in that order (the migrated files are in training order, which is easier to read by hand than id order). The same comparison decides whether the local copy changed (its `version` goes up), whether released parked changes rewrite the row, and whether a duplicate winner is rewritten (spec 1 §4).

Why not plain canonical JSON: rule 4 sorts merged arrays by `id`, but files written elsewhere (the migration, a hand edit, another build) need not be in id order. A positional compare then sees a merge that only reorders records as a change, and every remote change would cost each other device one extra upload. The tie-break (rule 2) keeps the positional canonical JSON: own fields never contain a record array.

### Too-new remote with local changes

When a pull downloads a file whose status is `read-only` or `needs-update` and the queue holds that path, the row's content becomes the raw remote (status as read) and the local content moves to `queue.pendingContent` with `pendingVersion = MODEL_VERSION`. The queue row stays. After the app has been updated so that `MODEL_VERSION` is at least the file's version, the next drain upgrades the pending content, merges it with the (now readable) remote, saves and pushes. Nothing is dropped, and nothing too-new is ever written (spec 1 D9).

### Catalog healing and the seed

After every pull that changed something, the engine runs `restoreReferenced(catalog, sessions)` over the local catalog and all local `ok` sessions; if it returns a changed catalog, that is a normal `writeFile` of `/exercises.json`.

`mergeSeed` runs **once per build** (`meta.seededBuild` = the build hash) and only when a catalog exists remotely or the owner chose "Start with the seed catalog" on an empty folder (§11). It never runs before the device's first successful pull, so a fresh device cannot race its own seed against the real catalog. Added entries go through `writeFile`.

### Duplicate session files

The pull indexes session rows by `session.id`. When two paths share one id, the engine merges their contents by the rules above, writes the result through `writeFile` to the path that **sorts first**, marks the other row `duplicateOf: <first path>` (hidden from views, refused by the write guard), and the issue stays listed until the second path disappears from Dropbox (a `deleted` listing entry), as spec 1 §4 requires.

## 7. The sync engine

One **drain** is a pull followed by a push. Pulling first keeps most conflicts from happening at all.

### Pull

1. **Listing.** With no cursor in `meta`: `listFolder()` (recursive from the root), cursor saved. Otherwise `listFolderContinue(cursor)`, which returns only what changed; one request when nothing did. On `cursor-reset`, the cursor is dropped and a full listing runs.
2. **Filter.** Only these paths are data: `/exercises.json`, `/bodyweight.json`, and `/sessions/<yyyy>/<yyyy-mm-dd>_<8 hex>.json`. Any other `.json` under the root or `/sessions/` (a desktop "conflicted copy", a stray file) is listed as an issue `unexpected-file` and never read. Everything else (`export/`, folders, `review.md`) is ignored.
3. **Download.** For each data entry whose `rev` differs from the row's, download (four at a time; reads do not contend for Dropbox's write lock), `readFile(kind, JSON.parse(text))`, then: no local row → save as read; local row with status `ok` and remote `ok` → `mergeFile`, save, queue if the merge added anything; remote `read-only`/`needs-update` → save raw with that status, and if the path is queued, park the local content as in §6; remote `quarantined` → save raw with status and issues (never overwritten; a queued local write for that path is held with `lastError: 'Dropbox copy invalid'`).
4. **Deleted entries.** A `deleted` listing entry for a data path keeps the row and its content, sets `rev: null` and `remoteDeleted: true`, and lists an issue. The file is re-created (mode `add`) only if the queue holds the path; the app never deletes files, so a deletion is always external.
5. After the loop: duplicate detection, `restoreReferenced`, seed (§6), `lastPullAt`.

### First load on a new device

After the listing, if more than 20 session entries have no local row, the engine calls `downloadZip('/sessions')` and unzips in the browser (`zip.ts`: central directory, local headers, stored entries copied, deflated entries through `DecompressionStream('deflate-raw')`, which Safari has since 16.4 and Chrome since 80). Each entry's `rev` is taken from the listing by path. The result goes through the same per-file step 3. For the migrated history that is one request of about 900 KB instead of 147 round trips. A file that changed between listing and zip carries a stale `rev`, which surfaces as an ordinary conflict on its next upload and merges. If the zip call fails (`too_large` is impossible at this size; a network error is not), the engine falls back to per-file downloads.

### Push

Walk the queue in the order of S12. For each row:

1. Skip rows whose `heldBack` is set after re-validating the current content (a now-valid content clears `heldBack` and proceeds). Skip rows whose file row is `read-only`/`needs-update`/`quarantined` (the pending content waits).
2. Read the row's `content` and `version`, serialise with `JSON.stringify(content, null, 2)` plus a trailing newline (matches the migration's output), upload with `{ add: true }` when `rev` is null, else `{ rev }`.
3. On success: store the new `rev`, `syncedAt`, and delete the queue row **only if the row's `version` is unchanged**; otherwise the newer content goes on the next drain.
4. On `conflict` (also for `add`, when the file appeared meanwhile): download, `readFile`, then as in Pull step 3 (`ok` → merge, save, upload again with the remote `rev`; too-new → park; `quarantined` → hold with `lastError`). Three conflicts on one path in one drain end the drain; `attempts` and `lastError` are recorded.
5. On `rate-limited`: wait `retryAfterMs`, retry the same row. On `offline`: the drain stops and backs off. On `unauthorized`: the engine stops until a new login. On `other`: `lastError`, skip the row, continue.

### Triggers and backoff

- App start; every `visibilitychange` to visible (iOS resumes the app this way); the `online` event; every 5 min while visible: **full drain**.
- 1 s after any `writeFile` (debounced): **push only**.
- Transient failures (`offline`, 5xx) back off 2 s, 4 s, 8 s … capped at 5 min, reset on success or `online`. A drain never runs twice at once in a tab, and only the lock holder runs it.

### Status

`engine.status` (observable): `phase` (`idle` | `pulling` | `pushing`), `online`, `connected`, `queueLength`, `heldBackCount`, `lastPullAt`, `lastPushAt`, `lastError`, `issues`, `tooNewSeen`.

## 8. Versions, too-new files and the one-tap update

- **Service worker** through `vite-plugin-pwa` with `registerType: 'prompt'`. Workbox precaches the built app shell only; requests to `dropboxapi.com` are never intercepted or cached. The build hash and date are injected at build time and shown in the shell.
- **Update checks** (`registration.update()`): at start, on every return to the foreground, hourly while open, and immediately when a pull marks any file `read-only` or `needs-update` (`tooNewSeen`). When a new build is waiting, the shell shows **"Update app"**: one tap posts `SKIP_WAITING`, waits for the engine to be idle (at most 10 s), and reloads on `controllerchange`. Never an automatic reload.
- **Too-new file, no build offered yet:** the shell says "a newer version of the app wrote this file; update as soon as one is offered". The file stays readable and unwritable (spec 1 §5); the old build keeps creating and writing files at its own version; parked local changes wait (§6).
- **Model version bump safeguards**, added now so the first real bump cannot be the first test: `upgradeFile` wraps each step in try/catch and returns `{ status: 'invalid', message }` on a throw (the raw file is quarantined untouched); a test walks `UPGRADE_STEPS` and asserts a step for every kind and every version from 1 to `MODEL_VERSION - 1`.

## 9. Hosting and deployment

- **GitHub Pages**, source "GitHub Actions". Workflow `.github/workflows/deploy.yml` on push to `main`: checkout, Node 24, `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `actions/upload-pages-artifact` from `dist/`, `actions/deploy-pages`. Permissions `pages: write`, `id-token: write`; concurrency group `pages` so two pushes do not race. A failing test blocks the deploy.
- Vite `base: '/calistally/'`; manifest `start_url` and `scope` the same; the service worker scope follows. No client routing: the OAuth redirect lands on the base URL with a query string.
- Local development: `npm run dev` on `http://localhost:5173/` (Vite's default, fixed with `strictPort` so the redirect URI stays valid).
- Pages serves `index.html` with a short cache lifetime; the service worker's update checks handle the rest.

## 10. Going public: scrub and history rewrite

The repository holds no training files, tokens or session dates, but the owner's first name, their bodyweight and a few quoted sheet cells. Both steps below are done before the first deploy; the first in the implementation branch, the second after that branch is merged.

### Scrub (in the working tree)

Rule: **every personal name, and every number or cell quoted from the real sheet, is replaced by a neutral word or a synthetic value.** The notations stay; they are what the parser documents.

- Docs: `docs/HANDOVER.md`, `docs/tracker-options.md`, both earlier specs, both earlier plans, `CLAUDE.md`: the name becomes "the owner"; the bodyweight figure becomes "the configured value"; sheet cells (the dips entry in spec 2 M3 and its decisions example, the ladder examples of spec 1 §1, the notation samples of HANDOVER §5) get made-up numbers.
- Code: `BODYWEIGHT_KG` is removed from `src/migration/sheet.ts`; `scripts/migrate-xlsx.ts` gains a required `--bodyweight <kg>` option (a positive number; missing or invalid → exit 2 with the usage line) passed through `runMigration` to `buildSessions`. A rerun with the real value stays byte-identical. The comment in `sheet.ts` that names the owner is reworded. Tests use a synthetic value.
- Memory files and the migration output live outside the repository and are untouched.

### History rewrite and repository recreation

A force-push alone is not enough: GitHub keeps the diffs of merged pull requests and their commits reachable. So the history is rewritten **and the repository is recreated**. Every destructive step is confirmed with the owner at the time:

1. `git filter-repo` (needs Python; `git filter-branch` is the built-in fallback) with `--replace-text` (the name → "the owner") and `--mailmap` (both work addresses → the personal address). Commit trailers stay.
2. Rename the current repository to `calistally-old` (stays private).
3. Create a fresh public `calistally` under the same account, push `main`, enable Pages, confirm the site loads at `https://joergbaender.github.io/calistally/`.
4. Delete `calistally-old` (`gh auth refresh -s delete_repo` once).
5. Re-clone; create the Dropbox app (§3) with the live redirect URI.

The GitHub handle stays in the repository URL and the Pages URL; that is accepted.

## 11. Migration output into the App folder; first run

The FINAL migration output (`exercises.json`, `bodyweight.json`, `sessions/2026/*.json`) is copied by hand through the Dropbox desktop client. The files passed `validateForWrite` when they were written; the desktop client handles the upload; no one-off code.

The one hazard is a race with the seed: an app that pulls an empty folder and immediately seeds `/exercises.json` would collide with the copied catalog and the desktop client would produce a conflicted copy. Therefore the shell treats an **empty App folder** (first pull returns no data files) as a state with two actions, and the engine seeds only after one of them:

- **"Start with the seed catalog"**: the seed is written, normal operation begins.
- **"I'll copy files in, then sync"**: the engine idles; "Sync now" runs the next pull.

The owner's sequence: log in once from the PC (this creates `Dropbox/Apps/CalisTally`); choose the second action; copy `exercises.json`, `bodyweight.json` and `sessions/` from the migration output into that folder (not `review.md`, not `report.md`); wait for the desktop client to finish; tap "Sync now". The phone then gets the history on its first login through the zip path of §7.

Hand edits to the JSON files on the PC later are just another writer: merged if valid, quarantined if not, listed either way. A hand edit must also set the edited record's `updatedAt` to a newer time (exactly `YYYY-MM-DDTHH:mm:ss.sssZ`), on the record whose own fields changed: the session for its note, the set for its reps, not the parent or the children (spec 1 §3). Without that, the edited copy and a device's copy have the same `updatedAt`, the tie-break of §6 decides by canonical JSON, and the old copy may win and be pushed back over the edit.

## 12. The shell

One page in plain DOM (`src/app/shell.ts`), deliberately plain; spec 4 replaces it and keeps everything under `src/sync/`.

| State | Shows |
|---|---|
| Not connected | Connect button; "paste the code" fallback; on iOS outside standalone mode the home-screen hint |
| Empty folder | The two actions of §11 |
| Connected | Status block (phase, online, last pull and push, queue length, held-back count, last error); "Sync now"; issues list (path, kind, reason) covering quarantined, read-only, needs-update, unexpected-file, duplicate, remote-deleted and held-back; "Update app" when a build is waiting, or the too-new notice; build hash; persistence status; counts of sessions, exercises and bodyweight entries as a sanity check; sign out |
| Disconnected (token revoked) | "Connect again", data and queue kept |

Nothing here edits training data.

## 13. Module layout and dependencies

| File | Responsibility |
|---|---|
| `src/sync/dropbox-client.ts` | `DropboxClient` interface, the `fetch` implementation, error mapping, token refresh hook |
| `src/sync/auth.ts` | PKCE (verifier, challenge, state), login start and completion, paste-code exchange, refresh, revoke, token storage |
| `src/sync/db.ts` | Database open/upgrade, typed stores, a promise wrapper over IndexedDB requests and transactions |
| `src/sync/store.ts` | `writeFile` with the guard and validation, read helpers, issues |
| `src/sync/merge.ts` | `canonicalJson`, `sameRecords`, `mergeRecord`, `mergeChildren`, `mergeFile` |
| `src/sync/paths.ts` | Session path from date and id; path classification (data, unexpected, ignored) |
| `src/sync/zip.ts` | Zip reader over `DecompressionStream` |
| `src/sync/engine.ts` | Pull, push, drain, triggers, backoff, status |
| `src/sync/lock.ts`, `src/sync/channel.ts` | Web Locks and BroadcastChannel behind interfaces, with fakes |
| `src/sync/fake-dropbox.ts`, `src/sync/test-fixtures.ts` | In-memory Dropbox with `rev`, conflict, 429 and offline injection; fixture builders (dates in 2030) |
| `src/app/config.ts`, `main.ts`, `shell.ts`, `sw-update.ts` | App key and URLs; bootstrap; the shell; service-worker update handling |
| `index.html`, `vite.config.ts`, `public/` | Scaffold, PWA plugin, manifest, icons |
| `.github/workflows/deploy.yml` | Build, test, deploy to Pages |

Dependencies: `vite`, `vite-plugin-pwa`, `fake-indexeddb` as dev dependencies. **No new runtime dependency.** Node 24 provides `fetch`, `crypto.subtle`, `DecompressionStream`, `CompressionStream` (to build zips in tests) and `BroadcastChannel`, so the tests need no browser and no jsdom.

## 14. Testing

Tests come first and run in Node. Fixtures are synthetic, dates in 2030; no real file, name or number.

- **merge:** symmetry, idempotency and convergence over randomly generated record trees with a fixed seed; every tombstone case (tombstone vs live at equal and unequal `updatedAt`, tombstone with itself, tombstone with an older copy, undelete); the canonical-JSON tie-break; child union; both file kinds; output sorted by `id`; the merged result validates; `sameRecords` ignores record position at every level and keeps `tags` positional.
- **store:** the ReadStatus guard for each refused status and for `duplicateOf`; a write that fails validation is saved, queued with `heldBack`, and released once a later write passes; queue coalescing keeps `enqueuedAt`; `version` increments; read helpers hide non-`ok` rows.
- **engine** (fake Dropbox, fake IndexedDB, fake timers, fake lock): plain push with `add` then `update`; conflict → download → merge → retry with the remote `rev`; catalog-first order; a held-back catalog row does not block sessions; cursor pull returns only changes and `cursor-reset` relists; too-new remote parks the local content and a later run with a raised `MODEL_VERSION` releases it; a quarantined remote is never overwritten and the local write is held; duplicate session files merge to the first path and flag the second; a deleted remote entry keeps the row and re-creates only if queued; first load through a zip built in the test (stored and deflated entries), with the per-file fallback when the zip call fails; the version-counter race (a write during upload keeps the queue row); 429 honours `Retry-After`; backoff sequence and reset; `unauthorized` stops the engine; only the lock holder drains; `restoreReferenced` and the seed run after a pull, the seed only once per build and only after the empty-folder choice; a merge that only reorders records (session, catalog, bodyweight, duplicate sessions) pushes nothing, bumps no version and keeps the remote's record order.
- **auth:** the RFC 7636 test vector (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`); verifier and state shape; `state` mismatch refused; expired pending login refused; refresh once on 401 and `unauthorized` on the second; one in-flight refresh shared by parallel calls; the paste-code exchange; a fresh paste login resumes with the same URL, an expired or redirect login does not; sign out revokes and clears, and refuses with a non-empty queue.
- **shell** (plain strings and a minimal fake root, no DOM library): the paste panel shows the Dropbox link as an escaped `<a target="_blank" rel="noopener">`; a render that changes nothing does not write the page; a re-render keeps the typed code, and its focus and selection only when it had focus. Real focus and keyboard behaviour is checked by hand.
- **client:** request shapes for each call (headers, `Dropbox-API-Arg` escaping, `mode`, `strict_conflict`, `content_hash`); each error mapping; timeouts.
- **zip:** stored and deflated entries, several files, the data-descriptor flag, a truncated archive rejected.
- **paths:** session path from date and id; classification of data, unexpected and ignored paths.
- **spec 1 leftovers:** every kind has every upgrade step; a throwing step yields `invalid` and the raw file is unchanged; the CLI `--bodyweight` option (required, validated, passed through).
- **Browser checklist** (manual, in the plan): PC login; installed-app login on the iPhone; persistence granted; offline write on the phone then sync; both devices editing one session; the update prompt after a deploy; the empty-folder flow and the migration copy.

## 15. Deliverables

1. Scaffold: `index.html`, `vite.config.ts` with `vite-plugin-pwa`, manifest and icons, `npm run dev` / `npm run build` / `npm run preview`, `tsconfig` adjusted for the browser entry.
2. `src/sync/` as in §13, with tests as in §14.
3. The spec 1 leftovers: try/catch in `upgradeFile`, the every-kind-every-step test.
4. The scrub (§10) and the `--bodyweight` option.
5. The shell (§12) and service-worker update handling (§8).
6. `.github/workflows/deploy.yml` (§9).
7. `CLAUDE.md`: status, commands, the sync rules in "Core rules", the new layout, "To fill in later" updated (app key, final app name).
8. After merge, with the owner: the history rewrite and repository recreation (§10), Pages enabled, the Dropbox app created, the migration output copied (§11), first login on both devices, the browser checklist run.

## 16. Out of scope

Longpoll; CSV export (`export/sets.csv`, spec 4, a plain overwrite outside the merge); any import UI; all training views (spec 4); tombstone garbage collection; multi-user anything.

## 17. To fill in once known

- The Dropbox app key: in `src/app/config.ts` since 2026-10-08.
- The final app and folder name: `CalisTally`, as planned.
- The first deploy and the repository recreation: both on 2026-10-08.
