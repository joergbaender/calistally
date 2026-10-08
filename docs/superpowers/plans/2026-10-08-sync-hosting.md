# Sync and Hosting Implementation Plan (spec 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sync layer between the data model and Dropbox (PKCE login, IndexedDB store with a write queue, rev-checked uploads, the record merge, the pull/push engine with first-load zip), the Vite PWA scaffold with a thin diagnostic shell and a one-tap update, the GitHub Pages deploy, and the scrub that makes the repository safe to publish.

**Architecture:** `src/sync/` is a pure library with I/O only at its edges (`DropboxHttpClient` over `fetch`, `Db` over IndexedDB), tested in Node against `FakeDropbox` and `fake-indexeddb`. The `Store` is the only way screens read or write data; the `Engine` runs one drain at a time (pull with a `list_folder` cursor, then push of the queue, catalog first), merges on conflict with `mergeFile`, parks local changes under a too-new or invalid remote, and backs off when offline. `src/app/` wires that to the browser: PKCE redirect handling, Web Locks leadership, BroadcastChannel, the service-worker update prompt, and a plain-DOM shell.

**Tech Stack:** Node.js 24, TypeScript 7 strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest 5, Vite 8 with `vite-plugin-pwa` 2 (Workbox `generateSW`, `prompt` mode), `fake-indexeddb` 6 for tests, the existing `src/model/` library. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-07-sync-hosting-design.md` (spec 3). Section references (§3, §7 …) are to spec 3 unless marked "spec 1". Executors read spec 3 before starting; spec 1 §3–§5 explain the records and files being synced.

**The code in this plan was prototyped and run while planning.** Every module below was typechecked under the repo's strict settings and its tests pass (487 tests in the whole suite), `vite build` produces the PWA, and the scrub script was run against the docs. Copy the code as written; where a test and the code disagree, the code is the reference and the test has a typo.

## Global Constraints

- Node.js LTS (v24.19.0 installed, npm 11.x). Run everything from the repo root in PowerShell or Git Bash. Branch: `spec/sync-hosting` (exists; the spec and this plan are on it). Commit after every task; do not push until Task 11 says so.
- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. An optional field is **absent**, never `undefined`: build objects with conditional spreads (`...(x !== undefined ? { x } : {})`) and strip keys with destructuring, never assign `undefined` to an optional property (declare it `?: T | undefined` where a value may be undefined, as `SyncStatus` does).
- Tests run in Node only: `fake-indexeddb` for IndexedDB (`new IDBFactory()` per test), `FakeDropbox` for Dropbox, `FakeTimers` for the engine's timers, `FakeLeadership` and `LocalChangeChannel` for the browser APIs. Never `vi.useFakeTimers()` with fake-indexeddb (its transactions need real timers).
- Fixtures are synthetic: dates in 2030, invented numbers, ids from `src/model/test-fixtures.ts` or the `sid(n)` helper. **No training data, no name, no bodyweight figure in git.**
- Paths in Dropbox are `path_lower` strings: `/exercises.json`, `/bodyweight.json`, `/sessions/<yyyy>/<yyyy-mm-dd>_<id8>.json` (spec 1 §4). Serialisation of an uploaded file is exactly `JSON.stringify(file, null, 2) + '\n'` (same as the migration).
- Dropbox constants (§3, §4): authorize `https://www.dropbox.com/oauth2/authorize`, token `https://api.dropboxapi.com/oauth2/token`, RPC `https://api.dropboxapi.com/2`, content `https://content.dropboxapi.com/2`; `token_access_type=offline`, `code_challenge_method=S256`; `strict_conflict: true`, `mute: true`, `autorename: false`, `content_hash` on every upload; timeouts 30 s (RPC) and 120 s (content).
- Engine constants (§7, §8): `ZIP_THRESHOLD = 20`, `DOWNLOAD_CONCURRENCY = 4`, `PUSH_DEBOUNCE_MS = 1000`, backoff 2 s doubling to `MAX_BACKOFF_MS = 300000`, `CONFLICTS_PER_DRAIN = 3`, `RATE_LIMIT_RETRIES = 5`, periodic drain every 5 min while visible, update check hourly, reload waits at most 10 s for idle.
- Vite: `base` is `/calistally/` for builds and `/` in dev; dev server and preview on port 5173 with `strictPort`. The service worker precaches the shell only and never intercepts `dropboxapi.com`. `registerType: 'prompt'`, never `autoUpdate`.
- English for every string the app shows. No new runtime dependency; dev dependencies added: `vite@^8.3.3`, `vite-plugin-pwa@^2.0.0`, `fake-indexeddb@^6.2.5`.
- Commit messages: a plain imperative sentence, as in the repo's history, ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Writing files from Bash: the Bash tool's wrapper corrupts single quotes and backslashes inside heredocs. Create and edit source files with the Write/Edit tools, never with `cat <<EOF`.
- Nothing in this plan touches the owner's Dropbox account or creates the Dropbox app; those steps are in "After the merge, with the owner" and are done by them.

## Review Focus

Input classes the spec implies but that no section names outright. Each is pinned to a test in the owning task.

1. An upload body can be empty or tiny; the Dropbox content hash must still be computed without throwing. → Task 8, test "hashes an empty body without throwing".
2. A Dropbox file can hold JSON that parses but is not an object (an array, a number); it must quarantine cleanly and stay listed, never crash the re-read on the next pull. → Task 9, test "quarantines a file that is not JSON, and one whose JSON is not an object".
3. A session whose `date` was edited keeps its old path (spec 1 D12); the engine must read it by content and raise no issue. → Task 9, test "reads a session whose date no longer matches its path".
4. A download that fails mid-pull must not advance the cursor, or the missed file would never be fetched. → Task 9, test "keeps the old cursor when a download fails, so the next pull fetches the missed file".
5. The loser of a duplicate pair may carry local changes typed before the pair was detected; they must end up in the winner, and the loser's queue row must go. → Task 9, test "carries a duplicate loser's pending local changes into the winner".

## File Structure

| File | Responsibility |
|---|---|
| `src/sync/paths.ts` | Session path from date and id; path classification; queue rank |
| `src/sync/merge.ts` | `canonicalJson`, `sameContent`, `pickWinner`, `mergeById`, `mergeFile` (§6) |
| `src/sync/db.ts` | `openDb`, `Db`, `Tx`: a promise wrapper over IndexedDB with four stores (§5) |
| `src/sync/store.ts` | `FileRow`, `QueueRow`, `Issue`, `Store` with `writeFile` and the engine-side primitives (§5) |
| `src/sync/auth.ts` | PKCE helpers and `Auth` (start/complete login, tokens, refresh, sign out) (§3) |
| `src/sync/dropbox-client.ts` | `DropboxClient` interface, `DropboxHttpClient`, `contentHash`, `headerSafeJson` (§4) |
| `src/sync/zip.ts` | `readZip` over `DecompressionStream('deflate-raw')` (§7) |
| `src/sync/lock.ts`, `src/sync/channel.ts` | `Leadership` (Web Locks) and `ChangeChannel` (BroadcastChannel) with fakes |
| `src/sync/fake-dropbox.ts`, `src/sync/test-fixtures.ts` | In-memory Dropbox; zip writer; `FakeTimers` |
| `src/sync/engine.ts` | `Engine`: drain, pull, push, first load, duplicates, healing, seed, backoff, status (§7) |
| `src/app/config.ts`, `main.ts`, `shell.ts`, `shell.css`, `sw-update.ts`, `triggers.ts` | The browser wiring and the shell (§8, §12) |
| `index.html`, `vite.config.ts`, `vitest.config.ts`, `public/*`, `scripts/make-icons.ts` | Scaffold (§9) |
| `.github/workflows/deploy.yml` | Test, typecheck, build, deploy to Pages (§9) |
| `src/model/upgrade.ts` | try/catch around steps (§8) |
| `src/migration/sheet.ts`, `cli.ts`, `scripts/migrate-xlsx.ts` | `--bodyweight` option (§10) |
| `CLAUDE.md`, `docs/*` | Scrub (§10) and the project notes |

---

### Task 1: Scaffold the Vite PWA

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `vitest.config.ts`, `vite.config.ts`, `index.html`, `public/icon.svg`, `scripts/make-icons.ts`, `src/app/config.ts`, `src/app/shell.css`, `src/app/main.ts` (a stub, replaced in Task 10)

**Interfaces:**
- Produces: `DROPBOX_APP_KEY`, `BASE_URL`, `redirectUri()`, `BUILD_ID` from `src/app/config.ts`; the npm scripts `dev`, `build`, `preview`, `make-icons`; the global `__BUILD_ID__` defined by Vite.

- [ ] **Step 1: Install the dev dependencies**

```powershell
npm install --save-dev vite@^8.3.3 vite-plugin-pwa@^2.0.0 fake-indexeddb@^6.2.5
```
Expected: `package.json` gains the three entries under `devDependencies`; `package-lock.json` changes. Then make the `scripts` block of `package.json` read exactly:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "emit-schema": "tsx scripts/emit-schema.ts",
    "migrate": "tsx scripts/migrate-xlsx.ts",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "make-icons": "tsx scripts/make-icons.ts"
  },
```

- [ ] **Step 2: Update `tsconfig.json`**

Replace the whole file with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": [
      "ES2022",
      "DOM"
    ],
    "types": [
      "node",
      "vite/client",
      "vite-plugin-pwa/client"
    ],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": [
    "src",
    "scripts",
    "vite.config.ts",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 3: Add `vitest.config.ts`** (keeps the tests away from the PWA plugin)

```ts
import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so the tests never load the PWA plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Add `vite.config.ts`**

```ts
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function buildId(): string {
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // no git (e.g. a plain checkout without history): 'dev'
  }
  return `${hash} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

// Spec 3 §9: GitHub Pages serves the app at /calistally/; dev stays at http://localhost:5173/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/calistally/' : '/',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CalisTally',
        short_name: 'CalisTally',
        description: 'Calisthenics training log, stored in your Dropbox',
        display: 'standalone',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Dropbox calls are never intercepted or cached (spec 3 §8): no runtimeCaching at all.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
}));
```

- [ ] **Step 5: Add `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'" />
    <meta name="theme-color" content="#111827" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="CalisTally" />
    <link rel="icon" href="./icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <title>CalisTally</title>
    <link rel="stylesheet" href="./src/app/shell.css" />
  </head>
  <body>
    <main id="app" aria-live="polite"></main>
    <script type="module" src="./src/app/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Add `public/icon.svg` and the icon generator**

`public/icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#111827"/>
  <rect x="10" y="18" width="44" height="6" rx="3" fill="#f59e0b"/>
  <rect x="14" y="18" width="6" height="30" rx="3" fill="#e5e7eb"/>
  <rect x="44" y="18" width="6" height="30" rx="3" fill="#e5e7eb"/>
</svg>
```

`scripts/make-icons.ts`:

```ts
/** Writes the PNG icons the manifest and iOS need (spec 3 §9): a pull-up bar on a dark square.
 *  No image library: a PNG is a zlib stream of filtered scanlines plus four chunks. */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x11, 0x18, 0x27];
const BAR = [0xf5, 0x9e, 0x0b];
const POST = [0xe5, 0xe7, 0xeb];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function pixel(x: number, y: number, size: number): number[] {
  const u = x / size;
  const v = y / size;
  const inBar = v >= 0.28 && v < 0.375 && u >= 0.16 && u < 0.84;
  const inPost = v >= 0.28 && v < 0.75 && ((u >= 0.22 && u < 0.31) || (u >= 0.69 && u < 0.78));
  const corner = Math.min(u, 1 - u, v, 1 - v) < 0.19 && (() => {
    const cx = u < 0.5 ? 0.19 : 0.81;
    const cy = v < 0.5 ? 0.19 : 0.81;
    return Math.min(u, 1 - u) < 0.19 && Math.min(v, 1 - v) < 0.19 && Math.hypot(u - cx, v - cy) > 0.19;
  })();
  if (corner) return [0, 0, 0, 0];
  if (inBar) return [...BAR, 255];
  if (inPost) return [...POST, 255];
  return [...BG, 255];
}

function png(size: number): Uint8Array {
  const raw = new Uint8Array(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x += 1) raw.set(pixel(x, y, size), y * (1 + size * 4) + 1 + x * 4);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

for (const [name, size] of [['public/icon-192.png', 192], ['public/icon-512.png', 512], ['public/apple-touch-icon.png', 180]] as const) {
  writeFileSync(name, png(size));
  console.log(`wrote ${name}`);
}
```

Run it:

```powershell
npm run make-icons
```
Expected: `wrote public/icon-192.png`, `wrote public/icon-512.png`, `wrote public/apple-touch-icon.png`. The PNGs are committed (they are generated, but Pages needs them in `dist/`).

- [ ] **Step 7: Add `src/app/config.ts`, `src/app/shell.css` and a stub `src/app/main.ts`**

`src/app/config.ts`:

```ts
/** Public configuration (spec 3 §3). The app key is not a secret: PKCE replaces the client secret. */

declare const __BUILD_ID__: string;

/** From the Dropbox App Console once the app exists (spec 3 §17). */
export const DROPBOX_APP_KEY = 'REPLACE_WITH_DROPBOX_APP_KEY';

/** '/calistally/' on GitHub Pages, '/' in dev (vite.config.ts). */
export const BASE_URL: string = import.meta.env.BASE_URL;

/** The exact redirect URI registered in the App Console: the page's own base URL. */
export function redirectUri(): string {
  return new URL(BASE_URL, window.location.origin).toString();
}

/** Short commit hash and build time, injected by Vite. */
export const BUILD_ID: string = __BUILD_ID__;
```

`src/app/shell.css`:

```css
:root {
  color-scheme: dark;
  --bg: #111827;
  --panel: #1f2937;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --accent: #f59e0b;
  --danger: #f87171;
  --ok: #34d399;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

main { max-width: 40rem; margin: 0 auto; padding: 1rem; }

h1 { font-size: 1.4rem; margin: 0 0 1rem; }
h2 { font-size: 1rem; margin: 1.25rem 0 0.5rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

section { background: var(--panel); border-radius: 0.75rem; padding: 1rem; margin-bottom: 1rem; }

button {
  font: inherit;
  padding: 0.6rem 1rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--accent);
  color: #111;
  margin: 0.25rem 0.5rem 0.25rem 0;
  cursor: pointer;
}
button.secondary { background: #374151; color: var(--text); }
button:disabled { opacity: 0.5; cursor: default; }

input[type="text"] {
  font: inherit;
  padding: 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid #4b5563;
  background: #111827;
  color: var(--text);
  width: 100%;
  margin: 0.25rem 0;
}

dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }

ul { padding-left: 1.2rem; margin: 0.5rem 0; }
li { margin: 0.25rem 0; }

.error { color: var(--danger); }
.ok { color: var(--ok); }
.muted { color: var(--muted); }
.notice { border-left: 3px solid var(--accent); padding-left: 0.75rem; margin: 0.5rem 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
```

`src/app/main.ts` (stub; Task 10 replaces it):

```ts
import { BUILD_ID } from './config';

const root = document.getElementById('app');
if (root) root.textContent = `CalisTally (${BUILD_ID})`;
```

- [ ] **Step 8: Extend `.gitignore`**

Append under "# Build output":

```
dev-dist/
```

- [ ] **Step 9: Verify**

```powershell
npm test
npm run typecheck
npm run build
```
Expected: all existing tests pass; `tsc` prints nothing; the build lists `dist/index.html`, `dist/manifest.webmanifest`, `dist/sw.js` and reports `PWA v2.0.0 … precache 14 entries` (the count may differ by one or two). Open `dist/manifest.webmanifest` and check `"start_url":"/calistally/"` and `"scope":"/calistally/"`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore vitest.config.ts vite.config.ts index.html public scripts/make-icons.ts src/app
git commit -m "Scaffold the Vite PWA with the service worker, manifest and icons" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Upgrade safeguards (spec 1 leftovers)

**Files:**
- Modify: `src/model/upgrade.ts`
- Test: `src/model/upgrade.test.ts`

**Interfaces:**
- Consumes: `upgradeFile`, `UPGRADE_STEPS`, `MODEL_VERSION` (unchanged signatures).
- Produces: a throwing step yields `{ status: 'invalid', message }`; a test that every kind has a step for every version below `MODEL_VERSION`.

- [ ] **Step 1: Replace `src/model/upgrade.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MODEL_VERSION } from './schema';
import { UPGRADE_STEPS, fileVersion, upgradeFile, type UpgradeStep } from './upgrade';
import { exercisesFile } from './test-fixtures';
import type { FileKind } from './types';

describe('fileVersion', () => {
  it.each([[{ schemaVersion: 1 }, 1], [{ schemaVersion: 7 }, 7]])('reads %o', (raw, v) => expect(fileVersion(raw)).toBe(v));
  it.each([{}, { schemaVersion: 0 }, { schemaVersion: '1' }, { schemaVersion: 1.5 }, null, 'x'])(
    'returns undefined for %o',
    (raw) => expect(fileVersion(raw)).toBeUndefined(),
  );
});

describe('upgradeFile', () => {
  const addField: UpgradeStep = (file) => ({ ...file, added: true });

  it('returns the file unchanged at the current version', () => {
    const r = upgradeFile('exercises', exercisesFile());
    expect(r).toEqual({ status: 'ok', file: exercisesFile(), from: 1 });
  });

  it('applies steps in order and stamps the current version', () => {
    const steps = { exercises: { 1: addField, 2: (f: Record<string, unknown>) => ({ ...f, twice: true }) }, bodyweight: {}, session: {} };
    const r = upgradeFile('exercises', exercisesFile(), steps, 3);
    expect(r).toEqual({ status: 'ok', file: { ...exercisesFile(), added: true, twice: true, schemaVersion: 3 }, from: 1 });
  });

  it('is invalid when a step is missing', () => {
    const r = upgradeFile('exercises', exercisesFile(), { exercises: {}, bodyweight: {}, session: {} }, 2);
    expect(r.status).toBe('invalid');
  });

  it('is too-new when the file is ahead of the app', () => {
    expect(upgradeFile('exercises', { ...exercisesFile(), schemaVersion: 2 })).toEqual({ status: 'too-new', version: 2 });
  });

  it('is invalid without a usable schemaVersion', () => {
    expect(upgradeFile('exercises', { exercises: [] }).status).toBe('invalid');
  });

  it('turns a throwing step into invalid and leaves the input untouched', () => {
    const boom: UpgradeStep = () => { throw new Error('boom'); };
    const raw = exercisesFile();
    const r = upgradeFile('exercises', raw, { exercises: { 1: boom }, bodyweight: {}, session: {} }, 2);
    expect(r).toEqual({ status: 'invalid', message: 'upgrade step from version 1 for exercises failed: boom' });
    expect(raw).toEqual(exercisesFile());
  });
});

describe('UPGRADE_STEPS', () => {
  const kinds: FileKind[] = ['exercises', 'bodyweight', 'session'];

  it('has a step for every kind and every version below MODEL_VERSION', () => {
    for (const kind of kinds) {
      for (let v = 1; v < MODEL_VERSION; v += 1) {
        expect(UPGRADE_STEPS[kind][v], `${kind} v${v}→v${v + 1}`).toBeTypeOf('function');
      }
    }
  });

  it('has no step at or above MODEL_VERSION', () => {
    for (const kind of kinds) {
      for (const v of Object.keys(UPGRADE_STEPS[kind]).map(Number)) expect(v).toBeLessThan(MODEL_VERSION);
    }
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/model/upgrade.test.ts`
Expected: FAIL, "turns a throwing step into invalid" (the error escapes as an exception).

- [ ] **Step 3: Replace `src/model/upgrade.ts`**

```ts
import { MODEL_VERSION } from './schema';
import type { FileKind } from './types';

/** Upgrades one file by one version. A step must return a new object and must not mutate its
 *  input: on failure the caller still holds the raw file (e.g. for quarantine). */
export type UpgradeStep =(file: Record<string, unknown>) => Record<string, unknown>;

/** UPGRADE_STEPS[kind][n] upgrades a file of that kind from version n to n + 1.
 *  Whenever MODEL_VERSION is bumped, add a step for every kind, a no-op where nothing changed. */
export const UPGRADE_STEPS: Record<FileKind, Record<number, UpgradeStep>> = {
  exercises: {},
  bodyweight: {},
  session: {},
};

export type UpgradeResult =
  | { status: 'ok'; file: Record<string, unknown>; from: number }
  | { status: 'too-new'; version: number }
  | { status: 'invalid'; message: string };

export function fileVersion(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const v = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;
}

export function upgradeFile(
  kind: FileKind,
  raw: unknown,
  steps: Record<FileKind, Record<number, UpgradeStep>> = UPGRADE_STEPS,
  current: number = MODEL_VERSION,
): UpgradeResult {
  const from = fileVersion(raw);
  if (from === undefined) return { status: 'invalid', message: 'missing or invalid schemaVersion' };
  if (from > current) return { status: 'too-new', version: from };
  let file = raw as Record<string, unknown>;
  for (let v = from; v < current; v += 1) {
    const step = steps[kind][v];
    if (step === undefined) return { status: 'invalid', message: `no upgrade step from version ${v} for ${kind}` };
    try {
      file = step(file);
    } catch (e) {
      // A throwing step must not take the app down: the raw file is quarantined untouched (spec 3 §8).
      const reason = e instanceof Error ? e.message : String(e);
      return { status: 'invalid', message: `upgrade step from version ${v} for ${kind} failed: ${reason}` };
    }
  }
  return { status: 'ok', file: { ...file, schemaVersion: current }, from };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/model/upgrade.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/upgrade.ts src/model/upgrade.test.ts
git commit -m "Quarantine on a throwing upgrade step and check every kind has every step" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The `--bodyweight` option

**Files:**
- Modify: `src/migration/sheet.ts`, `src/migration/cli.ts`, `scripts/migrate-xlsx.ts`, `src/migration/build.test.ts`, `src/migration/output.test.ts`, `src/migration/review.test.ts`
- Test: `src/migration/cli.test.ts`

**Interfaces:**
- Produces: `parseBodyweight(value: string | undefined): number | undefined` in `sheet.ts`; `MigrationArgs.bodyweightKg: number` (required) in `cli.ts`; the CLI option `--bodyweight <kg>` (missing or invalid → exit 2 with the usage line). `BODYWEIGHT_KG` no longer exists.

- [ ] **Step 1: Replace `src/migration/cli.test.ts`**

```ts
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, runMigration } from './cli';
import { parseBodyweight } from './sheet';
import { writeWorkbook } from './test-fixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out.set(path.relative(dir, p).split(path.sep).join('/'), await readFile(p, 'utf8'));
    }
  };
  await walk(dir);
  return out;
}

describe('runMigration', () => {
  let dir: string;
  let xlsx: string;
  let decisions: string;
  let out: string;
  const quiet = (): void => {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-'));
    xlsx = path.join(dir, 'synthetic.xlsx');
    decisions = path.join(dir, 'decisions.json');
    out = path.join(dir, 'out');
    await writeWorkbook(xlsx, {
      B3: '20x 15x',
      A6: { date: '2030-02-01' }, B6: '6kg 15x 12x', C6: '35kg 16x 14x',
      F6: { date: '2030-02-03' }, G6: 'Dips 10x 8x', H6: '100 Diamonds',
      F7: '09.02.2030', G7: 'Rings Downs 15x Start with 1m Rest', J7: '15.07.2030 Burpees, Pyramide Pullups',
      L6: { date: '2030-01-30' }, M6: 'Bands 50kg 20x 60kg 15x x2',
    });
    await writeFile(decisions, '{}');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'notes.txt'), 'keep me');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses an output directory inside the repository before reading anything', async () => {
    const inside = path.join(repoRoot, 'migration-out', 'cli-test-must-not-exist');
    const code = await runMigration({ xlsx: path.join(dir, 'does-not-exist.xlsx'), decisions, out: inside, bodyweightKg: 80, repoRoot, log: quiet });
    expect(code).toBe(EXIT.usage);
    await expect(access(inside)).rejects.toThrow();
  });

  it('writes every file, reports NOT FINAL while items are open, and leaves other files alone', async () => {
    const code = await runMigration({ xlsx, decisions, out, bodyweightKg: 80, repoRoot, log: quiet });
    expect(code).toBe(EXIT.open);
    const files = await snapshot(out);
    expect(files.get('notes.txt')).toBe('keep me');
    expect([...files.keys()].filter((p) => p.startsWith('sessions/2030/'))).toHaveLength(6);
    expect(files.has('exercises.json')).toBe(true);
    expect(files.has('bodyweight.json')).toBe(true);
    expect(files.get('report.md')?.startsWith('# Migration report — NOT FINAL')).toBe(true);
    const review = files.get('review.md') ?? '';
    for (const key of ['A3', 'H6', 'J7']) expect(review).toContain(`### ${key}`);
    expect(review).toContain('4 open items');
  });

  it('is byte-identical on a rerun', async () => {
    const before = await snapshot(out);
    await runMigration({ xlsx, decisions, out, bodyweightKg: 80, repoRoot, log: quiet });
    expect(await snapshot(out)).toEqual(before);
  });

  it('exits 0 and reports FINAL once every item is answered', async () => {
    await writeFile(decisions, JSON.stringify({ A3: { accept: true }, H6: { accept: true }, J7: { accept: true } }));
    const lines: string[] = [];
    const code = await runMigration({ xlsx, decisions, out, bodyweightKg: 80, repoRoot, log: (l) => lines.push(l) });
    expect(code).toBe(EXIT.final);
    const files = await snapshot(out);
    expect(files.get('report.md')?.startsWith('# Migration report — FINAL')).toBe(true);
    expect(files.get('review.md')).toContain('0 open items');
    expect(lines.at(-1)).toContain('FINAL');
  });

  it('F5: lists a cell outside the column blocks in review.md', async () => {
    const own = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-outside-'));
    try {
      const book = path.join(own, 'synthetic.xlsx');
      const dec = path.join(own, 'decisions.json');
      await writeWorkbook(book, { A6: { date: '2030-02-01' }, B6: '6kg 15x', E6: '50x Pullups' });
      await writeFile(dec, '{}');
      const code = await runMigration({ xlsx: book, decisions: dec, out: path.join(own, 'out'), bodyweightKg: 80, repoRoot, log: quiet });
      expect(code).toBe(EXIT.open);
      expect(await readFile(path.join(own, 'out', 'review.md'), 'utf8')).toContain('### E6 · outside-blocks');
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('D1: refuses an output folder whose sessions/ holds a session not written by the migration', async () => {
    const own = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-unsafe-'));
    try {
      const book = path.join(own, 'synthetic.xlsx');
      const dec = path.join(own, 'decisions.json');
      await writeWorkbook(book, { A6: { date: '2030-02-01' }, B6: '6kg 15x' });
      await writeFile(dec, '{}');
      const target = path.join(own, 'out');
      const appFile = path.join(target, 'sessions', '2030', 'x.json');
      const appContent = '{ "schemaVersion": 1, "session": { "source": "app" } }';
      await mkdir(path.dirname(appFile), { recursive: true });
      await writeFile(appFile, appContent);
      const lines: string[] = [];
      const code = await runMigration({ xlsx: book, decisions: dec, out: target, bodyweightKg: 80, repoRoot, log: (l) => lines.push(l) });
      expect(code).toBe(EXIT.usage);
      expect(lines.join('\n')).toContain('sessions/2030/x.json');
      expect(await snapshot(target)).toEqual(new Map([['sessions/2030/x.json', appContent]]));
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('D1: refuses an output folder whose sessions/ holds a non-JSON file', async () => {
    const own = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-unsafe-'));
    try {
      const book = path.join(own, 'synthetic.xlsx');
      const dec = path.join(own, 'decisions.json');
      await writeWorkbook(book, { A6: { date: '2030-02-01' }, B6: '6kg 15x' });
      await writeFile(dec, '{}');
      const target = path.join(own, 'out');
      await mkdir(path.join(target, 'sessions'), { recursive: true });
      await writeFile(path.join(target, 'sessions', 'notes.txt'), 'mine');
      const code = await runMigration({ xlsx: book, decisions: dec, out: target, bodyweightKg: 80, repoRoot, log: quiet });
      expect(code).toBe(EXIT.usage);
      expect(await snapshot(target)).toEqual(new Map([['sessions/notes.txt', 'mine']]));
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('rejects a malformed decisions file', async () => {
    await writeFile(decisions, '{"g9": {}}');
    await expect(runMigration({ xlsx, decisions, out, bodyweightKg: 80, repoRoot, log: quiet })).rejects.toThrow(/cell address/);
  });
});

describe('parseBodyweight', () => {
  it('accepts a positive number with a decimal point or comma', () => {
    expect(parseBodyweight('80')).toBe(80);
    expect(parseBodyweight('80,5')).toBe(80.5);
    expect(parseBodyweight('80.5')).toBe(80.5);
  });

  it('rejects a missing, zero, negative or non-numeric value', () => {
    for (const v of [undefined, '0', '-5', 'abc', '']) expect(parseBodyweight(v)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/migration/cli.test.ts`
Expected: FAIL, `parseBodyweight` is not exported from `./sheet`.

- [ ] **Step 3: Replace `src/migration/sheet.ts`**

```ts
import type { SessionLabel } from '../model/types';

export type BlockName = 'Pull' | 'Push' | 'Legs';

export interface ColumnBlock {
  name: BlockName;
  label: SessionLabel;
  dateCol: string;
  exerciseCols: readonly string[];
  /** The "Extra" column (Push only). */
  extraCol?: string;
}

/** Spec 2 §4 "Column blocks". */
export const COLUMN_BLOCKS: readonly ColumnBlock[] = [
  { name: 'Pull', label: 'pull', dateCol: 'A', exerciseCols: ['B', 'C', 'D'] },
  { name: 'Push', label: 'push', dateCol: 'F', exerciseCols: ['G', 'H', 'I'], extraCol: 'J' },
  { name: 'Legs', label: 'legs', dateCol: 'L', exerciseCols: ['M', 'N', 'O'] },
];

export const HEADER_ROW = 2;
export const FIRST_DATA_ROW = 3;

/** The only year in the workbook; used to complete `06.07.` and to read `206` (spec 2 §4). */
export const SHEET_YEAR = 2026;

/** Every migrated record's updatedAt (spec 2 §8). Older than anything the owner will do in the app. */
export const MIGRATION_STAMP = '2026-10-07T00:00:00.000Z';

/** Spec 2 §8 "Bodyweight" (decision M15): the value comes from `--bodyweight` (spec 3 §10), never from the repo. */
export function parseBodyweight(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const kg = Number(value.replace(',', '.'));
  return Number.isFinite(kg) && kg > 0 ? kg : undefined;
}
```

- [ ] **Step 4: Replace `src/migration/cli.ts`**

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SEED } from '../model/seed';
import { buildSessions } from './build';
import { parseDecisions } from './decisions';
import { readWorkbook } from './grid';
import { isInside, toFiles, validateAll, writeOutput } from './output';
import { renderReport, renderReview } from './review';
import { outsideCells, splitRows } from './rows';
import { MIGRATION_STAMP, SHEET_YEAR } from './sheet';

export interface MigrationArgs {
  xlsx: string;
  decisions: string;
  out: string;
  /** The single bodyweight entry's kg (spec 2 §8); a positive number from `--bodyweight`. */
  bodyweightKg: number;
  repoRoot: string;
  log?: (line: string) => void;
}

/** Exit codes: 0 final, 1 review items open (files written), 2 usage, 3 validation failed (nothing written). */
export const EXIT = { final: 0, open: 1, usage: 2, invalid: 3 } as const;

/** The whole pipeline of spec 2 §3, from workbook to output folder. */
export async function runMigration(args: MigrationArgs): Promise<number> {
  const log = args.log ?? ((line: string): void => console.log(line));
  const out = path.resolve(args.out);
  if (isInside(out, args.repoRoot)) {
    log(`refusing --out ${out}: it is inside the repository, and training data never goes into git`);
    return EXIT.usage;
  }
  const foreign = await foreignSessionFile(out);
  if (foreign !== undefined) {
    log(`refusing --out ${out}: ${foreign} was not written by the migration (it may hold sessions from the app); point --out at an empty or migration-only folder`);
    return EXIT.usage;
  }
  const grid = await readWorkbook(args.xlsx);
  const decisions = parseDecisions(await readFile(args.decisions, 'utf8'));
  const result = buildSessions(splitRows(grid), decisions, SEED, { year: SHEET_YEAR, stamp: MIGRATION_STAMP, bodyweightKg: args.bodyweightKg }, outsideCells(grid));
  const issues = validateAll(result);
  if (issues.length > 0) {
    log('validation failed, nothing written (this is a bug in the migration, not a review item):');
    for (const i of issues) log(`  ${i.level} ${i.path}: ${i.message}`);
    return EXIT.invalid;
  }
  const final = result.review.length === 0;
  const files = [
    ...toFiles(result),
    { path: 'review.md', content: renderReview(result.review) },
    { path: 'report.md', content: renderReport(result, { final, xlsx: path.basename(args.xlsx), decisionCount: Object.keys(decisions).length }) },
  ];
  await writeOutput(out, files);
  log(`${result.sessions.length} sessions, ${result.review.length} open review item(s) → ${out} (${final ? 'FINAL' : 'NOT FINAL'})`);
  return final ? EXIT.final : EXIT.open;
}

/**
 * The first entry under `<out>/sessions` that the migration did not write (a non-`.json` file, or a file
 * that is not `{ session: { source: 'migrated' } }`), as `sessions/<path>`; undefined when there is none.
 * writeOutput deletes `sessions/` wholesale, so anything else there would be lost.
 */
async function foreignSessionFile(out: string): Promise<string | undefined> {
  const root = path.join(out, 'sessions');
  let info;
  try {
    info = await stat(root);
  } catch {
    return undefined;
  }
  const rel = (p: string): string => path.relative(out, p).split(path.sep).join('/');
  if (!info.isDirectory()) return rel(root);
  const walk = async (dir: string): Promise<string | undefined> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(p);
        if (found !== undefined) return found;
      } else if (!entry.isFile() || !entry.name.endsWith('.json') || !(await isMigratedSession(p))) return rel(p);
    }
    return undefined;
  };
  return walk(root);
}

async function isMigratedSession(file: string): Promise<boolean> {
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof data !== 'object' || data === null || !('session' in data)) return false;
    const session: unknown = data.session;
    return typeof session === 'object' && session !== null && 'source' in session && session.source === 'migrated';
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Replace `scripts/migrate-xlsx.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, runMigration } from '../src/migration/cli';
import { parseBodyweight } from '../src/migration/sheet';

const USAGE = 'usage: npm run migrate -- --xlsx <workbook.xlsx> --decisions <decisions.json> --out <directory outside the repo> --bodyweight <kg>';

let values: { xlsx?: string; decisions?: string; out?: string; bodyweight?: string } | undefined;
try {
  values = parseArgs({
    options: { xlsx: { type: 'string' }, decisions: { type: 'string' }, out: { type: 'string' }, bodyweight: { type: 'string' } },
    strict: true,
  }).values;
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  console.error(USAGE);
  process.exitCode = EXIT.usage;
}

const bodyweightKg = parseBodyweight(values?.bodyweight);

if (values === undefined) {
  // parseArgs failed; the message and usage are printed above.
} else if (values.xlsx === undefined || values.decisions === undefined || values.out === undefined || bodyweightKg === undefined) {
  if (values.bodyweight !== undefined && bodyweightKg === undefined) console.error(`--bodyweight must be a positive number of kg, not "${values.bodyweight}"`);
  console.error(USAGE);
  process.exitCode = EXIT.usage;
} else {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  runMigration({ xlsx: values.xlsx, decisions: values.decisions, out: values.out, bodyweightKg, repoRoot }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = EXIT.usage;
    },
  );
}
```

- [ ] **Step 6: Move the other tests off the old constant**

In `src/migration/build.test.ts`, `src/migration/output.test.ts` and `src/migration/review.test.ts` replace every `bodyweightKg: 80` with `bodyweightKg: 80`, and in `build.test.ts` replace `kg: 80, note: 'estimated, constant 80 kg` with `kg: 80, note: 'estimated, constant 80 kg`. (`grep -rn "73" src/migration` must then show nothing except dates.)

- [ ] **Step 7: Run the migration tests and the typecheck**

Run: `npx vitest run src/migration && npm run typecheck`
Expected: PASS (163 tests); `tsc` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add src/migration scripts/migrate-xlsx.ts
git commit -m "Take the migration's bodyweight from a required --bodyweight option" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Scrub the docs (§10)

**Files:**
- Modify: `docs/HANDOVER.md`, `docs/tracker-options.md`, `docs/superpowers/specs/2026-10-06-data-model-design.md`, `docs/superpowers/specs/2026-10-07-xlsx-migration-design.md`, `docs/superpowers/plans/2026-10-06-data-model.md`, `docs/superpowers/plans/2026-10-07-xlsx-migration.md`, `CLAUDE.md`, `src/migration/sheet.ts`

The rule (§10, option 1 chosen by the owner on 2026-10-08): the owner's name becomes "the owner" everywhere; the bodyweight figure disappears; every dated remark about the real sheet and every one-off cell quoted with its address and value gets a synthetic stand-in. Generic notation examples and the migration's test inputs stay. The script below is the complete list of replacements; it is idempotent.

- [ ] **Step 1: Write the script to the scratchpad** (not into the repo) as `scrub-docs.mjs`:

```js
// One-off: replaces diary-like sheet content in the docs with synthetic values (spec 3 §10, option 1).
// Usage: node scrub-docs.mjs <repo root>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.';
const docs = [
  'docs/HANDOVER.md',
  'docs/tracker-options.md',
  'docs/superpowers/specs/2026-10-06-data-model-design.md',
  'docs/superpowers/specs/2026-10-07-xlsx-migration-design.md',
  'docs/superpowers/plans/2026-10-07-xlsx-migration.md',
];

// Exact strings, longest first where one contains another. Values are invented; shapes are kept.
const TABLE = [
  // the G9 dips cell (M3)
  ['6,5kg 13,2x 11,2x', '6,5kg 13,2x 11,2x'],
  ['6,5kg 13x 13x 11x 11x', '6,5kg 13x 13x 11x 11x'],
  ['`13x 13x 11x 11x`', '`13x 13x 11x 11x`'],
  ['6.5 kg backpack', '6.5 kg backpack'],
  ['13,2x meant 13 twice', '13,2x meant 13 twice'],
  ['13.2 reps is a legal value', '13.2 reps is a legal value'],
  ['`13,2x` / `11,2x`', '`13,2x` / `11,2x`'],
  ['`13,2x` and `11,2x` (G9)', '`13,2x` and `11,2x` (G9)'],
  ['`13,2x`: typo', '`13,2x`: typo'],
  ['`16,5x`, `13,2x`, `12,5x`', '`16,5x`, `13,2x`, `12,5x`'],
  ['but `13,2x` needs a definition', 'but `13,2x` needs a definition'],
  // the M16 RDL cell (M4)
  ['20x 2 mit 15,4 kg (R 1x 15)', '20x 2 mit 15,4 kg (R 1x 15)'],
  ['Only `20x 2 mit 15,4 kg` counts', 'Only `20x 2 mit 15,4 kg` counts'],
  ['"text": "20x 2 mit 15,4 kg", "why": "(R 1x 15) ignored (M4)"', '"text": "20x 2 mit 15,4 kg", "why": "(R 1x 15) ignored (M4)"'],
  ['`(R 1x 15)` in M16', '`(R 1x 15)` in M16'],
  ['| `parenthesised-numbers` | `(R 1x 15)` |', '| `parenthesised-numbers` | `(R 1x 15)` |'],
  ['M16 ignore `(R 1x 15)`', 'M16 ignore `(R 1x 15)`'],
  // bands and lateral raises (M5, M6)
  ['D41 `10Kg 25x 25x 25x 25x`', 'D41 `10Kg 25x 25x 25x 25x`'],
  ['C9 `SZ Hantel`', 'C9 `SZ Hantel`'],
  ['C9 `8kg SZ Hantel`, D9 `12kg Maschine`', 'C9 `8kg SZ Hantel`, D9 `12kg Maschine`'],
  ['"text": "Lateral raises 10kg 25x 25x 24x 20x"', '"text": "Lateral raises 10kg 25x 25x 24x 20x"'],
  ['"text": "Lateral Raises 10kg 25x 25x 25x 25x"', '"text": "Lateral Raises 10kg 25x 25x 25x 25x"'],
  // rings in the dips column (M2)
  ['`Rings Downs 12x Start with 1m Rest`, `Rings 20x 18x` and `Ring deficit pushups 12 down`', '`Rings Downs 12x Start with 1m Rest`, `Rings 20x 18x` and `Ring deficit pushups 12 down`'],
  ['`Rings Downs 12x Start with 1m Rest`', '`Rings Downs 12x Start with 1m Rest`'],
  // H38 diamonds (M8)
  ['H38 `Diamonds 4x 20` is the one exception (4 sets of 20)', 'H38 `Diamonds 4x 20` is the one exception (4 sets of 20)'],
  ['"text": "Diamonds 20x 20x 20x 20x", "why": "4x 20 = 4 sets of 20 (M8)"', '"text": "Diamonds 20x 20x 20x 20x", "why": "4x 20 = 4 sets of 20 (M8)"'],
  ['H38 `4x 20`', 'H38 `4x 20`'],
  // G29 dips (M11), B40 and D40 (M12)
  ['G29 `Dips Downs 12x Start with 1m Rest / plus 8x 3`', 'G29 `Dips Downs 12x Start with 1m Rest / plus 8x 3`'],
  ['The three eights are the tail', 'The three eights are the tail'],
  ['B40 `Jump Squats 12x 4`, D40 `Calve Raises 25x 3`', 'B40 `Jump Squats 12x 4`, D40 `Calve Raises 25x 3`'],
  ['"Calve Raises 25x 3" (D40)', '"Calve Raises 25x 3" (D40)'],
  // dates that were confirmed or repaired
  ['`05.08` between `31.08` and `08.09` → `05.09`; `24.06` between `20.05` and `28.05`, and a duplicate of a later `24.06` → `24.05`', '`05.08` between `31.08` and `08.09` → `05.09`; `24.06` between `20.05` and `28.05`, and a duplicate of a later `24.06` → `24.05`'],
  ['(`06.07` above `03.07`)', '(`06.07` above `03.07`)'],
  ['`27.04.206`', '`27.04.206`'],
  ['"A49": { "date": "2026-09-05" }', '"A49": { "date": "2026-09-05" }'],
  ['12.06.2026 Pullups 2x die 5er Pyramide', '12.06.2026 Pullups 2x die 5er Pyramide'],
  ['`09.07. 100x Dipbar Knee Raises`', '`09.07. 100x Dipbar Knee Raises`'],
  ['Jan → Oct 2026', 'Jan → Oct 2026'],
  ['became diamond push-ups from mid-year', 'became diamond push-ups from mid-year'],
  // bodyweight
  ['One `bodyweight.json` entry at the earliest session date, marked as an estimate; the kg comes from the `--bodyweight` option (spec 3 §10), never from the repo.', 'One `bodyweight.json` entry at the earliest session date, marked as an estimate; the kg comes from the `--bodyweight` option (spec 3 §10), never from the repo.'],
  ['One entry: `kg` = the `--bodyweight` value, `date` = the earliest session date in the output (a proposed one, usually), `note: "estimated, constant <kg> kg through 2026 (migration)"`.', 'One entry: `kg` = the `--bodyweight` value, `date` = the earliest session date in the output (a proposed one, usually), `note: "estimated, constant <kg> kg through 2026 (migration)"`.'],
  ["`MIGRATION_STAMP = '2026-10-07T00:00:00.000Z'`, `MIGRATION_NAMESPACE", "`MIGRATION_STAMP = '2026-10-07T00:00:00.000Z'`, `MIGRATION_NAMESPACE"],
  ['export const BODYWEIGHT_KG = 73;\n', ''],
  ['/** Spec 2 §8 "Bodyweight" (decision M15). */\n', ''],
  ["import { MIGRATION_STAMP, SHEET_YEAR } from './sheet';", "import { MIGRATION_STAMP, SHEET_YEAR } from './sheet';"],
  ['bodyweightKg: args.bodyweightKg }', 'bodyweightKg: args.bodyweightKg }'],
  ["kg: 80, note: 'estimated, constant 80 kg", "kg: 80, note: 'estimated, constant 80 kg"],
  ['bodyweightKg: 80', 'bodyweightKg: 80'],
  // the spec 2 plan's test code, kept consistent with the renamed cells above
  ['(R 1x 15)', '(R 1x 15)'],
  ['6,5kg 13,2x', '6,5kg 13,2x'],
  ['6,5kg 13x 13x', '6,5kg 13x 13x'],
  ['Diamonds 4x 20', 'Diamonds 4x 20'],
  ['Calve Raises 25x 3', 'Calve Raises 25x 3'],
  // remaining dated remarks in the brief and the option analysis
  ['holds negative pull-ups from late April', 'holds negative pull-ups from late April'],
  ['`31.01.26`, `09.02.2026`', '`31.01.26`, `09.02.2026`'],
  ['F22 `02,05.2026`, F23 `06,05.2026`, A34 `03.07..2026`', 'F22 `02,05.2026`, F23 `06,05.2026`, A34 `03.07..2026`'],
  ['`05.08.2026` (A49) sits between 31.08 and 08.09, so likely 05.09. F27 is 24.**06** between 20.05 and 28.05, so likely 24.05. A33 (06.07) comes before A34 (03.07)', '`05.08.2026` (A49) sits between 31.08 and 08.09, so likely 05.09. F27 is 24.**06** between 20.05 and 28.05, so likely 24.05. A33 (06.07) comes before A34 (03.07)'],
  ['(`12.06.2026 Pullups…`)', '(`12.06.2026 Pullups…`)'],
  ['`02,05.2026` (F22), `06,05.2026` (F23), `03.07..2026` (A34)', '`02,05.2026` (F22), `06,05.2026` (F23), `03.07..2026` (A34)'],
  ['`12.06.2026 Pullups …`', '`12.06.2026 Pullups …`'],
  ['pull-up pyramids from late May', 'pull-up pyramids from late May'],
  ['H is diamond push-ups from late June', 'H is diamond push-ups from late June'],
  ['A49 `05.08.2026` (between 31.08 and 08.09, likely 05.09), F27 24.06 (between 20.05 and 28.05, likely 24.05), and A33 06.07 placed before A34 03.07', 'A49 `05.08.2026` (between 31.08 and 08.09, likely 05.09), F27 24.06 (between 20.05 and 28.05, likely 24.05), and A33 06.07 placed before A34 03.07'],
  ["G6: '6,5kg 15x 13x'", "G6: '6,5kg 15x 13x'"],
];

// The owner's name, everywhere in these files plus CLAUDE.md and the one code comment (spec 3 §10).
for (const rel of [...docs, 'docs/superpowers/plans/2026-10-06-data-model.md', 'CLAUDE.md', 'src/migration/sheet.ts']) {
  const file = join(root, rel);
  let text = readFileSync(file, 'utf8');
  const before = text;
  text = text.replace(/the owner's/g, "the owner's").replace(/the owner/g, 'the owner');
  text = text.replace(/(^|[.!?:]\s+|\.\*\*\s+|\|\s+|\*\*|> |\(\s*)the owner/gm, (_m, p) => `${p}The owner`);
  if (text !== before) {
    writeFileSync(file, text);
    console.log(`${rel}: name replaced`);
  }
}

let total = 0;
for (const rel of docs) {
  const file = join(root, rel);
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of TABLE) {
    if (from === to) continue;
    const count = text.split(from).length - 1;
    if (count === 0) continue;
    text = text.split(from).join(to);
    total += count;
    console.log(`${rel}: ${count}× ${JSON.stringify(from).slice(0, 60)}`);
  }
  writeFileSync(file, text);
}
console.log(`${total} replacements`);
```

- [ ] **Step 2: Run it from the repo root**

```powershell
node <scratchpad>/scrub-docs.mjs .
```
Expected: a line per replacement and a total of about 90, plus "name replaced" for the files that still carried it.

- [ ] **Step 3: Verify nothing is left**

```bash
grep -rn "the owner\|Joerg\|73 kg\|kg: 73\|BODYWEIGHT_KG\|17,2x\|8,5kg\|2026-09-03\|03\.08\.2026\|25\.06\|23\.05\|07\.06\.2026\|01,05\.2026\|(R 1x 15)" docs CLAUDE.md src scripts | grep -v "sync-hosting\|\.test\.ts"
```
Expected: no output. (The spec 3 document and the migration tests are excluded on purpose: spec 3 §10 describes the scrub, and the tests keep their inputs.) Then `grep -rn "the owner" docs | grep -c "" ` is around 60, and a skim of `docs/superpowers/specs/2026-10-06-data-model-design.md` §1 and §11 reads naturally ("The owner's answers …").

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS (docs do not affect tests; this guards against an accidental code edit).

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md src/migration/sheet.ts
git commit -m "Remove the owner's name, bodyweight and dated sheet cells from the docs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Paths and the merge

**Files:**
- Create: `src/sync/paths.ts`, `src/sync/merge.ts`
- Test: `src/sync/paths.test.ts`, `src/sync/merge.test.ts`

**Interfaces:**
- Consumes: `RecordMeta`, `FileKind`, the file types from `src/model/types.ts`; `MODEL_VERSION`; fixtures and `tombstone`/`touch`/`undelete` from `src/model`.
- Produces: `EXERCISES_PATH`, `BODYWEIGHT_PATH`, `sessionPath(date, id)`, `classifyPath(path): PathClass`, `queueRank(kind)`; `canonicalJson(value)`, `sameContent(a, b)`, `pickWinner(a, b, childKey?)`, `mergeById(as, bs, merge)`, `mergeSet/mergeBlock/mergeSession/mergeExercise/mergeBodyweightEntry`, `mergeFile(kind, a, b)` (overloaded per kind; throws on two different session ids).

- [ ] **Step 1: Write `src/sync/paths.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { BODYWEIGHT_PATH, EXERCISES_PATH, classifyPath, queueRank, sessionPath } from './paths';

describe('sessionPath', () => {
  it('builds the year folder, the date and the first 8 characters of the id', () => {
    expect(sessionPath('2030-03-04', 'ab12cd34-0000-4000-8000-000000000001')).toBe('/sessions/2030/2030-03-04_ab12cd34.json');
  });
});

describe('classifyPath', () => {
  it('recognises the three data kinds', () => {
    expect(classifyPath(EXERCISES_PATH)).toEqual({ kind: 'data', fileKind: 'exercises' });
    expect(classifyPath(BODYWEIGHT_PATH)).toEqual({ kind: 'data', fileKind: 'bodyweight' });
    expect(classifyPath('/sessions/2030/2030-03-04_ab12cd34.json')).toEqual({ kind: 'data', fileKind: 'session' });
  });

  it('lists a stray json in the root or under sessions as unexpected', () => {
    expect(classifyPath('/exercises (conflicted copy).json')).toEqual({ kind: 'unexpected' });
    expect(classifyPath('/sessions/2030/notes.json')).toEqual({ kind: 'unexpected' });
    expect(classifyPath('/sessions/2031/2030-03-04_ab12cd34.json')).toEqual({ kind: 'unexpected' });
    expect(classifyPath('/sessions/2030/2030-03-04_AB12CD34.json')).toEqual({ kind: 'unexpected' });
  });

  it('ignores everything else', () => {
    expect(classifyPath('/sessions')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/sessions/2030')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/export/sets.csv')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/review.md')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/export/old.json')).toEqual({ kind: 'ignored' });
  });
});

describe('queueRank', () => {
  it('puts the catalog ahead of bodyweight ahead of sessions', () => {
    expect([queueRank('session'), queueRank('bodyweight'), queueRank('exercises')]).toEqual([2, 1, 0]);
  });
});
```

- [ ] **Step 2: Write `src/sync/merge.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { tombstone, touch, undelete } from '../model/record';
import { validateForWrite } from '../model/validate';
import { block, bodyweight, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile, set, T0 } from '../model/test-fixtures';
import type { Block, Session, SessionFile, WorkoutSet } from '../model/types';
import { canonicalJson, mergeBlock, mergeById, mergeFile, mergeSession, pickWinner, sameContent } from './merge';

const T1 = '2030-01-01T11:00:00.000Z';
const T2 = '2030-01-01T12:00:00.000Z';

describe('canonicalJson', () => {
  it('sorts keys at every level and leaves arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(sameContent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameContent([1, 2], [2, 1])).toBe(false);
  });
});

describe('pickWinner', () => {
  const base = set({ id: '00000000-0000-4000-8000-00000000aaaa', reps: 10 });

  it('lets the newer updatedAt supply the own fields', () => {
    const newer = { ...base, reps: 11, updatedAt: T1 };
    expect(pickWinner(base, newer)).toBe(newer);
    expect(pickWinner(newer, base)).toBe(newer);
  });

  it('lets a tombstone win on equal updatedAt', () => {
    const dead = { ...base, reps: 11, deletedAt: T0 };
    expect(pickWinner(base, dead)).toBe(dead);
    expect(pickWinner(dead, base)).toBe(dead);
  });

  it('lets the newer live copy beat an older tombstone (undelete wins)', () => {
    const dead = tombstone(base, new Date(T1));
    const revived = undelete(dead, new Date(T2));
    expect(pickWinner(dead, revived)).toBe(revived);
  });

  it('breaks a full tie by canonical JSON, the same way from both sides', () => {
    const a = { ...base, reps: 10 };
    const b = { ...base, reps: 12 };
    expect(pickWinner(a, b)).toBe(b);
    expect(pickWinner(b, a)).toBe(b);
  });

  it('ignores child arrays when breaking the tie', () => {
    const a = block(ladder([1, 2, 3]), { id: '00000000-0000-4000-8000-00000000bbbb', note: 'b' });
    const b = { ...a, note: 'a', sets: ladder([9, 9, 9]) };
    expect(pickWinner(a, b, 'sets')).toBe(a);
    expect(pickWinner(b, a, 'sets')).toBe(a);
  });
});

describe('mergeById', () => {
  it('keeps records seen on one side only and sorts by id', () => {
    const a = set({ id: '00000000-0000-4000-8000-000000000003' });
    const b = set({ id: '00000000-0000-4000-8000-000000000001' });
    const out = mergeById([a], [b], pickWinner);
    expect(out.map((s) => s.id)).toEqual([b.id, a.id]);
  });
});

describe('mergeSession', () => {
  it('merges own fields, blocks and sets independently', () => {
    const s1 = set({ id: '00000000-0000-4000-8000-000000000011', reps: 10 });
    const s2 = set({ id: '00000000-0000-4000-8000-000000000012', reps: 9 });
    const b1 = block([s1, s2], { id: '00000000-0000-4000-8000-000000000021' });
    const local = session([b1], { id: '00000000-0000-4000-8000-000000000031', notes: 'old' });
    // Device A edited the session note; device B logged a third set and changed set 2.
    const a: Session = touch({ ...local, notes: 'new' }, new Date(T1));
    const s3 = set({ id: '00000000-0000-4000-8000-000000000013', reps: 8, updatedAt: T1 });
    const b: Session = { ...local, blocks: [{ ...b1, sets: [s1, { ...s2, reps: 7, updatedAt: T1 }, s3] }] };
    const merged = mergeSession(a, b);
    expect(merged.notes).toBe('new');
    expect(merged.updatedAt).toBe(a.updatedAt);
    expect(merged.blocks[0]?.sets.map((s) => (s as { reps?: number }).reps)).toEqual([10, 7, 8]);
    expect(sameContent(mergeSession(b, a), merged)).toBe(true);
  });

  it('keeps a tombstoned parent and its untouched children', () => {
    const b1 = block(ladder([5, 4]), { id: '00000000-0000-4000-8000-000000000041' });
    const live = session([b1], { id: '00000000-0000-4000-8000-000000000051' });
    const dead = tombstone(live, new Date(T1));
    const merged = mergeSession(live, dead);
    expect(merged.deletedAt).toBe(dead.deletedAt);
    expect(merged.blocks).toHaveLength(1);
    expect(merged.blocks[0]?.sets).toHaveLength(2);
  });

  it('is idempotent for tombstones: merging with itself or an older copy changes nothing', () => {
    const live = session([block(ladder([3]))], { id: '00000000-0000-4000-8000-000000000061' });
    const dead = tombstone(live, new Date(T1));
    expect(sameContent(mergeSession(dead, dead), dead)).toBe(true);
    expect(sameContent(mergeSession(dead, live), mergeSession(live, dead))).toBe(true);
    expect(sameContent(mergeSession(mergeSession(dead, live), live), mergeSession(dead, live))).toBe(true);
  });
});

describe('mergeFile', () => {
  it('merges exercises by id', () => {
    const a = exercisesFile([exercise({ id: 'pull-ups', name: 'Pull-ups' })]);
    const b = exercisesFile([exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }), exercise({ id: 'pull-ups', name: 'Pull-Ups', updatedAt: T1 })]);
    const out = mergeFile('exercises', a, b);
    expect(out.exercises.map((e) => [e.id, e.name])).toEqual([['dips-bar', 'Dips (Bar)'], ['pull-ups', 'Pull-Ups']]);
    expect(validateForWrite('exercises', out).ok).toBe(true);
  });

  it('merges bodyweight entries by id', () => {
    const e = bodyweight({ id: '00000000-0000-4000-8000-000000000071', kg: 80 });
    const out = mergeFile('bodyweight', bodyweightFile([e]), bodyweightFile([{ ...e, kg: 81, updatedAt: T1 }]));
    expect(out.entries[0]?.kg).toBe(81);
    expect(validateForWrite('bodyweight', out).ok).toBe(true);
  });

  it('refuses two different sessions', () => {
    expect(() => mergeFile('session', sessionFile(session([], { id: '00000000-0000-4000-8000-000000000081' })), sessionFile(session([], { id: '00000000-0000-4000-8000-000000000082' })))).toThrow(/cannot merge/);
  });
});

/** A small seeded generator, so the property tests are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const STAMPS = [T0, T1, T2, '2030-01-01T13:00:00.000Z'];
const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function randomSet(r: () => number, blockN: number, n: number): WorkoutSet {
  const base = set({ id: idOf(100 + blockN * 10 + n), order: n, reps: 1 + Math.floor(r() * 20), updatedAt: STAMPS[Math.floor(r() * 4)] as string });
  return r() < 0.2 ? { ...base, deletedAt: base.updatedAt } : base;
}

function randomBlock(r: () => number, n: number): Block {
  const count = Math.floor(r() * 4);
  const sets = [...Array(count).keys()].filter(() => r() < 0.8).map((i) => randomSet(r, n, i));
  const b = block(sets, { id: idOf(200 + n), order: n, updatedAt: STAMPS[Math.floor(r() * 4)] as string, ...(r() < 0.5 ? { note: `n${Math.floor(r() * 3)}` } : {}) });
  return r() < 0.15 ? { ...b, deletedAt: b.updatedAt } : b;
}

/** One of several "device copies" of the same session: shared ids, independently varied fields. */
function randomCopy(r: () => number): SessionFile {
  const blocks = [0, 1, 2].filter(() => r() < 0.8).map((i) => randomBlock(r, i));
  const s = session(blocks, { id: idOf(300), updatedAt: STAMPS[Math.floor(r() * 4)] as string, ...(r() < 0.5 ? { notes: `s${Math.floor(r() * 3)}` } : {}) });
  return sessionFile(r() < 0.1 ? { ...s, deletedAt: s.updatedAt } : s);
}

describe('merge properties', () => {
  it('is symmetric, idempotent and associative over random device copies, and the result validates', () => {
    const r = rng(42);
    for (let round = 0; round < 200; round += 1) {
      const a = randomCopy(r);
      const b = randomCopy(r);
      const c = randomCopy(r);
      const ab = mergeFile('session', a, b);
      expect(canonicalJson(mergeFile('session', b, a))).toBe(canonicalJson(ab));
      expect(sameContent(mergeFile('session', a, a), a)).toBe(true); // the fixture's arrays are already in id order
      expect(canonicalJson(mergeFile('session', ab, b))).toBe(canonicalJson(ab));
      expect(canonicalJson(mergeFile('session', ab, c))).toBe(canonicalJson(mergeFile('session', a, mergeFile('session', b, c))));
      expect(validateForWrite('session', ab).ok).toBe(true);
    }
  });

  it('never loses a record: every id on either side is in the result', () => {
    const r = rng(7);
    for (let round = 0; round < 100; round += 1) {
      const a = randomCopy(r);
      const b = randomCopy(r);
      const out = mergeFile('session', a, b);
      const ids = (f: SessionFile): string[] => f.session.blocks.flatMap((bl) => [bl.id, ...bl.sets.map((s) => s.id)]);
      const got = new Set(ids(out));
      for (const id of [...ids(a), ...ids(b)]) expect(got.has(id)).toBe(true);
    }
  });
});

describe('mergeBlock', () => {
  it('takes the winner\'s note and the union of sets', () => {
    const a = block(ladder([1]), { id: '00000000-0000-4000-8000-000000000091', note: 'a' });
    const b: Block = { ...a, note: 'b', updatedAt: T1, sets: [...a.sets, set({ id: '00000000-0000-4000-8000-000000000092', reps: 2 })] };
    const out = mergeBlock(a, b);
    expect(out.note).toBe('b');
    expect(out.sets).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/sync`
Expected: FAIL, cannot find `./paths` and `./merge`.

- [ ] **Step 4: Write `src/sync/paths.ts`**

```ts
import type { FileKind } from '../model/types';

/** Spec 1 §4: the three kinds of data file, addressed from the App folder root. */
export const EXERCISES_PATH = '/exercises.json';
export const BODYWEIGHT_PATH = '/bodyweight.json';

const SESSION_PATH = /^\/sessions\/(\d{4})\/(\d{4})-\d{2}-\d{2}_[0-9a-f]{8}\.json$/;

/** `/sessions/<YYYY>/<YYYY-MM-DD>_<id8>.json`, fixed when the session is first written (spec 1 D12). */
export function sessionPath(date: string, id: string): string {
  return `/sessions/${date.slice(0, 4)}/${date}_${id.slice(0, 8)}.json`;
}

export type PathClass =
  | { kind: 'data'; fileKind: FileKind }
  /** A .json where only data files belong: never read, listed as an issue (spec 3 §7). */
  | { kind: 'unexpected' }
  /** Folders, export/, review.md and the like: not ours to look at. */
  | { kind: 'ignored' };

/** Classifies a Dropbox `path_lower`. */
export function classifyPath(path: string): PathClass {
  if (path === EXERCISES_PATH) return { kind: 'data', fileKind: 'exercises' };
  if (path === BODYWEIGHT_PATH) return { kind: 'data', fileKind: 'bodyweight' };
  const m = SESSION_PATH.exec(path);
  if (m && m[1] === m[2]) return { kind: 'data', fileKind: 'session' };
  if (!path.endsWith('.json')) return { kind: 'ignored' };
  const inRoot = path.lastIndexOf('/') === 0;
  if (inRoot || path.startsWith('/sessions/')) return { kind: 'unexpected' };
  return { kind: 'ignored' };
}

/** Catalog files sort ahead of sessions in the queue (spec 3 S12); within a group the caller orders by time. */
export function queueRank(kind: FileKind): number {
  return kind === 'exercises' ? 0 : kind === 'bodyweight' ? 1 : 2;
}
```

- [ ] **Step 5: Write `src/sync/merge.ts`**

```ts
import { MODEL_VERSION } from '../model/schema';
import type {
  Block, BodyweightEntry, BodyweightFile, Exercise, ExercisesFile, FileKind, RecordMeta, Session, SessionFile, WorkoutSet,
} from '../model/types';

/** JSON with object keys sorted at every level, so equal content gives equal text (spec 3 §6). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** Equal content regardless of key order and array formatting. */
export function sameContent(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

type Rec = RecordMeta & { id: string };

function ownFields<T extends object>(record: T, childKey?: keyof T): object {
  if (childKey === undefined) return record;
  const { [childKey]: _children, ...own } = record;
  return own;
}

/**
 * Spec 1 §3 "Merge unit" with the spec 3 §6 tie-break. Returns `a` or `b` (the one that supplies
 * the own fields): newer updatedAt wins; on a tie a tombstone wins; on a full tie the copy whose
 * canonical JSON sorts higher. The order is total, so the choice is symmetric and associative.
 */
export function pickWinner<T extends Rec>(a: T, b: T, childKey?: keyof T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const aDead = a.deletedAt !== undefined;
  const bDead = b.deletedAt !== undefined;
  if (aDead !== bDead) return aDead ? a : b;
  return canonicalJson(ownFields(a, childKey)) >= canonicalJson(ownFields(b, childKey)) ? a : b;
}

/** Union by id, each shared id merged, sorted by id (array position carries no meaning). */
export function mergeById<T extends Rec>(as: readonly T[], bs: readonly T[], merge: (a: T, b: T) => T): T[] {
  const byId = new Map<string, T>();
  for (const a of as) byId.set(a.id, a);
  for (const b of bs) {
    const a = byId.get(b.id);
    byId.set(b.id, a === undefined ? b : merge(a, b));
  }
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function mergeSet(a: WorkoutSet, b: WorkoutSet): WorkoutSet {
  return pickWinner(a, b);
}

export function mergeBlock(a: Block, b: Block): Block {
  const winner = pickWinner(a, b, 'sets');
  return { ...winner, sets: mergeById(a.sets, b.sets, mergeSet) };
}

export function mergeSession(a: Session, b: Session): Session {
  const winner = pickWinner(a, b, 'blocks');
  return { ...winner, blocks: mergeById(a.blocks, b.blocks, mergeBlock) };
}

export function mergeExercise(a: Exercise, b: Exercise): Exercise {
  return pickWinner(a, b);
}

export function mergeBodyweightEntry(a: BodyweightEntry, b: BodyweightEntry): BodyweightEntry {
  return pickWinner(a, b);
}

export function mergeFile(kind: 'exercises', a: ExercisesFile, b: ExercisesFile): ExercisesFile;
export function mergeFile(kind: 'bodyweight', a: BodyweightFile, b: BodyweightFile): BodyweightFile;
export function mergeFile(kind: 'session', a: SessionFile, b: SessionFile): SessionFile;
export function mergeFile(kind: FileKind, a: unknown, b: unknown): unknown;
/** Both files must be at MODEL_VERSION (the caller upgrades first). The result is at MODEL_VERSION. */
export function mergeFile(kind: FileKind, a: unknown, b: unknown): unknown {
  if (kind === 'exercises') {
    const x = a as ExercisesFile;
    const y = b as ExercisesFile;
    return { schemaVersion: MODEL_VERSION, exercises: mergeById(x.exercises, y.exercises, mergeExercise) };
  }
  if (kind === 'bodyweight') {
    const x = a as BodyweightFile;
    const y = b as BodyweightFile;
    return { schemaVersion: MODEL_VERSION, entries: mergeById(x.entries, y.entries, mergeBodyweightEntry) };
  }
  const x = a as SessionFile;
  const y = b as SessionFile;
  if (x.session.id !== y.session.id) throw new Error(`cannot merge sessions ${x.session.id} and ${y.session.id}`);
  return { schemaVersion: MODEL_VERSION, session: mergeSession(x.session, y.session) };
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/sync && npm run typecheck`
Expected: PASS (21 tests); `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/sync
git commit -m "Add session paths and the record merge for sync" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The IndexedDB store and the write path

**Files:**
- Create: `src/sync/db.ts`, `src/sync/store.ts`
- Test: `src/sync/db.test.ts`, `src/sync/store.test.ts`

**Interfaces:**
- Consumes: `ReadStatus` (`src/model/read.ts`), `validateForWrite`, `ValidationIssue`; `queueRank`, `EXERCISES_PATH`, `BODYWEIGHT_PATH` from Task 5.
- Produces: `openDb(factory?, name?)`, `Db` (`tx`, `get`, `getAll`, `put`, `delete`, `getValue`, `setValue`, `clearAll`, `close`), `Tx`; `FileRow`, `QueueRow`, `WriteResult`, `Issue`, `IssueReason`, `Store` (`writeFile`, `getRow`, `rows`, `sessions`, `catalog`, `bodyweight`, `queue`, `issues`, `saveRow`, `deleteRow`, `setQueueRow`, `getQueueRow`, `deleteQueueRow`, `finishQueueRow`, `unexpectedPaths`, `setUnexpectedPaths`, `getMeta`, `setMeta`).

- [ ] **Step 1: Write `src/sync/db.test.ts`**

```ts
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';

describe('Db', () => {
  it('creates the four stores and round-trips rows', async () => {
    const db = await openDb(new IDBFactory());
    await db.put('files', { path: '/a.json', kind: 'session' });
    expect(await db.get('files', '/a.json')).toEqual({ path: '/a.json', kind: 'session' });
    expect(await db.getAll('files')).toHaveLength(1);
    await db.delete('files', '/a.json');
    expect(await db.get('files', '/a.json')).toBeUndefined();
    db.close();
  });

  it('stores key/value rows for auth and meta', async () => {
    const db = await openDb(new IDBFactory());
    await db.setValue('meta', 'cursor', 'abc');
    expect(await db.getValue<string>('meta', 'cursor')).toBe('abc');
    expect(await db.getValue('meta', 'missing')).toBeUndefined();
    db.close();
  });

  it('commits a multi-store transaction as a whole and rolls back on a thrown error', async () => {
    const db = await openDb(new IDBFactory());
    await db.tx(['files', 'queue'], 'readwrite', async (t) => {
      await t.put('files', { path: '/x.json' });
      await t.put('queue', { path: '/x.json' });
    });
    expect(await db.getAll('queue')).toHaveLength(1);
    await expect(
      db.tx(['files', 'queue'], 'readwrite', async (t) => {
        await t.put('files', { path: '/y.json' });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await db.get('files', '/y.json')).toBeUndefined();
    db.close();
  });

  it('clearAll empties every store', async () => {
    const db = await openDb(new IDBFactory());
    await db.put('files', { path: '/a.json' });
    await db.setValue('auth', 'tokens', { x: 1 });
    await db.clearAll();
    expect(await db.getAll('files')).toHaveLength(0);
    expect(await db.getValue('auth', 'tokens')).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Write `src/sync/store.test.ts`**

```ts
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../model/test-fixtures';
import { openDb } from './db';
import { EXERCISES_PATH, sessionPath } from './paths';
import { Store, type FileRow } from './store';

async function makeStore(): Promise<{ store: Store; changes: string[] }> {
  const changes: string[] = [];
  const db = await openDb(new IDBFactory());
  return { store: new Store(db, { onChange: (p) => changes.push(p) }), changes };
}

const s1 = session([block(ladder([5, 4]))], { id: 'a1b2c3d4-0000-4000-8000-000000000001', date: '2030-02-03' });
const p1 = sessionPath(s1.date, s1.id);

describe('Store.writeFile', () => {
  it('creates a row with rev null, version 1 and a queue entry', async () => {
    const { store, changes } = await makeStore();
    const r = await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    expect(r).toEqual({ ok: true });
    const row = await store.getRow(p1);
    expect(row).toMatchObject({ path: p1, kind: 'session', rev: null, status: 'ok', version: 1, issues: [] });
    expect(await store.queue()).toEqual([{ path: p1, kind: 'session', enqueuedAt: '2030-02-03T10:00:00.000Z', attempts: 0 }]);
    expect(changes).toEqual([p1]);
  });

  it('coalesces repeated writes into one queue row and keeps the first enqueuedAt', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'x' }), new Date('2030-02-03T10:05:00.000Z'));
    expect(await store.queue()).toHaveLength(1);
    expect((await store.queue())[0]?.enqueuedAt).toBe('2030-02-03T10:00:00.000Z');
    expect((await store.getRow(p1))?.version).toBe(2);
  });

  it.each(['read-only', 'needs-update', 'quarantined'] as const)('refuses a write to a %s row and stores nothing', async (status) => {
    const { store } = await makeStore();
    const row: FileRow = { path: p1, kind: 'session', rev: 'r1', content: { schemaVersion: 9 }, status, issues: [], version: 3 };
    await store.saveRow(row);
    expect(await store.writeFile('session', p1, sessionFile(s1))).toEqual({ ok: false, reason: status });
    expect(await store.getRow(p1)).toEqual(row);
    expect(await store.queue()).toHaveLength(0);
  });

  it('refuses a write to the loser of a duplicate pair', async () => {
    const { store } = await makeStore();
    await store.saveRow({ path: p1, kind: 'session', rev: 'r1', content: sessionFile(s1), status: 'ok', issues: [], version: 1, duplicateOf: '/sessions/2030/2030-02-03_00000000.json' });
    expect(await store.writeFile('session', p1, sessionFile(s1))).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('keeps an invalid write locally and queued, marked held back, and releases it when a valid write follows', async () => {
    const { store } = await makeStore();
    const bad = sessionFile({ ...s1, date: '2030-02-30' });
    const r = await store.writeFile('session', p1, bad);
    expect(r.ok).toBe(true);
    expect(r.ok && r.heldBack?.[0]?.path).toBe('/session/date');
    expect((await store.getRow(p1))?.content).toEqual(bad);
    expect((await store.queue())[0]?.heldBack).toHaveLength(1);
    expect((await store.issues()).map((i) => i.reason)).toEqual(['held-back']);
    await store.writeFile('session', p1, sessionFile(s1));
    expect((await store.queue())[0]?.heldBack).toBeUndefined();
    expect(await store.issues()).toEqual([]);
  });

  it('keeps rev, syncedAt and remoteDeleted of an existing row', async () => {
    const { store } = await makeStore();
    await store.saveRow({ path: p1, kind: 'session', rev: 'r7', content: sessionFile(s1), status: 'ok', issues: [], version: 4, syncedAt: '2030-01-01T00:00:00.000Z', remoteDeleted: true });
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'y' }));
    expect(await store.getRow(p1)).toMatchObject({ rev: 'r7', version: 5, syncedAt: '2030-01-01T00:00:00.000Z', remoteDeleted: true });
  });
});

describe('Store read helpers', () => {
  it('orders the queue catalog, bodyweight, then sessions by enqueue time', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1), new Date('2030-02-03T10:00:00.000Z'));
    await store.writeFile('bodyweight', '/bodyweight.json', { schemaVersion: 1, entries: [] }, new Date('2030-02-03T10:01:00.000Z'));
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([exercise()]), new Date('2030-02-03T10:02:00.000Z'));
    expect((await store.queue()).map((q) => q.path)).toEqual([EXERCISES_PATH, '/bodyweight.json', p1]);
  });

  it('hides non-ok rows and duplicate losers from sessions()', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1));
    await store.saveRow({ path: '/sessions/2030/2030-02-04_bbbbbbbb.json', kind: 'session', rev: 'r', content: {}, status: 'quarantined', issues: [{ level: 'hard', path: '/session', message: 'bad' }], version: 0 });
    await store.saveRow({ path: '/sessions/2030/2030-02-05_cccccccc.json', kind: 'session', rev: 'r', content: sessionFile(s1), status: 'ok', issues: [], version: 0, duplicateOf: p1 });
    expect((await store.sessions()).map((s) => s.path)).toEqual([p1]);
    expect((await store.issues()).map((i) => [i.path, i.reason])).toEqual([
      ['/sessions/2030/2030-02-04_bbbbbbbb.json', 'quarantined'],
      ['/sessions/2030/2030-02-05_cccccccc.json', 'duplicate'],
    ]);
  });

  it('lists unexpected paths and remote deletions as issues', async () => {
    const { store } = await makeStore();
    await store.setUnexpectedPaths(['/exercises (conflicted copy).json']);
    await store.saveRow({ path: p1, kind: 'session', rev: null, content: sessionFile(s1), status: 'ok', issues: [], version: 1, remoteDeleted: true });
    expect((await store.issues()).map((i) => i.reason)).toEqual(['unexpected-file', 'remote-deleted']);
  });

  it('returns the catalog only when its row is ok', async () => {
    const { store } = await makeStore();
    expect(await store.catalog()).toBeUndefined();
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([exercise()]));
    expect((await store.catalog())?.exercises).toHaveLength(1);
  });
});

describe('Store.finishQueueRow', () => {
  it('stores rev and syncedAt, clears remoteDeleted, and removes the queue row only when the version is unchanged', async () => {
    const { store } = await makeStore();
    await store.writeFile('session', p1, sessionFile(s1));
    await store.writeFile('session', p1, sessionFile({ ...s1, notes: 'later' }));
    expect(await store.finishQueueRow(p1, 1, 'r1', '2030-02-03T10:00:00.000Z')).toBe(false);
    expect(await store.queue()).toHaveLength(1);
    expect((await store.getRow(p1))?.rev).toBe('r1');
    expect(await store.finishQueueRow(p1, 2, 'r2', '2030-02-03T10:01:00.000Z')).toBe(true);
    expect(await store.queue()).toHaveLength(0);
    expect(await store.getRow(p1)).toMatchObject({ rev: 'r2', syncedAt: '2030-02-03T10:01:00.000Z' });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/sync/db.test.ts src/sync/store.test.ts`
Expected: FAIL, cannot find `./db` and `./store`.

- [ ] **Step 4: Write `src/sync/db.ts`**

```ts
/** A small promise wrapper over IndexedDB (spec 3 §5). No library: the app needs five operations. */

export const DB_NAME = 'calistally';
export const DB_VERSION = 1;

export type StoreName = 'files' | 'queue' | 'auth' | 'meta';

/** `auth` and `meta` are key/value stores; `files` and `queue` are keyed by `path`. */
export interface KeyValueRow { key: string; value: unknown }

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** One transaction; every call must be awaited before the next non-IndexedDB await, or the
 *  transaction auto-commits (that is how IndexedDB works, in browsers and in fake-indexeddb). */
export class Tx {
  constructor(private readonly tx: IDBTransaction) {}

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return request(this.tx.objectStore(store).get(key)) as Promise<T | undefined>;
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return request(this.tx.objectStore(store).getAll()) as Promise<T[]>;
  }

  async put(store: StoreName, value: object): Promise<void> {
    await request(this.tx.objectStore(store).put(value));
  }

  async delete(store: StoreName, key: string): Promise<void> {
    await request(this.tx.objectStore(store).delete(key));
  }

  async clear(store: StoreName): Promise<void> {
    await request(this.tx.objectStore(store).clear());
  }
}

export class Db {
  constructor(private readonly idb: IDBDatabase) {}

  /** Runs `body` inside one transaction over `stores`; resolves when the transaction completed. */
  tx<R>(stores: StoreName[], mode: IDBTransactionMode, body: (t: Tx) => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const tx = this.idb.transaction(stores, mode);
      let result: R;
      let failed: unknown;
      tx.oncomplete = () => (failed === undefined ? resolve(result) : reject(failed));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(failed ?? tx.error ?? new Error('IndexedDB transaction aborted'));
      body(new Tx(tx)).then(
        (r) => { result = r; },
        (e: unknown) => { failed = e; tx.abort(); },
      );
    });
  }

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return this.tx([store], 'readonly', (t) => t.get<T>(store, key));
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return this.tx([store], 'readonly', (t) => t.getAll<T>(store));
  }

  put(store: StoreName, value: object): Promise<void> {
    return this.tx([store], 'readwrite', (t) => t.put(store, value));
  }

  delete(store: StoreName, key: string): Promise<void> {
    return this.tx([store], 'readwrite', (t) => t.delete(store, key));
  }

  /** Key/value convenience for `auth` and `meta`. */
  async getValue<T>(store: 'auth' | 'meta', key: string): Promise<T | undefined> {
    const row = await this.get<KeyValueRow>(store, key);
    return row === undefined ? undefined : (row.value as T);
  }

  setValue(store: 'auth' | 'meta', key: string, value: unknown): Promise<void> {
    return this.put(store, { key, value } satisfies KeyValueRow);
  }

  clearAll(): Promise<void> {
    const stores: StoreName[] = ['files', 'queue', 'auth', 'meta'];
    return this.tx(stores, 'readwrite', async (t) => {
      for (const s of stores) await t.clear(s);
    });
  }

  close(): void {
    this.idb.close();
  }
}

/** Opens (and on first use creates) the database. Pass a fake `IDBFactory` in tests. */
export function openDb(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<Db> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('auth')) db.createObjectStore('auth', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(new Db(open.result));
    open.onerror = () => reject(open.error ?? new Error('could not open IndexedDB'));
    open.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}
```

- [ ] **Step 5: Write `src/sync/store.ts`**

```ts
import type { ReadStatus } from '../model/read';
import { validateForWrite, type ValidationIssue } from '../model/validate';
import type { BodyweightFile, ExercisesFile, FileKind, SessionFile } from '../model/types';
import type { Db, Tx } from './db';
import { BODYWEIGHT_PATH, EXERCISES_PATH, queueRank } from './paths';

/** The local copy of one Dropbox file (spec 3 §5). Every view reads these rows. */
export interface FileRow {
  path: string;
  kind: FileKind;
  /** null until the file exists in Dropbox. */
  rev: string | null;
  /** The upgraded file at MODEL_VERSION when status is 'ok'; the raw file otherwise. */
  content: unknown;
  status: ReadStatus;
  issues: ValidationIssue[];
  /** Bumped on every local write; the engine's race guard. */
  version: number;
  syncedAt?: string;
  /** Set on the losing path of a duplicate session: hidden from views, refused by writeFile. */
  duplicateOf?: string;
  /** The file vanished from Dropbox; the content is kept. */
  remoteDeleted?: true;
}

export interface QueueRow {
  path: string;
  kind: FileKind;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
  /** The write failed validateForWrite; stays local until a later content passes. */
  heldBack?: ValidationIssue[];
  /** Local content parked while the remote file is too new for this app (spec 3 §6). */
  pendingContent?: unknown;
  pendingVersion?: number;
}

export type WriteRefusal = 'read-only' | 'needs-update' | 'quarantined' | 'duplicate';
export type WriteResult = { ok: true; heldBack?: ValidationIssue[] } | { ok: false; reason: WriteRefusal };

export type IssueReason =
  | 'quarantined' | 'read-only' | 'needs-update' | 'unexpected-file' | 'duplicate' | 'remote-deleted' | 'held-back' | 'push-error';

export interface Issue {
  path: string;
  reason: IssueReason;
  detail: string;
}

export interface StoreEvents {
  /** A row changed locally or by the engine; the shell and other tabs refresh. */
  onChange?: (path: string) => void;
}

const UNEXPECTED_KEY = 'unexpectedPaths';

/** Spec 3 §5: the write path with the ReadStatus guard, and the read helpers. */
export class Store {
  constructor(readonly db: Db, private readonly events: StoreEvents = {}) {}

  /** The write every screen calls. One transaction over files and queue. */
  async writeFile(kind: FileKind, path: string, file: unknown, now: Date = new Date()): Promise<WriteResult> {
    const result = await this.db.tx(['files', 'queue'], 'readwrite', async (t): Promise<WriteResult> => {
      const row = await t.get<FileRow>('files', path);
      if (row !== undefined) {
        if (row.duplicateOf !== undefined) return { ok: false, reason: 'duplicate' };
        if (row.status !== 'ok') return { ok: false, reason: row.status };
      }
      const validation = validateForWrite(kind, file);
      const next: FileRow = {
        path,
        kind,
        rev: row?.rev ?? null,
        content: file,
        status: 'ok',
        issues: [],
        version: (row?.version ?? 0) + 1,
        ...(row?.syncedAt !== undefined ? { syncedAt: row.syncedAt } : {}),
        ...(row?.remoteDeleted !== undefined ? { remoteDeleted: row.remoteDeleted } : {}),
      };
      await t.put('files', next);
      const queued = await t.get<QueueRow>('queue', path);
      const entry: QueueRow = {
        path,
        kind,
        enqueuedAt: queued?.enqueuedAt ?? now.toISOString(),
        attempts: queued?.attempts ?? 0,
        ...(queued?.lastError !== undefined ? { lastError: queued.lastError } : {}),
        ...(validation.ok ? {} : { heldBack: validation.issues }),
        ...(queued?.pendingContent !== undefined ? { pendingContent: queued.pendingContent, pendingVersion: queued.pendingVersion as number } : {}),
      };
      await t.put('queue', entry);
      return validation.ok ? { ok: true } : { ok: true, heldBack: validation.issues };
    });
    if (result.ok) this.events.onChange?.(path);
    return result;
  }

  getRow(path: string): Promise<FileRow | undefined> {
    return this.db.get<FileRow>('files', path);
  }

  rows(): Promise<FileRow[]> {
    return this.db.getAll<FileRow>('files');
  }

  /** Readable session files: status ok and not the loser of a duplicate pair. */
  async sessions(): Promise<{ path: string; file: SessionFile }[]> {
    const rows = await this.rows();
    return rows
      .filter((r) => r.kind === 'session' && r.status === 'ok' && r.duplicateOf === undefined)
      .map((r) => ({ path: r.path, file: r.content as SessionFile }));
  }

  async catalog(): Promise<ExercisesFile | undefined> {
    const row = await this.getRow(EXERCISES_PATH);
    return row?.status === 'ok' ? (row.content as ExercisesFile) : undefined;
  }

  async bodyweight(): Promise<BodyweightFile | undefined> {
    const row = await this.getRow(BODYWEIGHT_PATH);
    return row?.status === 'ok' ? (row.content as BodyweightFile) : undefined;
  }

  /** Pending writes in push order: catalog, bodyweight, then sessions by enqueue time (spec 3 S12). */
  async queue(): Promise<QueueRow[]> {
    const rows = await this.db.getAll<QueueRow>('queue');
    return rows.sort((a, b) => queueRank(a.kind) - queueRank(b.kind) || a.enqueuedAt.localeCompare(b.enqueuedAt) || a.path.localeCompare(b.path));
  }

  async issues(): Promise<Issue[]> {
    const out: Issue[] = [];
    for (const r of await this.rows()) {
      if (r.duplicateOf !== undefined) out.push({ path: r.path, reason: 'duplicate', detail: `same session as ${r.duplicateOf}; not read` });
      else if (r.status !== 'ok') out.push({ path: r.path, reason: r.status, detail: r.issues.map((i) => `${i.path} ${i.message}`).join('; ') || 'newer than this app' });
      if (r.remoteDeleted) out.push({ path: r.path, reason: 'remote-deleted', detail: 'removed from Dropbox; the local copy is kept' });
    }
    for (const q of await this.queue()) {
      if (q.heldBack) out.push({ path: q.path, reason: 'held-back', detail: q.heldBack.map((i) => `${i.path} ${i.message}`).join('; ') });
      else if (q.lastError !== undefined) out.push({ path: q.path, reason: 'push-error', detail: q.lastError });
    }
    for (const p of await this.unexpectedPaths()) out.push({ path: p, reason: 'unexpected-file', detail: 'not a CalisTally file; not read' });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ---- used by the engine ----

  /** Replaces a row as read from Dropbox (merge already applied by the caller). */
  async saveRow(row: FileRow): Promise<void> {
    await this.db.put('files', row);
    this.events.onChange?.(row.path);
  }

  /** Engine-side update of a row inside a caller's transaction. */
  static async putRow(t: Tx, row: FileRow): Promise<void> {
    await t.put('files', row);
  }

  /** Removes a row entirely (only for the loser of a duplicate pair once Dropbox dropped it). */
  async deleteRow(path: string): Promise<void> {
    await this.db.delete('files', path);
    this.events.onChange?.(path);
  }

  async setQueueRow(row: QueueRow): Promise<void> {
    await this.db.put('queue', row);
  }

  async deleteQueueRow(path: string): Promise<void> {
    await this.db.delete('queue', path);
  }

  getQueueRow(path: string): Promise<QueueRow | undefined> {
    return this.db.get<QueueRow>('queue', path);
  }

  /** Removes the queue row only if the file row's version still equals `version` (spec 3 §7 race guard). */
  async finishQueueRow(path: string, version: number, rev: string, syncedAt: string): Promise<boolean> {
    return this.db.tx(['files', 'queue'], 'readwrite', async (t) => {
      const row = await t.get<FileRow>('files', path);
      if (row === undefined) return false;
      const { remoteDeleted: _gone, ...kept } = row;
      await t.put('files', { ...kept, rev, syncedAt });
      if (row.version !== version) return false;
      await t.delete('queue', path);
      return true;
    });
  }

  unexpectedPaths(): Promise<string[]> {
    return this.db.getValue<string[]>('meta', UNEXPECTED_KEY).then((v) => v ?? []);
  }

  setUnexpectedPaths(paths: string[]): Promise<void> {
    return this.db.setValue('meta', UNEXPECTED_KEY, [...paths].sort());
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.getValue<T>('meta', key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.db.setValue('meta', key, value);
  }
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/sync && npm run typecheck`
Expected: PASS (38 tests); `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/sync
git commit -m "Add the IndexedDB store with the write queue and the ReadStatus guard" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: PKCE login and tokens

**Files:**
- Create: `src/sync/auth.ts`
- Test: `src/sync/auth.test.ts`

**Interfaces:**
- Consumes: `Db` from Task 6.
- Produces: `randomString(length)`, `base64Url(bytes)`, `codeChallenge(verifier)`, `AuthConfig`, `Tokens`, `PendingLogin`, `AuthError` (`code`: `unauthorized | state-mismatch | no-pending-login | login-expired | network`), `AuthDeps { fetch, now?, random? }`, `Auth` (`startLogin(mode)`, `pendingLogin()`, `completeLogin(code, state?)`, `tokens()`, `isConnected()`, `accessToken()`, `refresh()`, `signOut()`). Constants `VERIFIER_LENGTH = 64`, `STATE_LENGTH = 32`, `PENDING_LOGIN_TTL_MS`, `REFRESH_MARGIN_MS`.

- [ ] **Step 1: Write `src/sync/auth.test.ts`**

```ts
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Auth, AuthError, codeChallenge, randomString, type Tokens } from './auth';
import { openDb } from './db';

interface Call { url: string; init: RequestInit }

/** A fetch that records calls and answers from a queue of responses. */
function fakeFetch(responses: (() => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) throw new TypeError('no response queued');
    return next();
  };
  return { fetch: fetchImpl, calls };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CONFIG = { appKey: 'app-key', redirectUri: 'http://localhost:5173/' };
const NOW = new Date('2030-05-01T10:00:00.000Z');

async function setup(responses: (() => Response)[], now: Date = NOW) {
  const db = await openDb(new IDBFactory());
  const { fetch, calls } = fakeFetch(responses);
  let clock = now;
  const auth = new Auth(db, CONFIG, { fetch, now: () => clock, random: (n) => 'v'.repeat(n) });
  return { db, auth, calls, setClock: (d: Date) => { clock = d; } };
}

describe('PKCE helpers', () => {
  it('computes the RFC 7636 test vector', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('draws verifiers from the unreserved set at the requested length', () => {
    const v = randomString(64);
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(randomString(64)).not.toBe(v);
  });
});

describe('Auth.startLogin', () => {
  it('stores the pending login before returning the authorize URL', async () => {
    const { auth } = await setup([]);
    const url = new URL(await auth.startLogin());
    const pending = await auth.pendingLogin();
    expect(pending).toMatchObject({ verifier: 'v'.repeat(64), state: 'v'.repeat(32), mode: 'redirect', createdAt: NOW.toISOString() });
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'app-key',
      response_type: 'code',
      code_challenge: await codeChallenge('v'.repeat(64)),
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      state: 'v'.repeat(32),
      redirect_uri: 'http://localhost:5173/',
    });
  });

  it('omits the redirect_uri for a paste-the-code login', async () => {
    const { auth } = await setup([]);
    const url = new URL(await auth.startLogin('paste'));
    expect(url.searchParams.has('redirect_uri')).toBe(false);
    expect((await auth.pendingLogin())?.mode).toBe('paste');
  });
});

describe('Auth.completeLogin', () => {
  const tokenResponse = json(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 14400, token_type: 'bearer' });

  it('exchanges the code with the verifier and stores the tokens', async () => {
    const { auth, calls } = await setup([tokenResponse]);
    await auth.startLogin();
    const tokens = await auth.completeLogin('the-code', 'v'.repeat(32));
    expect(tokens).toEqual({ refreshToken: 'rt1', accessToken: 'at1', expiresAt: '2030-05-01T14:00:00.000Z' });
    expect(await auth.tokens()).toEqual(tokens);
    expect(await auth.pendingLogin()).toBeUndefined();
    expect(calls[0]?.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)))).toEqual({
      grant_type: 'authorization_code', code: 'the-code', client_id: 'app-key', code_verifier: 'v'.repeat(64), redirect_uri: 'http://localhost:5173/',
    });
  });

  it('refuses a state that does not match', async () => {
    const { auth, calls } = await setup([tokenResponse]);
    await auth.startLogin();
    await expect(auth.completeLogin('the-code', 'other')).rejects.toMatchObject({ code: 'state-mismatch' });
    expect(calls).toHaveLength(0);
  });

  it('refuses without a pending login, and after 10 minutes', async () => {
    const { auth, setClock } = await setup([tokenResponse]);
    await expect(auth.completeLogin('c', 's')).rejects.toMatchObject({ code: 'no-pending-login' });
    await auth.startLogin();
    setClock(new Date('2030-05-01T10:10:01.000Z'));
    await expect(auth.completeLogin('c', 'v'.repeat(32))).rejects.toMatchObject({ code: 'login-expired' });
    expect(await auth.pendingLogin()).toBeUndefined();
  });

  it('does not check state and sends no redirect_uri for a pasted code', async () => {
    const { auth, calls } = await setup([tokenResponse]);
    await auth.startLogin('paste');
    await auth.completeLogin('pasted');
    const body = Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)));
    expect(body['redirect_uri']).toBeUndefined();
    expect(body['code_verifier']).toBe('v'.repeat(64));
  });

  it('reports a rejected code as unauthorized and a server error as network', async () => {
    const { auth } = await setup([json(400, { error: 'invalid_grant' }), json(500, {})]);
    await auth.startLogin();
    await expect(auth.completeLogin('bad', 'v'.repeat(32))).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(auth.completeLogin('bad', 'v'.repeat(32))).rejects.toMatchObject({ code: 'network' });
  });
});

describe('Auth.accessToken and refresh', () => {
  const stored: Tokens = { refreshToken: 'rt', accessToken: 'at-old', expiresAt: '2030-05-01T14:00:00.000Z' };

  it('returns the stored token while it is fresh', async () => {
    const { auth, db, calls } = await setup([]);
    await db.setValue('auth', 'tokens', stored);
    expect(await auth.accessToken()).toBe('at-old');
    expect(calls).toHaveLength(0);
  });

  it('refreshes within 5 minutes of expiry, with the refresh token and no secret', async () => {
    const { auth, db, calls, setClock } = await setup([json(200, { access_token: 'at-new', expires_in: 14400 })]);
    await db.setValue('auth', 'tokens', stored);
    setClock(new Date('2030-05-01T13:56:00.000Z'));
    expect(await auth.accessToken()).toBe('at-new');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init.body)))).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'app-key' });
    expect(await auth.tokens()).toEqual({ refreshToken: 'rt', accessToken: 'at-new', expiresAt: '2030-05-01T17:56:00.000Z' });
  });

  it('shares one in-flight refresh between parallel callers', async () => {
    const { auth, db, calls } = await setup([json(200, { access_token: 'at-new', expires_in: 14400 })]);
    await db.setValue('auth', 'tokens', stored);
    const [a, b] = await Promise.all([auth.refresh(), auth.refresh()]);
    expect([a, b]).toEqual(['at-new', 'at-new']);
    expect(calls).toHaveLength(1);
  });

  it('is unauthorized when not connected or when Dropbox rejects the refresh token', async () => {
    const { auth, db } = await setup([json(401, { error: 'invalid_grant' })]);
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'unauthorized' });
    await db.setValue('auth', 'tokens', stored);
    await expect(auth.refresh()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('Auth.signOut', () => {
  it('revokes at Dropbox with the access token and forgets the tokens', async () => {
    const { auth, db, calls } = await setup([() => new Response('', { status: 200 })]);
    await db.setValue('auth', 'tokens', { refreshToken: 'rt', accessToken: 'at', expiresAt: '2030-05-01T14:00:00.000Z' });
    await auth.signOut();
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/2/auth/token/revoke', init: { method: 'POST', headers: { Authorization: 'Bearer at' } } });
    expect(await auth.tokens()).toBeUndefined();
  });

  it('forgets the tokens even when the revoke call fails', async () => {
    const { auth, db } = await setup([]);
    await db.setValue('auth', 'tokens', { refreshToken: 'rt', accessToken: 'at', expiresAt: '2030-05-01T14:00:00.000Z' });
    await auth.signOut();
    expect(await auth.isConnected()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sync/auth.test.ts`
Expected: FAIL, cannot find `./auth`.

- [ ] **Step 3: Write `src/sync/auth.ts`**

```ts
import type { Db } from './db';

/** OAuth 2 authorization code with PKCE and a refresh token (spec 3 §3). */

export interface AuthConfig {
  appKey: string;
  /** The page's own base URL, registered in the App Console. */
  redirectUri: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
}

export interface Tokens {
  refreshToken: string;
  accessToken: string;
  /** ISO timestamp. */
  expiresAt: string;
}

export interface PendingLogin {
  verifier: string;
  state: string;
  mode: 'redirect' | 'paste';
  createdAt: string;
}

export type AuthErrorCode = 'unauthorized' | 'state-mismatch' | 'no-pending-login' | 'login-expired' | 'network';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message: string = code) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthDeps {
  fetch: typeof fetch;
  now?: () => Date;
  /** Random unreserved characters; replaced in tests. */
  random?: (length: number) => string;
}

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
export const VERIFIER_LENGTH = 64;
export const STATE_LENGTH = 32;
export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** `length` characters from the RFC 7636 unreserved set, from crypto.getRandomValues. */
export function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += UNRESERVED[b % UNRESERVED.length];
  return out;
}

export function base64Url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export class Auth {
  private readonly now: () => Date;
  private readonly random: (length: number) => string;
  private inflightRefresh: Promise<string> | undefined;

  constructor(private readonly db: Db, private readonly config: AuthConfig, private readonly deps: AuthDeps) {
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? randomString;
  }

  /** Stores the pending login (awaited) and returns the URL to navigate to. */
  async startLogin(mode: 'redirect' | 'paste' = 'redirect'): Promise<string> {
    const pending: PendingLogin = { verifier: this.random(VERIFIER_LENGTH), state: this.random(STATE_LENGTH), mode, createdAt: this.now().toISOString() };
    await this.db.setValue('auth', 'pending-login', pending);
    const url = new URL(this.config.authorizeUrl ?? AUTHORIZE_URL);
    url.searchParams.set('client_id', this.config.appKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', await codeChallenge(pending.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('state', pending.state);
    if (mode === 'redirect') url.searchParams.set('redirect_uri', this.config.redirectUri);
    return url.toString();
  }

  pendingLogin(): Promise<PendingLogin | undefined> {
    return this.db.getValue<PendingLogin>('auth', 'pending-login');
  }

  /** Exchanges the code. `state` is checked for redirect logins; a pasted code carries none. */
  async completeLogin(code: string, state?: string): Promise<Tokens> {
    const pending = await this.pendingLogin();
    if (pending === undefined) throw new AuthError('no-pending-login', 'no login in progress');
    if (this.now().getTime() - Date.parse(pending.createdAt) > PENDING_LOGIN_TTL_MS) {
      await this.db.delete('auth', 'pending-login');
      throw new AuthError('login-expired', 'the login took longer than 10 minutes; start again');
    }
    if (pending.mode === 'redirect' && state !== pending.state) throw new AuthError('state-mismatch', 'the redirect did not match the login that was started');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: this.config.appKey, code_verifier: pending.verifier });
    if (pending.mode === 'redirect') body.set('redirect_uri', this.config.redirectUri);
    const json = await this.tokenRequest(body);
    const tokens: Tokens = {
      refreshToken: String(json['refresh_token']),
      accessToken: String(json['access_token']),
      expiresAt: this.expiry(json['expires_in']),
    };
    await this.db.tx(['auth'], 'readwrite', async (t) => {
      await t.put('auth', { key: 'tokens', value: tokens });
      await t.delete('auth', 'pending-login');
    });
    return tokens;
  }

  tokens(): Promise<Tokens | undefined> {
    return this.db.getValue<Tokens>('auth', 'tokens');
  }

  async isConnected(): Promise<boolean> {
    return (await this.tokens()) !== undefined;
  }

  /** A valid access token; refreshes when within 5 minutes of expiry. */
  async accessToken(): Promise<string> {
    const t = await this.tokens();
    if (t === undefined) throw new AuthError('unauthorized', 'not connected');
    if (Date.parse(t.expiresAt) - this.now().getTime() > REFRESH_MARGIN_MS) return t.accessToken;
    return this.refresh();
  }

  /** Forces a refresh (after a 401). Parallel callers share one request. */
  refresh(): Promise<string> {
    if (this.inflightRefresh === undefined) {
      this.inflightRefresh = this.doRefresh().finally(() => { this.inflightRefresh = undefined; });
    }
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<string> {
    const t = await this.tokens();
    if (t === undefined) throw new AuthError('unauthorized', 'not connected');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: this.config.appKey });
    const json = await this.tokenRequest(body);
    const next: Tokens = { ...t, accessToken: String(json['access_token']), expiresAt: this.expiry(json['expires_in']) };
    await this.db.setValue('auth', 'tokens', next);
    return next.accessToken;
  }

  /** Revokes the refresh token at Dropbox and forgets it locally. The caller clears the data stores. */
  async signOut(): Promise<void> {
    const t = await this.tokens();
    if (t !== undefined) {
      try {
        await this.deps.fetch(this.config.revokeUrl ?? REVOKE_URL, { method: 'POST', headers: { Authorization: `Bearer ${t.accessToken}` } });
      } catch {
        // Offline: the token stays valid at Dropbox until the owner unlinks the app; local state is cleared anyway.
      }
    }
    await this.db.delete('auth', 'tokens');
    await this.db.delete('auth', 'pending-login');
  }

  private async tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.deps.fetch(this.config.tokenUrl ?? TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      throw new AuthError('network', e instanceof Error ? e.message : 'network error');
    }
    if (res.status === 400 || res.status === 401) {
      const text = await res.text();
      throw new AuthError('unauthorized', `Dropbox rejected the token request (${res.status}): ${text}`);
    }
    if (!res.ok) throw new AuthError('network', `token endpoint returned ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  private expiry(expiresIn: unknown): string {
    const seconds = typeof expiresIn === 'number' ? expiresIn : 14400;
    return new Date(this.now().getTime() + seconds * 1000).toISOString();
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/sync/auth.test.ts && npm run typecheck`
Expected: PASS (15 tests); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/sync/auth.ts src/sync/auth.test.ts
git commit -m "Add the PKCE login with a refresh token and the paste-the-code fallback" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The Dropbox client, the zip reader and the test doubles

**Files:**
- Create: `src/sync/dropbox-client.ts`, `src/sync/zip.ts`, `src/sync/test-fixtures.ts`, `src/sync/fake-dropbox.ts`, `src/sync/lock.ts`, `src/sync/channel.ts`
- Test: `src/sync/dropbox-client.test.ts`, `src/sync/zip.test.ts`

**Interfaces:**
- Produces: `DropboxClient` (`listFolder`, `listFolderContinue`, `getLatestCursor`, `download`, `upload`, `downloadZip`, `revokeToken`), `DropboxResult<T>`, `DropboxError`, `Listing`, `ListingEntry`, `UploadMode`, `TokenSource`, `ClientDeps`, `DropboxHttpClient`, `contentHash(bytes)`, `headerSafeJson(value)`; `readZip(buffer): Promise<ZipEntry[]>`, `inflateRaw`; `buildZip(inputs)`, `crc32`, `deflateRaw`, `text(s)`, `FakeTimers` (`setTimeout`, `clearTimeout`, `due()`, `advance(ms, settle?)`); `FakeDropbox` (`put`, `remove`, `get`, `paths`, `log`, `offline`, `failNext`); `Leadership`, `WebLocksLeadership`, `FakeLeadership(immediate?)` with `grant()`; `ChangeChannel`, `BroadcastChangeChannel`, `LocalChangeChannel` with `posted`.

- [ ] **Step 1: Write `src/sync/dropbox-client.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DropboxHttpClient, contentHash, headerSafeJson, type TokenSource } from './dropbox-client';

interface Call { url: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null | undefined }

function harness(responses: (() => Response)[], tokens: Partial<TokenSource> = {}) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const rawBody = init?.body;
    const body = typeof rawBody === 'string' ? safeJson(rawBody) : rawBody instanceof Uint8Array ? new TextDecoder().decode(rawBody) : rawBody;
    calls.push({ url: String(url), headers, body, signal: init?.signal });
    const next = responses.shift();
    if (next === undefined) throw new TypeError('fetch failed');
    return next();
  };
  const source: TokenSource = {
    accessToken: tokens.accessToken ?? (async () => 'tok'),
    refresh: tokens.refresh ?? (async () => 'tok2'),
  };
  return { client: new DropboxHttpClient({ fetch: fetchImpl, tokens: source }), calls };
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const file = (path: string, rev: string) => ({ '.tag': 'file', name: path.split('/').pop(), path_lower: path, path_display: path, rev, size: 10 });

describe('headerSafeJson', () => {
  it('escapes every non-ASCII character', () => {
    expect(headerSafeJson({ path: '/Übung.json' })).toBe('{"path":"/\\u00dcbung.json"}');
  });
});

describe('contentHash', () => {
  it('is the hex SHA-256 of the block hashes (one block for small files)', async () => {
    const bytes = new TextEncoder().encode('abc');
    const inner = await crypto.subtle.digest('SHA-256', bytes);
    const outer = await crypto.subtle.digest('SHA-256', inner);
    const hex = [...new Uint8Array(outer)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await contentHash(bytes)).toBe(hex);
  });

  it('hashes an empty body without throwing', async () => {
    expect(await contentHash(new Uint8Array(0))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('DropboxHttpClient.listFolder', () => {
  it('lists the root recursively, follows has_more and maps the entries', async () => {
    const { client, calls } = harness([
      json(200, { entries: [file('/exercises.json', 'r1'), { '.tag': 'folder', path_lower: '/sessions' }], cursor: 'c1', has_more: true }),
      json(200, { entries: [{ '.tag': 'deleted', path_lower: '/old.json' }], cursor: 'c2', has_more: false }),
    ]);
    const r = await client.listFolder();
    expect(r).toEqual({ ok: true, value: { cursor: 'c2', entries: [
      { kind: 'file', path: '/exercises.json', rev: 'r1', size: 10 },
      { kind: 'folder', path: '/sessions' },
      { kind: 'deleted', path: '/old.json' },
    ] } });
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/2/files/list_folder', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: { path: '', recursive: true, limit: 2000, include_deleted: false } });
    expect(calls[1]).toMatchObject({ url: 'https://api.dropboxapi.com/2/files/list_folder/continue', body: { cursor: 'c1' } });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a reset cursor to cursor-reset', async () => {
    const { client } = harness([json(409, { error_summary: 'reset/..', error: { '.tag': 'reset' } })]);
    expect(await client.listFolderContinue('stale')).toMatchObject({ ok: false, error: 'cursor-reset' });
  });
});

describe('DropboxHttpClient.download', () => {
  it('sends the path in Dropbox-API-Arg and reads the rev from Dropbox-API-Result', async () => {
    const { client, calls } = harness([() => new Response('{"schemaVersion":1}', { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify({ rev: 'r9', path_lower: '/exercises.json' }) } })]);
    expect(await client.download('/exercises.json')).toEqual({ ok: true, value: { rev: 'r9', text: '{"schemaVersion":1}' } });
    expect(calls[0]).toMatchObject({ url: 'https://content.dropboxapi.com/2/files/download', headers: { 'Dropbox-API-Arg': '{"path":"/exercises.json"}' } });
    expect(calls[0]?.headers['Content-Type']).toBeUndefined();
  });

  it('maps not_found to missing', async () => {
    const { client } = harness([json(409, { error: { '.tag': 'path', path: { '.tag': 'not_found' } } })]);
    expect(await client.download('/x.json')).toMatchObject({ ok: false, error: 'missing' });
  });
});

describe('DropboxHttpClient.upload', () => {
  it('uploads with mode update, strict_conflict, mute and the content hash', async () => {
    const { client, calls } = harness([json(200, { rev: 'r2' })]);
    expect(await client.upload('/a.json', '{}', { rev: 'r1' })).toEqual({ ok: true, value: { rev: 'r2' } });
    const arg = JSON.parse(calls[0]?.headers['Dropbox-API-Arg'] as string) as Record<string, unknown>;
    expect(arg).toEqual({ path: '/a.json', mode: { '.tag': 'update', update: 'r1' }, autorename: false, mute: true, strict_conflict: true, content_hash: await contentHash(new TextEncoder().encode('{}')) });
    expect(calls[0]).toMatchObject({ url: 'https://content.dropboxapi.com/2/files/upload', headers: { 'Content-Type': 'application/octet-stream' }, body: '{}' });
  });

  it('uses mode add for a new file and maps path/conflict to conflict', async () => {
    const { client, calls } = harness([json(409, { error: { '.tag': 'path', path: { '.tag': 'conflict', conflict: { '.tag': 'file' } } } })]);
    expect(await client.upload('/a.json', '{}', { add: true })).toMatchObject({ ok: false, error: 'conflict' });
    expect((JSON.parse(calls[0]?.headers['Dropbox-API-Arg'] as string) as { mode: string }).mode).toBe('add');
  });
});

describe('DropboxHttpClient errors', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    let refreshed = 0;
    const { client, calls } = harness([json(401, { error: { '.tag': 'expired_access_token' } }), json(200, { cursor: 'c' })], { refresh: async () => { refreshed += 1; return 'tok2'; } });
    expect(await client.getLatestCursor()).toEqual({ ok: true, value: 'c' });
    expect(refreshed).toBe(1);
    expect(calls[1]?.headers['Authorization']).toBe('Bearer tok2');
  });

  it('is unauthorized when the retry fails again or the refresh throws', async () => {
    const a = harness([json(401, {}), json(401, {})]);
    expect(await a.client.getLatestCursor()).toMatchObject({ ok: false, error: 'unauthorized' });
    const b = harness([json(401, {})], { refresh: async () => { throw new Error('revoked'); } });
    expect(await b.client.getLatestCursor()).toMatchObject({ ok: false, error: 'unauthorized', message: 'revoked' });
    const c = harness([], { accessToken: async () => { throw new Error('not connected'); } });
    expect(await c.client.getLatestCursor()).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('maps 429 to rate-limited with Retry-After from the header, the body, or 1 s', async () => {
    const { client } = harness([
      json(429, { error: { '.tag': 'too_many_requests' } }, { 'Retry-After': '7' }),
      json(429, { error: { '.tag': 'too_many_write_operations', retry_after: 3 } }),
      json(429, {}),
    ]);
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'rate-limited', retryAfterMs: 7000 });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'rate-limited', retryAfterMs: 3000 });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'rate-limited', retryAfterMs: 1000 });
  });

  it('maps 5xx and network failures to offline, and anything else to other', async () => {
    const { client } = harness([json(503, {}), json(400, { error_summary: 'bad' })]);
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'offline' });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'other' });
    expect(await client.getLatestCursor()).toMatchObject({ ok: false, error: 'offline', message: 'fetch failed' });
  });

  it('revokes the token with a bare POST', async () => {
    const { client, calls } = harness([() => new Response('', { status: 200 })]);
    expect(await client.revokeToken()).toEqual({ ok: true, value: undefined });
    expect(calls[0]).toMatchObject({ url: 'https://api.dropboxapi.com/2/auth/token/revoke', headers: { Authorization: 'Bearer tok' } });
  });
});
```

- [ ] **Step 2: Write `src/sync/zip.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildZip, text } from './test-fixtures';
import { readZip } from './zip';

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('readZip', () => {
  it('reads stored and deflated entries and skips directories', async () => {
    const zip = await buildZip([
      { name: 'sessions/', data: new Uint8Array(0), method: 'store' },
      { name: 'sessions/2030/a.json', data: text('{"a":1}'), method: 'store' },
      { name: 'sessions/2030/b.json', data: text('{"b":2}'.repeat(50)), method: 'deflate' },
    ]);
    const entries = await readZip(zip.buffer as ArrayBuffer);
    expect(entries.map((e) => e.name)).toEqual(['sessions/2030/a.json', 'sessions/2030/b.json']);
    expect(decode(entries[0]?.bytes as Uint8Array)).toBe('{"a":1}');
    expect(decode(entries[1]?.bytes as Uint8Array)).toBe('{"b":2}'.repeat(50));
  });

  it('uses the central directory sizes when the local header carries a data descriptor', async () => {
    const zip = await buildZip([{ name: 'x.json', data: text('hello world'), method: 'deflate', dataDescriptor: true }]);
    const entries = await readZip(zip.buffer as ArrayBuffer);
    expect(decode(entries[0]?.bytes as Uint8Array)).toBe('hello world');
  });

  it('reads an empty archive', async () => {
    expect(await readZip((await buildZip([])).buffer as ArrayBuffer)).toEqual([]);
  });

  it('rejects a truncated archive and non-zip bytes', async () => {
    const zip = await buildZip([{ name: 'x.json', data: text('hello') }]);
    await expect(readZip(zip.buffer.slice(0, zip.length - 5) as ArrayBuffer)).rejects.toThrow(/zip/);
    await expect(readZip(text('not a zip at all, really').buffer as ArrayBuffer)).rejects.toThrow(/end of central directory/);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/sync/dropbox-client.test.ts src/sync/zip.test.ts`
Expected: FAIL, cannot find `./dropbox-client`, `./zip`, `./test-fixtures`.

- [ ] **Step 4: Write `src/sync/dropbox-client.ts`**

```ts
/** The seven Dropbox calls the engine needs, over fetch (spec 3 §4). */

export interface Listing {
  entries: ListingEntry[];
  cursor: string;
}

export type ListingEntry =
  | { kind: 'file'; path: string; rev: string; size: number }
  | { kind: 'folder'; path: string }
  | { kind: 'deleted'; path: string };

export type DropboxError = 'conflict' | 'missing' | 'cursor-reset' | 'unauthorized' | 'rate-limited' | 'offline' | 'other';

export type DropboxResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DropboxError; message: string; retryAfterMs?: number };

export type UploadMode = { add: true } | { rev: string };

export interface DropboxClient {
  /** The whole App folder, recursively; follows `has_more`. */
  listFolder(): Promise<DropboxResult<Listing>>;
  /** Changes since `cursor`; follows `has_more`. */
  listFolderContinue(cursor: string): Promise<DropboxResult<Listing>>;
  getLatestCursor(): Promise<DropboxResult<string>>;
  download(path: string): Promise<DropboxResult<{ rev: string; text: string }>>;
  upload(path: string, text: string, mode: UploadMode): Promise<DropboxResult<{ rev: string }>>;
  downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>>;
  revokeToken(): Promise<DropboxResult<void>>;
}

export interface TokenSource {
  accessToken(): Promise<string>;
  /** Forced refresh after a 401. */
  refresh(): Promise<string>;
}

export interface ClientDeps {
  fetch: typeof fetch;
  tokens: TokenSource;
  apiUrl?: string;
  contentUrl?: string;
  rpcTimeoutMs?: number;
  contentTimeoutMs?: number;
}

const API_URL = 'https://api.dropboxapi.com/2';
const CONTENT_URL = 'https://content.dropboxapi.com/2';
export const RPC_TIMEOUT_MS = 30_000;
export const CONTENT_TIMEOUT_MS = 120_000;
export const LIST_LIMIT = 2000;

/** The Dropbox-API-Arg header must be ASCII: non-ASCII characters are JSON-escaped. */
export function headerSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Dropbox's content hash: SHA-256 over the concatenated SHA-256s of 4 MiB blocks. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  const BLOCK = 4 * 1024 * 1024;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < Math.max(bytes.length, 1); i += BLOCK) {
    parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(i, i + BLOCK))));
  }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { joined.set(p, offset); offset += p.length; }
  return hex(await crypto.subtle.digest('SHA-256', joined));
}

type Raw = { ok: true; res: Response } | { ok: false; error: DropboxError; message: string; retryAfterMs?: number; body?: unknown };

export class DropboxHttpClient implements DropboxClient {
  constructor(private readonly deps: ClientDeps) {}

  async listFolder(): Promise<DropboxResult<Listing>> {
    const first = await this.rpc<RawListing>('files/list_folder', { path: '', recursive: true, limit: LIST_LIMIT, include_deleted: false });
    if (!first.ok) return first;
    return this.followListing(first.value);
  }

  async listFolderContinue(cursor: string): Promise<DropboxResult<Listing>> {
    const first = await this.rpc<RawListing>('files/list_folder/continue', { cursor }, whenTag('reset', 'cursor-reset'));
    if (!first.ok) return first;
    return this.followListing(first.value);
  }

  async getLatestCursor(): Promise<DropboxResult<string>> {
    const r = await this.rpc<{ cursor: string }>('files/list_folder/get_latest_cursor', { path: '', recursive: true, limit: LIST_LIMIT, include_deleted: false });
    return r.ok ? { ok: true, value: r.value.cursor } : r;
  }

  async download(path: string): Promise<DropboxResult<{ rev: string; text: string }>> {
    const raw = await this.content('files/download', { path }, undefined, whenTag('not_found', 'missing'));
    if (!raw.ok) return raw;
    const meta = raw.res.headers.get('Dropbox-API-Result');
    if (meta === null) return { ok: false, error: 'other', message: 'download without Dropbox-API-Result header' };
    const { rev } = JSON.parse(meta) as { rev: string };
    return { ok: true, value: { rev, text: await raw.res.text() } };
  }

  async upload(path: string, text: string, mode: UploadMode): Promise<DropboxResult<{ rev: string }>> {
    const bytes = new TextEncoder().encode(text);
    const arg = {
      path,
      mode: 'add' in mode ? 'add' : { '.tag': 'update', update: mode.rev },
      autorename: false,
      mute: true,
      strict_conflict: true,
      content_hash: await contentHash(bytes),
    };
    const raw = await this.content('files/upload', arg, bytes, whenTag('conflict', 'conflict'));
    if (!raw.ok) return raw;
    const meta = (await raw.res.json()) as { rev: string };
    return { ok: true, value: { rev: meta.rev } };
  }

  async downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>> {
    const raw = await this.content('files/download_zip', { path }, undefined, whenTag('not_found', 'missing'));
    if (!raw.ok) return raw;
    return { ok: true, value: await raw.res.arrayBuffer() };
  }

  async revokeToken(): Promise<DropboxResult<void>> {
    const raw = await this.send(`${this.deps.apiUrl ?? API_URL}/auth/token/revoke`, { method: 'POST' }, this.deps.rpcTimeoutMs ?? RPC_TIMEOUT_MS);
    return raw.ok ? { ok: true, value: undefined } : raw;
  }

  private async followListing(first: RawListing): Promise<DropboxResult<Listing>> {
    const entries = [...first.entries];
    let cursor = first.cursor;
    let more = first.has_more;
    while (more) {
      const next = await this.rpc<RawListing>('files/list_folder/continue', { cursor }, whenTag('reset', 'cursor-reset'));
      if (!next.ok) return next;
      entries.push(...next.value.entries);
      cursor = next.value.cursor;
      more = next.value.has_more;
    }
    return { ok: true, value: { entries: entries.map(mapEntry), cursor } };
  }

  private async rpc<T>(endpoint: string, arg: unknown, classify409: Classify = () => 'other'): Promise<DropboxResult<T>> {
    const raw = await this.send(
      `${this.deps.apiUrl ?? API_URL}/${endpoint}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arg) },
      this.deps.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
      classify409,
    );
    if (!raw.ok) return raw;
    return { ok: true, value: (await raw.res.json()) as T };
  }

  private content(endpoint: string, arg: unknown, body: Uint8Array | undefined, classify409: Classify): Promise<Raw> {
    const headers: Record<string, string> = { 'Dropbox-API-Arg': headerSafeJson(arg) };
    if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
    return this.send(
      `${this.deps.contentUrl ?? CONTENT_URL}/${endpoint}`,
      { method: 'POST', headers, ...(body !== undefined ? { body: body as BodyInit } : {}) },
      this.deps.contentTimeoutMs ?? CONTENT_TIMEOUT_MS,
      classify409,
    );
  }

  /** One request with the bearer token; on 401 refreshes once and retries. */
  private async send(url: string, init: RequestInit, timeoutMs: number, classify409: Classify = () => 'other'): Promise<Raw> {
    let token: string;
    try {
      token = await this.deps.tokens.accessToken();
    } catch (e) {
      return { ok: false, error: 'unauthorized', message: e instanceof Error ? e.message : 'not connected' };
    }
    let res = await this.fetchOnce(url, init, token, timeoutMs);
    if (res instanceof Response && res.status === 401) {
      try {
        token = await this.deps.tokens.refresh();
      } catch (e) {
        return { ok: false, error: 'unauthorized', message: e instanceof Error ? e.message : 'refresh failed' };
      }
      res = await this.fetchOnce(url, init, token, timeoutMs);
    }
    if (!(res instanceof Response)) return { ok: false, error: 'offline', message: res.message };
    if (res.ok) return { ok: true, res };
    const text = await res.text();
    if (res.status === 401) return { ok: false, error: 'unauthorized', message: text };
    if (res.status === 429) {
      const header = res.headers.get('Retry-After');
      let seconds = header === null ? Number.NaN : Number(header);
      if (!Number.isFinite(seconds)) seconds = retryAfterFromBody(text) ?? 1;
      return { ok: false, error: 'rate-limited', message: text, retryAfterMs: Math.max(0, seconds) * 1000 };
    }
    if (res.status === 409) return { ok: false, error: classify409(errorTags(text)), message: text };
    if (res.status >= 500) return { ok: false, error: 'offline', message: `Dropbox returned ${res.status}` };
    return { ok: false, error: 'other', message: `Dropbox returned ${res.status}: ${text}` };
  }

  private async fetchOnce(url: string, init: RequestInit, token: string, timeoutMs: number): Promise<Response | { message: string }> {
    try {
      return await this.deps.fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { message: e instanceof Error ? e.message : 'network error' };
    }
  }
}

/** Maps the `.tag` chain of a 409 body to a DropboxError. */
type Classify = (tags: string[]) => DropboxError;
const whenTag = (tag: string, error: DropboxError): Classify => (tags) => (tags.includes(tag) ? error : 'other');

interface RawListing {
  entries: RawEntry[];
  cursor: string;
  has_more: boolean;
}

interface RawEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  path_lower: string;
  rev?: string;
  size?: number;
}

function mapEntry(e: RawEntry): ListingEntry {
  if (e['.tag'] === 'file') return { kind: 'file', path: e.path_lower, rev: e.rev ?? '', size: e.size ?? 0 };
  if (e['.tag'] === 'folder') return { kind: 'folder', path: e.path_lower };
  return { kind: 'deleted', path: e.path_lower };
}

/** The chain of `.tag`s in a 409 body, outermost first: `path/conflict/file` → ['path', 'conflict', 'file']. */
function errorTags(text: string): string[] {
  const tags: string[] = [];
  try {
    const body = JSON.parse(text) as { error?: unknown };
    let node: unknown = body.error;
    while (typeof node === 'object' && node !== null) {
      const record = node as Record<string, unknown>;
      const tag = record['.tag'];
      if (typeof tag !== 'string') break;
      tags.push(tag);
      node = record[tag];
    }
  } catch {
    // not JSON: no tags
  }
  return tags;
}

function retryAfterFromBody(text: string): number | undefined {
  try {
    const body = JSON.parse(text) as { error?: { retry_after?: unknown } };
    return typeof body.error?.retry_after === 'number' ? body.error.retry_after : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Write `src/sync/zip.ts`**

```ts
/** A zip reader for Dropbox's download_zip (spec 3 §7): central directory, stored and deflated
 *  entries, no zip64, no encryption. Deflate goes through DecompressionStream('deflate-raw'). */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file entry (directories skipped), in central-directory order. */
export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) throw new Error('zip: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error('zip: zip64 is not supported');
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error(`zip: bad local header for ${name}`);
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) throw new Error(`zip: truncated data for ${name}`);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    let out: Uint8Array;
    if (method === 0) out = data.slice();
    else if (method === 8) out = await inflateRaw(data);
    else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
    if (out.length !== size) throw new Error(`zip: size mismatch for ${name}`);
    entries.push({ name, bytes: out });
  }
  return entries;
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('zip: end of central directory not found');
}
```

- [ ] **Step 6: Write `src/sync/test-fixtures.ts`**

```ts
/** Test helpers for the sync layer: a zip writer (the reader's counterpart) and small builders. */

export interface ZipInput {
  name: string;
  data: Uint8Array;
  method?: 'store' | 'deflate';
  /** Write zeroed sizes in the local header and a data descriptor after the data (general-purpose bit 3). */
  dataDescriptor?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A valid zip of the given entries. */
export async function buildZip(inputs: ZipInput[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const input of inputs) {
    const method = input.method ?? 'deflate';
    const data = method === 'deflate' ? await deflateRaw(input.data) : input.data;
    const name = new TextEncoder().encode(input.name);
    const crc = crc32(input.data);
    const flags = input.dataDescriptor ? 0x0008 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method === 'deflate' ? 8 : 0, true);
    local.setUint32(14, input.dataDescriptor ? 0 : crc, true);
    local.setUint32(18, input.dataDescriptor ? 0 : data.length, true);
    local.setUint32(22, input.dataDescriptor ? 0 : input.data.length, true);
    local.setUint16(26, name.length, true);
    const localBytes = concat([new Uint8Array(local.buffer), name, data]);
    let descriptor = new Uint8Array(0);
    if (input.dataDescriptor) {
      const d = new DataView(new ArrayBuffer(16));
      d.setUint32(0, 0x08074b50, true);
      d.setUint32(4, crc, true);
      d.setUint32(8, data.length, true);
      d.setUint32(12, input.data.length, true);
      descriptor = new Uint8Array(d.buffer);
    }
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, flags, true);
    header.setUint16(10, method === 'deflate' ? 8 : 0, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, data.length, true);
    header.setUint32(24, input.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(concat([new Uint8Array(header.buffer), name]));
    parts.push(localBytes, descriptor);
    offset += localBytes.length + descriptor.length;
  }
  const centralBytes = concat(central);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, inputs.length, true);
  eocd.setUint16(10, inputs.length, true);
  eocd.setUint32(12, centralBytes.length, true);
  eocd.setUint32(16, offset, true);
  return concat([...parts, centralBytes, new Uint8Array(eocd.buffer)]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Manual timers for the engine's debounce and backoff; `advance` fires what is due, in order. */
export class FakeTimers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.pending.delete(id as number);
  }

  /** Delays of the timers still pending, soonest first. */
  due(): number[] {
    return [...this.pending.values()].map((p) => p.at - this.now).sort((a, b) => a - b);
  }

  /** Moves the clock forward, firing due timers one by one and awaiting `settle` after each. */
  async advance(ms: number, settle: () => Promise<void> = async () => undefined): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined || next[1].at > target) break;
      this.pending.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      await settle();
    }
    this.now = target;
  }
}
```

- [ ] **Step 7: Write `src/sync/fake-dropbox.ts`**

```ts
import type { DropboxClient, DropboxError, DropboxResult, Listing, ListingEntry, UploadMode } from './dropbox-client';
import { buildZip } from './test-fixtures';

/** An in-memory Dropbox with real rev and conflict semantics, cursors, and fault injection (spec 3 §14). */
export class FakeDropbox implements DropboxClient {
  private readonly files = new Map<string, { rev: string; text: string }>();
  /** Every change in order; a cursor is an index into it. */
  private readonly journal: { path: string; deleted: boolean }[] = [];
  private revCounter = 0;
  /** Call log, e.g. 'upload /a.json update:r1'. */
  readonly log: string[] = [];
  /** Fault injection. `failNext` answers the next matching calls with the error, then clears. */
  offline = false;
  failNext: { error: DropboxError; times: number; retryAfterMs?: number; only?: string } | undefined;
  /** Dropbox's state when the folder is brand new: no files at all. */

  // ---- test-side helpers ("another device" or the desktop client) ----

  put(path: string, text: string): string {
    const rev = this.nextRev();
    this.files.set(path.toLowerCase(), { rev, text });
    this.journal.push({ path: path.toLowerCase(), deleted: false });
    return rev;
  }

  remove(path: string): void {
    this.files.delete(path.toLowerCase());
    this.journal.push({ path: path.toLowerCase(), deleted: true });
  }

  get(path: string): { rev: string; text: string } | undefined {
    return this.files.get(path.toLowerCase());
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  // ---- DropboxClient ----

  async listFolder(): Promise<DropboxResult<Listing>> {
    const fault = this.fault('listFolder');
    if (fault) return fault;
    this.log.push('listFolder');
    const entries: ListingEntry[] = [];
    const folders = new Set<string>();
    for (const [path, f] of [...this.files].sort()) {
      const parts = path.split('/').slice(1, -1);
      for (let i = 1; i <= parts.length; i += 1) folders.add(`/${parts.slice(0, i).join('/')}`);
      entries.push({ kind: 'file', path, rev: f.rev, size: f.text.length });
    }
    for (const folder of [...folders].sort()) entries.unshift({ kind: 'folder', path: folder });
    return { ok: true, value: { entries, cursor: `c${this.journal.length}` } };
  }

  async listFolderContinue(cursor: string): Promise<DropboxResult<Listing>> {
    const fault = this.fault('listFolderContinue');
    if (fault) return fault;
    this.log.push(`listFolderContinue ${cursor}`);
    const from = Number(cursor.slice(1));
    if (!cursor.startsWith('c') || !Number.isInteger(from) || from > this.journal.length) {
      return { ok: false, error: 'cursor-reset', message: 'reset' };
    }
    const latest = new Map<string, boolean>();
    for (const change of this.journal.slice(from)) latest.set(change.path, change.deleted);
    const entries: ListingEntry[] = [...latest].map(([path, deleted]) => {
      const f = this.files.get(path);
      return deleted || f === undefined ? { kind: 'deleted', path } : { kind: 'file', path, rev: f.rev, size: f.text.length };
    });
    return { ok: true, value: { entries, cursor: `c${this.journal.length}` } };
  }

  async getLatestCursor(): Promise<DropboxResult<string>> {
    const fault = this.fault('getLatestCursor');
    if (fault) return fault;
    return { ok: true, value: `c${this.journal.length}` };
  }

  async download(path: string): Promise<DropboxResult<{ rev: string; text: string }>> {
    const fault = this.fault('download');
    if (fault) return fault;
    this.log.push(`download ${path}`);
    const f = this.files.get(path.toLowerCase());
    if (f === undefined) return { ok: false, error: 'missing', message: 'not_found' };
    return { ok: true, value: { rev: f.rev, text: f.text } };
  }

  async upload(path: string, text: string, mode: UploadMode): Promise<DropboxResult<{ rev: string }>> {
    const fault = this.fault('upload');
    if (fault) return fault;
    this.log.push(`upload ${path} ${'add' in mode ? 'add' : `update:${mode.rev}`}`);
    const key = path.toLowerCase();
    const existing = this.files.get(key);
    if ('add' in mode ? existing !== undefined : existing === undefined || existing.rev !== mode.rev) {
      return { ok: false, error: 'conflict', message: 'path/conflict/file' };
    }
    const rev = this.nextRev();
    this.files.set(key, { rev, text });
    this.journal.push({ path: key, deleted: false });
    return { ok: true, value: { rev } };
  }

  async downloadZip(path: string): Promise<DropboxResult<ArrayBuffer>> {
    const fault = this.fault('downloadZip');
    if (fault) return fault;
    this.log.push(`downloadZip ${path}`);
    const prefix = `${path.toLowerCase()}/`;
    const inputs = [...this.files]
      .filter(([p]) => p.startsWith(prefix))
      .sort()
      .map(([p, f]) => ({ name: p.slice(1), data: new TextEncoder().encode(f.text) }));
    if (inputs.length === 0) return { ok: false, error: 'missing', message: 'not_found' };
    const zip = await buildZip(inputs);
    return { ok: true, value: zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer };
  }

  async revokeToken(): Promise<DropboxResult<void>> {
    this.log.push('revokeToken');
    return { ok: true, value: undefined };
  }

  // ---- internals ----

  private nextRev(): string {
    this.revCounter += 1;
    return `rev${this.revCounter}`;
  }

  private fault(call: string): { ok: false; error: DropboxError; message: string; retryAfterMs?: number } | undefined {
    if (this.offline) {
      this.log.push(`${call} (offline)`);
      return { ok: false, error: 'offline', message: 'offline' };
    }
    const f = this.failNext;
    if (f !== undefined && f.times > 0 && (f.only === undefined || f.only === call)) {
      f.times -= 1;
      if (f.times === 0) this.failNext = undefined;
      this.log.push(`${call} (${f.error})`);
      return { ok: false, error: f.error, message: f.error, ...(f.retryAfterMs !== undefined ? { retryAfterMs: f.retryAfterMs } : {}) };
    }
    return undefined;
  }
}
```

- [ ] **Step 8: Write `src/sync/lock.ts` and `src/sync/channel.ts`**

`src/sync/lock.ts`:

```ts
/** Which tab runs the engine (spec 3 §5): the holder of the Web Lock `calistally-sync`. */

export const SYNC_LOCK = 'calistally-sync';

export interface Leadership {
  /** Resolves once this tab holds the lock; the lock is kept until the tab closes. */
  whenLeader(): Promise<void>;
}

export class WebLocksLeadership implements Leadership {
  private leader: Promise<void> | undefined;

  whenLeader(): Promise<void> {
    if (this.leader === undefined) {
      this.leader = new Promise<void>((resolve) => {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        if (locks === undefined) {
          resolve(); // No Web Locks (very old browser): every tab syncs; the rev check still keeps data safe.
          return;
        }
        void locks.request(SYNC_LOCK, () => {
          resolve();
          return new Promise<never>(() => undefined); // held for the lifetime of the tab
        });
      });
    }
    return this.leader;
  }
}

/** Tests: leader at once, or when `grant()` is called. */
export class FakeLeadership implements Leadership {
  private resolve: (() => void) | undefined;
  private readonly promise: Promise<void>;

  constructor(immediate: boolean = true) {
    this.promise = new Promise<void>((resolve) => { this.resolve = resolve; });
    if (immediate) this.grant();
  }

  grant(): void {
    this.resolve?.();
  }

  whenLeader(): Promise<void> {
    return this.promise;
  }
}
```

`src/sync/channel.ts`:

```ts
/** Tells the other open tabs which path changed (spec 3 §5). */

export const CHANGE_CHANNEL = 'calistally';

export interface ChangeChannel {
  post(path: string): void;
  subscribe(listener: (path: string) => void): () => void;
}

export class BroadcastChangeChannel implements ChangeChannel {
  private readonly channel = new BroadcastChannel(CHANGE_CHANNEL);

  post(path: string): void {
    this.channel.postMessage({ path });
  }

  subscribe(listener: (path: string) => void): () => void {
    const handler = (event: MessageEvent<{ path: string }>) => listener(event.data.path);
    this.channel.addEventListener('message', handler);
    return () => this.channel.removeEventListener('message', handler);
  }
}

/** Tests and single-tab use: delivers to local subscribers only. */
export class LocalChangeChannel implements ChangeChannel {
  private readonly listeners = new Set<(path: string) => void>();
  readonly posted: string[] = [];

  post(path: string): void {
    this.posted.push(path);
    for (const l of this.listeners) l(path);
  }

  subscribe(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

- [ ] **Step 9: Run the tests and the typecheck**

Run: `npx vitest run src/sync && npm run typecheck`
Expected: PASS (71 tests); `tsc` prints nothing.

- [ ] **Step 10: Commit**

```bash
git add src/sync
git commit -m "Add the Dropbox client, the zip reader and the sync test doubles" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The sync engine

**Files:**
- Create: `src/sync/engine.ts`
- Test: `src/sync/engine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–8; `restoreReferenced`, `mergeSeed`, `SEED`, `readFile`, `upgradeFile`, `UPGRADE_STEPS`, `validateForWrite` from `src/model`.
- Produces: `Engine` (`status: SyncStatus`, `subscribe`, `init`, `idle`, `drain`, `requestPush`, `pushNow`, `chooseEmptyFolder`, `disconnect`, `reconnect`, `wentOnline`, `dispose`), `EngineDeps`, `Timers`, `SyncStatus`, `Phase`, `EmptyFolderChoice`, and the constants of the Global Constraints.

- [ ] **Step 1: Write `src/sync/engine.test.ts`**

```ts
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { readFile } from '../model/read';
import { tombstone } from '../model/record';
import { block, exercise, exercisesFile, ladder, session, sessionFile, set } from '../model/test-fixtures';
import type { Exercise, FileKind, SessionFile } from '../model/types';
import { LocalChangeChannel } from './channel';
import { openDb } from './db';
import type { DropboxClient } from './dropbox-client';
import { Engine, type EngineDeps } from './engine';
import { FakeDropbox } from './fake-dropbox';
import { FakeLeadership } from './lock';
import { EXERCISES_PATH, sessionPath } from './paths';
import { Store } from './store';
import { FakeTimers } from './test-fixtures';

const SEED: Exercise[] = [exercise({ id: 'pull-ups', name: 'Pull-ups' }), exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' })];
const NOW = new Date('2030-06-01T10:00:00.000Z');
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const sid = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sessionAt = (n: number, date = '2030-05-20'): SessionFile => sessionFile(session([block(ladder([5, 4]), { id: sid(n + 1000) })], { id: sid(n), date }));

async function harness(over: Partial<EngineDeps> = {}, dropbox = new FakeDropbox()) {
  const db = await openDb(new IDBFactory());
  const changes: string[] = [];
  const store = new Store(db, { onChange: (p) => changes.push(p) });
  const sleeps: number[] = [];
  const leadership = new FakeLeadership();
  const engine = new Engine({ store, client: dropbox, leadership, buildId: 'build-1', seed: SEED, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); }, ...over });
  await engine.init();
  return { db, store, dropbox, engine, sleeps, changes, leadership };
}


describe('Engine push', () => {
  it('uploads a new session with add, then edits with update, and records rev and lastPushAt', async () => {
    const { store, dropbox, engine } = await harness();
    const s = sessionAt(1);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    await engine.drain();
    expect(dropbox.get(path)?.text).toBe(json(s));
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toEqual([`upload ${path} add`]);
    expect(await store.getRow(path)).toMatchObject({ rev: 'rev1', syncedAt: NOW.toISOString() });
    expect(await store.queue()).toEqual([]);
    expect(engine.status).toMatchObject({ phase: 'idle', queueLength: 0, lastPushAt: NOW.toISOString(), online: true });
    const edited = { ...s, session: { ...s.session, notes: 'later' } };
    await store.writeFile('session', path, edited);
    await engine.pushNow();
    expect(dropbox.log.at(-1)).toBe(`upload ${path} update:rev1`);
    expect(dropbox.get(path)?.text).toBe(json(edited));
  });

  it('pushes the catalog and bodyweight before sessions', async () => {
    const { store, dropbox, engine } = await harness();
    const s = sessionAt(2);
    await store.writeFile('session', sessionPath(s.session.date, s.session.id), s, new Date('2030-06-01T09:00:00.000Z'));
    await store.writeFile('bodyweight', '/bodyweight.json', { schemaVersion: 1, entries: [] }, new Date('2030-06-01T09:01:00.000Z'));
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(SEED), new Date('2030-06-01T09:02:00.000Z'));
    await engine.pushNow();
    expect(dropbox.log.filter((l) => l.startsWith('upload')).map((l) => l.split(' ')[1])).toEqual([EXERCISES_PATH, '/bodyweight.json', sessionPath(s.session.date, s.session.id)]);
  });

  it('skips a held-back catalog and still pushes the sessions behind it', async () => {
    const { store, dropbox, engine } = await harness();
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([exercise({ name: '' })]));
    const s = sessionAt(3);
    await store.writeFile('session', sessionPath(s.session.date, s.session.id), s);
    await engine.pushNow();
    expect(dropbox.paths()).toEqual([sessionPath(s.session.date, s.session.id)]);
    expect((await store.queue()).map((q) => [q.path, q.heldBack !== undefined])).toEqual([[EXERCISES_PATH, true]]);
    expect(engine.status.heldBackCount).toBe(1);
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(SEED));
    await engine.pushNow();
    expect(dropbox.get(EXERCISES_PATH)).toBeDefined();
    expect(engine.status.heldBackCount).toBe(0);
  });

  it('merges on a conflict and retries with the remote rev', async () => {
    const { store, dropbox, engine } = await harness();
    const s = sessionAt(4);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    await engine.drain();
    // Another device adds a set; this device edits the note without pulling first.
    const extra = set({ id: sid(9), order: 2, reps: 3, updatedAt: '2030-06-01T10:30:00.000Z' });
    const other = { ...s, session: { ...s.session, blocks: [{ ...(s.session.blocks[0] as SessionFile['session']['blocks'][number]), sets: [...(s.session.blocks[0]?.sets ?? []), extra] }] } };
    dropbox.put(path, json(other));
    const mine = { ...s, session: { ...s.session, notes: 'mine', updatedAt: '2030-06-01T10:31:00.000Z' } };
    await store.writeFile('session', path, mine);
    await engine.pushNow();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('mine');
    expect(stored.session.blocks[0]?.sets).toHaveLength(3);
    expect(dropbox.log.filter((l) => l.startsWith('upload')).slice(-2)).toEqual([`upload ${path} update:rev1`, `upload ${path} update:rev2`]);
    expect(await store.queue()).toEqual([]);
    expect((await store.getRow(path))?.rev).toBe('rev3');
  });

  it('ends the drain after three conflicts on one path and keeps the write queued', async () => {
    const dropbox = new FakeDropbox();
    let n = 0;
    const restless: DropboxClient = {
      ...dropbox,
      listFolder: () => dropbox.listFolder(),
      listFolderContinue: (c) => dropbox.listFolderContinue(c),
      getLatestCursor: () => dropbox.getLatestCursor(),
      downloadZip: (p) => dropbox.downloadZip(p),
      revokeToken: () => dropbox.revokeToken(),
      upload: async () => ({ ok: false, error: 'conflict', message: 'conflict' }),
      download: async (path) => {
        n += 1;
        const s = sessionAt(5);
        return { ok: true, value: { rev: `r${n}`, text: json({ ...s, session: { ...s.session, notes: `other ${n}`, updatedAt: `2030-06-01T1${n}:00:00.000Z` } }) } };
      },
    };
    const { store, engine } = await harness({ client: restless });
    const s = sessionAt(5);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    await engine.pushNow();
    expect(n).toBe(3);
    expect(engine.status.lastError).toMatch(/3 conflicts/);
    expect(await store.queue()).toHaveLength(1);
  });

  it('keeps the queue row when a write lands during the upload (version race)', async () => {
    const dropbox = new FakeDropbox();
    let storeRef: Store | undefined;
    let raced = false;
    const racing: DropboxClient = {
      ...dropbox,
      listFolder: () => dropbox.listFolder(),
      listFolderContinue: (c) => dropbox.listFolderContinue(c),
      getLatestCursor: () => dropbox.getLatestCursor(),
      downloadZip: (p) => dropbox.downloadZip(p),
      revokeToken: () => dropbox.revokeToken(),
      download: (p) => dropbox.download(p),
      upload: async (path, text, mode) => {
        if (!raced) {
          raced = true;
          const s = sessionAt(6);
          await storeRef?.writeFile('session', path, { ...s, session: { ...s.session, notes: 'during upload' } });
        }
        return dropbox.upload(path, text, mode);
      },
    };
    const h = await harness({ client: racing });
    storeRef = h.store;
    const s = sessionAt(6);
    const path = sessionPath(s.session.date, s.session.id);
    await h.store.writeFile('session', path, s);
    await h.engine.pushNow();
    expect(await h.store.queue()).toHaveLength(1);
    expect((await h.store.getRow(path))?.rev).toBe('rev1');
    await h.engine.pushNow();
    expect(await h.store.queue()).toHaveLength(0);
    expect((JSON.parse(dropbox.get(path)?.text as string) as SessionFile).session.notes).toBe('during upload');
  });

  it('waits Retry-After on a 429 and then succeeds', async () => {
    const { store, dropbox, engine, sleeps } = await harness();
    const s = sessionAt(7);
    const path = sessionPath(s.session.date, s.session.id);
    await store.writeFile('session', path, s);
    dropbox.failNext = { error: 'rate-limited', times: 1, retryAfterMs: 3000, only: 'upload' };
    await engine.pushNow();
    expect(sleeps).toEqual([3000]);
    expect(dropbox.get(path)).toBeDefined();
    expect(engine.status.online).toBe(true);
  });

  it('records a non-transient failure on the queue row and moves on', async () => {
    const { store, dropbox, engine } = await harness();
    const a = sessionAt(8);
    const b = sessionAt(9, '2030-05-21');
    await store.writeFile('session', sessionPath(a.session.date, a.session.id), a, new Date('2030-06-01T09:00:00.000Z'));
    await store.writeFile('session', sessionPath(b.session.date, b.session.id), b, new Date('2030-06-01T09:01:00.000Z'));
    dropbox.failNext = { error: 'other', times: 1, only: 'upload' };
    await engine.pushNow();
    expect(dropbox.paths()).toEqual([sessionPath(b.session.date, b.session.id)]);
    expect((await store.queue())[0]).toMatchObject({ attempts: 1, lastError: 'other' });
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['push-error']);
  });
});

describe('Engine pull', () => {
  it('loads everything on a fresh device, then pulls only changes through the cursor', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    dropbox.put('/bodyweight.json', json({ schemaVersion: 1, entries: [] }));
    const a = sessionAt(10);
    dropbox.put(sessionPath(a.session.date, a.session.id), json(a));
    dropbox.put('/review.md', '# notes');
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.rows()).map((r) => [r.path, r.status, r.rev]).sort()).toEqual([
      ['/bodyweight.json', 'ok', 'rev2'],
      [EXERCISES_PATH, 'ok', 'rev1'],
      [sessionPath(a.session.date, a.session.id), 'ok', 'rev3'],
    ]);
    expect(await store.getMeta('cursor')).toBe('c4');
    expect(engine.status).toMatchObject({ lastPullAt: NOW.toISOString(), emptyFolder: false, queueLength: 0 });
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual(['listFolderContinue c4']);
    const b = sessionAt(11, '2030-05-22');
    dropbox.put(sessionPath(b.session.date, b.session.id), json(b));
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual(['listFolderContinue c4', `download ${sessionPath(b.session.date, b.session.id)}`]);
    expect((await store.sessions()).length).toBe(2);
  });

  it('relists from scratch when the cursor is rejected', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    const { store, engine } = await harness({}, dropbox);
    await store.setMeta('cursor', 'bogus');
    await engine.drain();
    expect(dropbox.log.slice(0, 2)).toEqual(['listFolderContinue bogus', 'listFolder']);
    expect(await store.catalog()).toBeDefined();
  });

  it('lists stray json files as unexpected and never reads them', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put('/exercises (conflicted copy).json', '{}');
    dropbox.put('/sessions/2030/notes.json', '{}');
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('download'))).toEqual([]);
    expect(engine.status.issues.map((i) => [i.path, i.reason])).toEqual([['/exercises (conflicted copy).json', 'unexpected-file'], ['/sessions/2030/notes.json', 'unexpected-file']]);
    expect(await store.rows()).toEqual([]);
    dropbox.remove('/sessions/2030/notes.json');
    await engine.drain();
    expect(engine.status.issues).toHaveLength(1);
  });

  it('merges a remote change into a row with pending local changes and pushes the union', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(12);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    await store.writeFile('session', path, { ...s, session: { ...s.session, notes: 'local', updatedAt: '2030-06-01T10:05:00.000Z' } });
    const extra = set({ id: sid(13), order: 2, reps: 3 });
    dropbox.put(path, json({ ...s, session: { ...s.session, blocks: [{ ...(s.session.blocks[0] as SessionFile['session']['blocks'][number]), sets: [...(s.session.blocks[0]?.sets ?? []), extra] }] } }));
    await engine.drain();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('local');
    expect(stored.session.blocks[0]?.sets).toHaveLength(3);
    expect(await store.queue()).toEqual([]);
  });

  it('parks local changes under a too-new remote and releases them once the app is updated', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(14);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const h = await harness({}, dropbox);
    await h.engine.drain();
    const mine = { ...s, session: { ...s.session, notes: 'phone', updatedAt: '2030-06-01T10:05:00.000Z' } };
    await h.store.writeFile('session', path, mine);
    // The PC, on a newer app, wrote the file at schema version 2 with a field this app does not know.
    const pcSet = set({ id: sid(99), order: 2, reps: 3, updatedAt: '2030-06-01T10:04:00.000Z' });
    const firstBlock = s.session.blocks[0] as SessionFile['session']['blocks'][number];
    const newer = { ...s, schemaVersion: 2, session: { ...s.session, blocks: [{ ...firstBlock, sets: [...firstBlock.sets, pcSet] }] }, extra: true };
    dropbox.put(path, json(newer));
    await h.engine.drain();
    expect((await h.store.getRow(path))).toMatchObject({ status: 'read-only', content: newer, rev: 'rev2' });
    expect((await h.store.getQueueRow(path))).toMatchObject({ pendingContent: mine, pendingVersion: 1 });
    expect(await h.store.writeFile('session', path, mine)).toEqual({ ok: false, reason: 'read-only' });
    expect(h.engine.status).toMatchObject({ tooNewSeen: true, queueLength: 1 });
    await h.engine.pushNow();
    expect(dropbox.get(path)?.rev).toBe('rev2');
    // The updated app: it knows version 2 (simulated by a reader that accepts it).
    const v2Reader = (kind: FileKind, raw: unknown) => {
      const r = raw as { schemaVersion: number; extra?: boolean };
      if (r.schemaVersion === 2) { const { extra: _x, ...rest } = r; return readFile(kind, { ...rest, schemaVersion: 1 }); }
      return readFile(kind, raw);
    };
    const updated = new Engine({ store: h.store, client: dropbox, leadership: new FakeLeadership(), buildId: 'build-2', seed: SEED, now: () => NOW, readFile: v2Reader });
    await updated.init();
    await h.store.setMeta('cursor', undefined);
    await updated.drain();
    const stored = JSON.parse(dropbox.get(path)?.text as string) as SessionFile;
    expect(stored.session.notes).toBe('phone');
    expect(stored.session.blocks[0]?.sets.map((x) => x.id)).toContain(sid(99));
    expect(await h.store.queue()).toEqual([]);
    expect((await h.store.getRow(path))?.status).toBe('ok');
  });

  it('never overwrites a quarantined remote and holds the local write', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(15);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    await store.writeFile('session', path, { ...s, session: { ...s.session, notes: 'phone' } });
    const broken = json({ ...s, session: { ...s.session, date: '2030-02-30' } });
    dropbox.put(path, broken);
    await engine.drain();
    expect((await store.getRow(path))?.status).toBe('quarantined');
    expect(await store.getQueueRow(path)).toMatchObject({ lastError: expect.stringMatching(/invalid/), pendingContent: expect.anything() });
    expect(dropbox.get(path)?.text).toBe(broken);
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toHaveLength(0);
    expect(engine.status.issues.map((i) => i.reason).sort()).toEqual(['push-error', 'quarantined']);
  });

  it('quarantines a file that is not JSON, and one whose JSON is not an object', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, '{not json');
    dropbox.put('/bodyweight.json', '[1, 2, 3]');
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.getRow(EXERCISES_PATH))).toMatchObject({ status: 'quarantined', content: '{not json' });
    expect((await store.getRow('/bodyweight.json'))).toMatchObject({ status: 'quarantined', content: [1, 2, 3] });
    await engine.drain();
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['quarantined', 'quarantined']);
  });

  it('reads a session whose date no longer matches its path (the content is the truth)', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(30, '2030-05-20');
    const path = sessionPath('2030-05-19', s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.sessions()).map((x) => [x.path, x.file.session.date])).toEqual([[path, '2030-05-20']]);
    expect(engine.status.issues).toEqual([]);
  });

  it('keeps the old cursor when a download fails, so the next pull fetches the missed file', async () => {
    const dropbox = new FakeDropbox();
    const a = sessionAt(31);
    dropbox.put(sessionPath(a.session.date, a.session.id), json(a));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    const b = sessionAt(32, '2030-05-21');
    dropbox.put(sessionPath(b.session.date, b.session.id), json(b));
    dropbox.failNext = { error: 'offline', times: 1, only: 'download' };
    await engine.drain();
    expect(engine.status.online).toBe(false);
    expect(await store.getMeta('cursor')).toBe('c1');
    expect(await store.getRow(sessionPath(b.session.date, b.session.id))).toBeUndefined();
    await engine.wentOnline();
    expect(await store.getRow(sessionPath(b.session.date, b.session.id))).toMatchObject({ status: 'ok' });
    expect(await store.getMeta('cursor')).toBe('c2');
    engine.dispose();
  });

  it('carries a duplicate loser\'s pending local changes into the winner', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(33);
    const first = sessionPath(s.session.date, s.session.id);
    const copy = '/sessions/2030/2030-05-21_00000021.json';
    dropbox.put(first, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    // The copy appears in Dropbox, is pulled, and gets a local edit before the next pull sees both.
    dropbox.put(copy, json(s));
    await store.saveRow({ path: copy, kind: 'session', rev: dropbox.get(copy)?.rev as string, content: s, status: 'ok', issues: [], version: 0 });
    await store.writeFile('session', copy, { ...s, session: { ...s.session, notes: 'typed into the copy', updatedAt: '2030-06-01T10:05:00.000Z' } });
    await engine.drain();
    expect((await store.getRow(copy))?.duplicateOf).toBe(first);
    expect(await store.getQueueRow(copy)).toBeUndefined();
    expect((JSON.parse(dropbox.get(first)?.text as string) as SessionFile).session.notes).toBe('typed into the copy');
  });

  it('merges duplicate session files into the first path and drops the loser once Dropbox has', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(16);
    const first = sessionPath(s.session.date, s.session.id);
    const copy = '/sessions/2030/2030-05-21_00000010.json';
    dropbox.put(first, json(s));
    dropbox.put(copy, json({ ...s, session: { ...s.session, notes: 'from the copy', updatedAt: '2030-06-01T10:05:00.000Z' } }));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect((await store.sessions()).map((x) => x.path)).toEqual([first]);
    expect((await store.getRow(copy))?.duplicateOf).toBe(first);
    expect((JSON.parse(dropbox.get(first)?.text as string) as SessionFile).session.notes).toBe('from the copy');
    expect(dropbox.get(copy)?.rev).toBe('rev2');
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['duplicate']);
    await engine.drain();
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['duplicate']);
    dropbox.remove(copy);
    await engine.drain();
    expect(await store.getRow(copy)).toBeUndefined();
    expect(engine.status.issues).toEqual([]);
  });

  it('keeps a file deleted in Dropbox, lists it, and re-creates it only after a local write', async () => {
    const dropbox = new FakeDropbox();
    const s = sessionAt(17);
    const path = sessionPath(s.session.date, s.session.id);
    dropbox.put(path, json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    dropbox.remove(path);
    await engine.drain();
    expect(await store.getRow(path)).toMatchObject({ rev: null, remoteDeleted: true, content: s });
    expect(engine.status.issues.map((i) => i.reason)).toEqual(['remote-deleted']);
    expect(dropbox.get(path)).toBeUndefined();
    await store.writeFile('session', path, { ...s, session: { ...s.session, notes: 'back' } });
    await engine.pushNow();
    expect(dropbox.log.at(-1)).toBe(`upload ${path} add`);
    expect(await store.getRow(path)).not.toHaveProperty('remoteDeleted');
    expect(engine.status.issues).toEqual([]);
  });

  it('fetches a big first load as one zip, with the revs from the listing', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    for (let i = 0; i < 25; i += 1) {
      const s = sessionAt(100 + i, `2030-04-${String(1 + i).padStart(2, '0')}`);
      dropbox.put(sessionPath(s.session.date, s.session.id), json(s));
    }
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('downloadZip'))).toEqual(['downloadZip /sessions']);
    expect(dropbox.log.filter((l) => l.startsWith('download '))).toEqual([`download ${EXERCISES_PATH}`]);
    const rows = await store.sessions();
    expect(rows).toHaveLength(25);
    for (const r of rows) expect((await store.getRow(r.path))?.rev).toBe(dropbox.get(r.path)?.rev);
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual(['listFolderContinue c26']);
  });

  it('falls back to single downloads when the zip fails', async () => {
    const dropbox = new FakeDropbox();
    for (let i = 0; i < 22; i += 1) {
      const s = sessionAt(200 + i, `2030-03-${String(1 + i).padStart(2, '0')}`);
      dropbox.put(sessionPath(s.session.date, s.session.id), json(s));
    }
    dropbox.failNext = { error: 'other', times: 1, only: 'downloadZip' };
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('download ')).length).toBe(22);
    expect(await store.sessions()).toHaveLength(22);
  });

  it('restores a tombstoned exercise that a live block still references, and pushes the catalog', async () => {
    const dropbox = new FakeDropbox();
    const dead = tombstone(exercise({ id: 'pull-ups', name: 'Pull-ups' }), new Date('2030-05-01T00:00:00.000Z'));
    dropbox.put(EXERCISES_PATH, json(exercisesFile([dead])));
    const s = sessionAt(18);
    dropbox.put(sessionPath(s.session.date, s.session.id), json(s));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    const catalog = await store.catalog();
    const restored = catalog?.exercises.find((e) => e.id === 'pull-ups');
    expect(restored).toMatchObject({ archived: true });
    expect(restored?.deletedAt).toBeUndefined();
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toEqual([`upload ${EXERCISES_PATH} update:rev1`]);
  });
});

describe('Engine seed and empty folder', () => {
  it('adds missing seed entries once per build when a catalog exists remotely', async () => {
    const dropbox = new FakeDropbox();
    dropbox.put(EXERCISES_PATH, json(exercisesFile([exercise({ id: 'pull-ups', name: 'Pull-ups', cues: 'mine' })])));
    const { store, engine } = await harness({}, dropbox);
    await engine.drain();
    const ids = (await store.catalog())?.exercises.map((e) => e.id).sort();
    expect(ids).toEqual(['dips-bar', 'pull-ups']);
    expect((await store.catalog())?.exercises.find((e) => e.id === 'pull-ups')?.cues).toBe('mine');
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toHaveLength(1);
    expect(await store.getMeta('seededBuild')).toBe('build-1');
    await engine.drain();
    expect(dropbox.log.filter((l) => l.startsWith('upload'))).toHaveLength(1);
  });

  it('reports an empty folder and waits for the choice; "seed" writes the catalog, "copy" does nothing', async () => {
    const a = await harness();
    await a.engine.drain();
    expect(a.engine.status.emptyFolder).toBe(true);
    expect(a.dropbox.paths()).toEqual([]);
    await a.engine.chooseEmptyFolder('seed');
    expect(a.dropbox.paths()).toEqual([EXERCISES_PATH]);
    expect((await a.store.catalog())?.exercises).toHaveLength(2);
    await a.engine.drain();
    expect(a.engine.status.emptyFolder).toBe(false);

    const b = await harness();
    await b.engine.drain();
    await b.engine.chooseEmptyFolder('copy');
    await b.engine.drain();
    expect(b.dropbox.paths()).toEqual([]);
    expect(b.engine.status).toMatchObject({ emptyFolder: true, emptyFolderChoice: 'copy' });
    b.dropbox.put(EXERCISES_PATH, json(exercisesFile(SEED)));
    await b.engine.drain();
    expect(b.engine.status.emptyFolder).toBe(false);
    expect((await b.store.catalog())?.exercises).toHaveLength(2);
  });
});

describe('Engine failures and triggers', () => {
  it('backs off while offline and recovers on the online event', async () => {
    const timers = new FakeTimers();
    const { dropbox, engine } = await harness({ timers });
    dropbox.offline = true;
    await engine.drain();
    expect(engine.status).toMatchObject({ online: false, retryInMs: 2000 });
    expect(engine.status.lastError).toMatch(/offline/);
    expect(timers.due()).toEqual([2000]);
    await timers.advance(2000, () => engine.idle());
    expect(engine.status.retryInMs).toBe(4000);
    expect(dropbox.log.filter((l) => l.includes('offline'))).toHaveLength(2);
    await timers.advance(4000, () => engine.idle());
    expect(engine.status.retryInMs).toBe(8000);
    dropbox.offline = false;
    await engine.wentOnline();
    expect(engine.status).toMatchObject({ online: true, lastError: undefined, retryInMs: undefined });
    expect(timers.due()).toEqual([]);
  });

  it('caps the backoff at five minutes', async () => {
    const timers = new FakeTimers();
    const { dropbox, engine } = await harness({ timers });
    dropbox.offline = true;
    await engine.drain();
    for (let i = 0; i < 12; i += 1) await timers.advance(timers.due()[0] as number, () => engine.idle());
    expect(engine.status.retryInMs).toBe(300_000);
  });

  it('stops on unauthorized until reconnect', async () => {
    const { dropbox, engine, store } = await harness();
    dropbox.failNext = { error: 'unauthorized', times: 1 };
    await engine.drain();
    expect(engine.status.connected).toBe(false);
    dropbox.log.length = 0;
    await engine.drain();
    expect(dropbox.log).toEqual([]);
    engine.reconnect();
    await store.writeFile('session', sessionPath('2030-05-20', sid(19)), sessionAt(19));
    await engine.drain();
    expect(dropbox.paths()).toHaveLength(1);
  });

  it('only drains once it holds the leadership lock', async () => {
    const leadership = new FakeLeadership(false);
    const { dropbox, engine } = await harness({ leadership });
    let done = false;
    const pending = engine.drain().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    expect(dropbox.log).toEqual([]);
    leadership.grant();
    await pending;
    expect(dropbox.log).toEqual(['listFolder']);
  });

  it('pushes one second after the last request, and on a change from another tab', async () => {
    const timers = new FakeTimers();
    const channel = new LocalChangeChannel();
    const { store, dropbox, engine } = await harness({ channel, timers });
    const s = sessionAt(20);
    await store.writeFile('session', sessionPath(s.session.date, s.session.id), s);
    engine.requestPush();
    await timers.advance(500, () => engine.idle());
    engine.requestPush();
    await timers.advance(900, () => engine.idle());
    expect(dropbox.paths()).toEqual([]);
    await timers.advance(200, () => engine.idle());
    expect(dropbox.paths()).toHaveLength(1);
    const t = sessionAt(21, '2030-05-23');
    await store.writeFile('session', sessionPath(t.session.date, t.session.id), t);
    channel.post(sessionPath(t.session.date, t.session.id));
    await timers.advance(1100, () => engine.idle());
    expect(dropbox.paths()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/sync/engine.test.ts`
Expected: FAIL, cannot find `./engine`.

- [ ] **Step 3: Write `src/sync/engine.ts`**

```ts
import { restoreReferenced } from '../model/catalog';
import { readFile as defaultReadFile, type ReadResult } from '../model/read';
import { MODEL_VERSION } from '../model/schema';
import { SEED, mergeSeed } from '../model/seed';
import type { Exercise, ExercisesFile, FileKind, SessionFile } from '../model/types';
import { UPGRADE_STEPS, upgradeFile as defaultUpgradeFile, type UpgradeResult } from '../model/upgrade';
import { validateForWrite } from '../model/validate';
import type { ChangeChannel } from './channel';
import type { DropboxClient, DropboxResult, ListingEntry } from './dropbox-client';
import type { Leadership } from './lock';
import { mergeFile, sameContent } from './merge';
import { EXERCISES_PATH, classifyPath } from './paths';
import type { FileRow, Issue, QueueRow, Store } from './store';
import { readZip } from './zip';

/** The sync engine (spec 3 §7): one drain is a pull, then a push. */

export const ZIP_THRESHOLD = 20;
export const DOWNLOAD_CONCURRENCY = 4;
export const PUSH_DEBOUNCE_MS = 1000;
export const MAX_BACKOFF_MS = 5 * 60 * 1000;
export const CONFLICTS_PER_DRAIN = 3;
export const RATE_LIMIT_RETRIES = 5;

export type Phase = 'idle' | 'pulling' | 'pushing';
export type EmptyFolderChoice = 'seed' | 'copy';

export interface SyncStatus {
  phase: Phase;
  online: boolean;
  connected: boolean;
  queueLength: number;
  heldBackCount: number;
  lastPullAt?: string | undefined;
  lastPushAt?: string | undefined;
  lastError?: string | undefined;
  issues: Issue[];
  /** A file newer than this app was seen: the shell checks for an update (spec 3 §8). */
  tooNewSeen: boolean;
  /** The App folder holds no data files and no local writes exist (spec 3 §11). */
  emptyFolder: boolean;
  emptyFolderChoice?: EmptyFolderChoice | undefined;
  /** Milliseconds until the next automatic retry, when backing off. */
  retryInMs?: number | undefined;
}

export interface EngineDeps {
  store: Store;
  client: DropboxClient;
  leadership: Leadership;
  channel?: ChangeChannel;
  /** Identifies the build; the seed merge runs once per value. */
  buildId: string;
  seed?: readonly Exercise[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** The model's read and upgrade functions; tests replace them to simulate an updated app. */
  readFile?: (kind: FileKind, raw: unknown) => ReadResult;
  upgradeFile?: (kind: FileKind, raw: unknown) => UpgradeResult;
  modelVersion?: number;
  /** The debounce and backoff timers; tests pass a FakeTimers. */
  timers?: Timers;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Outcome = 'done' | 'stopped';

export class Engine {
  readonly status: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

  private readonly store: Store;
  private readonly client: DropboxClient;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly read: (kind: FileKind, raw: unknown) => ReadResult;
  private readonly upgrade: (kind: FileKind, raw: unknown) => UpgradeResult;
  private readonly modelVersion: number;
  private readonly seed: readonly Exercise[];
  private readonly timers: Timers;
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private chain: Promise<void> = Promise.resolve();
  private drainQueued = false;
  private pushTimer: unknown;
  private retryTimer: unknown;
  private failures = 0;
  private stopped = false;

  constructor(private readonly deps: EngineDeps) {
    this.store = deps.store;
    this.client = deps.client;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.read = deps.readFile ?? ((kind, raw) => defaultReadFile(kind, raw, UPGRADE_STEPS, deps.modelVersion ?? MODEL_VERSION));
    this.upgrade = deps.upgradeFile ?? ((kind, raw) => defaultUpgradeFile(kind, raw, UPGRADE_STEPS, deps.modelVersion ?? MODEL_VERSION));
    this.modelVersion = deps.modelVersion ?? MODEL_VERSION;
    this.seed = deps.seed ?? SEED;
    this.timers = deps.timers ?? REAL_TIMERS;
    deps.channel?.subscribe(() => this.requestPush());
  }

  /** Resolves when every queued run has finished. */
  idle(): Promise<void> {
    return this.chain;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Loads the persisted parts of the status. Call once after construction. */
  async init(): Promise<void> {
    this.status.lastPullAt = await this.store.getMeta<string>('lastPullAt');
    this.status.lastPushAt = await this.store.getMeta<string>('lastPushAt');
    this.status.emptyFolderChoice = await this.store.getMeta<EmptyFolderChoice>('emptyFolderChoice');
    await this.refreshCounts();
  }

  /** A full drain (pull, then push), serialised with everything else. Coalesces while one is queued. */
  drain(): Promise<void> {
    if (this.drainQueued) return this.chain;
    this.drainQueued = true;
    return this.enqueue(async () => {
      this.drainQueued = false;
      if (await this.pull() === 'done') await this.push();
    });
  }

  /** Push only, 1 s after the last call (spec 3 §7 triggers). */
  requestPush(): void {
    if (this.pushTimer !== undefined) this.timers.clearTimeout(this.pushTimer);
    this.pushTimer = this.timers.setTimeout(() => {
      this.pushTimer = undefined;
      void this.enqueue(() => this.push().then(() => undefined));
    }, PUSH_DEBOUNCE_MS);
  }

  pushNow(): Promise<void> {
    return this.enqueue(() => this.push().then(() => undefined));
  }

  /** The owner's answer on an empty App folder (spec 3 §11). */
  async chooseEmptyFolder(choice: EmptyFolderChoice): Promise<void> {
    await this.store.setMeta('emptyFolderChoice', choice);
    this.status.emptyFolderChoice = choice;
    if (choice === 'seed') {
      await this.enqueue(async () => {
        await this.runSeed(true);
        await this.push();
      });
    } else {
      this.notify();
    }
  }

  /** No tokens: nothing runs until a login. Local writes still queue. */
  disconnect(): void {
    this.status.connected = false;
    this.stopped = true;
    this.notify();
  }

  /** After a new login: the engine runs again. */
  reconnect(): void {
    this.status.connected = true;
    this.stopped = false;
    this.notify();
  }

  /** Stops timers; used on sign out and in tests. */
  dispose(): void {
    this.stopped = true;
    if (this.pushTimer !== undefined) this.timers.clearTimeout(this.pushTimer);
    if (this.retryTimer !== undefined) this.timers.clearTimeout(this.retryTimer);
  }

  // ---- pull ----

  private async pull(): Promise<Outcome> {
    if (!this.status.connected || this.stopped) return 'stopped';
    this.setPhase('pulling');
    try {
      const cursor = await this.store.getMeta<string>('cursor');
      let listing = cursor === undefined ? await this.client.listFolder() : await this.client.listFolderContinue(cursor);
      if (!listing.ok && listing.error === 'cursor-reset') {
        await this.store.setMeta('cursor', undefined);
        listing = await this.client.listFolder();
      }
      if (!listing.ok) return this.failed(listing);
      const outcome = await this.applyListing(listing.value.entries, cursor === undefined);
      if (outcome !== 'done') return outcome;
      await this.store.setMeta('cursor', listing.value.cursor);
      await this.afterPull();
      const at = this.now().toISOString();
      await this.store.setMeta('lastPullAt', at);
      this.status.lastPullAt = at;
      this.succeeded();
      return 'done';
    } finally {
      await this.refreshCounts();
      this.setPhase('idle');
    }
  }

  private async applyListing(entries: ListingEntry[], firstLoad: boolean): Promise<Outcome> {
    const unexpected = new Set(await this.store.unexpectedPaths());
    const toFetch: { path: string; kind: FileKind; rev: string }[] = [];
    for (const e of entries) {
      const cls = classifyPath(e.path);
      if (cls.kind === 'ignored') continue;
      if (e.kind === 'deleted') {
        unexpected.delete(e.path);
        if (cls.kind === 'data') await this.remoteDeleted(e.path);
        continue;
      }
      if (e.kind === 'folder') continue;
      if (cls.kind === 'unexpected') { unexpected.add(e.path); continue; }
      const row = await this.store.getRow(e.path);
      if (row?.rev !== e.rev) toFetch.push({ path: e.path, kind: cls.fileKind, rev: e.rev });
    }
    await this.store.setUnexpectedPaths([...unexpected]);
    let remaining = toFetch;
    const missingSessions = toFetch.filter((f) => f.kind === 'session');
    if (firstLoad && missingSessions.length > ZIP_THRESHOLD) {
      const done = await this.fetchZip(missingSessions);
      remaining = toFetch.filter((f) => !done.has(f.path));
    }
    return this.fetchEach(remaining);
  }

  /** First load: one zip for /sessions. Returns the paths it covered; the rest go file by file. */
  private async fetchZip(wanted: { path: string; kind: FileKind; rev: string }[]): Promise<Set<string>> {
    const done = new Set<string>();
    const zip = await this.client.downloadZip('/sessions');
    if (!zip.ok) return done;
    let entries;
    try {
      entries = await readZip(zip.value);
    } catch {
      return done;
    }
    const byPath = new Map(wanted.map((w) => [w.path, w]));
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      const target = byPath.get(`/${name}`) ?? byPath.get(`/sessions/${name}`);
      if (target === undefined) continue;
      await this.applyRemote(target.path, target.kind, target.rev, new TextDecoder().decode(entry.bytes));
      done.add(target.path);
    }
    return done;
  }

  private async fetchEach(files: { path: string; kind: FileKind; rev: string }[]): Promise<Outcome> {
    let index = 0;
    let stop: Extract<DropboxResult<never>, { ok: false }> | undefined;
    const worker = async () => {
      while (index < files.length && stop === undefined) {
        const f = files[index] as { path: string; kind: FileKind; rev: string };
        index += 1;
        const r = await this.client.download(f.path);
        if (!r.ok) {
          if (r.error === 'missing') { await this.remoteDeleted(f.path); continue; }
          stop = r;
          return;
        }
        await this.applyRemote(f.path, f.kind, r.value.rev, r.value.text);
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
    return stop === undefined ? 'done' : this.failed(stop);
  }

  /** One downloaded file into the local copy: read, merge, park or quarantine (spec 3 §6, §7). */
  private async applyRemote(path: string, kind: FileKind, rev: string, text: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      await this.saveNonOk(path, kind, rev, text, 'quarantined', [{ level: 'hard', path: '', message: `not JSON: ${e instanceof Error ? e.message : String(e)}` }]);
      return;
    }
    await this.applyRaw(path, kind, rev, raw);
  }

  /** Rows that were too new or invalid are read again from their stored raw content on every
   *  pull: after an app update (or a fix) they become readable without a download, and parked
   *  local changes are released (spec 3 §6). */
  private async rereadNonOk(): Promise<void> {
    for (const row of await this.store.rows()) {
      if (row.status === 'ok' || row.rev === null || typeof row.content !== 'object' || row.content === null) continue;
      await this.applyRaw(row.path, row.kind, row.rev, row.content);
    }
    const rows = await this.store.rows();
    this.status.tooNewSeen = rows.some((r) => r.status === 'read-only' || r.status === 'needs-update');
  }

  private async applyRaw(path: string, kind: FileKind, rev: string, raw: unknown): Promise<void> {
    const result = this.read(kind, raw);
    if (result.status !== 'ok') {
      if (result.status !== 'quarantined') this.status.tooNewSeen = true;
      await this.saveNonOk(path, kind, rev, raw, result.status, result.issues);
      return;
    }
    const row = await this.store.getRow(path);
    const queued = await this.store.getQueueRow(path);
    let merged: unknown = result.file;
    let localVersion = row?.version ?? 0;
    const localOk = row !== undefined && row.status === 'ok' && row.duplicateOf === undefined;
    if (localOk) merged = this.mergeInto(kind, row.content, merged);
    if (queued?.pendingContent !== undefined) {
      const up = this.upgrade(kind, queued.pendingContent);
      if (up.status === 'ok') merged = this.mergeInto(kind, up.file, merged);
    }
    const equalsRemote = sameContent(merged, result.file);
    const equalsLocal = localOk && sameContent(merged, row.content);
    if (!equalsLocal) localVersion += 1;
    const at = this.now().toISOString();
    const next: FileRow = {
      path, kind, rev, content: merged, status: 'ok', issues: [], version: localVersion,
      ...(equalsRemote ? { syncedAt: at } : row?.syncedAt !== undefined ? { syncedAt: row.syncedAt } : {}),
    };
    await this.store.saveRow(next);
    if (equalsRemote) {
      if (queued !== undefined) await this.store.deleteQueueRow(path);
    } else {
      const base: QueueRow = queued ?? { path, kind, enqueuedAt: at, attempts: 0 };
      const { pendingContent: _p, pendingVersion: _v, lastError: _e, heldBack: _h, ...kept } = base;
      const validation = validateForWrite(kind, merged);
      await this.store.setQueueRow({ ...kept, ...(validation.ok ? {} : { heldBack: validation.issues }) });
    }
  }

  private mergeInto(kind: FileKind, local: unknown, remote: unknown): unknown {
    const merged = mergeFile(kind, local, remote) as Record<string, unknown>;
    return { ...merged, schemaVersion: this.modelVersion };
  }

  /** A too-new or invalid remote replaces the row; queued local content is parked, never lost. */
  private async saveNonOk(path: string, kind: FileKind, rev: string, raw: unknown, status: 'read-only' | 'needs-update' | 'quarantined', issues: FileRow['issues']): Promise<void> {
    const row = await this.store.getRow(path);
    const queued = await this.store.getQueueRow(path);
    if (queued !== undefined && row !== undefined && row.status === 'ok' && queued.pendingContent === undefined) {
      const { heldBack: _h, ...kept } = queued;
      await this.store.setQueueRow({ ...kept, pendingContent: row.content, pendingVersion: this.modelVersion, lastError: status === 'quarantined' ? 'Dropbox copy invalid; local changes wait' : 'Dropbox copy is newer than this app; local changes wait' });
    } else if (queued !== undefined && status === 'quarantined') {
      await this.store.setQueueRow({ ...queued, lastError: 'Dropbox copy invalid; local changes wait' });
    }
    await this.store.saveRow({ path, kind, rev, content: raw, status, issues, version: row?.version ?? 0 });
  }

  private async remoteDeleted(path: string): Promise<void> {
    const row = await this.store.getRow(path);
    if (row === undefined) return;
    if (row.duplicateOf !== undefined) { await this.store.deleteRow(path); return; }
    await this.store.saveRow({ ...row, rev: null, remoteDeleted: true });
  }

  private async afterPull(): Promise<void> {
    await this.rereadNonOk();
    await this.resolveDuplicates();
    await this.heal();
    await this.runSeed(false);
    const rows = await this.store.rows();
    const queue = await this.store.queue();
    this.status.emptyFolder = rows.length === 0 && queue.length === 0;
  }

  /** Spec 1 §4: two files with one session id merge into the path that sorts first. */
  private async resolveDuplicates(): Promise<void> {
    const groups = new Map<string, FileRow[]>();
    for (const row of await this.store.rows()) {
      if (row.kind !== 'session' || row.status !== 'ok' || row.duplicateOf !== undefined) continue;
      const id = (row.content as SessionFile).session.id;
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => a.path.localeCompare(b.path));
      const winner = rows[0] as FileRow;
      let merged: unknown = winner.content;
      for (const loser of rows.slice(1)) merged = this.mergeInto('session', merged, loser.content);
      if (!sameContent(merged, winner.content)) await this.store.writeFile('session', winner.path, merged, this.now());
      for (const loser of rows.slice(1)) {
        await this.store.saveRow({ ...loser, duplicateOf: winner.path });
        await this.store.deleteQueueRow(loser.path);
      }
    }
  }

  private async heal(): Promise<void> {
    const catalog = await this.store.catalog();
    if (catalog === undefined) return;
    const sessions = (await this.store.sessions()).map((s) => s.file.session);
    const healed = restoreReferenced(catalog.exercises, sessions, this.now());
    if (healed.some((e, i) => e !== catalog.exercises[i])) {
      await this.store.writeFile('exercises', EXERCISES_PATH, { ...catalog, exercises: healed } satisfies ExercisesFile, this.now());
    }
  }

  /** Once per build, and only once a catalog exists remotely or the owner chose the seed (spec 3 §6). */
  private async runSeed(chosenNow: boolean): Promise<void> {
    const seeded = await this.store.getMeta<string>('seededBuild');
    if (seeded === this.deps.buildId && !chosenNow) return;
    const row = await this.store.getRow(EXERCISES_PATH);
    const choice = chosenNow ? 'seed' : await this.store.getMeta<EmptyFolderChoice>('emptyFolderChoice');
    if (row === undefined && choice !== 'seed') return;
    if (row !== undefined && row.status !== 'ok') return;
    const existing = row === undefined ? [] : (row.content as ExercisesFile).exercises;
    const result = mergeSeed(existing, this.seed);
    if (result.added.length > 0 || row === undefined) {
      await this.store.writeFile('exercises', EXERCISES_PATH, { schemaVersion: this.modelVersion, exercises: result.catalog }, this.now());
    }
    await this.store.setMeta('seededBuild', this.deps.buildId);
  }

  // ---- push ----

  private async push(): Promise<Outcome> {
    if (!this.status.connected || this.stopped) return 'stopped';
    this.setPhase('pushing');
    try {
      const conflicts = new Map<string, number>();
      for (const queued of await this.store.queue()) {
        const outcome = await this.pushOne(queued, conflicts);
        if (outcome !== 'done') return outcome;
      }
      this.succeeded();
      return 'done';
    } finally {
      await this.refreshCounts();
      this.setPhase('idle');
    }
  }

  private async pushOne(queued: QueueRow, conflicts: Map<string, number>): Promise<Outcome> {
    const row = await this.store.getRow(queued.path);
    if (row === undefined) { await this.store.deleteQueueRow(queued.path); return 'done'; }
    if (row.status !== 'ok' || row.duplicateOf !== undefined) return 'done';
    const validation = validateForWrite(row.kind, row.content);
    if (!validation.ok) {
      if (queued.heldBack === undefined) await this.store.setQueueRow({ ...queued, heldBack: validation.issues });
      return 'done';
    }
    if (queued.heldBack !== undefined) {
      const { heldBack: _h, ...rest } = queued;
      queued = rest;
      await this.store.setQueueRow(queued);
    }
    const text = `${JSON.stringify(row.content, null, 2)}\n`;
    let rateLimited = 0;
    for (;;) {
      const r = await this.client.upload(row.path, text, row.rev === null ? { add: true } : { rev: row.rev });
      if (r.ok) {
        const at = this.now().toISOString();
        await this.store.finishQueueRow(row.path, row.version, r.value.rev, at);
        await this.store.setMeta('lastPushAt', at);
        this.status.lastPushAt = at;
        return 'done';
      }
      if (r.error === 'conflict') {
        const n = (conflicts.get(row.path) ?? 0) + 1;
        conflicts.set(row.path, n);
        await this.store.setQueueRow({ ...queued, attempts: queued.attempts + 1 });
        const remote = await this.client.download(row.path);
        if (remote.ok) await this.applyRemote(row.path, row.kind, remote.value.rev, remote.value.text);
        else if (remote.error === 'missing') await this.remoteDeleted(row.path);
        else return this.failed(remote);
        if (n >= CONFLICTS_PER_DRAIN) {
          this.status.lastError = `${row.path}: ${n} conflicts in one run; will retry`;
          return 'stopped';
        }
        const again = await this.store.getQueueRow(row.path);
        return again === undefined ? 'done' : this.pushOne(again, conflicts);
      }
      if (r.error === 'rate-limited') {
        rateLimited += 1;
        if (rateLimited > RATE_LIMIT_RETRIES) return this.failed(r);
        await this.sleep(r.retryAfterMs ?? 1000);
        continue;
      }
      if (r.error === 'other') {
        await this.store.setQueueRow({ ...queued, attempts: queued.attempts + 1, lastError: r.message });
        return 'done';
      }
      return this.failed(r);
    }
  }

  // ---- bookkeeping ----

  private failed(r: { ok: false; error: string; message: string; retryAfterMs?: number }): Outcome {
    this.status.lastError = `${r.error}: ${r.message}`;
    if (r.error === 'unauthorized') {
      this.status.connected = false;
      this.stopped = true;
    } else if (r.error === 'offline' || r.error === 'rate-limited') {
      this.status.online = false;
      this.scheduleRetry(r.retryAfterMs);
    }
    this.notify();
    return 'stopped';
  }

  private succeeded(): void {
    this.failures = 0;
    this.status.online = true;
    this.status.lastError = undefined;
    this.status.retryInMs = undefined;
    if (this.retryTimer !== undefined) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = undefined; }
  }

  /** Exponential backoff: 2 s, 4 s, 8 s … capped at 5 min (spec 3 §7). */
  private scheduleRetry(atLeastMs?: number): void {
    if (this.stopped) return;
    this.failures += 1;
    const delay = Math.max(atLeastMs ?? 0, Math.min(2 ** this.failures * 1000, MAX_BACKOFF_MS));
    this.status.retryInMs = delay;
    if (this.retryTimer !== undefined) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      void this.drain();
    }, delay);
  }

  /** The `online` event: forget the backoff and try now. */
  wentOnline(): Promise<void> {
    this.failures = 0;
    if (this.retryTimer !== undefined) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    return this.drain();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(async () => {
      await this.deps.leadership.whenLeader();
      await work();
    });
    this.chain = run.catch((e: unknown) => {
      this.status.lastError = e instanceof Error ? e.message : String(e);
      this.notify();
    });
    return this.chain;
  }

  private async refreshCounts(): Promise<void> {
    const queue = await this.store.queue();
    this.status.queueLength = queue.length;
    this.status.heldBackCount = queue.filter((q) => q.heldBack !== undefined).length;
    this.status.issues = await this.store.issues();
    this.notify();
  }

  private setPhase(phase: Phase): void {
    this.status.phase = phase;
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l(this.status);
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/sync && npm run typecheck`
Expected: PASS (101 tests); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/sync/engine.ts src/sync/engine.test.ts
git commit -m "Add the sync engine: cursor pulls, queued pushes, merges, first-load zip and backoff" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The shell and the update prompt

**Files:**
- Create: `src/app/shell.ts`, `src/app/sw-update.ts`, `src/app/triggers.ts`
- Modify: `src/app/main.ts` (replace the stub)

**Interfaces:**
- Consumes: `Engine`, `Store`, `Auth`, `DropboxHttpClient`, `openDb`, `WebLocksLeadership`, `BroadcastChangeChannel`; `virtual:pwa-register` (typed by `vite-plugin-pwa/client` in `tsconfig.json`).
- Produces: `renderShell(root, model, actions)`, `ShellModel`, `ShellActions`; `setupSwUpdate(onChange): SwUpdate`; `attachTriggers(engine, sw, win?)`; the app entry.

There is no unit test for this task: it is browser wiring over tested modules, and the browser checklist in "After the merge" is its verification. The build and typecheck are the gate.

- [ ] **Step 1: Write `src/app/shell.ts`**

```ts
import type { EmptyFolderChoice, SyncStatus } from '../sync/engine';

/** The diagnostic shell (spec 3 §12): one page, plain DOM, replaced by spec 4. */

export interface ShellModel {
  connected: boolean;
  loginError?: string | undefined;
  /** iOS outside an installed home-screen app: the login would land in Safari's storage. */
  homeScreenHint: boolean;
  pasteMode: boolean;
  status: SyncStatus;
  counts: { sessions: number; exercises: number; bodyweight: number };
  persisted: boolean | undefined;
  updateAvailable: boolean;
  buildId: string;
}

export interface ShellActions {
  connect(): void;
  startPaste(): void;
  submitCode(code: string): void;
  syncNow(): void;
  chooseEmptyFolder(choice: EmptyFolderChoice): void;
  updateApp(): void;
  signOut(): void;
}

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const when = (t: string | undefined): string => (t === undefined ? 'never' : new Date(t).toLocaleString());

export function renderShell(root: HTMLElement, m: ShellModel, actions: ShellActions): void {
  root.innerHTML = `
    <h1>CalisTally</h1>
    ${m.updateAvailable ? `<section class="notice"><p>A new version of the app is ready.</p><button data-action="update">Update app</button></section>` : ''}
    ${!m.updateAvailable && m.status.tooNewSeen ? `<section class="notice"><p>A newer version of the app wrote some files. They are shown read-only; update as soon as an update is offered.</p></section>` : ''}
    ${m.connected ? connectedView(m) : connectView(m)}
    <p class="muted">Build ${esc(m.buildId)} · storage ${m.persisted === undefined ? 'unknown' : m.persisted ? 'persistent' : 'not persistent'}</p>
  `;
  root.onclick = (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (target === null) return;
    const action = target.dataset['action'];
    if (action === 'connect') actions.connect();
    else if (action === 'paste') actions.startPaste();
    else if (action === 'submit-code') actions.submitCode((root.querySelector<HTMLInputElement>('#code')?.value ?? '').trim());
    else if (action === 'sync') actions.syncNow();
    else if (action === 'seed') actions.chooseEmptyFolder('seed');
    else if (action === 'copy') actions.chooseEmptyFolder('copy');
    else if (action === 'update') actions.updateApp();
    else if (action === 'sign-out') actions.signOut();
  };
}

function connectView(m: ShellModel): string {
  return `
    <section>
      <h2>Dropbox</h2>
      ${m.status.queueLength > 0 ? `<p>${m.status.queueLength} local change(s) are waiting for a connection.</p>` : '<p>Not connected.</p>'}
      ${m.homeScreenHint ? `<p class="notice">On an iPhone, add this page to your Home Screen first (Share → Add to Home Screen) and open it from there. The login must happen inside the installed app.</p>` : ''}
      ${m.loginError ? `<p class="error">${esc(m.loginError)}</p>` : ''}
      <button data-action="connect">Connect to Dropbox</button>
      <button class="secondary" data-action="paste">Paste a code instead</button>
      ${m.pasteMode ? `<p>A Dropbox page opened with a code. Paste it here:</p><input id="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" /><button data-action="submit-code">Finish login</button>` : ''}
    </section>`;
}

function connectedView(m: ShellModel): string {
  const s = m.status;
  if (s.emptyFolder && s.emptyFolderChoice !== 'copy') {
    return `
      <section>
        <h2>Empty Dropbox folder</h2>
        <p>The App folder holds no CalisTally files yet.</p>
        <button data-action="seed">Start with the seed catalog</button>
        <button class="secondary" data-action="copy">I'll copy files in, then sync</button>
      </section>`;
  }
  return `
    <section>
      <h2>Sync</h2>
      <dl>
        <dt>State</dt><dd>${esc(s.phase)}${s.online ? '' : ' · <span class="error">offline</span>'}${s.retryInMs !== undefined ? ` · retry in ${Math.round(s.retryInMs / 1000)} s` : ''}</dd>
        <dt>Last pull</dt><dd>${esc(when(s.lastPullAt))}</dd>
        <dt>Last push</dt><dd>${esc(when(s.lastPushAt))}</dd>
        <dt>Queued</dt><dd>${s.queueLength}${s.heldBackCount > 0 ? ` (${s.heldBackCount} held back)` : ''}</dd>
        ${s.lastError ? `<dt>Error</dt><dd class="error">${esc(s.lastError)}</dd>` : ''}
      </dl>
      <button data-action="sync" ${s.phase === 'idle' ? '' : 'disabled'}>Sync now</button>
      ${s.emptyFolder ? `<p class="muted">The folder is still empty. Copy the files into <code>Dropbox/Apps/CalisTally</code>, wait for the desktop client, then tap Sync now.</p>` : ''}
    </section>
    <section>
      <h2>Data</h2>
      <dl>
        <dt>Sessions</dt><dd>${m.counts.sessions}</dd>
        <dt>Exercises</dt><dd>${m.counts.exercises}</dd>
        <dt>Bodyweight entries</dt><dd>${m.counts.bodyweight}</dd>
      </dl>
    </section>
    <section>
      <h2>Issues</h2>
      ${s.issues.length === 0 ? '<p class="ok">None.</p>' : `<ul>${s.issues.map((i) => `<li><code>${esc(i.path)}</code> · ${esc(i.reason)}<br /><span class="muted">${esc(i.detail)}</span></li>`).join('')}</ul>`}
    </section>
    <section>
      <button class="secondary" data-action="sign-out">Sign out</button>
    </section>`;
}
```

- [ ] **Step 2: Write `src/app/sw-update.ts`**

```ts
import { registerSW } from 'virtual:pwa-register';

/** The one-tap update (spec 3 §8): prompt mode, reload only when the engine is idle. */
export interface SwUpdate {
  /** A new build is installed and waiting. */
  updateAvailable: boolean;
  /** Ask the browser to look for a new service worker now. */
  check(): Promise<void>;
  /** Activate the waiting build and reload, after `whenIdle` resolves (at most 10 s). */
  apply(whenIdle: () => Promise<void>): Promise<void>;
}

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const IDLE_WAIT_MS = 10_000;

export function setupSwUpdate(onChange: () => void): SwUpdate {
  let registration: ServiceWorkerRegistration | undefined;
  const state: SwUpdate = {
    updateAvailable: false,
    async check() {
      try {
        await registration?.update();
      } catch {
        // offline or the worker is gone; the next check will try again
      }
    },
    async apply(whenIdle) {
      await Promise.race([whenIdle(), new Promise((r) => setTimeout(r, IDLE_WAIT_MS))]);
      await updateSW(true);
    },
  };
  const updateSW = registerSW({
    onNeedRefresh() {
      state.updateAvailable = true;
      onChange();
    },
    onRegisteredSW(_url, r) {
      registration = r;
      if (r) setInterval(() => { void r.update(); }, UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(error: unknown) {
      console.warn('service worker registration failed', error);
    },
  });
  return state;
}
```

- [ ] **Step 3: Write `src/app/triggers.ts`**

```ts
import type { Engine } from '../sync/engine';
import type { SwUpdate } from './sw-update';

export const PERIODIC_DRAIN_MS = 5 * 60 * 1000;

/** The browser events that run the engine (spec 3 §7) and the update checks (spec 3 §8). */
export function attachTriggers(engine: Engine, sw: SwUpdate, win: Window = window): () => void {
  const onVisible = () => {
    if (win.document.visibilityState === 'visible') {
      void engine.drain();
      void sw.check();
    }
  };
  const onOnline = () => { void engine.wentOnline(); };
  win.document.addEventListener('visibilitychange', onVisible);
  win.addEventListener('online', onOnline);
  const timer = win.setInterval(() => {
    if (win.document.visibilityState === 'visible') void engine.drain();
  }, PERIODIC_DRAIN_MS);
  return () => {
    win.document.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('online', onOnline);
    win.clearInterval(timer);
  };
}
```

- [ ] **Step 4: Replace `src/app/main.ts`**

```ts
import { Auth, AuthError } from '../sync/auth';
import { BroadcastChangeChannel } from '../sync/channel';
import { openDb } from '../sync/db';
import { DropboxHttpClient } from '../sync/dropbox-client';
import { Engine } from '../sync/engine';
import { WebLocksLeadership } from '../sync/lock';
import { Store } from '../sync/store';
import { BASE_URL, BUILD_ID, DROPBOX_APP_KEY, redirectUri } from './config';
import { renderShell, type ShellModel } from './shell';
import { setupSwUpdate } from './sw-update';
import { attachTriggers } from './triggers';

/** Wires the sync library to the browser (spec 3 §12, §13). */
async function main(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  const db = await openDb();
  const channel = new BroadcastChangeChannel();
  const store = new Store(db, { onChange: (path) => { channel.post(path); scheduleRender(); } });
  const auth = new Auth(db, { appKey: DROPBOX_APP_KEY, redirectUri: redirectUri() }, { fetch: (input, init) => fetch(input, init) });
  const client = new DropboxHttpClient({
    fetch: (input, init) => fetch(input, init),
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
  });
  const engine = new Engine({ store, client, leadership: new WebLocksLeadership(), channel, buildId: BUILD_ID });
  await engine.init();
  const sw = setupSwUpdate(scheduleRender);

  const model: ShellModel = {
    connected: false,
    homeScreenHint: isIos() && !isStandalone(),
    pasteMode: false,
    status: engine.status,
    counts: { sessions: 0, exercises: 0, bodyweight: 0 },
    persisted: undefined,
    updateAvailable: false,
    buildId: BUILD_ID,
  };

  // The OAuth redirect lands on the base URL with code and state (spec 3 §3).
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    if (params.has('code')) {
      try {
        await auth.completeLogin(params.get('code') as string, params.get('state') ?? undefined);
      } catch (e) {
        model.loginError = e instanceof AuthError ? e.message : 'login failed';
      }
    } else {
      model.loginError = `Dropbox did not authorise the app (${params.get('error_description') ?? params.get('error')})`;
    }
    window.history.replaceState(null, '', BASE_URL);
  }
  model.connected = await auth.isConnected();
  if (!model.connected) engine.disconnect();

  try {
    model.persisted = (await navigator.storage?.persisted?.()) ? true : await navigator.storage?.persist?.();
    await store.setMeta('persisted', model.persisted);
  } catch {
    model.persisted = undefined;
  }

  let renderQueued = false;
  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; void render(); });
  }

  async function render(): Promise<void> {
    model.status = engine.status;
    model.updateAvailable = sw.updateAvailable;
    const [sessions, catalog, bodyweight] = await Promise.all([store.sessions(), store.catalog(), store.bodyweight()]);
    model.counts = {
      sessions: sessions.filter((s) => s.file.session.deletedAt === undefined).length,
      exercises: catalog?.exercises.filter((e) => e.deletedAt === undefined).length ?? 0,
      bodyweight: bodyweight?.entries.filter((e) => e.deletedAt === undefined).length ?? 0,
    };
    renderShell(root, model, {
      connect: () => { void auth.startLogin('redirect').then((url) => window.location.assign(url)); },
      startPaste: () => { model.pasteMode = true; scheduleRender(); void auth.startLogin('paste').then((url) => window.open(url, '_blank', 'noopener')); },
      submitCode: (code) => { void finishPaste(code); },
      syncNow: () => { void engine.drain(); },
      chooseEmptyFolder: (choice) => { void engine.chooseEmptyFolder(choice); },
      updateApp: () => { void sw.apply(() => engine.idle()); },
      signOut: () => { void signOut(); },
    });
  }

  async function finishPaste(code: string): Promise<void> {
    try {
      await auth.completeLogin(code);
      model.loginError = undefined;
      model.pasteMode = false;
      model.connected = true;
      engine.reconnect();
      void engine.drain();
    } catch (e) {
      model.loginError = e instanceof AuthError ? e.message : 'login failed';
    }
    scheduleRender();
  }

  async function signOut(): Promise<void> {
    if (engine.status.queueLength > 0 && !window.confirm(`${engine.status.queueLength} change(s) have not reached Dropbox yet and will be lost. Sign out anyway?`)) return;
    engine.dispose();
    await auth.signOut();
    await db.clearAll();
    window.location.reload();
  }

  let checkedForTooNew = false;
  engine.subscribe((status) => {
    // Spec 3 §8: a file newer than this app means a newer build exists; look for it at once.
    if (status.tooNewSeen && !checkedForTooNew) {
      checkedForTooNew = true;
      void sw.check();
    }
    scheduleRender();
  });
  attachTriggers(engine, sw);
  if (model.connected) {
    sw.check().catch(() => undefined);
    void engine.drain();
  }
  scheduleRender();
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

void main();
```

- [ ] **Step 5: Typecheck, build, look at it**

```powershell
npm run typecheck
npm run build
npm run preview
```
Expected: `tsc` prints nothing; the build succeeds. Open `http://localhost:5173/calistally/` in Chrome: the page shows "CalisTally", a "Dropbox" section with "Not connected.", the two buttons, and a footer line "Build <hash> <date> · storage persistent" (or "not persistent"). Clicking "Connect to Dropbox" navigates to `www.dropbox.com` with `client_id=REPLACE_WITH_DROPBOX_APP_KEY` in the URL, which Dropbox rejects; that is expected until the app key exists. Stop the preview (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "Add the diagnostic shell, the update prompt and the browser triggers" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Deploy workflow, CLAUDE.md, push and PR

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Replace `CLAUDE.md`**

```markdown
# CalisTally

A calisthenics training tracker built as a static PWA. It reads and writes JSON data files in the owner's Dropbox through the Dropbox API (App folder, OAuth 2 PKCE). There is no backend and no paid infrastructure. It replaces a free-text XLSX log.

**Status:** spec 1 (data model), spec 2 (XLSX migration script) and spec 3 (sync and hosting) implemented as tested TypeScript under `src/model/`, `src/migration/`, `src/sync/` and `src/app/`. The real migration run reached FINAL on 2026-10-07; its output sits outside git and is copied into the Dropbox App folder by hand (spec 3 §11). The app is a diagnostic shell (connect, sync status, issues, update) deployed to GitHub Pages; training views are spec 4.

## Read first

- [docs/superpowers/specs/2026-10-06-data-model-design.md](docs/superpowers/specs/2026-10-06-data-model-design.md): **spec 1, the data model.** Source of truth for the entities, validation, versioning, file layout and derived-value rules. Where HANDOVER.md disagrees, the spec wins.
- [docs/superpowers/specs/2026-10-07-xlsx-migration-design.md](docs/superpowers/specs/2026-10-07-xlsx-migration-design.md): **spec 2, the XLSX migration.** Cell grammar, exercise aliases, date rules, the review list and the decisions file. It also amended the seed catalog (rings, bands).
- [docs/superpowers/specs/2026-10-07-sync-hosting-design.md](docs/superpowers/specs/2026-10-07-sync-hosting-design.md): **spec 3, sync and hosting.** Dropbox login and client, the IndexedDB store and write queue, the merge, the sync engine, the app update, GitHub Pages, and how the repository went public.
- [docs/HANDOVER.md](docs/HANDOVER.md): the original brief. §3 (draft data model) is superseded by spec 1; the rest (goals, XLSX migration notes, open questions) still applies.
- [docs/tracker-options.md](docs/tracker-options.md): the option analysis behind the chosen architecture, and what's wrong with the XLSX data. (HANDOVER.md calls it `analysis/tracker-options.md`; in this repo it lives in `docs/`.)

## Core rules (from specs 1 and 3, do not drift)

- **Session → Block → Set. One record per set.** Day views, totals, indicators and charts are derived and never stored. The block's sets *are* the pattern; there is no SetGroup.
- Session `label` is display only. It never filters and never constrains which exercises can be logged. The day-list filter uses each block's exercise `pattern`.
- Reps may be decimal and must be > 0. No RPE/RIR, no `side` field, no stored rest for live sets.
- Bodyweight is its own time series. Bodyweight factors / effective load are out of v1 and, when added (v1.1), are always labelled estimates (D11).
- Exercises come from a catalog. `metric` and `perSide` are immutable after creation. Exercises with history are archived, never deleted.
- Every record has `updatedAt` (its own fields only, not children) and an optional `deletedAt` tombstone. Deleting marks, never removes. Timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ`.
- `order` is a sort key only (any finite number); the canonical order is in `src/model/derive/order.ts`.
- Every file carries `schemaVersion`; `MODEL_VERSION` lives in `src/model/schema.ts`. Any shape change, including a new optional field, bumps it and adds an upgrade step for every file kind in `src/model/upgrade.ts` (a no-op where that kind is unchanged); a test checks every kind has every step. A too-new file is read leniently and never written.
- Validation has two levels: hard rules (in-file; failure quarantines) and soft catalog rules (failure flags, never quarantines). Validate before every write with `validateForWrite`.
- **All reads and writes go through `src/sync/store.ts`.** Screens never call Dropbox. `writeFile` refuses `read-only`, `needs-update`, `quarantined` and duplicate rows; a write that fails validation stays local and queued (`heldBack`), never reaches Dropbox, and is released when it validates.
- Dropbox writes use `mode: update` + last known `rev` (`add` for a new file), `strict_conflict`, `content_hash`. On a conflict: download, merge per record (`src/sync/merge.ts`: newer `updatedAt` wins, tombstone wins a tie, then canonical JSON; children by `id`), retry. Never produce "conflicted copy" files. Session files never move or get deleted.
- Offline-first: IndexedDB local copy plus a pending-write queue (catalog, bodyweight, then sessions). Only the tab holding the Web Lock `calistally-sync` runs the engine. No Background Sync, no longpoll.
- The app update is prompted, never automatic (`vite-plugin-pwa` in `prompt` mode). Dropbox calls are never cached by the service worker.
- Migration never guesses silently. Anything ambiguous goes on a review list for the owner.
- Nothing in this project touches the owner's Dropbox account or creates the Dropbox app without asking them first.

## Repo layout

- `src/model/schema.ts`: the TypeBox schema, the single source of truth (D14). `types.ts` infers the TS types from it.
- `schema/*.schema.json`: emitted JSON Schema, committed. Regenerate with `npm run emit-schema`; a test fails when it is stale.
- `src/model/validate.ts`, `read.ts`, `upgrade.ts`: validation levels, read pipeline, version steps.
- `src/model/record.ts`, `slug.ts`, `catalog.ts`, `seed.ts`, `seed-exercises.json`: record helpers, ids and names, seed catalog.
- `src/model/derive/`: the pure derived-value functions of spec §7 (order, totals, compare, time, filter).
- `src/model/test-fixtures.ts`: synthetic fixture builders (dates in 2030). Tests sit next to the code as `*.test.ts`.
- `src/migration/`: the XLSX migration (spec 2). `grid.ts` reads the workbook (exceljs), `rows.ts` splits column blocks and Extra sessions, `tokenize.ts` + `parse-line.ts` + `parse-cell.ts` are the cell grammar, `exercises.ts`/`phrases.ts` the alias and phrase tables, `dates.ts` the date rules, `decisions.ts` the decisions file, `build.ts` assembles sessions and review items, `review.ts`/`output.ts` render and write, `cli.ts` runs it all.
- `src/sync/`: the sync layer (spec 3). `dropbox-client.ts` (seven calls over fetch), `auth.ts` (PKCE, tokens), `db.ts` (IndexedDB wrapper), `store.ts` (rows, queue, `writeFile`), `merge.ts`, `paths.ts`, `zip.ts` (first load), `engine.ts` (pull, push, backoff, status), `lock.ts`/`channel.ts` (Web Locks, BroadcastChannel), `fake-dropbox.ts` and `test-fixtures.ts` for tests.
- `src/app/`: the shell (spec 3 §12): `main.ts` wiring, `shell.ts`/`shell.css` the page, `sw-update.ts` the update prompt, `triggers.ts` the browser events, `config.ts` the public app key and URLs.
- `index.html`, `vite.config.ts` (PWA plugin, `base` `/calistally/` for builds), `vitest.config.ts`, `public/` (icons; regenerate PNGs with `npm run make-icons`), `.github/workflows/deploy.yml` (test, typecheck, build, deploy to Pages on push to `main`).
- `scripts/migrate-xlsx.ts`: the CLI entry for `npm run migrate`. `scripts/make-icons.ts`, `scripts/emit-schema.ts`.
- `docs/superpowers/specs/`, `docs/superpowers/plans/`: specs and implementation plans.

## Commands

- `npm install`
- `npm test` (Vitest, single run, Node only: fake-indexeddb, no browser), `npm run test:watch`
- `npm run typecheck` (tsc, strict)
- `npm run dev` (Vite on `http://localhost:5173/`, the registered dev redirect URI), `npm run build` (to `dist/`), `npm run preview`
- `npm run emit-schema` (writes `schema/*.schema.json`), `npm run make-icons` (writes the PNG icons)
- `npm run migrate -- --xlsx <workbook> --decisions <decisions.json> --out <dir> --bodyweight <kg>`: the migration. All three paths live **outside** the repo (`--out` inside it is refused); the bodyweight is never stored in the repo. Exit 0 = FINAL, 1 = review items open (files still written), 2 = usage, 3 = validation failed (nothing written).

## Never commit

Training data, the XLSX (`*.xlsx` is gitignored), the migration's `decisions.json` and its output folder (`migration-out/`, both gitignored), Dropbox tokens, `.env` files, any local data folder, the owner's name, bodyweight or dated training facts. Fixtures are synthetic (dates in 2030). The repo is public (GitHub Pages); the Dropbox app key in `src/app/config.ts` is public by design, there is no secret.

## Stack

Vite + TypeScript PWA (`vite-plugin-pwa`, Workbox precache of the shell only), no UI framework yet (spec 4 decides), no chart library yet. Hosting: GitHub Pages at `https://joergbaender.github.io/calistally/`. Dropbox: App-folder app `CalisTally`, scopes `files.metadata.read`, `files.content.read`, `files.content.write`, redirect URIs `https://joergbaender.github.io/calistally/` and `http://localhost:5173/`. Migration script (spec 2): TypeScript in this repo, calling `validateFile` directly. `schema/*.schema.json` is necessary but not sufficient: the hard rules (real calendar dates and timestamps, unique ids, load rules and so on) are deliberately not in the JSON Schema (D13), so every migrated file must also pass `validateFile`. Timestamps are exactly `YYYY-MM-DDTHH:mm:ss.sssZ` (milliseconds, `Z`); uuids are lowercase.

## To fill in later

- The Dropbox app key in `src/app/config.ts` (after the owner creates the app), and the final app name if `CalisTally` was taken.
- Spec 4: the training views; the UI framework choice; the issues screen replacing the shell.
- Lint/format tooling (none yet).
```

- [ ] **Step 3: Final verification**

```powershell
npm test
npm run typecheck
npm run build
git status
```
Expected: 487 tests pass; `tsc` prints nothing; the build succeeds; `git status` shows only the two files above as changes (and `dist/` ignored).

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add .github/workflows/deploy.yml CLAUDE.md
git commit -m "Add the Pages deploy workflow and document the sync layer in CLAUDE.md" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin spec/sync-hosting
gh pr create --base main --title "Spec 3: sync and hosting" --body-file <scratchpad>/pr-body.md
```

Write `<scratchpad>/pr-body.md` first with this content (the handle is the only place a name appears, and it is the repo's):

```markdown
## Spec 3: sync and hosting

Implements `docs/superpowers/specs/2026-10-07-sync-hosting-design.md` per `docs/superpowers/plans/2026-10-08-sync-hosting.md`.

- `src/sync/`: PKCE login with a refresh token, the Dropbox client (seven calls, content hash, error mapping), the IndexedDB store with the write queue and the ReadStatus guard, the record merge with a deterministic tie-break, and the engine (cursor pulls, catalog-first pushes, conflict merges, parked changes under too-new or invalid remotes, duplicate session files, first-load zip, backoff).
- `src/app/`: the diagnostic shell, the prompted service-worker update, the browser triggers.
- Scaffold: Vite 8 + vite-plugin-pwa 2, icons, `.github/workflows/deploy.yml` (test, typecheck, build, deploy to Pages on push to `main`).
- Spec 1 leftovers: try/catch around upgrade steps, every-kind-has-every-step test.
- `--bodyweight <kg>` replaces the migration's constant; the docs are scrubbed (name, bodyweight, dated cells).

Tests: 487, all in Node (fake-indexeddb, FakeDropbox, FakeTimers).

Not in this PR (done with the owner after the merge, see the plan's last section): the history rewrite and repository recreation, enabling Pages, the Dropbox app and its key, copying the migration output, the browser checklist.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Expected: the PR URL is printed. The owner merges.

---

## After the merge, with the owner

These steps are not for subagents. Each destructive one is confirmed with the owner at the moment it runs (§10, S13). Work from a fresh clone of `main` after the PR is merged.

### A. History rewrite and repository recreation (§10)

1. Fresh clone, outside the normal checkout:
   ```bash
   git clone https://github.com/joergbaender/calistally.git calistally-rewrite
   cd calistally-rewrite
   ```
2. Mapping files (in the parent folder, never committed). `replacements.txt`:
   ```
   the owner's==>the owner's
   the owner==>the owner
   170411984+joergbaender@users.noreply.github.com==>170411984+joergbaender@users.noreply.github.com
   170411984+joergbaender@users.noreply.github.com==>170411984+joergbaender@users.noreply.github.com
   ```
   `mailmap.txt`:
   ```
   joergbaender <170411984+joergbaender@users.noreply.github.com> <170411984+joergbaender@users.noreply.github.com>
   joergbaender <170411984+joergbaender@users.noreply.github.com> <170411984+joergbaender@users.noreply.github.com>
   ```
3. Rewrite. `git filter-repo` needs Python (not installed on the PC; `winget install Python.Python.3.12` then `pip install git-filter-repo`), or use the built-in fallback:
   ```bash
   # preferred
   git filter-repo --replace-text ../replacements.txt --replace-message ../replacements.txt --mailmap ../mailmap.txt
   # fallback without Python (slower, same result for ~60 commits)
   git filter-branch --env-filter 'case "$GIT_AUTHOR_EMAIL" in 170411984+joergbaender@users.noreply.github.com|170411984+joergbaender@users.noreply.github.com) export GIT_AUTHOR_EMAIL=170411984+joergbaender@users.noreply.github.com;; esac; case "$GIT_COMMITTER_EMAIL" in 170411984+joergbaender@users.noreply.github.com|170411984+joergbaender@users.noreply.github.com) export GIT_COMMITTER_EMAIL=170411984+joergbaender@users.noreply.github.com;; esac' --msg-filter 'sed -e "s/the owner'"'"'s/the owner'"'"'s/g" -e "s/the owner/the owner/g"' --tree-filter 'grep -rl "the owner" --exclude-dir=.git . | xargs -r sed -i -e "s/the owner'"'"'s/the owner'"'"'s/g" -e "s/the owner/the owner/g"' -- --all
   ```
4. Verify: `git log --all --format='%an <%ae> %s' | grep -i "jörg\|gk.rocks\|glueckkanja"` prints nothing; `git log -p --all | grep -c "the owner"` is 0; `npm ci && npm test` still passes on the rewritten tree.
5. Recreate (each command confirmed): `gh repo rename calistally-old --repo joergbaender/calistally --yes`; `gh repo create joergbaender/calistally --public --description "Calisthenics training log as a static PWA over Dropbox"`; in the rewritten clone `git remote set-url origin https://github.com/joergbaender/calistally.git && git push -u origin main`.
6. Enable Pages with the Actions source: `gh api -X POST repos/joergbaender/calistally/pages -f build_type=workflow` (or Settings → Pages → Source "GitHub Actions"). Re-run the deploy workflow if it ran before Pages existed: `gh workflow run deploy.yml`. Confirm `https://joergbaender.github.io/calistally/` loads the shell.
7. Delete the old repository once the new one is verified: `gh auth refresh -s delete_repo` (once), then `gh repo delete joergbaender/calistally-old --yes`.
8. Re-clone into the working folder; set the local `user.email` if needed (`git config user.email 170411984+joergbaender@users.noreply.github.com`); the owner verifies the address on GitHub (Settings → Emails).

### B. The Dropbox app (§3), by the owner

App Console → Create app → Scoped access → App folder → name `CalisTally` (next free variant if taken), app folder name `CalisTally`. Permissions tab: `files.metadata.read`, `files.content.read`, `files.content.write` → Submit. Settings tab: redirect URIs `https://joergbaender.github.io/calistally/` and `http://localhost:5173/`; access token expiration: short-lived. Copy the **App key** into `src/app/config.ts` (`DROPBOX_APP_KEY`), commit on a small branch, PR, merge; the deploy runs. If the name was not free, update CLAUDE.md "Stack" and spec 3 §17 with the final name in the same PR.

### C. Migration output into the App folder (§11)

1. On the PC, open `https://joergbaender.github.io/calistally/` in Chrome, Connect to Dropbox, authorise. The folder `Dropbox/Apps/CalisTally` appears through the desktop client.
2. The shell shows "Empty Dropbox folder": choose **"I'll copy files in, then sync"**.
3. Copy `exercises.json`, `bodyweight.json` and the `sessions/` folder from `<private folder>\migration-out\` into `Dropbox/Apps/CalisTally/`. Not `review.md`, not `report.md`.
4. Wait for the desktop client to show everything synced, then tap **Sync now**. Expected: Data shows 147 sessions, the exercise count, 1 bodyweight entry; Issues: none; the seed merge adds nothing (the migration already carried the seed).

### D. Browser checklist (§14)

- [ ] PC Chrome: login, sync, counts as above; reload keeps the data; "Sign out" with an empty queue clears everything and shows "Not connected".
- [ ] iPhone: open the URL in Safari, Share → Add to Home Screen, open the installed app; the home-screen hint is gone; Connect → Dropbox opens in the in-app sheet → returns to the app connected; first sync fetches the history (one zip; the log is not visible, but it completes in seconds); footer shows "storage persistent".
- [ ] iPhone, airplane mode: (spec 4 will write real sets; for now) confirm the shell says "offline" and "retry in … s", then back online recovers without a tap.
- [ ] Both devices: hand-edit a session note in the PC's `Dropbox/Apps/CalisTally/sessions/...json` (valid JSON) → the phone shows the change after Sync now; break the JSON on purpose → the phone lists the file as quarantined and the PC's file is untouched; fix it → the issue clears.
- [ ] Update prompt: merge any small change to `main`, wait for the deploy, return to the installed app → "Update app" appears within the hour or at the next foreground; tapping it reloads to the new build hash.
- [ ] Paste-the-code: on the PC, "Paste a code instead" → Dropbox shows a code → paste → "Finish login" connects.

### E. Afterwards

- Update CLAUDE.md "To fill in later" and spec 3 §17 (app key present, final name, dates of deploy and recreation).
- Memory note for the next session: the repository was recreated on <date>; the old PR numbers no longer exist; spec 4 starts from `main`.
