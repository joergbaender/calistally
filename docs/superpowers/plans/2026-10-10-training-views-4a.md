# Training Views Implementation Plan, part 4a: the gym build (spec 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the diagnostic shell with the real app for the gym: a Preact UI with four tabs (Log · Days · More · Sync), the live log against a whole reference session, the day list with chips and indicators, the session page with tombstone edits and Undo, and a Sync tab that keeps every shell function. The More tab stays a placeholder until plan 4b.

**Architecture:** Pure logic sits in `src/model/` (`edit.ts`: every edit as a function from file to file with the record rules of spec 1 §3; `derive/live.ts`: reference proposal, card pairing, stepper and sticky load) and in one view-model file per screen (`*.vm.ts`), all tested in Node. `src/ui/data.ts` wraps the store and the engine in Preact signals; screens read signals and write only through `Data.edit` / `Data.create` (which call `Store.writeFile` with the row version they read and replay once on a race). Components are thin TSX over the view models, tested under happy-dom for the interactions that write data. `src/app/main.tsx` keeps the spec 3 wiring and mounts `<App>`.

**Tech Stack:** Node.js 24, TypeScript 7 strict, Vite 8 (Oxc transform), `vite-plugin-pwa` 2, Vitest 5. New: `preact@^10.29.8` and `@preact/signals@^2.11.3` (runtime); `happy-dom@^20.14.6` and `@testing-library/preact@^3.2.4` (dev). The existing `src/model/` and `src/sync/` libraries.

**Spec:** `docs/superpowers/specs/2026-10-10-training-views-design.md` (spec 4, with its amendments of 2026-10-10). Section references (§3, §4 …) are to spec 4 unless marked "spec 1" or "spec 3". Executors read spec 4 before starting; spec 1 §3 and §7 explain the record rules and derived values the screens rely on, spec 3 §5 and §12 the store and the shell being replaced.

**The code in this plan was prototyped, reviewed and run while planning.** Every task below was rebuilt from the finished prototype as one commit, and each commit was checked independently: the full suite and the typecheck pass at the end of every task, with the counts given in its last step. Four reviewers (spec conformance, data safety, live logging at the gym, tests and types) went over the finished code; their 44 findings were fixed and re-verified before the code was copied here. Copy the code as written. Where a test and the code disagree, the code is the reference.

## Global Constraints

- Node.js 24 LTS, npm 11. Run everything from the repo root in PowerShell or Git Bash. Branch: `spec/training-views` (exists; spec 4 and this plan are on it). Commit after every task; do not push until Task 12 says so.
- Dependencies, exactly: `npm install preact@^10.29.8 @preact/signals@^2.11.3` and `npm install -D happy-dom@^20.14.6 @testing-library/preact@^3.2.4`. **Never `npm install preact` without the version:** npm's `latest` is Preact 11 since 2026-09-30, and this app stays on 10. No other dependency: no router, no CSS framework, no chart or date library.
- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`: an optional field is absent, never `undefined`. TSX through `"jsx": "react-jsx"`, `"jsxImportSource": "preact"` in `tsconfig.json` and `oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } }` in `vite.config.ts` (Vite 8 compiles with Oxc, not esbuild).
- Tests: Node is the default environment. A component test file starts with `// @vitest-environment happy-dom` and imports `render`, `screen`, `fireEvent`, `waitFor`, `act` from `@testing-library/preact` only. `src/ui/test-setup.ts` (Vitest `setupFiles`) runs `cleanup` after every test. A signal written outside `fireEvent`/`render` updates the DOM asynchronously: wrap it in `act` or use `waitFor`. Preact listens to `onInput` for typing (`fireEvent.input`). IndexedDB in tests is `new IDBFactory()` from `fake-indexeddb`; never `vi.useFakeTimers()` together with fake-indexeddb.
- Never create `signal()`, `computed()` or `effect()` inside a component body; use `useSignal`, `useComputed`, `useSignalEffect`. Module-scope signals are fine.
- **Every write goes through `Data.edit` / `Data.create`** (and from components through the helpers in `src/ui/components/log/outcome.ts`), never `Store` directly from a screen. Every write timestamp comes from `data.clock()`; `src/ui/clock.test.ts` fails on `new Date()` in `src/ui/components`. Sets added in the Log tab carry `completedAt`; sets added on the session page never do (spec 1 D16). A delete is a tombstone with a 6-second Undo toast. Every write control ignores a second tap until its write has landed.
- **Colours are tokens** (§8, U11): every colour is a custom property in the `:root` block of `src/ui/theme.css`; `src/ui/theme.test.ts` fails on any literal colour elsewhere. Touch targets are at least 44 × 44 px; fixed bars use `env(safe-area-inset-*, 0px)`.
- No model change: `MODEL_VERSION` stays 1, no schema or upgrade step changes, `schema/*.schema.json` untouched.
- English for every string the app shows (spec 1 D10).
- Fixtures are synthetic: dates in 2030, invented numbers, fixtures from `src/model/test-fixtures.ts`. **No training data, no name, no bodyweight figure, no real date in git.**
- Writing files: create and edit source files with the Write/Edit tools, never with shell heredocs (the Bash tool's wrapper corrupts quotes and backslashes). The working tree is CRLF (`core.autocrlf=true`); git normalises on commit.
- Commit messages: a plain imperative sentence, as in the repo's history, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `user.email` of the clone is the noreply address (`170411984+joergbaender@users.noreply.github.com`).
- Nothing in this plan touches the owner's Dropbox account. The device checklist of Task 12 is run by the owner, one step at a time.

## Review Focus

Inputs the spec implies but does not name, most likely first. Each is pinned to a test in the task that owns the code.

1. **A double tap with sweaty hands** on any write control (a picker row, a card's Start, Add set, a sheet's Save or Delete) must write once: one session, one block, one set. → Task 8 "a double tap on a picker row starts one session" and "a double tap on Start adds one block"; Task 9 "a double tap on Add set adds one set" and "Add set stays held for a minimum time after an add, even when the refreshed row shows at once".

2. **The other device changes a record while a sheet is open.** Saving the sheet must not write back the old value of a field the owner did not touch. → Task 9 "Save writes only what the owner changed: another device's load change made while the sheet was open survives"; Task 11 "Save writes only what the owner changed against the opened values: a label and date changed elsewhere meanwhile survive".

3. **The app is killed, reloaded or updated mid-ladder.** It must land back on the open session with the same reference and the stepper's typed value. → Task 4 "an open session wins over the last route (spec 4 §4 Resume: a reload or an app update lands on it)"; Task 8 "renders no card before the stored reference is read, so the proposal never flashes"; Task 9 "the stepper value, the note and the chosen load survive a switch to another tab and back".

4. **A migrated reference block with an aggregate set** ("100 Diamonds") must never propose 100 as the next set or mark it as the position. → Task 3 "never proposes a migrated aggregate set's total: falls back to today's last set, else nothing"; Task 8 "a migrated aggregate set at the next position is neither proposed nor marked".

5. **A refused file whose content is malformed** (too new, or quarantined with a wrong field type) must stay off the Days list and the session page instead of crashing them. → Task 5 "checks the lenient session schema: a wrong label, a non-string tag or a bad load type keeps the file off the list".

## File Structure

| File | Responsibility |
|---|---|
| `src/model/edit.ts` | Pure edits of a session file: start, past session, header fields, blocks, sets, tombstones, moves (§3) |
| `src/model/derive/live.ts` | Day type, reference proposal, card pairing, proposed amount, step, sticky load, span (§4) |
| `src/ui/format.ts`, `src/ui/router.ts` | Display formatting (§8); hash routes and the start route (§3) |
| `src/ui/data.ts` | Signals over store and engine; `edit`/`create` with version and replay; the clock; soft issues (§3, §7) |
| `src/ui/toast.ts`, `held-back.ts`, `context.ts`, `locked.ts` | One toast at a time; the once-per-path held-back note; the app context; read-only sessions (§5) |
| `src/ui/theme.css` | The token block and every component's styles (U11, §8) |
| `src/ui/components/shared/` | Sheet, Stepper, NumberPad, SetChips, Marks, ToastHost, Button, BackBar |
| `src/ui/app.tsx`, `app.vm.ts` | Tab bar, route switch, Sync badge, clock mode |
| `src/ui/components/sync/` | The Sync tab and its view model (§7) |
| `src/ui/components/log/` | Log tab: picker, screen, cards, entry area, sheets, exercise search, drafts, write helpers (§4) |
| `src/ui/components/days/` | Days list, Add past session, session page and its sheets (§5) |
| `src/ui/components/more/MoreTab.tsx` | Placeholder until plan 4b |
| `src/app/main.tsx`, `idle.ts`, `sw-update.ts` | Bootstrap and mount; the idle race and the prompted update with its states (§7, spec 3 §8) |
| `src/ui/test-setup.ts`, `src/ui/test-harness.tsx` | Testing Library cleanup; a real `Data` over a fake-IndexedDB `Store` for component tests |

### Task 1: Toolchain and theme tokens

Adds Preact, signals, happy-dom and Testing Library; teaches TypeScript, Vite and Vitest to compile and run TSX; and starts `src/ui/theme.css` with the token block that every later style refers to (U11). The smoke test proves that a TSX component renders under happy-dom and re-renders on a signal change.

**Files:**
- Modify: `package-lock.json`
- Modify: `package.json`
- Create: `src/ui/smoke.test.tsx`
- Create: `src/ui/test-setup.ts`
- Create: `src/ui/theme.css`
- Create: `src/ui/theme.test.ts`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `vite.config.ts`:
    - `export default defineConfig(({ command, isPreview }) => (`
  - `vitest.config.ts`:
    - `export default defineConfig(`

- [ ] **Step 1: Install the dependencies**

Run, exactly (Preact 11 is npm's `latest`; this app pins 10):

```bash
npm install preact@^10.29.8 @preact/signals@^2.11.3
npm install -D happy-dom@^20.14.6 @testing-library/preact@^3.2.4
```

Expected: `package.json` lists `preact` and `@preact/signals` under `dependencies` and the other two under `devDependencies`; `npm ls preact` shows a single `preact@10.29.x`.

- [ ] **Step 2: Write the failing tests**

Create `src/ui/smoke.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { signal, type Signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';

/** Proves the toolchain: TSX compiles, happy-dom renders, signals re-render on change. */
function Counter({ count }: { count: Signal<number> }) {
  return (
    <button onClick={() => { count.value += 1; }}>
      clicked {count}
    </button>
  );
}

describe('toolchain smoke', () => {
  it('renders a Preact component under happy-dom and re-renders on a signal change', async () => {
    const count = signal(0);
    render(<Counter count={count} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('clicked 0');
    fireEvent.click(button);
    expect(count.value).toBe(1);
    await Promise.resolve();
    expect(button.textContent).toBe('clicked 1');
  });
});
```

Create `src/ui/test-setup.ts`:

```ts
import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

/** Unmounts every rendered component after each test (component files under happy-dom); harmless in Node files. */
afterEach(() => cleanup());
```

Create `src/ui/theme.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Spec 4 §8 (U11): every colour is a token in theme.css; components never contain a literal colour. */
const UI_DIR = join(import.meta.dirname, '.');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?:^|[^-\w])(?:color|background(?:-color)?)\s*:\s*(?!var\(|transparent|inherit|currentColor|none)[a-z]+/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('theme tokens', () => {
  it('no literal colour outside theme.css', () => {
    const offenders = walk(UI_DIR)
      .filter((f) => !f.endsWith('theme.css') && !f.endsWith('theme.test.ts') && /\.(tsx?|css)$/.test(f))
      .filter((f) => LITERAL.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('theme.css defines every token of spec 4 §8', () => {
    const css = readFileSync(join(UI_DIR, 'theme.css'), 'utf8');
    for (const token of ['--bg', '--panel', '--panel-2', '--text', '--muted', '--accent', '--ok', '--danger', '--outline', '--on-accent']) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/ui/smoke.test.tsx src/ui/theme.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/theme.test.ts: Error: ENOENT: no such file or directory, open 'src\ui\theme.css'
```


- [ ] **Step 4: Write the implementation**

`package-lock.json` is updated by the install command of Step 1; do not edit it by hand.

`package.json` is updated by the install command of Step 1; do not edit it by hand.

Create `src/ui/theme.css`:

```css
/* Spec 4 §8: the one token block. A re-theme edits this block only; components reference tokens. */
:root {
  color-scheme: dark;
  --bg: #111827;
  --panel: #1f2937;
  --panel-2: #273449;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --accent: #f59e0b;
  --ok: #34d399;
  --danger: #f87171;
  --outline: #374151;
  --on-accent: #111111;
}

/* ---- base ---- */
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
  overscroll-behavior: none;
}
/* The status bar is translucent (black-translucent): this strip covers its area, so scrolled
   content (the Log cards) never shows under the clock and battery. Above the bars, below sheets. */
body::before {
  content: '';
  position: fixed;
  top: 0;
  inset-inline: 0;
  z-index: 15;
  height: env(safe-area-inset-top, 0px);
  background: var(--bg);
  pointer-events: none;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { touch-action: manipulation; cursor: pointer; }
input, select, textarea { font-size: 16px; } /* iOS: no zoom on focus below 16 px */
/* Read by screen readers, not shown. */
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
```

Replace the whole content of `tsconfig.json` with:

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
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  },
  "include": [
    "src",
    "scripts",
    "vite.config.ts",
    "vitest.config.ts"
  ]
}
```

Replace the whole content of `vite.config.ts` with:

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

// Spec 3 §9: dev stays at http://localhost:5173/; build and preview serve at /calistally/.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/calistally/' : '/',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // Vite 8 compiles TSX with Oxc; name the JSX runtime here as well as in tsconfig (the Vite config wins).
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
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

Replace the whole content of `vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so the tests never load the PWA plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Testing Library's own auto-cleanup needs a global afterEach, which Vitest has only with globals: true.
    setupFiles: ['src/ui/test-setup.ts'],
  },
});
```

- [ ] **Step 5: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 38 test files and 529 tests; the typecheck prints nothing.

- [ ] **Step 6: Commit**

```
git add package-lock.json package.json src/ui/smoke.test.tsx src/ui/test-setup.ts src/ui/theme.css src/ui/theme.test.ts tsconfig.json vite.config.ts vitest.config.ts
git commit -m "Add Preact, signals and the component-test toolchain" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Record edits (`src/model/edit.ts`)

Every change a screen can make, as a pure function from a session file to a new session file (§3 "Edits"). Each one sets `updatedAt` on the edited record only (spec 1 §3), deletes by tombstone, appends with `nextOrder`, moves with a midpoint `order`, never invents or touches `completedAt`, and refuses what the hard rules would reject with an `EditError`, so a screen never builds an invalid file.

**Files:**
- Create: `src/model/edit.test.ts`
- Create: `src/model/edit.ts`

**Interfaces:**
- Consumes: `src/model/derive/order`, `src/model/derive/totals`, `src/model/record`, `src/model/schema`, `src/model/types`, `src/model/validate`.
- Produces:
  - `src/model/edit.ts`:
    - `export class EditError extends Error`
    - `export interface SetInput`
    - `export interface SetFields`
    - `export interface SessionFields`
    - `export function normalizeLoad(loadType: LoadType, loadKg: number): { loadType: LoadType; loadKg: number }`
    - `export function startSession(now: Date, localDate: string, id?: string): SessionFile`
    - `export function createPastSession(date: string, now: Date, id?: string): SessionFile`
    - `export function setSessionFields(file: SessionFile, fields: SessionFields, now: Date): SessionFile`
    - `export function deleteSession(file: SessionFile, now: Date): SessionFile`
    - `export function undeleteSession(file: SessionFile, now: Date): SessionFile`
    - `export function findBlock(session: Session, blockId: string): Block | undefined`
    - `export function addBlock(file: SessionFile, exerciseId: string, now: Date, id?: string): { file: SessionFile; blockId: string }`
    - `export function setBlockNote(file: SessionFile, blockId: string, note: string | null, now: Date): SessionFile`
    - `export function deleteBlock(file: SessionFile, blockId: string, now: Date): SessionFile`
    - `export function undeleteBlock(file: SessionFile, blockId: string, now: Date): SessionFile`
    - `export function moveBlock(file: SessionFile, blockId: string, direction: 'up' | 'down', now: Date): SessionFile`
    - `export function findSet(session: Session, setId: string): { block: Block; set: WorkoutSet } | undefined`
    - `export function addSet(file: SessionFile, blockId: string, input: SetInput, now: Date, id?: string): { file: SessionFile; setId: string }`
    - `export function setSetFields(file: SessionFile, setId: string, fields: SetFields, now: Date): SessionFile`
    - `export function deleteSet(file: SessionFile, setId: string, now: Date): SessionFile`
    - `export function undeleteSet(file: SessionFile, setId: string, now: Date): SessionFile`

- [ ] **Step 1: Write the failing tests**

Create `src/model/edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EditError,
  addBlock,
  addSet,
  createPastSession,
  deleteBlock,
  deleteSession,
  deleteSet,
  findBlock,
  findSet,
  moveBlock,
  normalizeLoad,
  setBlockNote,
  setSessionFields,
  setSetFields,
  startSession,
  undeleteBlock,
  undeleteSession,
  undeleteSet,
} from './edit';
import type { SetInput } from './edit';
import { amountOf, liveBlocks } from './derive';
import { MODEL_VERSION } from './schema';
import { T0, block, ladder, session, sessionFile, set, timedSet, uuid } from './test-fixtures';
import type { SessionFile, WorkoutSet } from './types';
import { validateForWrite } from './validate';

const later = new Date('2030-01-01T11:00:00.000Z');
const LATER = '2030-01-01T11:00:00.000Z';
const earlier = new Date('2030-01-01T09:00:00.000Z');
const T0_PLUS_1 = '2030-01-01T10:00:00.001Z';

/** Every edit result must be writable as it is (spec 4 §11). */
function valid(file: SessionFile): SessionFile {
  const result = validateForWrite('session', file);
  expect(result.issues).toEqual([]);
  expect(result.ok).toBe(true);
  return file;
}

describe('EditError', () => {
  it('is an Error with its own name', () => {
    const e = new EditError('nope');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('EditError');
    expect(e.message).toBe('nope');
  });
});

describe('normalizeLoad', () => {
  it('turns added and assist at 0 kg into bodyweight', () => {
    expect(normalizeLoad('added', 0)).toEqual({ loadType: 'bodyweight', loadKg: 0 });
    expect(normalizeLoad('assist', 0)).toEqual({ loadType: 'bodyweight', loadKg: 0 });
  });

  it('keeps every other valid load as it is', () => {
    expect(normalizeLoad('added', 11.5)).toEqual({ loadType: 'added', loadKg: 11.5 });
    expect(normalizeLoad('assist', 10)).toEqual({ loadType: 'assist', loadKg: 10 });
    expect(normalizeLoad('bodyweight', 0)).toEqual({ loadType: 'bodyweight', loadKg: 0 });
    expect(normalizeLoad('external', 0)).toEqual({ loadType: 'external', loadKg: 0 });
    expect(normalizeLoad('external', 35)).toEqual({ loadType: 'external', loadKg: 35 });
    expect(normalizeLoad('band', 0)).toEqual({ loadType: 'band', loadKg: 0 });
    expect(normalizeLoad('band', 50)).toEqual({ loadType: 'band', loadKg: 50 });
  });

  it('throws EditError on negative kg for every load type', () => {
    expect(() => normalizeLoad('added', -1)).toThrow(EditError);
    expect(() => normalizeLoad('assist', -0.5)).toThrow(EditError);
    expect(() => normalizeLoad('external', -1)).toThrow(EditError);
    expect(() => normalizeLoad('band', -1)).toThrow(EditError);
    expect(() => normalizeLoad('bodyweight', -1)).toThrow(EditError);
  });

  it('throws EditError on bodyweight with kg other than 0 (the file would not validate)', () => {
    expect(() => normalizeLoad('bodyweight', 5)).toThrow(EditError);
  });

  it('throws EditError on a non-finite kg', () => {
    expect(() => normalizeLoad('external', Number.NaN)).toThrow(EditError);
    expect(() => normalizeLoad('added', Number.POSITIVE_INFINITY)).toThrow(EditError);
  });
});

describe('startSession', () => {
  it('creates a live session: startedAt and updatedAt = now, tags [], source app, no blocks', () => {
    const file = valid(startSession(later, '2030-03-04'));
    expect(file.schemaVersion).toBe(MODEL_VERSION);
    expect(file.session).toEqual({
      id: file.session.id,
      date: '2030-03-04',
      startedAt: LATER,
      tags: [],
      source: 'app',
      blocks: [],
      updatedAt: LATER,
    });
    expect(file.session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('takes a given id', () => {
    const id = uuid();
    expect(startSession(later, '2030-03-04', id).session.id).toBe(id);
  });

  it('throws EditError on a date that is not a calendar date', () => {
    expect(() => startSession(later, '2030-02-30')).toThrow(EditError);
    expect(() => startSession(later, '04.03.2030')).toThrow(EditError);
  });
});

describe('createPastSession', () => {
  it('creates a session without startedAt', () => {
    const file = valid(createPastSession('2030-03-04', later));
    expect(file.session).toEqual({
      id: file.session.id,
      date: '2030-03-04',
      tags: [],
      source: 'app',
      blocks: [],
      updatedAt: LATER,
    });
    expect('startedAt' in file.session).toBe(false);
  });

  it('takes a given id and refuses a bad date', () => {
    const id = uuid();
    expect(createPastSession('2030-03-04', later, id).session.id).toBe(id);
    expect(() => createPastSession('2030-13-01', later)).toThrow(EditError);
  });
});

describe('setSessionFields', () => {
  const base = (): SessionFile =>
    sessionFile(session([block(ladder([5, 4]))], { label: 'pull', notes: 'old', tags: ['sick'] }));

  it('sets date, label, notes and tags and touches only the session', () => {
    const file = base();
    const out = valid(setSessionFields(file, { date: '2030-03-05', label: 'push', notes: 'new', tags: ['a', 'b'] }, later));
    expect(out.session.date).toBe('2030-03-05');
    expect(out.session.label).toBe('push');
    expect(out.session.notes).toBe('new');
    expect(out.session.tags).toEqual(['a', 'b']);
    expect(out.session.updatedAt).toBe(LATER);
    expect(out.session.blocks).toBe(file.session.blocks);
    expect(out.session.blocks[0]?.updatedAt).toBe(T0);
    expect(out.session.blocks[0]?.sets[0]?.updatedAt).toBe(T0);
    expect(file.session.updatedAt).toBe(T0);
  });

  it('uses max(now, previous + 1 ms) for updatedAt', () => {
    expect(setSessionFields(base(), { notes: 'x' }, earlier).session.updatedAt).toBe(T0_PLUS_1);
  });

  it('label null removes the label, notes null removes the notes', () => {
    const out = valid(setSessionFields(base(), { label: null, notes: null }, later));
    expect('label' in out.session).toBe(false);
    expect('notes' in out.session).toBe(false);
  });

  it('an empty notes string removes the notes too', () => {
    const out = valid(setSessionFields(base(), { notes: '   ' }, later));
    expect('notes' in out.session).toBe(false);
  });

  it('leaves fields that are not given alone', () => {
    const out = setSessionFields(base(), { tags: ['x'] }, later);
    expect(out.session.label).toBe('pull');
    expect(out.session.notes).toBe('old');
    expect(out.session.date).toBe('2030-01-01');
  });

  it('dateExact true removes dateUncertain; without it the flag stays even when the date changes', () => {
    const migrated = sessionFile(session([], { source: 'migrated', dateUncertain: true }));
    const exact = valid(setSessionFields(migrated, { dateExact: true }, later));
    expect('dateUncertain' in exact.session).toBe(false);
    const moved = valid(setSessionFields(migrated, { date: '2030-01-02' }, later));
    expect(moved.session.dateUncertain).toBe(true);
    expect(moved.session.date).toBe('2030-01-02');
  });

  it('drops empty tags and trims the rest', () => {
    const out = valid(setSessionFields(base(), { tags: [' sick ', '', '  '] }, later));
    expect(out.session.tags).toEqual(['sick']);
  });

  it('throws EditError on a date that is not a calendar date', () => {
    expect(() => setSessionFields(base(), { date: '2030-02-29' }, later)).toThrow(EditError);
  });
});

describe('deleteSession / undeleteSession', () => {
  it('tombstones only the session and round-trips through undelete', () => {
    const file = sessionFile(session([block(ladder([5]))]));
    const deleted = valid(deleteSession(file, later));
    expect(deleted.session.deletedAt).toBe(LATER);
    expect(deleted.session.updatedAt).toBe(LATER);
    expect(deleted.session.blocks).toBe(file.session.blocks);
    expect(deleted.session.blocks[0]?.deletedAt).toBeUndefined();

    const restored = valid(undeleteSession(deleted, new Date('2030-01-01T12:00:00.000Z')));
    expect('deletedAt' in restored.session).toBe(false);
    expect(restored.session.updatedAt).toBe('2030-01-01T12:00:00.000Z');
    expect(restored.session.blocks).toBe(file.session.blocks);
  });

  it('undelete moves updatedAt past the tombstone even on a slow clock', () => {
    const deleted = deleteSession(sessionFile(), later);
    expect(undeleteSession(deleted, earlier).session.updatedAt).toBe('2030-01-01T11:00:00.001Z');
  });
});

describe('addBlock', () => {
  it('appends a block with order = nextOrder over every sibling, deleted ones included, updatedAt = now', () => {
    const dead = block([], { order: 7, deletedAt: T0 });
    const file = sessionFile(session([block([], { order: 0 }), dead]));
    const { file: out, blockId } = addBlock(file, 'dips', later);
    valid(out);
    const added = out.session.blocks.find((b) => b.id === blockId);
    expect(added).toEqual({ id: blockId, order: 8, exerciseId: 'dips', sets: [], updatedAt: LATER });
    expect(out.session.blocks).toHaveLength(3);
    expect(out.session.updatedAt).toBe(T0);
    expect(file.session.blocks).toHaveLength(2);
  });

  it('starts at order 0 in an empty session and takes a given id', () => {
    const id = uuid();
    const { file: out, blockId } = addBlock(sessionFile(), 'dips', later, id);
    expect(blockId).toBe(id);
    expect(out.session.blocks[0]?.order).toBe(0);
    valid(out);
  });

  it('throws EditError on an exercise id that is not a slug', () => {
    expect(() => addBlock(sessionFile(), 'Dips Rings', later)).toThrow(EditError);
    expect(() => addBlock(sessionFile(), '', later)).toThrow(EditError);
  });
});

describe('setBlockNote', () => {
  const file = (): SessionFile => sessionFile(session([block(ladder([5]), { note: 'old' }), block([])]));

  it('sets the note and touches only that block', () => {
    const f = file();
    const id = f.session.blocks[0]!.id;
    const out = valid(setBlockNote(f, id, 'deep', later));
    expect(out.session.blocks[0]?.note).toBe('deep');
    expect(out.session.blocks[0]?.updatedAt).toBe(LATER);
    expect(out.session.blocks[0]?.sets).toBe(f.session.blocks[0]!.sets);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
  });

  it('null or an empty string removes the note', () => {
    const f = file();
    const id = f.session.blocks[0]!.id;
    expect('note' in valid(setBlockNote(f, id, null, later)).session.blocks[0]!).toBe(false);
    expect('note' in valid(setBlockNote(f, id, '  ', later)).session.blocks[0]!).toBe(false);
  });

  it('throws EditError on an unknown block', () => {
    expect(() => setBlockNote(file(), uuid(), 'x', later)).toThrow(EditError);
  });
});

describe('deleteBlock / undeleteBlock', () => {
  it('tombstones only the block, keeps its sets, and round-trips', () => {
    const f = sessionFile(session([block(ladder([5, 4])), block([])]));
    const id = f.session.blocks[0]!.id;
    const deleted = valid(deleteBlock(f, id, later));
    expect(deleted.session.blocks[0]?.deletedAt).toBe(LATER);
    expect(deleted.session.blocks[0]?.updatedAt).toBe(LATER);
    expect(deleted.session.blocks[0]?.sets).toBe(f.session.blocks[0]!.sets);
    expect(deleted.session.blocks[0]?.sets[0]?.deletedAt).toBeUndefined();
    expect(deleted.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(deleted.session.updatedAt).toBe(T0);

    const restored = valid(undeleteBlock(deleted, id, earlier));
    expect('deletedAt' in restored.session.blocks[0]!).toBe(false);
    expect(restored.session.blocks[0]?.updatedAt).toBe('2030-01-01T11:00:00.001Z');
    expect(restored.session.updatedAt).toBe(T0);
  });

  it('throws EditError on an unknown block', () => {
    expect(() => deleteBlock(sessionFile(), uuid(), later)).toThrow(EditError);
    expect(() => undeleteBlock(sessionFile(), uuid(), later)).toThrow(EditError);
  });
});

describe('moveBlock', () => {
  const three = (): SessionFile =>
    sessionFile(
      session([
        block([], { order: 0, exerciseId: 'a' }),
        block([], { order: 1, exerciseId: 'b' }),
        block([], { order: 2, exerciseId: 'c' }),
      ]),
    );
  const ids = (f: SessionFile): string[] => liveBlocks(f.session).map((b) => b.exerciseId);

  it('up: the block gets the midpoint between its two predecessors and nothing else is renumbered', () => {
    const f = three();
    const c = f.session.blocks[2]!;
    const out = valid(moveBlock(f, c.id, 'up', later));
    expect(ids(out)).toEqual(['a', 'c', 'b']);
    const moved = out.session.blocks.find((b) => b.id === c.id)!;
    expect(moved.order).toBe(0.5);
    expect(moved.updatedAt).toBe(LATER);
    expect(out.session.blocks[0]).toBe(f.session.blocks[0]);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
  });

  it('down: the block gets the midpoint between its two successors', () => {
    const f = three();
    const a = f.session.blocks[0]!;
    const out = valid(moveBlock(f, a.id, 'down', later));
    expect(ids(out)).toEqual(['b', 'a', 'c']);
    expect(out.session.blocks.find((b) => b.id === a.id)!.order).toBe(1.5);
  });

  it('moving to the very first or very last place steps 1 beyond the neighbour', () => {
    const f = three();
    const up = moveBlock(f, f.session.blocks[1]!.id, 'up', later);
    expect(ids(up)).toEqual(['b', 'a', 'c']);
    expect(up.session.blocks[1]!.order).toBe(-1);
    const down = moveBlock(f, f.session.blocks[1]!.id, 'down', later);
    expect(ids(down)).toEqual(['a', 'c', 'b']);
    expect(down.session.blocks[1]!.order).toBe(3);
  });

  it('is a no-op (same file object) at the edge', () => {
    const f = three();
    expect(moveBlock(f, f.session.blocks[0]!.id, 'up', later)).toBe(f);
    expect(moveBlock(f, f.session.blocks[2]!.id, 'down', later)).toBe(f);
  });

  it('skips tombstoned neighbours', () => {
    const f = sessionFile(
      session([
        block([], { order: 0, exerciseId: 'a' }),
        block([], { order: 1, exerciseId: 'dead', deletedAt: T0 }),
        block([], { order: 2, exerciseId: 'b' }),
      ]),
    );
    const out = valid(moveBlock(f, f.session.blocks[2]!.id, 'up', later));
    expect(ids(out)).toEqual(['b', 'a']);
    expect(out.session.blocks[2]!.order).toBe(-1);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    const single = sessionFile(session([block([], { order: 0, deletedAt: T0 }), block([], { order: 1 })]));
    expect(moveBlock(single, single.session.blocks[1]!.id, 'up', later)).toBe(single);
  });

  it('follows the canonical order (id breaks ties), not array position', () => {
    const f = sessionFile(
      session([
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 0, exerciseId: 'second' }),
        block([], { id: '00000000-0000-4000-8000-00000000000a', order: 0, exerciseId: 'first' }),
      ]),
    );
    expect(ids(f)).toEqual(['first', 'second']);
    const out = moveBlock(f, f.session.blocks[0]!.id, 'up', later);
    expect(ids(out)).toEqual(['second', 'first']);
    expect(out.session.blocks[0]!.order).toBe(-1);
  });

  it('steps past a run of equal orders (two devices each appended) so the move shows', () => {
    const tied = sessionFile(
      session([
        block([], { id: '00000000-0000-4000-8000-00000000000a', order: 0, exerciseId: 'a' }),
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 0, exerciseId: 'b' }),
        block([], { id: '00000000-0000-4000-8000-00000000000c', order: 0, exerciseId: 'c' }),
      ]),
    );
    expect(ids(tied)).toEqual(['a', 'b', 'c']);
    const up = valid(moveBlock(tied, tied.session.blocks[2]!.id, 'up', later));
    expect(ids(up)).toEqual(['c', 'a', 'b']);
    expect(up.session.blocks[2]!.order).toBe(-1);
    expect(up.session.blocks[0]).toBe(tied.session.blocks[0]);
    expect(up.session.blocks[1]).toBe(tied.session.blocks[1]);
    const down = valid(moveBlock(tied, tied.session.blocks[0]!.id, 'down', later));
    expect(ids(down)).toEqual(['b', 'c', 'a']);
    expect(down.session.blocks[0]!.order).toBe(1);
  });

  it('takes the midpoint to the next distinct order beyond a tied run', () => {
    const f = sessionFile(
      session([
        block([], { order: 0, exerciseId: 'a' }),
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 1, exerciseId: 'b' }),
        block([], { id: '00000000-0000-4000-8000-00000000000c', order: 1, exerciseId: 'c' }),
        block([], { order: 2, exerciseId: 'd' }),
      ]),
    );
    const out = valid(moveBlock(f, f.session.blocks[3]!.id, 'up', later));
    expect(ids(out)).toEqual(['a', 'd', 'b', 'c']);
    expect(out.session.blocks[3]!.order).toBe(0.5);
  });

  it('throws EditError instead of writing a non-move when no order fits between the neighbours', () => {
    // 1 - 2^-53 and 1 are adjacent doubles; their midpoint rounds to 1, the neighbour's own order.
    const f = sessionFile(
      session([
        block([], { id: '00000000-0000-4000-8000-00000000000a', order: 1 - 2 ** -53, exerciseId: 'a' }),
        block([], { id: '00000000-0000-4000-8000-00000000000b', order: 1, exerciseId: 'b' }),
        block([], { id: '00000000-0000-4000-8000-00000000000c', order: 2, exerciseId: 'c' }),
      ]),
    );
    expect(() => moveBlock(f, f.session.blocks[2]!.id, 'up', later)).toThrow(EditError);
  });

  it('throws EditError on an unknown or tombstoned block', () => {
    const f = three();
    expect(() => moveBlock(f, uuid(), 'up', later)).toThrow(EditError);
    const dead = deleteBlock(f, f.session.blocks[1]!.id, later);
    expect(() => moveBlock(dead, f.session.blocks[1]!.id, 'up', later)).toThrow(EditError);
  });
});

describe('findBlock', () => {
  it('finds live and tombstoned blocks by id, undefined otherwise', () => {
    const dead = block([], { deletedAt: T0 });
    const live = block([]);
    const s = session([live, dead]);
    expect(findBlock(s, live.id)).toBe(live);
    expect(findBlock(s, dead.id)).toBe(dead);
    expect(findBlock(s, uuid())).toBeUndefined();
  });
});

describe('findSet', () => {
  it('finds a set in any block, tombstoned ones included, with its block', () => {
    const dead = set({ deletedAt: T0 });
    const live = set();
    const b1 = block([live]);
    const b2 = block([dead], { deletedAt: T0 });
    const s = session([b1, b2]);
    expect(findSet(s, live.id)).toEqual({ block: b1, set: live });
    expect(findSet(s, dead.id)).toEqual({ block: b2, set: dead });
    expect(findSet(s, uuid())).toBeUndefined();
  });
});

describe('addSet', () => {
  const bw: SetInput = { reps: 10, loadType: 'bodyweight', loadKg: 0 };
  const twoBlocks = (): SessionFile => sessionFile(session([block(ladder([17, 16])), block([])]));

  it('appends to the named block with order = nextOrder over every sibling (deleted included), updatedAt = now', () => {
    const f = sessionFile(session([block([set({ order: 0 }), set({ order: 4, deletedAt: T0 })]), block([])]));
    const blockId = f.session.blocks[0]!.id;
    const { file: out, setId } = addSet(f, blockId, bw, later);
    valid(out);
    const added = out.session.blocks[0]!.sets.find((s) => s.id === setId);
    expect(added).toEqual({ id: setId, order: 5, reps: 10, loadType: 'bodyweight', loadKg: 0, updatedAt: LATER });
    expect(out.session.blocks[0]!.sets).toHaveLength(3);
    expect(out.session.blocks[0]!.updatedAt).toBe(T0);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
    expect(f.session.blocks[0]!.sets).toHaveLength(2);
  });

  it('starts at order 0 in an empty block and takes a given id', () => {
    const f = twoBlocks();
    const id = uuid();
    const { file: out, setId } = addSet(f, f.session.blocks[1]!.id, bw, later, id);
    expect(setId).toBe(id);
    expect(out.session.blocks[1]!.sets[0]?.order).toBe(0);
    valid(out);
  });

  it('carries no completedAt when none is given (session page) and keeps a given one (Log tab)', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    const plain = valid(addSet(f, blockId, bw, later).file);
    expect('completedAt' in plain.session.blocks[1]!.sets[0]!).toBe(false);
    const live = valid(addSet(f, blockId, { ...bw, completedAt: LATER }, later).file);
    expect(live.session.blocks[1]!.sets[0]!.completedAt).toBe(LATER);
  });

  it('stores a seconds set and a trimmed note', () => {
    const f = twoBlocks();
    const out = valid(addSet(f, f.session.blocks[1]!.id, { seconds: 45, loadType: 'external', loadKg: 35, note: ' slow ' }, later).file);
    expect(out.session.blocks[1]!.sets[0]).toEqual({
      id: out.session.blocks[1]!.sets[0]!.id,
      order: 0,
      seconds: 45,
      loadType: 'external',
      loadKg: 35,
      note: 'slow',
      updatedAt: LATER,
    });
    const blank = valid(addSet(f, f.session.blocks[1]!.id, { ...bw, note: '  ' }, later).file);
    expect('note' in blank.session.blocks[1]!.sets[0]!).toBe(false);
  });

  it('normalises added/assist at 0 kg to bodyweight and refuses bad loads', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    const out = valid(addSet(f, blockId, { reps: 8, loadType: 'added', loadKg: 0 }, later).file);
    expect(out.session.blocks[1]!.sets[0]).toMatchObject({ loadType: 'bodyweight', loadKg: 0 });
    expect(() => addSet(f, blockId, { reps: 8, loadType: 'added', loadKg: -1 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { reps: 8, loadType: 'bodyweight', loadKg: 3 }, later)).toThrow(EditError);
  });

  it('throws EditError on amount <= 0 or not a number (D18)', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    expect(() => addSet(f, blockId, { ...bw, reps: 0 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { ...bw, reps: -2 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { ...bw, reps: Number.NaN }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { seconds: 0, loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
  });

  it('throws EditError on both or neither of reps / seconds', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[1]!.id;
    expect(() => addSet(f, blockId, { reps: 5, seconds: 30, loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
    expect(() => addSet(f, blockId, { loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
  });

  it('throws EditError when the metric mixes with the live sets already in the block', () => {
    const f = twoBlocks();
    const blockId = f.session.blocks[0]!.id;
    expect(() => addSet(f, blockId, { seconds: 30, loadType: 'bodyweight', loadKg: 0 }, later)).toThrow(EditError);
    const onlyDeadTimed = sessionFile(session([block([timedSet({ deletedAt: T0 })])]));
    valid(addSet(onlyDeadTimed, onlyDeadTimed.session.blocks[0]!.id, bw, later).file);
  });

  it('throws EditError on an unknown block or a bad completedAt', () => {
    const f = twoBlocks();
    expect(() => addSet(f, uuid(), bw, later)).toThrow(EditError);
    expect(() => addSet(f, f.session.blocks[1]!.id, { ...bw, completedAt: '2030-01-01T11:00:00Z' }, later)).toThrow(EditError);
  });
});

describe('setSetFields', () => {
  const target = (): { file: SessionFile; set: WorkoutSet } => {
    const s = set({ order: 1, reps: 12, loadType: 'added', loadKg: 11.5, completedAt: T0, note: 'old' });
    return { file: sessionFile(session([block([set({ order: 0 }), s]), block([])])), set: s };
  };

  it('changes the amount and touches only that set', () => {
    const { file: f, set: s } = target();
    const out = valid(setSetFields(f, s.id, { reps: 13 }, later));
    const edited = findSet(out.session, s.id)!.set;
    expect(edited).toEqual({ ...s, reps: 13, updatedAt: LATER });
    expect(out.session.blocks[0]!.sets[0]).toBe(f.session.blocks[0]!.sets[0]);
    expect(out.session.blocks[0]!.updatedAt).toBe(T0);
    expect(out.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(out.session.updatedAt).toBe(T0);
    expect(amountOf(findSet(f.session, s.id)!.set)).toBe(12);
  });

  it('never touches completedAt, whatever changes', () => {
    const { file: f, set: s } = target();
    const out = setSetFields(f, s.id, { reps: 1, loadType: 'external', loadKg: 20, note: null }, later);
    expect(findSet(out.session, s.id)!.set.completedAt).toBe(T0);
    const untimed = sessionFile(session([block([set()])]));
    const id = untimed.session.blocks[0]!.sets[0]!.id;
    expect('completedAt' in findSet(setSetFields(untimed, id, { reps: 2 }, later).session, id)!.set).toBe(false);
  });

  it('uses max(now, previous + 1 ms)', () => {
    const { file: f, set: s } = target();
    expect(findSet(setSetFields(f, s.id, { reps: 13 }, earlier).session, s.id)!.set.updatedAt).toBe(T0_PLUS_1);
  });

  it('changes the load through normalizeLoad, merging with the stored load', () => {
    const { file: f, set: s } = target();
    const kgOnly = valid(setSetFields(f, s.id, { loadKg: 15 }, later));
    expect(findSet(kgOnly.session, s.id)!.set).toMatchObject({ loadType: 'added', loadKg: 15 });
    const toZero = valid(setSetFields(f, s.id, { loadKg: 0 }, later));
    expect(findSet(toZero.session, s.id)!.set).toMatchObject({ loadType: 'bodyweight', loadKg: 0 });
    const toExternal = valid(setSetFields(f, s.id, { loadType: 'external' }, later));
    expect(findSet(toExternal.session, s.id)!.set).toMatchObject({ loadType: 'external', loadKg: 11.5 });
    const toBand = valid(setSetFields(f, s.id, { loadType: 'band', loadKg: 50 }, later));
    expect(findSet(toBand.session, s.id)!.set).toMatchObject({ loadType: 'band', loadKg: 50 });
    expect(() => setSetFields(f, s.id, { loadKg: -1 }, later)).toThrow(EditError);
  });

  it('switching to bodyweight without a kg zeroes the stored kg (the sheet need not pass both)', () => {
    const { file: f, set: s } = target();
    const out = valid(setSetFields(f, s.id, { loadType: 'bodyweight' }, later));
    expect(findSet(out.session, s.id)!.set).toMatchObject({ loadType: 'bodyweight', loadKg: 0 });
    expect(() => setSetFields(f, s.id, { loadType: 'bodyweight', loadKg: 3 }, later)).toThrow(EditError);
  });

  it('note: a string sets it, null or blank removes it', () => {
    const { file: f, set: s } = target();
    expect(findSet(valid(setSetFields(f, s.id, { note: 'deep' }, later)).session, s.id)!.set.note).toBe('deep');
    expect('note' in findSet(valid(setSetFields(f, s.id, { note: null }, later)).session, s.id)!.set).toBe(false);
    expect('note' in findSet(valid(setSetFields(f, s.id, { note: ' ' }, later)).session, s.id)!.set).toBe(false);
  });

  it('throws EditError on amount <= 0, on a metric switch and on both metrics', () => {
    const { file: f, set: s } = target();
    expect(() => setSetFields(f, s.id, { reps: 0 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { reps: -1 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { reps: Number.POSITIVE_INFINITY }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { seconds: 30 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, s.id, { reps: 5, seconds: 30 }, later)).toThrow(EditError);
    const timed = sessionFile(session([block([timedSet()])]));
    const id = timed.session.blocks[0]!.sets[0]!.id;
    expect(() => setSetFields(timed, id, { reps: 5 }, later)).toThrow(EditError);
    expect(findSet(valid(setSetFields(timed, id, { seconds: 40 }, later)).session, id)!.set).toMatchObject({ seconds: 40 });
  });

  it('throws EditError on an unknown set', () => {
    expect(() => setSetFields(target().file, uuid(), { reps: 5 }, later)).toThrow(EditError);
  });

  it('lets a migrated aggregate set change only its note', () => {
    const agg = set({ reps: 100, aggregate: true });
    const f = sessionFile(session([block([agg])], { source: 'migrated' }));
    expect(findSet(valid(setSetFields(f, agg.id, { note: 'n' }, later)).session, agg.id)!.set.note).toBe('n');
    expect(() => setSetFields(f, agg.id, { reps: 90 }, later)).toThrow(EditError);
    expect(() => setSetFields(f, agg.id, { loadKg: 5, loadType: 'added' }, later)).toThrow(EditError);
  });
});

describe('deleteSet / undeleteSet', () => {
  it('tombstones only the set and round-trips', () => {
    const f = sessionFile(session([block(ladder([5, 4])), block([])]));
    const s = f.session.blocks[0]!.sets[1]!;
    const deleted = valid(deleteSet(f, s.id, later));
    const dead = findSet(deleted.session, s.id)!.set;
    expect(dead.deletedAt).toBe(LATER);
    expect(dead.updatedAt).toBe(LATER);
    expect(amountOf(dead)).toBe(4);
    expect(deleted.session.blocks[0]!.sets[0]).toBe(f.session.blocks[0]!.sets[0]);
    expect(deleted.session.blocks[0]!.updatedAt).toBe(T0);
    expect(deleted.session.blocks[1]).toBe(f.session.blocks[1]);
    expect(deleted.session.updatedAt).toBe(T0);

    const restored = valid(undeleteSet(deleted, s.id, earlier));
    const back = findSet(restored.session, s.id)!.set;
    expect('deletedAt' in back).toBe(false);
    expect(back.updatedAt).toBe('2030-01-01T11:00:00.001Z');
    expect(restored.session.blocks[0]!.updatedAt).toBe(T0);
  });

  it('throws EditError on an unknown set', () => {
    expect(() => deleteSet(sessionFile(), uuid(), later)).toThrow(EditError);
    expect(() => undeleteSet(sessionFile(), uuid(), later)).toThrow(EditError);
  });
});

describe('edits refuse a tombstoned session or block (a write no view would show)', () => {
  const input: SetInput = { reps: 5, loadType: 'bodyweight', loadKg: 0 };

  it('every edit of a deleted block throws EditError; its undelete still works', () => {
    const f = sessionFile(session([block(ladder([5]), { deletedAt: T0, order: 0 }), block([], { order: 1 })]));
    const id = f.session.blocks[0]!.id;
    const setId = f.session.blocks[0]!.sets[0]!.id;
    expect(() => addSet(f, id, input, later)).toThrow(/block was deleted/);
    expect(() => setSetFields(f, setId, { reps: 6 }, later)).toThrow(EditError);
    expect(() => deleteSet(f, setId, later)).toThrow(EditError);
    expect(() => setBlockNote(f, id, 'x', later)).toThrow(EditError);
    expect(() => deleteBlock(f, id, later)).toThrow(EditError);
    expect(() => moveBlock(f, id, 'down', later)).toThrow(EditError);
    expect(valid(undeleteBlock(f, id, later)).session.blocks[0]?.deletedAt).toBeUndefined();
    expect(valid(undeleteSet(f, setId, later)).session.blocks[0]?.sets[0]?.updatedAt).toBe(LATER);
  });

  it('every edit inside a deleted session throws EditError; its undelete still works', () => {
    const f = sessionFile(session([block(ladder([5]), { order: 0 }), block([], { order: 1 })], { deletedAt: T0 }));
    const id = f.session.blocks[0]!.id;
    const setId = f.session.blocks[0]!.sets[0]!.id;
    expect(() => addSet(f, id, input, later)).toThrow(/session was deleted/);
    expect(() => setSetFields(f, setId, { reps: 6 }, later)).toThrow(EditError);
    expect(() => deleteSet(f, setId, later)).toThrow(EditError);
    expect(() => addBlock(f, 'dips', later)).toThrow(EditError);
    expect(() => setBlockNote(f, id, 'x', later)).toThrow(EditError);
    expect(() => deleteBlock(f, id, later)).toThrow(EditError);
    expect(() => moveBlock(f, id, 'down', later)).toThrow(EditError);
    expect(valid(undeleteSession(f, later)).session.deletedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/model/edit.test.ts`

Expected: FAIL. The first error reads:

```
src/model/edit.test.ts: Error: Cannot find module './edit' imported from src/model/edit.test.ts
```


- [ ] **Step 3: Write the implementation**

Create `src/model/edit.ts`:

```ts
import { compareBlocks, liveBlocks, liveSets } from './derive/order';
import { amountOf, metricOf } from './derive/totals';
import { nextOrder, orderBetween, tombstone, touch, undelete } from './record';
import { EXERCISE_ID_PATTERN, MODEL_VERSION } from './schema';
import type { Block, LoadType, Session, SessionFile, SessionLabel, WorkoutSet } from './types';
import { isCalendarDate, isTimestamp } from './validate';

/**
 * Pure edits over session files (spec 4 §3 "Edits"). Every function takes the current file and
 * returns a new one with `updatedAt` moved on the edited record only (spec 1 §3 "What updatedAt
 * covers"); `now` is always passed in. A result passes `validateForWrite('session', …)` whenever
 * the input did; input that could not be stored is refused with an `EditError`.
 */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

/** A new set; exactly one of reps / seconds; completedAt only from the Log tab (D16). */
export interface SetInput {
  reps?: number;
  seconds?: number;
  loadType: LoadType;
  loadKg: number;
  note?: string;
  completedAt?: string;
}

/** Field changes; `null` removes the note. A reps/seconds switch is not allowed (the metric is the exercise's). */
export interface SetFields {
  reps?: number;
  seconds?: number;
  loadType?: LoadType;
  loadKg?: number;
  note?: string | null;
}

export interface SessionFields {
  date?: string;
  /** true: the date is no longer an estimate; removes `dateUncertain` (spec 4 §5). */
  dateExact?: true;
  label?: SessionLabel | null;
  notes?: string | null;
  tags?: string[];
}

/** Three rules. The kg must be a finite number >= 0 (EditError otherwise); added/assist at 0 kg
 *  is bodyweight (spec 1 §3), so added/assist never stays at <= 0 kg; bodyweight carries 0 kg
 *  (EditError otherwise, the file would not validate). */
export function normalizeLoad(loadType: LoadType, loadKg: number): { loadType: LoadType; loadKg: number } {
  if (!Number.isFinite(loadKg)) throw new EditError(`load must be a number, got ${loadKg}`);
  if (loadKg < 0) throw new EditError(`load must not be negative, got ${loadKg} kg`);
  if ((loadType === 'added' || loadType === 'assist') && loadKg === 0) return { loadType: 'bodyweight', loadKg: 0 };
  if (loadType === 'bodyweight' && loadKg !== 0) throw new EditError(`bodyweight carries no kg, got ${loadKg}`);
  return { loadType, loadKg };
}

function requireDate(date: string): string {
  if (!isCalendarDate(date)) throw new EditError(`not a calendar date: ${date}`);
  return date;
}

/** Trimmed text, or undefined when the field is to be removed (null, empty or blank). */
function optionalText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `{ key: value }` when value is defined, else `{}`: keeps optional properties absent, never undefined. */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function newId(id: string | undefined): string {
  return id ?? crypto.randomUUID();
}

function withSession(file: SessionFile, session: Session): SessionFile {
  return { ...file, session };
}

export function startSession(now: Date, localDate: string, id?: string): SessionFile {
  const stamp = now.toISOString();
  return {
    schemaVersion: MODEL_VERSION,
    session: {
      id: newId(id),
      date: requireDate(localDate),
      startedAt: stamp,
      tags: [],
      source: 'app',
      blocks: [],
      updatedAt: stamp,
    },
  };
}

export function createPastSession(date: string, now: Date, id?: string): SessionFile {
  return {
    schemaVersion: MODEL_VERSION,
    session: { id: newId(id), date: requireDate(date), tags: [], source: 'app', blocks: [], updatedAt: now.toISOString() },
  };
}

/** Touches the session only; `null` removes label / notes; `dateExact: true` removes dateUncertain. */
export function setSessionFields(file: SessionFile, fields: SessionFields, now: Date): SessionFile {
  const { label: _label, notes: _notes, dateUncertain, ...rest } = file.session;
  const label = fields.label === undefined ? file.session.label : fields.label === null ? undefined : fields.label;
  const notes = fields.notes === undefined ? file.session.notes : optionalText(fields.notes);
  const tags = fields.tags === undefined ? file.session.tags : fields.tags.map((t) => t.trim()).filter((t) => t !== '');
  const session: Session = {
    ...rest,
    date: fields.date === undefined ? file.session.date : requireDate(fields.date),
    tags,
    ...opt('dateUncertain', fields.dateExact === true ? undefined : dateUncertain),
    ...opt('label', label),
    ...opt('notes', notes),
  };
  return withSession(file, touch(session, now));
}

export function deleteSession(file: SessionFile, now: Date): SessionFile {
  return withSession(file, tombstone(file.session, now));
}

export function undeleteSession(file: SessionFile, now: Date): SessionFile {
  return withSession(file, undelete(file.session, now));
}

// ---- blocks ----------------------------------------------------------------------------------

const EXERCISE_ID_RE = new RegExp(EXERCISE_ID_PATTERN);

/** Lookup by id, tombstoned blocks included (undelete needs them). */
export function findBlock(session: Session, blockId: string): Block | undefined {
  return session.blocks.find((b) => b.id === blockId);
}

function requireBlock(session: Session, blockId: string): Block {
  const found = findBlock(session, blockId);
  if (found === undefined) throw new EditError(`unknown block ${blockId}`);
  return found;
}

/** Edits other than undelete refuse a tombstoned session: no view would show what they write. */
function requireLiveSession(session: Session): void {
  if (session.deletedAt !== undefined) throw new EditError('the session was deleted');
}

/** A block an edit may change: known, in a live session, and not tombstoned itself. */
function requireLiveBlock(session: Session, blockId: string): Block {
  requireLiveSession(session);
  const found = requireBlock(session, blockId);
  if (found.deletedAt !== undefined) throw new EditError('the block was deleted');
  return found;
}

/** The file with one block replaced (by id); the session record itself is not touched. */
function replaceBlock(file: SessionFile, next: Block): SessionFile {
  return withSession(file, { ...file.session, blocks: file.session.blocks.map((b) => (b.id === next.id ? next : b)) });
}

export function addBlock(file: SessionFile, exerciseId: string, now: Date, id?: string): { file: SessionFile; blockId: string } {
  requireLiveSession(file.session);
  if (!EXERCISE_ID_RE.test(exerciseId)) throw new EditError(`not an exercise id: "${exerciseId}"`);
  const blockId = newId(id);
  const added: Block = { id: blockId, order: nextOrder(file.session.blocks), exerciseId, sets: [], updatedAt: now.toISOString() };
  return { file: withSession(file, { ...file.session, blocks: [...file.session.blocks, added] }), blockId };
}

export function setBlockNote(file: SessionFile, blockId: string, note: string | null, now: Date): SessionFile {
  const { note: _note, ...rest } = requireLiveBlock(file.session, blockId);
  return replaceBlock(file, touch({ ...rest, ...opt('note', optionalText(note)) }, now));
}

export function deleteBlock(file: SessionFile, blockId: string, now: Date): SessionFile {
  return replaceBlock(file, tombstone(requireLiveBlock(file.session, blockId), now));
}

export function undeleteBlock(file: SessionFile, blockId: string, now: Date): SessionFile {
  return replaceBlock(file, undelete(requireBlock(file.session, blockId), now));
}

/**
 * Moves the block past its canonical live neighbour by giving it a midpoint order between that
 * neighbour and the next live block beyond with a *different* order (spec 1 §3 "Sibling order":
 * nobody else is renumbered); one past the neighbour when there is none. Blocks that share the
 * neighbour's order (two devices each appended) cannot be split by an order value, so the moved
 * block steps past the whole tied run: one touch beats renumbering the neighbours. At the edge
 * the same file object comes back. Should no representable number fit between the two orders
 * (adjacent doubles), the move is refused rather than written as a non-move.
 */
export function moveBlock(file: SessionFile, blockId: string, direction: 'up' | 'down', now: Date): SessionFile {
  requireLiveSession(file.session);
  const live = liveBlocks(file.session);
  const moved = live.find((b) => b.id === blockId);
  if (moved === undefined) throw new EditError(`unknown or deleted block ${blockId}`);
  const at = live.indexOf(moved);
  const step = direction === 'up' ? -1 : 1;
  const neighbour = live[at + step];
  if (neighbour === undefined) return file;
  let beyond: Block | undefined;
  for (let i = at + 2 * step; beyond === undefined && i >= 0 && i < live.length; i += step) {
    const candidate = live[i];
    if (candidate !== undefined && candidate.order !== neighbour.order) beyond = candidate;
  }
  const order = beyond === undefined ? neighbour.order + step : orderBetween(beyond.order, neighbour.order);
  const next: Block = { ...moved, order };
  if (Math.sign(compareBlocks(next, neighbour)) !== step) {
    throw new EditError(`no order fits between ${beyond?.order} and ${neighbour.order} to move block ${blockId} ${direction}`);
  }
  return replaceBlock(file, touch(next, now));
}

// ---- sets ------------------------------------------------------------------------------------

type Metric = 'reps' | 'seconds';

/** Lookup by id across every block, tombstoned blocks and sets included. */
export function findSet(session: Session, setId: string): { block: Block; set: WorkoutSet } | undefined {
  for (const block of session.blocks) {
    const set = block.sets.find((s) => s.id === setId);
    if (set !== undefined) return { block, set };
  }
  return undefined;
}

function requireSet(session: Session, setId: string): { block: Block; set: WorkoutSet } {
  const found = findSet(session, setId);
  if (found === undefined) throw new EditError(`unknown set ${setId}`);
  return found;
}

/** A set an edit may change: its block and its session are live (undeleteSet uses requireSet). */
function requireLiveSet(session: Session, setId: string): { block: Block; set: WorkoutSet } {
  requireLiveSession(session);
  const found = requireSet(session, setId);
  if (found.block.deletedAt !== undefined) throw new EditError('the block was deleted');
  return found;
}

/** The file with one set of one block replaced (by id); neither the block nor the session is touched. */
function replaceSet(file: SessionFile, block: Block, next: WorkoutSet): SessionFile {
  return replaceBlock(file, { ...block, sets: block.sets.map((s) => (s.id === next.id ? next : s)) });
}

/** D18: reps > 0; the same for seconds. */
function requireAmount(metric: Metric, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new EditError(`${metric} must be more than 0, got ${amount}`);
  return amount;
}

/** The one metric given, checked; undefined when neither is given; EditError on both. */
function inputAmount(input: { reps?: number; seconds?: number }): { metric: Metric; amount: number } | undefined {
  const { reps, seconds } = input;
  if (reps !== undefined && seconds !== undefined) throw new EditError('a set has reps or seconds, not both');
  if (reps !== undefined) return { metric: 'reps', amount: requireAmount('reps', reps) };
  if (seconds !== undefined) return { metric: 'seconds', amount: requireAmount('seconds', seconds) };
  return undefined;
}

type SetCommon = Omit<WorkoutSet, 'reps' | 'seconds'>;

function withAmount(common: SetCommon, metric: Metric, amount: number): WorkoutSet {
  return metric === 'reps' ? { ...common, reps: amount } : { ...common, seconds: amount };
}

/** The set without its amount field (the one metric it carries); the amount itself is `amountOf`. */
function withoutAmount(set: WorkoutSet): SetCommon {
  if ('reps' in set) {
    const { reps: _reps, ...common } = set;
    return common;
  }
  const { seconds: _seconds, ...common } = set;
  return common;
}

/** Appends a set to the block; order = nextOrder over every sibling (deleted ones included), updatedAt = now. */
export function addSet(file: SessionFile, blockId: string, input: SetInput, now: Date, id?: string): { file: SessionFile; setId: string } {
  const target = requireLiveBlock(file.session, blockId);
  const given = inputAmount(input);
  if (given === undefined) throw new EditError('a set needs reps or seconds');
  // One live set is enough to read the block's metric: the hard rule keeps live sets uniform.
  const existing = liveSets(target)[0];
  if (existing !== undefined && metricOf(existing) !== given.metric) {
    throw new EditError(`the block's sets count ${metricOf(existing)}, not ${given.metric}`);
  }
  if (input.completedAt !== undefined && !isTimestamp(input.completedAt)) {
    throw new EditError(`not a timestamp: ${input.completedAt}`);
  }
  const setId = newId(id);
  const common: SetCommon = {
    id: setId,
    order: nextOrder(target.sets),
    ...normalizeLoad(input.loadType, input.loadKg),
    updatedAt: now.toISOString(),
    ...opt('note', optionalText(input.note)),
    ...opt('completedAt', input.completedAt),
  };
  const added = withAmount(common, given.metric, given.amount);
  return { file: replaceBlock(file, { ...target, sets: [...target.sets, added] }), setId };
}

/** Changes amount, load and note of one set; never touches completedAt (D16). A load given as
 *  type only merges with the stored kg, except that a switch to bodyweight zeroes the kg. */
export function setSetFields(file: SessionFile, setId: string, fields: SetFields, now: Date): SessionFile {
  const { block, set: current } = requireLiveSet(file.session, setId);
  const metric = metricOf(current);
  const change = inputAmount(fields);
  if (change !== undefined && change.metric !== metric) {
    throw new EditError(`a ${metric} set cannot take ${change.metric}: the metric is the exercise's`);
  }
  const loadType = fields.loadType ?? current.loadType;
  const loadKg = fields.loadKg ?? (fields.loadType === 'bodyweight' ? 0 : current.loadKg);
  const load = fields.loadType === undefined && fields.loadKg === undefined ? undefined : normalizeLoad(loadType, loadKg);
  if (current.aggregate === true && (change !== undefined || load !== undefined)) {
    throw new EditError('an aggregate set can change only its note');
  }
  const { note: _note, ...rest } = withoutAmount(current);
  const common: SetCommon = {
    ...rest,
    ...(load ?? {}),
    ...opt('note', fields.note === undefined ? current.note : optionalText(fields.note)),
  };
  const amount = change === undefined ? amountOf(current) : change.amount;
  return replaceSet(file, block, touch(withAmount(common, metric, amount), now));
}

export function deleteSet(file: SessionFile, setId: string, now: Date): SessionFile {
  const { block, set } = requireLiveSet(file.session, setId);
  return replaceSet(file, block, tombstone(set, now));
}

export function undeleteSet(file: SessionFile, setId: string, now: Date): SessionFile {
  const { block, set } = requireSet(file.session, setId);
  return replaceSet(file, block, undelete(set, now));
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 39 test files and 592 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/model/edit.test.ts src/model/edit.ts
git commit -m "Add the pure edit functions for sessions, blocks and sets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Live-log derivations (`src/model/derive/live.ts`)

The pure rules behind the Log tab (§4): the day type of a session, the proposed reference session, the pairing of today's blocks with the reference blocks (U13), the stepper's proposed value and step, the sticky load, and the counter's source. They sit next to the other derived-value functions of spec 1 §7 so v1.1 can reuse them.

**Files:**
- Modify: `src/model/derive/index.ts`
- Create: `src/model/derive/live.test.ts`
- Create: `src/model/derive/live.ts`

**Interfaces:**
- Consumes: `src/model/derive/compare`, `src/model/derive/filter`, `src/model/derive/order`, `src/model/derive/time`, `src/model/derive/totals`, `src/model/types`.
- Produces:
  - `src/model/derive/live.ts`:
    - `export function dayType(session: Session, catalog: readonly Exercise[]): Chip | undefined`
    - `export function recentSessions(sessions: readonly Session[], excludeId: string | undefined, limit = 10): Session[]`
    - `export function proposeReference(sessions: readonly Session[], catalog: readonly Exercise[], excludeId: string | undefined): Session | undefined`
    - `export interface CardPair`
    - `export function pairCards(today: Session, reference: Session | undefined): CardPair[]`
    - `export function stepFor(metric: 'reps' | 'seconds'): number`
    - `export function proposedAmount(todayBlock: Block | undefined, referenceBlock: Block | undefined): number | undefined`
    - `export interface StickyLoad`
    - `export function stickyLoad(todayBlock: Block | undefined, referenceBlock: Block | undefined, exercise: Exercise | undefined): StickyLoad`
    - `export function latestCompletedAt(session: Session): string | undefined`
    - `export function sessionSpan(session: Session): { from: string; to: string; seconds: number } | undefined`
    - `export function defaultCurrentBlock(session: Session): Block | undefined`
    - `export function sessionExerciseIds(session: Session): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/model/derive/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dayType,
  defaultCurrentBlock,
  latestCompletedAt,
  pairCards,
  proposeReference,
  proposedAmount,
  recentSessions,
  sessionExerciseIds,
  sessionSpan,
  stepFor,
  stickyLoad,
} from './live';
import { T0, block, exercise, ladder, session, set, timedSet } from '../test-fixtures';

const catalog = [
  exercise(),
  exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }),
  exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs' }),
  exercise({ id: 'knee-raises', name: 'Knee Raises', pattern: 'core' }),
];

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('dayType (spec 4 §4 proposal rule)', () => {
  it('is the chip most live blocks have', () => {
    const s = session([
      block([], { order: 0, exerciseId: 'pull-ups' }),
      block([], { order: 1, exerciseId: 'dips-bar' }),
      block([], { order: 2, exerciseId: 'push-ups' }),
    ]);
    expect(dayType(s, catalog)).toBe('push');
  });

  it('on a tie the first block in canonical order wins, not the first in the array', () => {
    const s = session([
      block([], { order: 1, exerciseId: 'pull-ups' }),
      block([], { order: 0, exerciseId: 'dips-bar' }),
    ]);
    expect(dayType(s, catalog)).toBe('push');
  });

  it('counts an unknown exercise as other', () => {
    const s = session([block([], { order: 0, exerciseId: 'ghost' })]);
    expect(dayType(s, catalog)).toBe('other');
    const core = session([block([], { order: 0, exerciseId: 'knee-raises' })]);
    expect(dayType(core, catalog)).toBe('other');
  });

  it('is undefined without live blocks and ignores tombstoned blocks', () => {
    expect(dayType(session([]), catalog)).toBeUndefined();
    const s = session([
      block([], { order: 0, exerciseId: 'dips-bar', deletedAt: T0 }),
      block([], { order: 1, exerciseId: 'dips-bar', deletedAt: T0 }),
      block([], { order: 2, exerciseId: 'pull-ups' }),
    ]);
    expect(dayType(s, catalog)).toBe('pull');
    expect(dayType(session([block()], { deletedAt: T0 }), catalog)).toBeUndefined();
  });
});

describe('recentSessions', () => {
  const a = session([], { id: id(901), date: '2030-03-01' });
  const b = session([], { id: id(902), date: '2030-03-02' });
  const dead = session([], { id: id(903), date: '2030-03-03', deletedAt: T0 });
  const c = session([], { id: id(904), date: '2030-03-04' });
  const today = session([], { id: id(905), date: '2030-03-05' });

  it('excludes the given id, drops tombstones and lists newest first', () => {
    expect(recentSessions([a, today, dead, c, b], today.id).map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it('respects the limit and defaults to 10', () => {
    expect(recentSessions([a, b, c, today], undefined, 2).map((s) => s.id)).toEqual([today.id, c.id]);
    const many = Array.from({ length: 12 }, (_, i) => session([], { id: id(800 + i), date: `2030-04-${String(i + 1).padStart(2, '0')}` }));
    expect(recentSessions(many, undefined)).toHaveLength(10);
    expect(recentSessions(many, undefined)[0]?.id).toBe(id(811));
  });
});

describe('proposeReference (spec 4 §4 proposal rule)', () => {
  const push = (over: Partial<ReturnType<typeof session>>) => session([block([], { exerciseId: 'dips-bar' })], over);
  const pull = (over: Partial<ReturnType<typeof session>>) => session([block([], { exerciseId: 'pull-ups' })], over);
  const legs = (over: Partial<ReturnType<typeof session>>) => session([block([], { exerciseId: 'squats' })], over);

  it('with a push/pull/legs rotation proposes the day type gone longest without', () => {
    const sessions = [
      push({ id: id(911), date: '2030-03-01' }),
      pull({ id: id(912), date: '2030-03-02' }),
      legs({ id: id(913), date: '2030-03-03' }),
      push({ id: id(914), date: '2030-03-04' }),
    ];
    expect(proposeReference(sessions, catalog, undefined)?.id).toBe(id(912));
  });

  it('with one day type only proposes its most recent session', () => {
    const sessions = [pull({ id: id(921), date: '2030-03-01' }), pull({ id: id(922), date: '2030-03-03' }), pull({ id: id(923), date: '2030-03-02' })];
    expect(proposeReference(sessions, catalog, undefined)?.id).toBe(id(922));
  });

  it('returns undefined with no sessions, with only tombstones and with only empty sessions', () => {
    expect(proposeReference([], catalog, undefined)).toBeUndefined();
    expect(proposeReference([pull({ id: id(931), date: '2030-03-01', deletedAt: T0 })], catalog, undefined)).toBeUndefined();
    expect(proposeReference([session([], { id: id(932), date: '2030-03-01' })], catalog, undefined)).toBeUndefined();
  });

  it("excludes today's session id", () => {
    const today = push({ id: id(941), date: '2030-03-05' });
    const sessions = [pull({ id: id(942), date: '2030-03-02' }), push({ id: id(943), date: '2030-03-04' }), today];
    // Without the exclusion push's most recent is today (03-05) and pull (03-02) still wins; the
    // exclusion matters when today is the only session of its type.
    const onlyToday = [pull({ id: id(944), date: '2030-03-06' }), today];
    expect(proposeReference(sessions, catalog, today.id)?.id).toBe(id(942));
    expect(proposeReference(onlyToday, catalog, today.id)?.id).toBe(id(944));
  });

  it('on equal dates picks the lower in session order', () => {
    const lower = push({ id: id(951), date: '2030-03-05' });
    const higher = pull({ id: id(952), date: '2030-03-05' });
    expect(proposeReference([higher, lower], catalog, undefined)?.id).toBe(lower.id);
    const earlyStart = pull({ id: id(953), date: '2030-03-05', startedAt: '2030-03-05T08:00:00.000Z' });
    const lateStart = push({ id: id(950), date: '2030-03-05', startedAt: '2030-03-05T18:00:00.000Z' });
    expect(proposeReference([lateStart, earlyStart], catalog, undefined)?.id).toBe(earlyStart.id);
  });
});

describe('pairCards (spec 4 §4 cards, U13)', () => {
  it('pairs two runs of one exercise positionally', () => {
    const r1 = block(ladder([10, 10]), { order: 0, exerciseId: 'pull-ups' });
    const rDips = block(ladder([8]), { order: 1, exerciseId: 'dips-bar' });
    const r2 = block(ladder([6, 6]), { order: 2, exerciseId: 'pull-ups' });
    const reference = session([r2, rDips, r1]);
    const t1 = block(ladder([11]), { order: 0, exerciseId: 'pull-ups' });
    const t2 = block(ladder([7]), { order: 1, exerciseId: 'pull-ups' });
    const today = session([t2, t1]);
    expect(pairCards(today, reference)).toEqual([
      { exerciseId: 'pull-ups', reference: r1, today: t1 },
      { exerciseId: 'dips-bar', reference: rDips, today: undefined },
      { exerciseId: 'pull-ups', reference: r2, today: t2 },
    ]);
  });

  it("appends today's new exercise and third run after the reference cards, in canonical order", () => {
    const r1 = block(ladder([10]), { order: 0, exerciseId: 'pull-ups' });
    const reference = session([r1]);
    const t1 = block(ladder([11]), { order: 0, exerciseId: 'pull-ups' });
    const tNew = block(ladder([20]), { order: 1, exerciseId: 'push-ups' });
    const t2 = block(ladder([5]), { order: 2, exerciseId: 'pull-ups' });
    const today = session([t2, tNew, t1]);
    expect(pairCards(today, reference)).toEqual([
      { exerciseId: 'pull-ups', reference: r1, today: t1 },
      { exerciseId: 'push-ups', reference: undefined, today: tNew },
      { exerciseId: 'pull-ups', reference: undefined, today: t2 },
    ]);
  });

  it("with No reference shows today's blocks only, in canonical order, tombstones out", () => {
    const b0 = block([], { order: 0, exerciseId: 'dips-bar' });
    const b1 = block([], { order: 1, exerciseId: 'pull-ups' });
    const dead = block([], { order: 2, exerciseId: 'squats', deletedAt: T0 });
    expect(pairCards(session([b1, dead, b0]), undefined)).toEqual([
      { exerciseId: 'dips-bar', reference: undefined, today: b0 },
      { exerciseId: 'pull-ups', reference: undefined, today: b1 },
    ]);
  });

  it('a reference block without a today block has today undefined; an empty today gives reference cards only', () => {
    const r = block(ladder([10]), { order: 0, exerciseId: 'pull-ups' });
    expect(pairCards(session([]), session([r]))).toEqual([{ exerciseId: 'pull-ups', reference: r, today: undefined }]);
  });
});

describe('stepFor', () => {
  it('steps reps by 1 and seconds by 5', () => {
    expect(stepFor('reps')).toBe(1);
    expect(stepFor('seconds')).toBe(5);
  });
});

describe('proposedAmount (spec 4 §4 stepper)', () => {
  const reference = block(ladder([17, 16, 15, 14, 13]));

  it("takes the reference set at position today's live set count + 1", () => {
    expect(proposedAmount(undefined, reference)).toBe(17);
    expect(proposedAmount(block(ladder([17, 16])), reference)).toBe(15);
  });

  it('ignores tombstoned sets in today when counting the position', () => {
    const today = block([set({ reps: 17, order: 0 }), set({ reps: 16, order: 1, deletedAt: T0 })]);
    expect(proposedAmount(today, reference)).toBe(16);
  });

  it("falls back to today's last set in canonical order when the reference runs out or is absent", () => {
    const today = block([set({ reps: 9, order: 1 }), set({ reps: 12, order: 0 })]);
    expect(proposedAmount(today, block(ladder([10])))).toBe(9);
    expect(proposedAmount(today, undefined)).toBe(9);
  });

  it('is undefined when both are empty', () => {
    expect(proposedAmount(undefined, undefined)).toBeUndefined();
    expect(proposedAmount(block([]), block([]))).toBeUndefined();
  });

  it("never proposes a migrated aggregate set's total: falls back to today's last set, else nothing", () => {
    const aggregateRef = block([set({ reps: 100, aggregate: true, order: 0 })]);
    expect(proposedAmount(undefined, aggregateRef)).toBeUndefined();
    expect(proposedAmount(block([set({ reps: 12 })]), block([set({ reps: 10, order: 0 }), set({ reps: 100, aggregate: true, order: 1 })]))).toBe(12);
    // A late entry in a migrated block (no reference) does not start from the aggregate either.
    expect(proposedAmount(aggregateRef, undefined)).toBeUndefined();
  });

  it('works for seconds', () => {
    const ref = block([timedSet({ seconds: 30, order: 0 }), timedSet({ seconds: 45, order: 1 })]);
    expect(proposedAmount(block([timedSet({ seconds: 30 })]), ref)).toBe(45);
    expect(proposedAmount(block([timedSet({ seconds: 25 })]), undefined)).toBe(25);
  });
});

describe('stickyLoad (spec 4 §4 entry area)', () => {
  it("uses today's last live set", () => {
    const today = block([
      set({ order: 0, loadType: 'added', loadKg: 10 }),
      set({ order: 1, loadType: 'added', loadKg: 11.5 }),
      set({ order: 2, loadType: 'external', loadKg: 40, deletedAt: T0 }),
    ]);
    const ref = block([set({ loadType: 'band', loadKg: 50 })]);
    expect(stickyLoad(today, ref, exercise())).toEqual({ loadType: 'added', loadKg: 11.5, needsKg: false });
  });

  it("uses the reference's first live set when today has none", () => {
    const ref = block([set({ order: 1, loadType: 'assist', loadKg: 20 }), set({ order: 0, loadType: 'assist', loadKg: 10 })]);
    expect(stickyLoad(undefined, ref, exercise())).toEqual({ loadType: 'assist', loadKg: 10, needsKg: false });
    expect(stickyLoad(block([]), ref, exercise())).toEqual({ loadType: 'assist', loadKg: 10, needsKg: false });
  });

  it('falls back to the exercise default with 0 kg; added and assist need a kg', () => {
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'added' }))).toEqual({ loadType: 'added', loadKg: 0, needsKg: true });
    expect(stickyLoad(undefined, block([]), exercise({ defaultLoadType: 'assist' }))).toEqual({ loadType: 'assist', loadKg: 0, needsKg: true });
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'bodyweight' }))).toEqual({ loadType: 'bodyweight', loadKg: 0, needsKg: false });
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'external' }))).toEqual({ loadType: 'external', loadKg: 0, needsKg: false });
    expect(stickyLoad(undefined, undefined, exercise({ defaultLoadType: 'band' }))).toEqual({ loadType: 'band', loadKg: 0, needsKg: false });
  });

  it('an undefined exercise falls back to bodyweight 0', () => {
    expect(stickyLoad(undefined, undefined, undefined)).toEqual({ loadType: 'bodyweight', loadKg: 0, needsKg: false });
  });
});

describe('latestCompletedAt (the counter source)', () => {
  it('is the latest completedAt of a live set in a live block', () => {
    const s = session([
      block([set({ order: 0, completedAt: '2030-03-04T14:10:00.000Z' }), set({ order: 1, completedAt: '2030-03-04T14:20:00.000Z' })], { order: 0 }),
      block([set({ order: 0, completedAt: '2030-03-04T14:15:00.000Z' })], { order: 1 }),
    ]);
    expect(latestCompletedAt(s)).toBe('2030-03-04T14:20:00.000Z');
  });

  it('ignores tombstoned sets and blocks, and is undefined without a stamp', () => {
    const s = session([
      block([set({ order: 0, completedAt: '2030-03-04T14:10:00.000Z' }), set({ order: 1, completedAt: '2030-03-04T14:20:00.000Z', deletedAt: T0 })], { order: 0 }),
      block([set({ order: 0, completedAt: '2030-03-04T14:30:00.000Z' })], { order: 1, deletedAt: T0 }),
    ]);
    expect(latestCompletedAt(s)).toBe('2030-03-04T14:10:00.000Z');
    expect(latestCompletedAt(session([block([set()])]))).toBeUndefined();
  });
});

describe('sessionSpan', () => {
  it('runs from startedAt to the latest completedAt with the seconds', () => {
    const s = session([block([set({ order: 0, completedAt: '2030-03-04T14:53:00.000Z' })])], { startedAt: '2030-03-04T14:05:00.000Z' });
    expect(sessionSpan(s)).toEqual({ from: '2030-03-04T14:05:00.000Z', to: '2030-03-04T14:53:00.000Z', seconds: 48 * 60 });
  });

  it('uses the earliest completedAt when startedAt is absent', () => {
    const s = session([
      block([set({ order: 0, completedAt: '2030-03-04T14:20:00.000Z' })], { order: 0 }),
      block([set({ order: 0, completedAt: '2030-03-04T14:10:00.000Z' }), set({ order: 1, completedAt: '2030-03-04T14:40:30.000Z' })], { order: 1 }),
    ]);
    expect(sessionSpan(s)).toEqual({ from: '2030-03-04T14:10:00.000Z', to: '2030-03-04T14:40:30.000Z', seconds: 30 * 60 + 30 });
  });

  it('is undefined without a completedAt, when the only stamp equals startedAt and for one untimed set', () => {
    expect(sessionSpan(session([block([set()])], { startedAt: '2030-03-04T14:05:00.000Z' }))).toBeUndefined();
    expect(sessionSpan(session([block([set({ completedAt: '2030-03-04T14:05:00.000Z' })])], { startedAt: '2030-03-04T14:05:00.000Z' }))).toBeUndefined();
    expect(sessionSpan(session([block([set({ completedAt: '2030-03-04T14:05:00.000Z' })])]))).toBeUndefined();
    expect(sessionSpan(session([]))).toBeUndefined();
  });
});

describe('defaultCurrentBlock', () => {
  it('is the last live block in canonical order, by order then id, not array position', () => {
    const last = block([], { id: id(961), order: 2 });
    const dead = block([], { id: id(962), order: 5, deletedAt: T0 });
    const first = block([], { id: id(963), order: 0 });
    expect(defaultCurrentBlock(session([last, dead, first]))).toBe(last);
    const tieLow = block([], { id: id(964), order: 1 });
    const tieHigh = block([], { id: id(965), order: 1 });
    expect(defaultCurrentBlock(session([tieHigh, tieLow]))).toBe(tieHigh);
    expect(defaultCurrentBlock(session([]))).toBeUndefined();
  });
});

describe('sessionExerciseIds', () => {
  it('de-duplicates in block order and skips tombstoned blocks', () => {
    const s = session([
      block([], { order: 2, exerciseId: 'pull-ups' }),
      block([], { order: 0, exerciseId: 'dips-bar' }),
      block([], { order: 1, exerciseId: 'pull-ups' }),
      block([], { order: 3, exerciseId: 'squats', deletedAt: T0 }),
      block([], { order: 4, exerciseId: 'push-ups' }),
    ]);
    expect(sessionExerciseIds(s)).toEqual(['dips-bar', 'pull-ups', 'push-ups']);
    expect(sessionExerciseIds(session([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/model/derive/live.test.ts`

Expected: FAIL. The first error reads:

```
src/model/derive/live.test.ts: Error: Cannot find module './live' imported from src/model/derive/live.test.ts
```


- [ ] **Step 3: Write the implementation**

Append to `src/model/derive/index.ts`:

```ts
export * from './live';
```

Create `src/model/derive/live.ts`:

```ts
import type { Block, Exercise, LoadType, Session, WorkoutSet } from '../types';
import { chipOf, type Chip } from './filter';
import { compareSessions, completedStamps, liveBlocks, liveSets, sessionTimeKey, sortSessions } from './order';
import { amountOf } from './totals';

/** Spec 4 §4 proposal rule: the chip most live blocks have; tie → the chip of the first block in
 *  canonical order; undefined without live blocks. An unknown exercise counts as 'other'. */
export function dayType(session: Session, catalog: readonly Exercise[]): Chip | undefined {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const chips = liveBlocks(session).map((b) => {
    const ex = byId.get(b.exerciseId);
    return ex === undefined ? 'other' : chipOf(ex.pattern);
  });
  const counts = new Map<Chip, number>();
  for (const c of chips) counts.set(c, (counts.get(c) ?? 0) + 1);
  // Walking the chips in block order and only replacing on a strictly higher count keeps the
  // earliest chip on a tie.
  let best: Chip | undefined;
  let bestCount = 0;
  for (const c of chips) {
    const n = counts.get(c) ?? 0;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** Live sessions other than `excludeId`, in session order, newest first, at most `limit`. */
export function recentSessions(sessions: readonly Session[], excludeId: string | undefined, limit = 10): Session[] {
  return sortSessions(sessions)
    .filter((s) => s.id !== excludeId)
    .reverse()
    .slice(0, limit);
}

/** Spec 4 §4: per day type its most recent session; of those the one lowest in session order
 *  (oldest date; on equal dates the lower). Sessions without a day type never qualify. */
export function proposeReference(sessions: readonly Session[], catalog: readonly Exercise[], excludeId: string | undefined): Session | undefined {
  const latestByType = new Map<Chip, Session>();
  // Ascending session order: a later session of the same type simply overwrites the earlier one.
  for (const s of sortSessions(sessions)) {
    if (s.id === excludeId) continue;
    const type = dayType(s, catalog);
    if (type !== undefined) latestByType.set(type, s);
  }
  let proposal: Session | undefined;
  for (const s of latestByType.values()) {
    if (proposal === undefined || compareSessions(s, proposal) < 0) proposal = s;
  }
  return proposal;
}

export interface CardPair {
  exerciseId: string;
  reference: Block | undefined;
  today: Block | undefined;
}

/** Spec 4 §4 cards (U13): the reference's live blocks in canonical order, the k-th block of
 *  exercise X paired with the k-th live block of X in today; today's unpaired blocks follow in
 *  canonical order. Without a reference there are only today's cards. */
export function pairCards(today: Session, reference: Session | undefined): CardPair[] {
  const todayBlocks = liveBlocks(today);
  const paired = new Set<string>();
  const seen = new Map<string, number>();
  const cards: CardPair[] = [];
  for (const ref of reference === undefined ? [] : liveBlocks(reference)) {
    const k = seen.get(ref.exerciseId) ?? 0;
    seen.set(ref.exerciseId, k + 1);
    const match = todayBlocks.filter((b) => b.exerciseId === ref.exerciseId)[k];
    if (match !== undefined) paired.add(match.id);
    cards.push({ exerciseId: ref.exerciseId, reference: ref, today: match });
  }
  for (const b of todayBlocks) {
    if (!paired.has(b.id)) cards.push({ exerciseId: b.exerciseId, reference: undefined, today: b });
  }
  return cards;
}

export function stepFor(metric: 'reps' | 'seconds'): number {
  return metric === 'reps' ? 1 : 5;
}

const setsOf = (block: Block | undefined): WorkoutSet[] => (block === undefined ? [] : liveSets(block));

/** A migrated aggregate set holds a total of unknown sets ("100 total"), never one set's amount. */
const single = (s: WorkoutSet | undefined): WorkoutSet | undefined => (s === undefined || s.aggregate === true ? undefined : s);

/** Spec 4 §4 stepper: the reference set at position (today's live set count + 1), else today's
 *  last live set, else undefined. An aggregate set never proposes: it is a total, not the set at
 *  that position (spec 4 §4). */
export function proposedAmount(todayBlock: Block | undefined, referenceBlock: Block | undefined): number | undefined {
  const today = setsOf(todayBlock);
  const candidate = single(setsOf(referenceBlock)[today.length]) ?? single(today[today.length - 1]);
  return candidate === undefined ? undefined : amountOf(candidate);
}

export interface StickyLoad {
  loadType: LoadType;
  loadKg: number;
  /** added/assist without a weight: the load sheet opens before the first write (spec 1 §5). */
  needsKg: boolean;
}

function sticky(loadType: LoadType, loadKg: number): StickyLoad {
  return { loadType, loadKg, needsKg: (loadType === 'added' || loadType === 'assist') && loadKg <= 0 };
}

/** Spec 4 §4: today's last live set → the reference's first live set → the exercise default at 0 kg. */
export function stickyLoad(todayBlock: Block | undefined, referenceBlock: Block | undefined, exercise: Exercise | undefined): StickyLoad {
  const today = setsOf(todayBlock);
  const last = today[today.length - 1];
  if (last !== undefined) return sticky(last.loadType, last.loadKg);
  const first = setsOf(referenceBlock)[0];
  if (first !== undefined) return sticky(first.loadType, first.loadKg);
  return sticky(exercise?.defaultLoadType ?? 'bodyweight', 0);
}

/** The counter source: the latest completedAt of a live set in a live block. */
export function latestCompletedAt(session: Session): string | undefined {
  const stamps = completedStamps(session);
  return stamps.length === 0 ? undefined : stamps.reduce((a, b) => (a > b ? a : b));
}

/** startedAt (else the earliest completedAt) → the latest completedAt, only when both exist and
 *  the span is positive. */
export function sessionSpan(session: Session): { from: string; to: string; seconds: number } | undefined {
  const from = sessionTimeKey(session);
  const to = latestCompletedAt(session);
  if (from === undefined || to === undefined) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  return ms > 0 ? { from, to, seconds: ms / 1000 } : undefined;
}

/** The last live block in canonical order (spec 4 §4: the current block after a reload). */
export function defaultCurrentBlock(session: Session): Block | undefined {
  const blocks = liveBlocks(session);
  return blocks[blocks.length - 1];
}

/** The session's exercises in canonical block order, de-duplicated (the picker line). */
export function sessionExerciseIds(session: Session): string[] {
  return [...new Set(liveBlocks(session).map((b) => b.exerciseId))];
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 40 test files and 625 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/model/derive/index.ts src/model/derive/live.test.ts src/model/derive/live.ts
git commit -m "Add the live-log derivations: reference, pairing, proposal, sticky load" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Formatting and routing

Display formatting with fixed English names and device-locale numbers (§8), and hash routing over a signal (§3 "Routing"), including the start-route rule (OAuth → Sync; an open session → Log; else the last route).

**Files:**
- Create: `src/ui/format.test.ts`
- Create: `src/ui/format.ts`
- Create: `src/ui/router.test.ts`
- Create: `src/ui/router.ts`

**Interfaces:**
- Consumes: `src/model/derive/compare`, `src/model/types`.
- Produces:
  - `src/ui/format.ts`:
    - `export function localDate(now: Date): string`
    - `export function parseLocalDate(date: string): Date`
    - `export function formatDay(date: string): string`
    - `export function formatDayLong(date: string): string`
    - `export function formatMonth(date: string): string`
    - `export function formatLabel(label: SessionLabel): string`
    - `export function formatTime(iso: string): string`
    - `export function formatClock(seconds: number): string`
    - `export function formatMinutes(seconds: number): string`
    - `export function formatAmount(n: number): string`
    - `export function formatLoad(loadType: LoadType, loadKg: number): string`
    - `export function formatLoadShort(loadType: LoadType, loadKg: number): string`
    - `export function glyph(ind: AmountIndicator | LoadIndicator): string`
    - `export function glyphLabel(ind: AmountIndicator | LoadIndicator): string`
  - `src/ui/router.ts`:
    - `export type MorePage = 'exercises' | 'exercise' | 'calendar' | 'bodyweight' | 'catalog'`
    - `export type Route =`
    - `export function parseRoute(hash: string): Route`
    - `export function routeHash(route: Route): string`
    - `export function startRoute(input: { afterOAuth: boolean; openSession: boolean; lastRoute: string | undefined; hasLocalData: boolean; connected: boolean }): Route`
    - `export interface RouterWindow`
    - `export class Router`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatClock,
  formatDay,
  formatDayLong,
  formatLoad,
  formatLoadShort,
  formatMinutes,
  formatMonth,
  formatTime,
  glyph,
  glyphLabel,
  formatLabel,
  localDate,
  parseLocalDate,
} from './format';
import { SESSION_LABELS } from '../model/schema';

/** The device locale's rendering of a number, the same call format.ts makes (spec 4 §8: decimals use the device locale). */
const num = (n: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
const pad2 = (n: number): string => String(n).padStart(2, '0');

describe('localDate', () => {
  it('uses the local calendar day, not the UTC one, late in the evening', () => {
    // 23:30 local; in any zone east of UTC the UTC date is already the 5th.
    expect(localDate(new Date(2030, 2, 4, 23, 30))).toBe('2030-03-04');
  });

  it('uses the local calendar day early in the morning', () => {
    expect(localDate(new Date(2030, 0, 1, 0, 15))).toBe('2030-01-01');
  });

  it('pads month and day', () => {
    expect(localDate(new Date(2030, 10, 9, 12, 0))).toBe('2030-11-09');
  });
});

describe('parseLocalDate', () => {
  it('returns local midnight of that day', () => {
    const d = parseLocalDate('2030-03-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2030, 2, 4, 0, 0]);
  });

  it('round-trips with localDate', () => {
    expect(localDate(parseLocalDate('2030-12-31'))).toBe('2030-12-31');
    expect(localDate(parseLocalDate('2030-01-01'))).toBe('2030-01-01');
  });
});

describe('formatDay', () => {
  it('shows weekday, zero-padded day and short month in English', () => {
    expect(formatDay('2030-03-07')).toBe('Thu 07 Mar');
    expect(formatDay('2030-03-04')).toBe('Mon 04 Mar');
  });

  it('covers the other weekdays and months', () => {
    expect(formatDay('2030-11-30')).toBe('Sat 30 Nov');
    expect(formatDay('2030-01-01')).toBe('Tue 01 Jan');
  });
});

describe('formatDayLong', () => {
  it('shows the weekday and the ISO date', () => {
    expect(formatDayLong('2030-03-07')).toBe('Thu 2030-03-07');
    expect(formatDayLong('2030-11-30')).toBe('Sat 2030-11-30');
  });
});

describe('formatMonth', () => {
  it('shows the full English month name and the year', () => {
    expect(formatMonth('2030-03-04')).toBe('March 2030');
    expect(formatMonth('2030-11-30')).toBe('November 2030');
  });
});

describe('formatLabel', () => {
  it('shows a session label as capitalised display text', () => {
    expect(formatLabel('push')).toBe('Push');
    expect(formatLabel('mixed')).toBe('Mixed');
    expect(SESSION_LABELS.map(formatLabel)).toEqual(['Pull', 'Push', 'Legs', 'Mixed', 'Other']);
  });
});

describe('formatTime', () => {
  it('shows the local 24 h clock of an ISO instant', () => {
    const d = new Date(2030, 2, 4, 23, 30, 0);
    expect(formatTime(d.toISOString())).toBe(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    expect(formatTime(d.toISOString())).toBe('23:30');
  });

  it('pads single-digit hours and minutes', () => {
    const d = new Date(2030, 2, 4, 7, 5, 59);
    expect(formatTime(d.toISOString())).toBe('07:05');
  });
});

describe('formatClock', () => {
  it('shows m:ss below an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(3599)).toBe('59:59');
  });

  it('switches to h:mm:ss from 3600 seconds', () => {
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(36000)).toBe('10:00:00');
  });

  it('drops fractional seconds', () => {
    expect(formatClock(59.9)).toBe('0:59');
  });
});

describe('formatMinutes', () => {
  it('shows whole minutes under an hour', () => {
    expect(formatMinutes(48 * 60)).toBe('48 min');
    expect(formatMinutes(48 * 60 + 59)).toBe('48 min');
    expect(formatMinutes(30)).toBe('0 min');
  });

  it('shows hours and minutes from an hour', () => {
    expect(formatMinutes(72 * 60)).toBe('1 h 12 min');
    expect(formatMinutes(3600)).toBe('1 h 0 min');
    expect(formatMinutes(2 * 3600 + 5 * 60)).toBe('2 h 5 min');
  });
});

describe('formatAmount', () => {
  it('matches the device locale with up to two decimals', () => {
    expect(formatAmount(11.5)).toBe(num(11.5));
    expect(formatAmount(12)).toBe(num(12));
    expect(formatAmount(0.125)).toBe(num(0.125));
  });

  it('rounds to two decimals and keeps integers plain', () => {
    expect(formatAmount(0.125)).toBe(formatAmount(0.13));
    expect(formatAmount(10)).toBe(num(10));
    expect(formatAmount(10)).toHaveLength(2);
  });
});

describe('formatLoad', () => {
  it('names bodyweight and external load', () => {
    expect(formatLoad('bodyweight', 0)).toBe('bodyweight');
    expect(formatLoad('external', 35)).toBe(`${num(35)} kg`);
  });

  it('signs added and assist, assist with U+2212 and the word assist', () => {
    expect(formatLoad('added', 11.5)).toBe(`+${num(11.5)} kg`);
    expect(formatLoad('assist', 10)).toBe(`−10 kg assist`.replace('10', num(10)));
    expect(formatLoad('assist', 10).charAt(0)).toBe('−');
  });

  it('shows the band grade without a unit', () => {
    expect(formatLoad('band', 50)).toBe(`band ${num(50)}`);
  });
});

describe('formatLoadShort', () => {
  it('abbreviates bodyweight and drops the unit on added and assist', () => {
    expect(formatLoadShort('bodyweight', 0)).toBe('bw');
    expect(formatLoadShort('added', 11.5)).toBe(`+${num(11.5)}`);
    expect(formatLoadShort('assist', 10)).toBe(`−${num(10)}`);
  });

  it('keeps the unit on external and the band word', () => {
    expect(formatLoadShort('external', 35)).toBe(`${num(35)} kg`);
    expect(formatLoadShort('band', 50)).toBe(`band ${num(50)}`);
  });
});

describe('glyph', () => {
  it('maps the trend indicators', () => {
    expect(glyph('up')).toBe('↑');
    expect(glyph('down')).toBe('↓');
    expect(glyph('same')).toBe('=');
  });

  it('maps the load-only indicators', () => {
    expect(glyph('incomparable')).toBe('≠');
    expect(glyph('none')).toBe('–');
    expect(glyph('hidden')).toBe('');
  });
});

describe('glyphLabel', () => {
  it('gives a screen-reader text for every indicator', () => {
    expect(glyphLabel('up')).toBe('more');
    expect(glyphLabel('down')).toBe('less');
    expect(glyphLabel('same')).toBe('same');
    expect(glyphLabel('incomparable')).toBe('not comparable');
    expect(glyphLabel('none')).toBe('no comparison');
  });

  it('is empty for hidden', () => {
    expect(glyphLabel('hidden')).toBe('');
  });
});
```

Create `src/ui/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRoute, Router, routeHash, startRoute, type Route, type RouterWindow } from './router';

/** Every route of the spec 4 §3 table, with its canonical hash. */
const TABLE: ReadonlyArray<readonly [string, Route]> = [
  ['#/log', { tab: 'log' }],
  ['#/days', { tab: 'days' }],
  ['#/days/abc', { tab: 'days', sessionId: 'abc' }],
  ['#/more', { tab: 'more' }],
  ['#/more/exercises', { tab: 'more', page: 'exercises' }],
  ['#/more/exercise/pull-up', { tab: 'more', page: 'exercise', id: 'pull-up' }],
  ['#/more/calendar', { tab: 'more', page: 'calendar' }],
  ['#/more/bodyweight', { tab: 'more', page: 'bodyweight' }],
  ['#/more/catalog', { tab: 'more', page: 'catalog' }],
  ['#/more/catalog/ring-dip', { tab: 'more', page: 'catalog', id: 'ring-dip' }],
  ['#/sync', { tab: 'sync' }],
];

interface FakeWindow extends RouterWindow {
  listeners: Array<() => void>;
  calls: Array<{ method: 'pushState' | 'replaceState'; url: string }>;
  fire(): void;
}

function fakeWindow(hash: string): FakeWindow {
  const win: FakeWindow = {
    location: { hash },
    listeners: [],
    calls: [],
    addEventListener(_type, fn) {
      win.listeners.push(fn);
    },
    removeEventListener(_type, fn) {
      win.listeners = win.listeners.filter((l) => l !== fn);
    },
    history: {
      pushState(_data, _unused, url) {
        win.location.hash = url;
        win.calls.push({ method: 'pushState', url });
      },
      replaceState(_data, _unused, url) {
        win.location.hash = url;
        win.calls.push({ method: 'replaceState', url });
      },
    },
    fire() {
      for (const l of [...win.listeners]) l();
    },
  };
  return win;
}

describe('parseRoute', () => {
  it.each(TABLE)('parses %s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it('sends an empty or bare hash to the Log tab', () => {
    expect(parseRoute('')).toEqual({ tab: 'log' });
    expect(parseRoute('#')).toEqual({ tab: 'log' });
    expect(parseRoute('#/')).toEqual({ tab: 'log' });
  });

  it('sends unknown hashes to the Log tab', () => {
    expect(parseRoute('#/nowhere')).toEqual({ tab: 'log' });
    expect(parseRoute('#/more/nowhere')).toEqual({ tab: 'log' });
    expect(parseRoute('#/more/exercises/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/more/calendar/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/days/abc/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/sync/extra')).toEqual({ tab: 'log' });
    expect(parseRoute('#/log/extra')).toEqual({ tab: 'log' });
  });

  it('decodes an encoded id', () => {
    expect(parseRoute('#/more/exercise/a%20b')).toEqual({ tab: 'more', page: 'exercise', id: 'a b' });
  });

  it('never carries an id on pages that have none', () => {
    expect(parseRoute('#/more/exercises')).not.toHaveProperty('id');
    expect(parseRoute('#/days')).not.toHaveProperty('sessionId');
  });
});

describe('routeHash', () => {
  it.each(TABLE)('renders %s', (hash, route) => {
    expect(routeHash(route)).toBe(hash);
  });

  it.each(TABLE)('round-trips %s', (hash) => {
    expect(routeHash(parseRoute(hash))).toBe(hash);
  });

  it('encodes an id with reserved characters', () => {
    const route: Route = { tab: 'more', page: 'exercise', id: 'a b/c' };
    expect(parseRoute(routeHash(route))).toEqual(route);
  });
});

describe('startRoute', () => {
  const base = { afterOAuth: false, openSession: false, lastRoute: undefined, hasLocalData: true, connected: true };

  it('goes to Sync after the OAuth redirect, whatever else is set', () => {
    expect(startRoute({ ...base, afterOAuth: true, lastRoute: '#/days/abc' })).toEqual({ tab: 'sync' });
    expect(startRoute({ afterOAuth: true, openSession: false, lastRoute: undefined, hasLocalData: false, connected: false })).toEqual({ tab: 'sync' });
    expect(startRoute({ ...base, afterOAuth: true, openSession: true })).toEqual({ tab: 'sync' });
  });

  it('an open session wins over the last route (spec 4 §4 Resume: a reload or an app update lands on it)', () => {
    expect(startRoute({ ...base, openSession: true, lastRoute: '#/sync' })).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, openSession: true, lastRoute: '#/days/abc' })).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, openSession: true, hasLocalData: false, connected: false })).toEqual({ tab: 'log' });
  });

  it('resumes the last route when there is one', () => {
    expect(startRoute({ ...base, lastRoute: '#/days/abc' })).toEqual({ tab: 'days', sessionId: 'abc' });
    expect(startRoute({ ...base, lastRoute: '#/more/calendar', hasLocalData: false, connected: false })).toEqual({ tab: 'more', page: 'calendar' });
  });

  it('treats an unknown last route as Log', () => {
    expect(startRoute({ ...base, lastRoute: '#/nowhere' })).toEqual({ tab: 'log' });
  });

  it('goes to Sync with no local data and no connection', () => {
    expect(startRoute({ ...base, hasLocalData: false, connected: false })).toEqual({ tab: 'sync' });
  });

  it('goes to Log otherwise', () => {
    expect(startRoute(base)).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, hasLocalData: false, connected: true })).toEqual({ tab: 'log' });
    expect(startRoute({ ...base, hasLocalData: true, connected: false })).toEqual({ tab: 'log' });
  });
});

describe('Router', () => {
  it('reflects the initial hash in the route signal', () => {
    const win = fakeWindow('#/days/abc');
    const router = new Router(win);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: 'abc' });
    router.dispose();
  });

  it('starts at Log for an empty hash', () => {
    const router = new Router(fakeWindow(''));
    expect(router.route.value).toEqual({ tab: 'log' });
    router.dispose();
  });

  it('navigate pushes a history entry and updates the signal', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    router.navigate({ tab: 'days', sessionId: 'abc' });
    expect(win.calls).toEqual([{ method: 'pushState', url: '#/days/abc' }]);
    expect(win.location.hash).toBe('#/days/abc');
    expect(router.route.value).toEqual({ tab: 'days', sessionId: 'abc' });
    router.dispose();
  });

  it('navigate with replace uses replaceState', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    router.navigate({ tab: 'sync' }, { replace: true });
    expect(win.calls).toEqual([{ method: 'replaceState', url: '#/sync' }]);
    expect(router.route.value).toEqual({ tab: 'sync' });
    router.dispose();
  });

  it('back goes to the tab root of the current route', () => {
    const win = fakeWindow('#/days/abc');
    const router = new Router(win);
    router.back();
    expect(router.route.value).toEqual({ tab: 'days' });
    expect(win.location.hash).toBe('#/days');

    router.navigate({ tab: 'more', page: 'exercise', id: 'x' });
    router.back();
    expect(router.route.value).toEqual({ tab: 'more' });
    expect(win.location.hash).toBe('#/more');
    expect(win.calls.at(-1)).toEqual({ method: 'pushState', url: '#/more' });
    router.dispose();
  });

  it('back at a tab root stays there without a history entry', () => {
    const win = fakeWindow('#/sync');
    const router = new Router(win);
    router.back();
    expect(router.route.value).toEqual({ tab: 'sync' });
    expect(win.location.hash).toBe('#/sync');
    expect(win.calls).toEqual([]);

    router.navigate({ tab: 'days' });
    router.back();
    expect(win.calls).toEqual([{ method: 'pushState', url: '#/days' }]);
    router.dispose();
  });

  it('follows a hashchange event from the window', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    expect(win.listeners).toHaveLength(1);
    win.location.hash = '#/more/bodyweight';
    win.fire();
    expect(router.route.value).toEqual({ tab: 'more', page: 'bodyweight' });
    expect(win.calls).toEqual([]);
    router.dispose();
  });

  it('dispose removes the listener so later events are ignored', () => {
    const win = fakeWindow('#/log');
    const router = new Router(win);
    router.dispose();
    expect(win.listeners).toHaveLength(0);
    win.location.hash = '#/sync';
    win.fire();
    expect(router.route.value).toEqual({ tab: 'log' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/format.test.ts src/ui/router.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/format.test.ts: Error: Cannot find module './format' imported from src/ui/format.test.ts
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/format.ts`:

```ts
/**
 * Display formatting for the UI (spec 4 §8 "Text"): English names fixed,
 * local calendar days and local times, durations as m:ss / h:mm:ss, and the
 * device locale for decimals only. Pure; no DOM.
 */
import type { AmountIndicator, LoadIndicator } from '../model/derive/compare';
import type { LoadType, SessionLabel } from '../model/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** U+2212 MINUS SIGN, used for assist loads. */
const MINUS = '−';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of `now` in the local zone. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Local midnight of a 'YYYY-MM-DD' day. */
export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function weekdayOf(date: string): string {
  return WEEKDAYS[parseLocalDate(date).getDay()] ?? '';
}

/** 'Thu 07 Mar' */
export function formatDay(date: string): string {
  const d = parseLocalDate(date);
  return `${weekdayOf(date)} ${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()] ?? ''}`;
}

/** 'Thu 2030-03-07' */
export function formatDayLong(date: string): string {
  return `${weekdayOf(date)} ${date}`;
}

/** 'March 2030' */
export function formatMonth(date: string): string {
  const d = parseLocalDate(date);
  return `${MONTHS_LONG[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** A session label as display text: 'push' → 'Push'. Shared by the Days list, the session page and its label select. */
export function formatLabel(label: SessionLabel): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Local 'HH:MM' (24 h) of an ISO instant. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 'm:ss' below an hour, 'h:mm:ss' from 3600 seconds; fractions dropped. */
export function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** '48 min' below an hour, '1 h 12 min' from an hour; whole minutes. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const amountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Up to two decimals in the device locale (display only; files store JSON numbers). */
export function formatAmount(n: number): string {
  return amountFormat.format(n);
}

/** 'bodyweight' | '+11.5 kg' | '−10 kg assist' | '35 kg' | 'band 50' */
export function formatLoad(loadType: LoadType, loadKg: number): string {
  switch (loadType) {
    case 'bodyweight':
      return 'bodyweight';
    case 'added':
      return `+${formatAmount(loadKg)} kg`;
    case 'assist':
      return `${MINUS}${formatAmount(loadKg)} kg assist`;
    case 'external':
      return `${formatAmount(loadKg)} kg`;
    case 'band':
      return `band ${formatAmount(loadKg)}`;
  }
}

/** 'bw' | '+11.5' | '−10' | '35 kg' | 'band 50' */
export function formatLoadShort(loadType: LoadType, loadKg: number): string {
  switch (loadType) {
    case 'bodyweight':
      return 'bw';
    case 'added':
      return `+${formatAmount(loadKg)}`;
    case 'assist':
      return `${MINUS}${formatAmount(loadKg)}`;
    case 'external':
      return `${formatAmount(loadKg)} kg`;
    case 'band':
      return `band ${formatAmount(loadKg)}`;
  }
}

/** The indicator glyph (spec 4 §8): ↑ ↓ = ≠ –, and nothing for hidden. */
export function glyph(ind: AmountIndicator | LoadIndicator): string {
  switch (ind) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'same':
      return '=';
    case 'incomparable':
      return '≠';
    case 'none':
      return '–';
    case 'hidden':
      return '';
  }
}

/** The screen-reader text for an indicator glyph. */
export function glyphLabel(ind: AmountIndicator | LoadIndicator): string {
  switch (ind) {
    case 'up':
      return 'more';
    case 'down':
      return 'less';
    case 'same':
      return 'same';
    case 'incomparable':
      return 'not comparable';
    case 'none':
      return 'no comparison';
    case 'hidden':
      return '';
  }
}
```

Create `src/ui/router.ts`:

```ts
/**
 * Hash routing (spec 4 §3 "Routing"): the route is a signal derived from
 * `location.hash`; navigation writes the hash through the History API so the
 * browser back button works; an unknown hash is the Log tab.
 */
import { signal, type Signal } from '@preact/signals';

export type MorePage = 'exercises' | 'exercise' | 'calendar' | 'bodyweight' | 'catalog';

export type Route =
  | { tab: 'log' }
  | { tab: 'days'; sessionId?: string }
  | { tab: 'more'; page?: MorePage; id?: string }
  | { tab: 'sync' };

const LOG: Route = { tab: 'log' };

/** More pages that stand alone, and those that may carry an id as a third segment. */
const MORE_PLAIN: ReadonlySet<string> = new Set<MorePage>(['exercises', 'calendar', 'bodyweight', 'catalog']);
const MORE_WITH_ID: ReadonlySet<string> = new Set<MorePage>(['exercise', 'catalog']);

function isMorePage(s: string): s is MorePage {
  return MORE_PLAIN.has(s) || MORE_WITH_ID.has(s);
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** '#/days/abc' → { tab: 'days', sessionId: 'abc' }; anything unknown → { tab: 'log' }. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter((p) => p.length > 0);
  const [tab, second, third, ...rest] = parts;
  if (rest.length > 0) return LOG;

  switch (tab) {
    case undefined:
    case 'log':
      return LOG; // '#/log/extra' is unknown, which is Log too
    case 'sync':
      return second === undefined ? { tab: 'sync' } : LOG;
    case 'days':
      if (third !== undefined) return LOG;
      return second === undefined ? { tab: 'days' } : { tab: 'days', sessionId: decode(second) };
    case 'more': {
      if (second === undefined) return { tab: 'more' };
      if (!isMorePage(second)) return LOG;
      if (third === undefined) return { tab: 'more', page: second };
      if (!MORE_WITH_ID.has(second)) return LOG;
      return { tab: 'more', page: second, id: decode(third) };
    }
    default:
      return LOG;
  }
}

/** The inverse of parseRoute: { tab: 'days', sessionId: 'abc' } → '#/days/abc'. */
export function routeHash(route: Route): string {
  switch (route.tab) {
    case 'log':
      return '#/log';
    case 'sync':
      return '#/sync';
    case 'days':
      return route.sessionId === undefined ? '#/days' : `#/days/${encodeURIComponent(route.sessionId)}`;
    case 'more': {
      if (route.page === undefined) return '#/more';
      const base = `#/more/${route.page}`;
      return route.id === undefined ? base : `${base}/${encodeURIComponent(route.id)}`;
    }
  }
}

/**
 * Where the app opens (spec 4 §3): Sync after the OAuth redirect; else Log while a session is
 * open (§4 Resume: a reload or an app update lands back on it); else the last route; else Sync
 * when there is neither local data nor a connection; else Log.
 */
export function startRoute(input: { afterOAuth: boolean; openSession: boolean; lastRoute: string | undefined; hasLocalData: boolean; connected: boolean }): Route {
  if (input.afterOAuth) return { tab: 'sync' };
  if (input.openSession) return LOG;
  if (input.lastRoute !== undefined) return parseRoute(input.lastRoute);
  if (!input.hasLocalData && !input.connected) return { tab: 'sync' };
  return LOG;
}

/** The slice of `window` the router needs, so tests can pass a plain object. */
export interface RouterWindow {
  location: { hash: string };
  addEventListener(type: 'hashchange', fn: () => void): void;
  removeEventListener(type: 'hashchange', fn: () => void): void;
  history: {
    replaceState(data: unknown, unused: string, url: string): void;
    pushState(data: unknown, unused: string, url: string): void;
  };
}

export class Router {
  readonly route: Signal<Route>;
  private readonly win: RouterWindow;
  private readonly onHashChange = (): void => {
    this.route.value = parseRoute(this.win.location.hash);
  };

  constructor(win: RouterWindow) {
    this.win = win;
    this.route = signal(parseRoute(win.location.hash));
    win.addEventListener('hashchange', this.onHashChange);
  }

  /** Writes the hash (pushState, or replaceState with `replace`) and updates the signal. */
  navigate(route: Route, opts?: { replace?: boolean }): void {
    const hash = routeHash(route);
    if (opts?.replace === true) this.win.history.replaceState(null, '', hash);
    else this.win.history.pushState(null, '', hash);
    this.route.value = route;
  }

  /** To the root of the current tab: '#/days/abc' → '#/days'. Already at a tab root: a no-op (no history entry). */
  back(): void {
    const root: Route = { tab: this.route.value.tab };
    if (routeHash(this.route.value) === routeHash(root)) return;
    this.navigate(root);
  }

  dispose(): void {
    this.win.removeEventListener('hashchange', this.onHashChange);
  }
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 42 test files and 705 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/format.test.ts src/ui/format.ts src/ui/router.test.ts src/ui/router.ts
git commit -m "Add display formatting and hash routing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Signals over the store (`src/ui/data.ts`)

The one bridge between screens and the sync library (§3 "Signals over the store"): a signal per slice, the derived signals as computeds, `Data.edit` / `Data.create` with the row version and one replay on a race, the shared clock, the toast and held-back helpers, the app context, and the lookup of read-only sessions (`locked.ts`).

**Files:**
- Create: `src/ui/context.ts`
- Create: `src/ui/data.test.ts`
- Create: `src/ui/data.ts`
- Create: `src/ui/held-back.test.ts`
- Create: `src/ui/held-back.ts`
- Create: `src/ui/locked.test.ts`
- Create: `src/ui/locked.ts`
- Create: `src/ui/toast.test.ts`
- Create: `src/ui/toast.ts`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/schema`, `src/model/types`, `src/model/validate`, `src/sync/channel`, `src/sync/engine`, `src/sync/merge`, `src/sync/paths`, `src/sync/store`, `src/ui/router`.
- Produces:
  - `src/ui/context.ts`:
    - `export interface SyncActions`
    - `export interface UiState`
    - `export interface AppDeps { data: Data; router: Router; sync: SyncActions; ui: UiState }`
    - `export const AppContext: Context<AppDeps | null> = createContext<AppDeps | null>(null)`
    - `export function useApp(): AppDeps`
  - `src/ui/data.ts`:
    - `export interface SessionRow { path: string; file: SessionFile; version: number }`
    - `export interface FileSlice<F> { file: F; version: number }`
    - `export interface SoftIssue { path: string; sessionId: string; date: string; issues: ValidationIssue[] }`
    - `export type WriteOutcome = { ok: true; heldBack: boolean } | { ok: false; reason: WriteRefusal | 'missing' }`
    - `export interface FileByKind { session: SessionFile; exercises: ExercisesFile; bodyweight: BodyweightFile }`
    - `export type FileOf<K extends FileKind> = FileByKind[K]`
    - `export interface DataDeps`
    - `export class Data`
    - `export function storeChanges(channel: Pick<ChangeChannel, 'post'> | undefined): { onChange(path: string): void; bind(data: Pick<Data, 'refresh'>): void }`
    - `export function sessionRowById(rows: readonly SessionRow[], id: string): SessionRow | undefined`
  - `src/ui/held-back.ts`:
    - `export function noteHeldBack(path: string): boolean`
  - `src/ui/locked.ts`:
    - `export interface LockedSession { row: FileRow; session: Session }`
    - `export function lockedSessionRows(rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): LockedSession[]`
    - `export function lockedSessionsOf(rows: readonly FileRow[], okSessionIds: ReadonlySet<string> = new Set()): Session[]`
  - `src/ui/toast.ts`:
    - `export interface Toast`
    - `export const toast: Signal<Toast | undefined> = signal<Toast | undefined>(undefined)`
    - `export function showToast(text: string, action?: { label: string; run: () => void }, ms = 4000): void`
    - `export function dismissToast(): void`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/data.test.ts`:

```ts
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile } from '../model/test-fixtures';
import type { Session, SessionFile } from '../model/types';
import type { ChangeChannel } from '../sync/channel';
import { openDb } from '../sync/db';
import type { SyncStatus } from '../sync/engine';
import { BODYWEIGHT_PATH, EXERCISES_PATH, sessionPath } from '../sync/paths';
import { Store, type FileRow, type WriteResult } from '../sync/store';
import { Data, sessionRowById, storeChanges, type DataDeps } from './data';

const NOW = new Date('2030-03-04T11:00:00.000Z');

const sA = session([block(ladder([5, 4]))], { id: 'a1b2c3d4-0000-4000-8000-000000000001', date: '2030-03-01' });
const sB = session([block(ladder([6]))], { id: 'a1b2c3d4-0000-4000-8000-000000000002', date: '2030-03-02' });
const sOpen = session([block(ladder([7]))], { id: 'a1b2c3d4-0000-4000-8000-000000000003', date: '2030-03-04', startedAt: '2030-03-04T10:00:00.000Z' });
const sGone = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000004', date: '2030-03-03', deletedAt: '2030-03-03T12:00:00.000Z' });
const pathOf = (s: Session) => sessionPath(s.date, s.id);

function okRow(s: Session, version = 1): FileRow {
  return { path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', issues: [], version };
}

const STATUS: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

class FakeEngine {
  status: SyncStatus = { ...STATUS };
  readonly listeners = new Set<(s: SyncStatus) => void>();
  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }
  emit(patch: Partial<SyncStatus>): void {
    Object.assign(this.status, patch);
    for (const l of this.listeners) l(this.status);
  }
}

class FakeChannel implements ChangeChannel {
  readonly listeners = new Set<(path: string) => void>();
  post(path: string): void {
    for (const l of this.listeners) l(path);
  }
  subscribe(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function makeStore(factory = new IDBFactory()): Promise<Store> {
  return new Store(await openDb(factory));
}

async function makeData(over: Partial<DataDeps> = {}): Promise<{ data: Data; store: Store; engine: FakeEngine; channel: FakeChannel }> {
  const store = over.store ?? (await makeStore());
  const engine = new FakeEngine();
  const channel = new FakeChannel();
  const data = new Data({ store, engine, channel, now: () => NOW, ...over });
  return { data, store, engine, channel };
}

describe('Data.load', () => {
  it('fills sessions (ok rows, not duplicates, with the row version), catalog and bodyweight', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA, 3));
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 2 });
    await store.saveRow({ path: BODYWEIGHT_PATH, kind: 'bodyweight', rev: 'r1', content: bodyweightFile([]), status: 'ok', issues: [], version: 5 });
    await data.load();
    expect(data.sessions.value).toEqual([{ path: pathOf(sA), file: sessionFile(sA), version: 3 }]);
    expect(data.catalog.value).toEqual({ file: exercisesFile([exercise()]), version: 2 });
    expect(data.bodyweight.value).toEqual({ file: bodyweightFile([]), version: 5 });
  });

  it('leaves catalog and bodyweight undefined when their rows are missing or not ok', async () => {
    const { data, store } = await makeData();
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: { schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await data.load();
    expect(data.catalog.value).toBeUndefined();
    expect(data.bodyweight.value).toBeUndefined();
  });

  it('collects refusedRows: a quarantined row and a duplicate', async () => {
    const { data, store } = await makeData();
    const bad: FileRow = { path: pathOf(sA), kind: 'session', rev: 'r1', content: { schemaVersion: 1 }, status: 'quarantined', issues: [{ level: 'schema', path: '/session', message: 'missing' }], version: 1 };
    const dup: FileRow = { ...okRow(sB), duplicateOf: pathOf(sA) };
    await store.saveRow(bad);
    await store.saveRow(dup);
    await store.saveRow(okRow(sOpen));
    await data.load();
    expect(data.refusedRows.value.map((r) => r.path).sort()).toEqual([bad.path, dup.path].sort());
    expect(data.sessions.value.map((r) => r.path)).toEqual([pathOf(sOpen)]);
  });

  it('reads issues from the store and status from the engine', async () => {
    const { data, store, engine } = await makeData();
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    engine.status.queueLength = 7;
    await data.load();
    expect(data.issues.value).toEqual(await store.issues());
    expect(data.issues.value.map((i) => i.reason)).toEqual(['duplicate']);
    expect(data.status.value.queueLength).toBe(7);
  });

  it('keeps status current through engine.subscribe and re-reads issues on each callback', async () => {
    const { data, store, engine } = await makeData();
    await data.load();
    expect(data.issues.value).toEqual([]);
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    engine.emit({ phase: 'pulling' });
    expect(data.status.value.phase).toBe('pulling');
    await vi.waitFor(() => expect(data.issues.value.map((i) => i.reason)).toEqual(['duplicate']));
  });

  it('has a disconnected default status without an engine', async () => {
    const store = await makeStore();
    const data = new Data({ store });
    await data.load();
    expect(data.status.value.connected).toBe(false);
    expect(data.status.value.phase).toBe('idle');
  });
});

describe('Data.refresh', () => {
  it('updates only the slice of that path', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 1 });
    await data.load();
    const catalogBefore = data.catalog.value;
    const bodyweightBefore = data.bodyweight.value;
    await store.saveRow(okRow(sB, 4));
    await data.refresh(pathOf(sB));
    expect(data.sessions.value.map((r) => [r.path, r.version])).toEqual([[pathOf(sA), 1], [pathOf(sB), 4]]);
    expect(data.catalog.value).toBe(catalogBefore);
    expect(data.bodyweight.value).toBe(bodyweightBefore);
  });

  it('replaces an existing session row in place and moves a row that turned refused', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA, 1));
    await data.load();
    await store.saveRow(okRow({ ...sA, notes: 'n' }, 2));
    await data.refresh(pathOf(sA));
    expect(data.sessions.value).toEqual([{ path: pathOf(sA), file: sessionFile({ ...sA, notes: 'n' }), version: 2 }]);
    await store.saveRow({ ...okRow(sA, 3), status: 'quarantined' });
    await data.refresh(pathOf(sA));
    expect(data.sessions.value).toEqual([]);
    expect(data.refusedRows.value.map((r) => r.path)).toEqual([pathOf(sA)]);
    await store.deleteRow(pathOf(sA));
    await data.refresh(pathOf(sA));
    expect(data.refusedRows.value).toEqual([]);
  });

  it('refreshes the catalog and bodyweight slices and the issues', async () => {
    const { data, store } = await makeData();
    await data.load();
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 1 });
    await data.refresh(EXERCISES_PATH);
    expect(data.catalog.value?.version).toBe(1);
    await store.saveRow({ path: BODYWEIGHT_PATH, kind: 'bodyweight', rev: 'r1', content: bodyweightFile([]), status: 'ok', issues: [], version: 1 });
    await data.refresh(BODYWEIGHT_PATH);
    expect(data.bodyweight.value?.version).toBe(1);
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sA) });
    await data.refresh(pathOf(sB));
    expect(data.issues.value.map((i) => i.reason)).toEqual(['duplicate']);
  });

  it('runs on a channel message from another tab', async () => {
    const { data, store, channel } = await makeData();
    await data.load();
    await store.saveRow(okRow(sA));
    channel.post(pathOf(sA));
    await vi.waitFor(() => expect(data.sessions.value.map((r) => r.path)).toEqual([pathOf(sA)]));
  });
});

describe('Data computed signals', () => {
  it('liveSessions sorts by compareSessions with tombstones out', async () => {
    const { data, store } = await makeData();
    for (const s of [sOpen, sGone, sB, sA]) await store.saveRow(okRow(s));
    await data.load();
    expect(data.liveSessions.value.map((s) => s.id)).toEqual([sA.id, sB.id, sOpen.id]);
  });

  it('exercises and exerciseById include tombstoned entries; [] without a catalog', async () => {
    const { data, store } = await makeData();
    await data.load();
    expect(data.exercises.value).toEqual([]);
    expect(data.exerciseById.value.size).toBe(0);
    const gone = exercise({ id: 'dips', name: 'Dips', pattern: 'push', deletedAt: '2030-01-02T00:00:00.000Z' });
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise(), gone]), status: 'ok', issues: [], version: 1 });
    await data.refresh(EXERCISES_PATH);
    expect(data.exercises.value.map((e) => e.id)).toEqual(['pull-ups', 'dips']);
    expect(data.exerciseById.value.get('dips')).toEqual(gone);
  });

  it('openSession is the one isSessionOpen names and closes when now passes 3 h', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await store.saveRow(okRow(sOpen, 2));
    await data.load();
    expect(data.openSession.value).toEqual({ path: pathOf(sOpen), file: sessionFile(sOpen), version: 2 });
    data.now.value = new Date('2030-03-04T13:00:00.000Z');
    expect(data.openSession.value).toBeUndefined();
  });

  it('softIssues runs checkCatalogRules per live session and is [] without a catalog', async () => {
    const { data, store } = await makeData();
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'a1b2c3d4-0000-4000-8000-000000000005', date: '2030-03-05' });
    await store.saveRow(okRow(sA));
    await store.saveRow(okRow(unknown));
    await store.saveRow(okRow({ ...sGone, blocks: [block([], { exerciseId: 'nope' })] }));
    await data.load();
    expect(data.softIssues.value).toEqual([]);
    await store.saveRow({ path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', content: exercisesFile([exercise()]), status: 'ok', issues: [], version: 1 });
    await data.refresh(EXERCISES_PATH);
    expect(data.softIssues.value).toEqual([
      { path: pathOf(unknown), sessionId: unknown.id, date: '2030-03-05', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise nope' }] },
    ]);
  });

  it('heldBackCount counts the queue rows that are held back', async () => {
    const { data, store } = await makeData();
    await store.writeFile('session', pathOf(sA), sessionFile({ ...sA, date: '2030-02-30' }), NOW);
    await store.writeFile('session', pathOf(sB), sessionFile(sB), NOW);
    await data.load();
    expect(data.heldBackCount.value).toBe(1);
    await store.writeFile('session', pathOf(sA), sessionFile(sA), NOW);
    await data.refresh(pathOf(sA));
    expect(data.heldBackCount.value).toBe(0);
  });
});

describe('Data.create', () => {
  it('writes a new file with expectedVersion 0', async () => {
    const { data, store } = await makeData();
    await data.load();
    expect(await data.create('session', pathOf(sA), sessionFile(sA))).toEqual({ ok: true, heldBack: false });
    expect((await store.getRow(pathOf(sA)))?.version).toBe(1);
  });

  it("returns 'changed' when the path already exists", async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await data.load();
    expect(await data.create('session', pathOf(sA), sessionFile(sA))).toEqual({ ok: false, reason: 'changed' });
  });
});

describe('Data.edit', () => {
  it('applies fn to the fresh content and writes with the row version', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA, 4));
    await data.load();
    const seen: SessionFile[] = [];
    const r = await data.edit('session', pathOf(sA), (f) => {
      seen.push(f);
      return sessionFile({ ...f.session, notes: 'edited' });
    });
    expect(r).toEqual({ ok: true, heldBack: false });
    expect(seen).toEqual([sessionFile(sA)]);
    const row = await store.getRow(pathOf(sA));
    expect(row?.version).toBe(5);
    expect((row?.content as SessionFile).session.notes).toBe('edited');
  });

  it('reports heldBack when the result fails validation; the store still saved it', async () => {
    const { data, store } = await makeData();
    await store.saveRow(okRow(sA));
    await data.load();
    const broken = (f: SessionFile): SessionFile => {
      const b = f.session.blocks[0];
      if (b === undefined) throw new Error('fixture');
      const s0 = b.sets[0];
      if (s0 === undefined) throw new Error('fixture');
      return sessionFile({ ...f.session, blocks: [{ ...b, sets: [{ ...s0, reps: -1 }, ...b.sets.slice(1)] }] });
    };
    expect(await data.edit('session', pathOf(sA), broken)).toEqual({ ok: true, heldBack: true });
    expect((await store.queue())[0]?.heldBack).toBeDefined();
    expect((await store.getRow(pathOf(sA)))?.version).toBe(2);
  });

  it("returns 'missing' only without a row (or a row of another kind); a refused row names its reason", async () => {
    const { data, store } = await makeData();
    const sQ = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000011', date: '2030-02-11' });
    const sR = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000012', date: '2030-02-12' });
    const sN = session([], { id: 'a1b2c3d4-0000-4000-8000-000000000013', date: '2030-02-13' });
    await store.saveRow({ ...okRow(sQ), status: 'quarantined' });
    await store.saveRow({ ...okRow(sR), status: 'read-only' });
    await store.saveRow({ ...okRow(sN), status: 'needs-update' });
    await store.saveRow({ ...okRow(sB), duplicateOf: pathOf(sQ) });
    await store.saveRow(okRow(sA));
    await data.load();
    const calls: string[] = [];
    const fn = (f: SessionFile) => { calls.push(f.session.id); return sessionFile({ ...f.session, notes: 'x' }); };
    expect(await data.edit('session', pathOf(sOpen), fn)).toEqual({ ok: false, reason: 'missing' });
    expect(await data.edit('session', pathOf(sQ), fn)).toEqual({ ok: false, reason: 'quarantined' });
    expect(await data.edit('session', pathOf(sR), fn)).toEqual({ ok: false, reason: 'read-only' });
    expect(await data.edit('session', pathOf(sN), fn)).toEqual({ ok: false, reason: 'needs-update' });
    expect(await data.edit('session', pathOf(sB), fn)).toEqual({ ok: false, reason: 'duplicate' });
    // The kind ties the file type: an exercises edit on a session path finds no exercises row.
    expect(await data.edit('exercises', pathOf(sA), (f) => ({ ...f, exercises: [] }))).toEqual({ ok: false, reason: 'missing' });
    expect(calls).toEqual([]);
    expect((await store.getRow(pathOf(sA)))?.version).toBe(1);
  });

  it('writes nothing when fn returns its input or a file with the same canonical JSON', async () => {
    const { data, store } = await makeData();
    await store.saveRow({ ...okRow(sA, 3), remoteDeleted: true });
    await data.load();
    const writes = vi.spyOn(store, 'writeFile');
    expect(await data.edit('session', pathOf(sA), (f) => f)).toEqual({ ok: true, heldBack: false });
    // A copy with the keys in another order is the same content.
    expect(await data.edit('session', pathOf(sA), (f) => ({ session: { ...f.session }, schemaVersion: f.schemaVersion }))).toEqual({ ok: true, heldBack: false });
    expect(writes).not.toHaveBeenCalled();
    expect((await store.getRow(pathOf(sA)))?.version).toBe(3);
    expect(await store.queue()).toEqual([]);
  });

  /** A store where another writer (a pull merging the PC's change) lands between Data.edit's read
   *  and its write, for the first `races` writes: the write then meets a moved version for real. */
  class RacyStore extends Store {
    writes = 0;
    constructor(db: ConstructorParameters<typeof Store>[0], private readonly races: number) {
      super(db);
    }
    override async writeFile(...args: Parameters<Store['writeFile']>): Promise<WriteResult> {
      this.writes += 1;
      if (this.writes <= this.races) {
        const row = await this.getRow(args[1]);
        if (row === undefined) throw new Error('fixture');
        const file = row.content as SessionFile;
        await this.saveRow({ ...row, content: sessionFile({ ...file.session, tags: [...file.session.tags, `pc ${this.writes}`] }), version: row.version + 1 });
      }
      return super.writeFile(...args);
    }
  }

  it("replays fn once on 'changed' on the fresh row, so the other writer's change is kept", async () => {
    const store = new RacyStore(await openDb(new IDBFactory()), 1);
    const { data } = await makeData({ store });
    await store.saveRow(okRow(sA));
    await data.load();
    let calls = 0;
    const r = await data.edit('session', pathOf(sA), (f) => {
      calls += 1;
      return sessionFile({ ...f.session, notes: `try ${calls}` });
    });
    expect(r).toEqual({ ok: true, heldBack: false });
    expect(calls).toBe(2);
    expect(store.writes).toBe(2);
    const row = await store.getRow(pathOf(sA));
    expect(row?.content).toEqual(sessionFile({ ...sA, tags: ['pc 1'], notes: 'try 2' }));
    expect(row?.version).toBe(3);
  });

  it("gives up with 'changed' after a second 'changed' in a row and writes nothing of its own", async () => {
    const store = new RacyStore(await openDb(new IDBFactory()), 2);
    const { data } = await makeData({ store });
    await store.saveRow(okRow(sA));
    await data.load();
    let calls = 0;
    const r = await data.edit('session', pathOf(sA), (f) => { calls += 1; return sessionFile({ ...f.session, notes: 'mine' }); });
    expect(r).toEqual({ ok: false, reason: 'changed' });
    expect(calls).toBe(2);
    const session2 = ((await store.getRow(pathOf(sA)))?.content as SessionFile).session;
    expect(session2.tags).toEqual(['pc 1', 'pc 2']);
    expect(session2.notes).toBeUndefined();
  });
});

describe('Data.retryLeftMs', () => {
  it('counts the engine retry down from the time its status arrived, floored at 0', async () => {
    let current = NOW;
    const { data, engine } = await makeData({ now: () => current });
    await data.load();
    expect(data.retryLeftMs.value).toBeUndefined();
    engine.emit({ retryInMs: 10_000 });
    expect(data.retryLeftMs.value).toBe(10_000);
    current = new Date(NOW.getTime() + 4_000);
    data.now.value = current;
    expect(data.retryLeftMs.value).toBe(6_000);
    current = new Date(NOW.getTime() + 15_000);
    data.now.value = current;
    expect(data.retryLeftMs.value).toBe(0);
    engine.emit({ retryInMs: 2_000 });
    expect(data.retryLeftMs.value).toBe(2_000);
    engine.emit({ retryInMs: undefined });
    expect(data.retryLeftMs.value).toBeUndefined();
  });
});

describe('storeChanges', () => {
  it("delivers the store's onChange to this tab's Data and posts it to the other tabs", async () => {
    const channel = new FakeChannel();
    const posted: string[] = [];
    channel.subscribe((p) => posted.push(p));
    const changes = storeChanges(channel);
    const store = new Store(await openDb(new IDBFactory()), { onChange: changes.onChange });
    // A change before Data exists only goes to the channel.
    await store.writeFile('session', pathOf(sB), sessionFile(sB), NOW);
    const data = new Data({ store, now: () => NOW });
    changes.bind(data);
    await data.load();
    expect(data.sessions.value.map((r) => r.path)).toEqual([pathOf(sB)]);
    // No manual refresh: the store's own event updates the signals.
    await store.writeFile('session', pathOf(sA), sessionFile(sA), NOW);
    await vi.waitFor(() => expect(data.sessions.value.map((r) => r.path).sort()).toEqual([pathOf(sA), pathOf(sB)].sort()));
    expect(posted).toEqual([pathOf(sB), pathOf(sA)]);
  });
});

describe('Data meta, clock and dispose', () => {
  it('getMeta and setMeta go to the store meta', async () => {
    const { data, store } = await makeData();
    expect(await data.getMeta<string>('daysChip')).toBeUndefined();
    await data.setMeta('daysChip', 'push');
    expect(await data.getMeta<string>('daysChip')).toBe('push');
    expect(await store.getMeta<string>('daysChip')).toBe('push');
  });

  it('clock() reads the injected clock afresh on every call, without waiting for the now tick', async () => {
    let current = NOW;
    const { data } = await makeData({ now: () => current });
    expect(data.clock()).toEqual(NOW);
    current = new Date('2030-03-04T11:00:42.000Z');
    expect(data.clock()).toEqual(current);
    expect(data.now.value).toEqual(NOW);
  });

  it('setClock uses the injected interval: fast 1000, slow 60000, off clears', async () => {
    const intervals: { fn: () => void; ms: number; id: number }[] = [];
    const cleared: unknown[] = [];
    let nextId = 1;
    let current = NOW;
    const { data } = await makeData({
      now: () => current,
      setInterval: (fn, ms) => { const id = nextId++; intervals.push({ fn, ms, id }); return id; },
      clearInterval: (id) => cleared.push(id),
    });
    data.setClock('fast');
    expect(intervals.map((i) => i.ms)).toEqual([1000]);
    current = new Date('2030-03-04T11:00:01.000Z');
    intervals[0]?.fn();
    expect(data.now.value).toEqual(current);
    data.setClock('slow');
    expect(cleared).toEqual([1]);
    expect(intervals.map((i) => i.ms)).toEqual([1000, 60000]);
    data.setClock('off');
    expect(cleared).toEqual([1, 2]);
    data.setClock('off');
    expect(cleared).toEqual([1, 2]);
  });

  it('dispose clears the interval and unsubscribes from engine and channel', async () => {
    const cleared: unknown[] = [];
    const { data, engine, channel } = await makeData({ setInterval: () => 'tick', clearInterval: (id) => cleared.push(id) });
    await data.load();
    expect(engine.listeners.size).toBe(1);
    expect(channel.listeners.size).toBe(1);
    data.setClock('fast');
    data.dispose();
    expect(cleared).toEqual(['tick']);
    expect(engine.listeners.size).toBe(0);
    expect(channel.listeners.size).toBe(0);
    engine.emit({ phase: 'pushing' });
    expect(data.status.value.phase).toBe('idle');
  });
});

describe('sessionRowById', () => {
  it('finds a row by session id', () => {
    const rows = [{ path: pathOf(sA), file: sessionFile(sA), version: 1 }, { path: pathOf(sB), file: sessionFile(sB), version: 1 }];
    expect(sessionRowById(rows, sB.id)?.path).toBe(pathOf(sB));
    expect(sessionRowById(rows, 'nope')).toBeUndefined();
  });
});
```

Create `src/ui/held-back.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { noteHeldBack } from './held-back';

describe('noteHeldBack', () => {
  it('is true the first time per path, false after, independent per path', () => {
    expect(noteHeldBack('sessions/2030/2030-03-04-a.json')).toBe(true);
    expect(noteHeldBack('sessions/2030/2030-03-04-a.json')).toBe(false);
    expect(noteHeldBack('sessions/2030/2030-03-05-b.json')).toBe(true);
  });
});
```

Create `src/ui/locked.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, ladder, session, sessionFile } from '../model/test-fixtures';
import type { FileRow } from '../sync/store';
import { lockedSessionRows, lockedSessionsOf } from './locked';

const row = (content: unknown, over: Partial<FileRow> = {}): FileRow => ({
  path: '/sessions/2030/2030-03-04_00000000.json', kind: 'session', rev: 'r1', content, status: 'quarantined', issues: [], version: 1, ...over,
});

describe('lockedSessionsOf', () => {
  it('takes the session of refused session rows whose content parses as a session', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    expect(lockedSessionsOf([row(sessionFile(s))])).toEqual([s]);
  });

  it('skips rows of other kinds and content that is not a session', () => {
    expect(lockedSessionsOf([
      row({ schemaVersion: 1 }),
      row({ session: 'nope' }),
      row({ session: { id: 'x', date: '2030-03-04' } }),
      row({ session: { id: 'x', date: '2030-03-04', blocks: 'no' } }),
      row({ session: { id: 'x', date: '2030-03-04', tags: [], blocks: [{ id: 'b', exerciseId: 'dips' }] } }),
      row(null),
      row({ schemaVersion: 1, exercises: [] }, { kind: 'exercises', path: '/exercises.json' }),
    ])).toEqual([]);
  });

  it('skips a session the page could not render: tags missing, or a set without a numeric amount', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const { tags: _tags, ...noTags } = s;
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noTags })])).toEqual([]);
    const noAmount = { ...s, blocks: [{ ...s.blocks[0], sets: [{ id: 'x', order: 0 }] }] };
    expect(lockedSessionsOf([row({ schemaVersion: 1, session: noAmount })])).toEqual([]);
  });

  it('checks the lenient session schema: a wrong label, a non-string tag or a bad load type keeps the file off the list', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const file = sessionFile(s);
    const b0 = s.blocks[0];
    const set0 = b0?.sets[0];
    if (b0 === undefined || set0 === undefined) throw new Error('fixture');
    for (const bad of [
      { ...s, label: 5 },
      { ...s, label: null },
      { ...s, label: 'Push' },
      { ...s, tags: ['ok', 7] },
      { ...s, notes: { text: 'x' } },
      { ...s, blocks: [{ ...b0, sets: [{ ...set0, loadType: 'chains' }] }] },
    ]) {
      expect(lockedSessionsOf([row({ ...file, session: bad })])).toEqual([]);
    }
  });

  it('lists a file a newer app wrote (unknown fields, newer schemaVersion) and one that fails only a hard rule', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const newer = { schemaVersion: 99, session: { ...s, mood: 'good' } };
    expect(lockedSessionsOf([row(newer, { status: 'needs-update' })])).toEqual([newer.session]);
    // 30 February matches the date pattern; only the hard rules refuse it (display does not care).
    const hard = sessionFile({ ...s, date: '2030-02-30' });
    expect(lockedSessionsOf([row(hard)])).toEqual([hard.session]);
  });

  it('leaves out the loser of a duplicate pair: spec 3 §6 hides it from views, its content is merged into the ok twin', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const loser = row(sessionFile(s), { status: 'ok', duplicateOf: '/sessions/2030/2030-03-04_aaaaaaaa.json', path: '/sessions/2030/2030-03-04_bbbbbbbb.json' });
    expect(lockedSessionsOf([loser], new Set([s.id]))).toEqual([]);
    // Even before the twin's row is known: a duplicate is never listed on its own.
    expect(lockedSessionsOf([loser])).toEqual([]);
  });

  it('leaves out a refused session whose id an ok session or an earlier refused row already holds (the route could not reach it)', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const first = row(sessionFile(s), { status: 'needs-update', path: '/sessions/2030/2030-03-04_first.json' });
    const second = row(sessionFile(s), { status: 'quarantined', path: '/sessions/2030/2030-03-04_second.json' });
    expect(lockedSessionsOf([first], new Set([s.id]))).toEqual([]);
    expect(lockedSessionRows([first, second], new Set())).toEqual([{ row: first, session: s }]);
  });
});

describe('lockedSessionRows', () => {
  it('pairs each listed session with its row, so the session page reads the same row and its reason', () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    const r: FileRow = { path: '/sessions/2030/2030-03-04_x.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'read-only', issues: [], version: 1 };
    expect(lockedSessionRows([r], new Set())).toEqual([{ row: r, session: s }]);
  });
});
```

Create `src/ui/toast.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissToast, showToast, toast } from './toast';

describe('toast', () => {
  beforeEach(() => dismissToast());

  it('showToast sets the signal with the default 4000 ms', () => {
    showToast('Saved');
    expect(toast.value).toEqual({ text: 'Saved', ms: 4000 });
  });

  it('carries an action and a custom duration', () => {
    const run = () => undefined;
    showToast('Set deleted', { label: 'Undo', run }, 6000);
    expect(toast.value).toEqual({ text: 'Set deleted', action: { label: 'Undo', run }, ms: 6000 });
  });

  it('dismissToast clears it', () => {
    showToast('Saved');
    dismissToast();
    expect(toast.value).toBeUndefined();
  });

  it('a second showToast replaces the first', () => {
    showToast('first');
    showToast('second');
    expect(toast.value?.text).toBe('second');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/data.test.ts src/ui/held-back.test.ts src/ui/locked.test.ts src/ui/toast.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/data.test.ts: Error: Cannot find module './data' imported from src/ui/data.test.ts
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/context.ts`:

```ts
import { createContext, type Context } from 'preact';
import { useContext } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { EmptyFolderChoice } from '../sync/engine';
import type { Data } from './data';
import type { Router } from './router';

/** The shell's actions (spec 3 §12) plus the Update states (spec 4 §7). */
export interface SyncActions {
  connect(): void;
  startPaste(): void;
  submitCode(code: string): void;
  syncNow(): void;
  chooseEmptyFolder(choice: EmptyFolderChoice): void;
  updateApp(): Promise<'reloading' | 'busy'>;
  signOut(): void;
}

/** The pieces of ShellModel that are not in Data. */
export interface UiState {
  connected: Signal<boolean>;
  loginError: Signal<string | undefined>;
  homeScreenHint: boolean;
  pasteMode: Signal<boolean>;
  pasteUrl: Signal<string | undefined>;
  persisted: Signal<boolean | undefined>;
  updateAvailable: Signal<boolean>;
  buildId: string;
}

export interface AppDeps { data: Data; router: Router; sync: SyncActions; ui: UiState }

export const AppContext: Context<AppDeps | null> = createContext<AppDeps | null>(null);

/** Throws outside the provider: every screen is rendered under `<AppContext.Provider>`. */
export function useApp(): AppDeps {
  const deps = useContext(AppContext);
  if (deps === null) throw new Error('useApp() called outside AppContext.Provider');
  return deps;
}
```

Create `src/ui/data.ts`:

```ts
import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { isSessionOpen, sortSessions } from '../model/derive';
import type { BodyweightFile, Exercise, ExercisesFile, FileKind, Session, SessionFile } from '../model/types';
import { checkCatalogRules, type ValidationIssue } from '../model/validate';
import type { ChangeChannel } from '../sync/channel';
import type { SyncStatus } from '../sync/engine';
import { canonicalJson } from '../sync/merge';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../sync/paths';
import type { FileRow, Issue, QueueRow, Store, WriteRefusal, WriteResult } from '../sync/store';

/** Spec 4 §3 "Signals over the store": one signal per slice, everything derived is a computed. */

export interface SessionRow { path: string; file: SessionFile; version: number }
export interface FileSlice<F> { file: F; version: number }
export interface SoftIssue { path: string; sessionId: string; date: string; issues: ValidationIssue[] }
export type WriteOutcome = { ok: true; heldBack: boolean } | { ok: false; reason: WriteRefusal | 'missing' };

/** The file type of each kind, so `Data.edit` ties the function's file type to the kind it writes. */
export interface FileByKind { session: SessionFile; exercises: ExercisesFile; bodyweight: BodyweightFile }
export type FileOf<K extends FileKind> = FileByKind[K];

export interface DataDeps {
  store: Store;
  engine?: { status: SyncStatus; subscribe(fn: (s: SyncStatus) => void): () => void };
  channel?: ChangeChannel;
  now?: () => Date;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

const FAST_MS = 1000;
const SLOW_MS = 60000;

/** Before the engine reports: nothing known, not connected. */
const NO_STATUS: SyncStatus = { phase: 'idle', online: true, connected: false, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

function isReadable(row: FileRow): boolean {
  return row.status === 'ok' && row.duplicateOf === undefined;
}

/** Why the store would refuse a write to this row (its own guard, spec 3 §5), or undefined for an ok row. */
function refusalOf(row: FileRow): WriteRefusal | undefined {
  if (row.duplicateOf !== undefined) return 'duplicate';
  return row.status === 'ok' ? undefined : row.status;
}

function outcomeOf(result: WriteResult): WriteOutcome {
  return result.ok ? { ok: true, heldBack: result.heldBack !== undefined } : result;
}

export class Data {
  readonly sessions: Signal<SessionRow[]> = signal<SessionRow[]>([]);
  readonly catalog: Signal<FileSlice<ExercisesFile> | undefined> = signal<FileSlice<ExercisesFile> | undefined>(undefined);
  readonly bodyweight: Signal<FileSlice<BodyweightFile> | undefined> = signal<FileSlice<BodyweightFile> | undefined>(undefined);
  /** status != ok or duplicateOf set. Screens list the read-only sessions through `lockedSessionRows` (src/ui/locked.ts), which leaves duplicates out (spec 4 §5). */
  readonly refusedRows: Signal<FileRow[]> = signal<FileRow[]>([]);
  readonly status: Signal<SyncStatus>;
  /** The engine's retry delay counted down against `now` from the moment its status arrived; floored at 0, undefined without a retry. */
  readonly retryLeftMs: ReadonlySignal<number | undefined>;
  readonly issues: Signal<Issue[]> = signal<Issue[]>([]);
  readonly now: Signal<Date>;
  readonly liveSessions: ReadonlySignal<Session[]>;
  readonly exercises: ReadonlySignal<Exercise[]>;
  readonly exerciseById: ReadonlySignal<Map<string, Exercise>>;
  readonly openSession: ReadonlySignal<SessionRow | undefined>;
  readonly softIssues: ReadonlySignal<SoftIssue[]>;
  readonly heldBackCount: ReadonlySignal<number>;

  private readonly queue: Signal<QueueRow[]> = signal<QueueRow[]>([]);
  /** `clock()` when the current status arrived: `retryInMs` is relative to it. */
  private readonly statusAt: Signal<Date>;
  private readonly store: Store;
  private readonly engine: DataDeps['engine'];
  private readonly channel: ChangeChannel | undefined;
  /** The current time from the injected clock, read afresh on every call (the `now` signal only ticks).
   *  Screens take "now" for edits and defaults from here so tests control it in one place. */
  readonly clock: () => Date;
  private readonly startInterval: (fn: () => void, ms: number) => unknown;
  private readonly stopInterval: (id: unknown) => void;
  private intervalId: unknown;
  private unsubscribers: (() => void)[] = [];

  constructor(deps: DataDeps) {
    this.store = deps.store;
    this.engine = deps.engine;
    this.channel = deps.channel;
    this.clock = deps.now ?? (() => new Date());
    this.startInterval = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.stopInterval = deps.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
    this.status = signal<SyncStatus>({ ...(deps.engine?.status ?? NO_STATUS) });
    this.now = signal<Date>(this.clock());
    this.statusAt = signal<Date>(this.now.value);

    this.retryLeftMs = computed(() => {
      const retry = this.status.value.retryInMs;
      if (retry === undefined) return undefined;
      // `now` ticks at most once a second and may lag the status's arrival: no negative elapsed time.
      const elapsed = Math.max(0, this.now.value.getTime() - this.statusAt.value.getTime());
      return Math.max(0, retry - elapsed);
    });
    this.liveSessions = computed(() => sortSessions(this.sessions.value.map((r) => r.file.session)));
    this.exercises = computed(() => this.catalog.value?.file.exercises ?? []);
    this.exerciseById = computed(() => new Map(this.exercises.value.map((e) => [e.id, e])));
    this.openSession = computed(() => {
      const all = this.liveSessions.value;
      const now = this.now.value;
      return this.sessions.value.find((r) => isSessionOpen(r.file.session, all, now));
    });
    this.softIssues = computed(() => {
      if (this.catalog.value === undefined) return [];
      const catalog = this.exercises.value;
      const out: SoftIssue[] = [];
      for (const row of this.sessions.value) {
        const s = row.file.session;
        if (s.deletedAt !== undefined) continue;
        const issues = checkCatalogRules(s, catalog);
        if (issues.length > 0) out.push({ path: row.path, sessionId: s.id, date: s.date, issues });
      }
      return out;
    });
    this.heldBackCount = computed(() => this.queue.value.filter((q) => q.heldBack !== undefined).length);
  }

  /** Initial load of every slice; call once. Also subscribes to engine status and channel. */
  async load(): Promise<void> {
    const rows = await this.store.rows();
    const sessions: SessionRow[] = [];
    const refused: FileRow[] = [];
    let catalog: FileSlice<ExercisesFile> | undefined;
    let bodyweight: FileSlice<BodyweightFile> | undefined;
    for (const row of rows) {
      if (!isReadable(row)) {
        refused.push(row);
        continue;
      }
      if (row.path === EXERCISES_PATH) catalog = { file: row.content as ExercisesFile, version: row.version };
      else if (row.path === BODYWEIGHT_PATH) bodyweight = { file: row.content as BodyweightFile, version: row.version };
      else if (row.kind === 'session') sessions.push({ path: row.path, file: row.content as SessionFile, version: row.version });
    }
    this.sessions.value = sessions;
    this.refusedRows.value = refused;
    this.catalog.value = catalog;
    this.bodyweight.value = bodyweight;
    this.queue.value = await this.store.queue();
    this.issues.value = await this.store.issues();

    if (this.engine !== undefined) {
      this.unsubscribers.push(
        this.engine.subscribe((s) => {
          // The engine mutates one status object; copy it so the signal sees a change. The retry
          // countdown starts from this moment (one batch, one re-render).
          batch(() => {
            this.statusAt.value = this.clock();
            this.status.value = { ...s };
          });
          void this.reloadIssues();
        }),
      );
    }
    if (this.channel !== undefined) {
      this.unsubscribers.push(this.channel.subscribe((path) => void this.refresh(path)));
    }
  }

  /** Reload one path (the store's onChange and the channel call this). */
  async refresh(path: string): Promise<void> {
    const row = await this.store.getRow(path);
    const readable = row !== undefined && isReadable(row);
    if (path === EXERCISES_PATH) {
      this.catalog.value = readable ? { file: row.content as ExercisesFile, version: row.version } : undefined;
    } else if (path === BODYWEIGHT_PATH) {
      this.bodyweight.value = readable ? { file: row.content as BodyweightFile, version: row.version } : undefined;
    } else {
      const others = this.sessions.value.filter((r) => r.path !== path);
      this.sessions.value = readable && row.kind === 'session' ? [...others, { path, file: row.content as SessionFile, version: row.version }] : others;
    }
    const refusedOthers = this.refusedRows.value.filter((r) => r.path !== path);
    this.refusedRows.value = row !== undefined && !readable ? [...refusedOthers, row] : refusedOthers;
    this.queue.value = await this.store.queue();
    this.issues.value = await this.store.issues();
  }

  /** Create a file that does not exist yet (expectedVersion 0). */
  async create(kind: FileKind, path: string, file: unknown): Promise<WriteOutcome> {
    return outcomeOf(await this.store.writeFile(kind, path, file, this.clock(), 0));
  }

  /**
   * Read the fresh row, apply `fn`, write with that row's version; on 'changed' read again and replay
   * once. 'missing' when there is no row of that kind at the path; a refused row returns the store's
   * reason (spec 4 §9: the toast names it). A result with the same content (the very object, or the
   * same canonical JSON) writes nothing, so an edit that changes nothing never re-uploads a file.
   */
  async edit<K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> {
    const first = await this.attempt(kind, path, fn);
    if (first !== 'changed') return first;
    const second = await this.attempt(kind, path, fn);
    return second === 'changed' ? { ok: false, reason: 'changed' } : second;
  }

  private async attempt<K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome | 'changed'> {
    const row = await this.store.getRow(path);
    if (row === undefined || row.kind !== kind) return { ok: false, reason: 'missing' };
    const refusal = refusalOf(row);
    if (refusal !== undefined) return { ok: false, reason: refusal };
    // An ok row of this kind holds an upgraded file of that kind (spec 3 §5).
    const current = row.content as FileOf<K>;
    const next = fn(current);
    if (next === current || canonicalJson(next) === canonicalJson(current)) return { ok: true, heldBack: false };
    const result = await this.store.writeFile(kind, path, next, this.clock(), row.version);
    if (!result.ok && result.reason === 'changed') return 'changed';
    return outcomeOf(result);
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.store.getMeta<T>(key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.store.setMeta(key, value);
  }

  /** The `now` tick: 1000 ms when fast, else 60000 ms. */
  setClock(mode: 'fast' | 'slow' | 'off'): void {
    if (this.intervalId !== undefined) {
      this.stopInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (mode === 'off') return;
    this.intervalId = this.startInterval(() => {
      this.now.value = this.clock();
    }, mode === 'fast' ? FAST_MS : SLOW_MS);
  }

  dispose(): void {
    this.setClock('off');
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  private async reloadIssues(): Promise<void> {
    this.queue.value = await this.store.queue();
    this.issues.value = await this.store.issues();
  }
}

/**
 * Spec 4 §3: where the store's `onChange` goes. Other tabs hear it through the channel, which never
 * delivers to the posting tab, so this tab's Data refreshes directly. The store is built before Data,
 * so Data binds late; a change before `bind` only reaches the channel (`Data.load` reads everything).
 */
export function storeChanges(channel: Pick<ChangeChannel, 'post'> | undefined): { onChange(path: string): void; bind(data: Pick<Data, 'refresh'>): void } {
  let bound: Pick<Data, 'refresh'> | undefined;
  return {
    onChange(path) {
      channel?.post(path);
      void bound?.refresh(path);
    },
    bind(data) {
      bound = data;
    },
  };
}

export function sessionRowById(rows: readonly SessionRow[], id: string): SessionRow | undefined {
  return rows.find((r) => r.file.session.id === id);
}
```

Create `src/ui/held-back.ts`:

```ts
/** Spec 4 §9: the "Saved here, not uploaded (app bug)" toast shows once per path per app run. */
const noted = new Set<string>();

/** True the first time a path is held back; false after. */
export function noteHeldBack(path: string): boolean {
  if (noted.has(path)) return false;
  noted.add(path);
  return true;
}
```

Create `src/ui/locked.ts`:

```ts
import { Value } from '@sinclair/typebox/value';
import { Lenient } from '../model/schema';
import type { Session } from '../model/types';
import type { FileRow } from '../sync/store';

/**
 * Spec 4 §5: sessions on refused rows, shown read-only. One module for the Days list and the session
 * page, so the list and the page agree on which file an id opens.
 */

/**
 * The lenient session-file schema (unknown properties ignored, any schemaVersion from 1), so every
 * field the views read has its declared type: a label is one of the five, tags are strings, a load
 * type is known. Hard-rule failures (a 30 February, duplicate ids) do not matter for display; a file
 * that fails this check stays off the Days list and shows on the Sync tab only.
 */
function sessionOf(content: unknown): Session | undefined {
  // The lenient type differs from Session only by the unknown fields it allows, which no view reads.
  return Value.Check(Lenient.SessionFile, content) ? (content.session as Session) : undefined;
}

export interface LockedSession { row: FileRow; session: Session }

/**
 * Spec 4 §5: refused session rows (read-only, needs-update, quarantined) whose content passes the
 * lenient session-file schema, with their row (the session page names `row.status` in its banner).
 *
 * Left out, because the route `#/days/<sessionId>` could never open them read-only:
 * - the loser of a duplicate pair (`duplicateOf`): spec 3 §6 hides it from views; the engine merged
 *   its content into the ok twin at the path that sorts first, and the Sync tab lists it as "Duplicate file";
 * - a session whose id `okSessionIds` (every ok session row, tombstoned ones too) or an earlier refused
 *   row already holds; the session page resolves `data.sessions` first, then this list in order.
 */
export function lockedSessionRows(rows: readonly FileRow[], okSessionIds: ReadonlySet<string>): LockedSession[] {
  const out: LockedSession[] = [];
  const taken = new Set(okSessionIds);
  for (const row of rows) {
    if (row.kind !== 'session' || row.duplicateOf !== undefined) continue;
    const s = sessionOf(row.content);
    if (s === undefined || taken.has(s.id)) continue;
    taken.add(s.id);
    out.push({ row, session: s });
  }
  return out;
}

/** The sessions of `lockedSessionRows`, for the Days list. */
export function lockedSessionsOf(rows: readonly FileRow[], okSessionIds: ReadonlySet<string> = new Set()): Session[] {
  return lockedSessionRows(rows, okSessionIds).map((l) => l.session);
}
```

Create `src/ui/toast.ts`:

```ts
import { signal, type Signal } from '@preact/signals';

/** Spec 4 §4, §9: one toast at a time; a new one replaces the current. */
export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
  ms: number;
}

export const toast: Signal<Toast | undefined> = signal<Toast | undefined>(undefined);

/** Default 4000 ms; undo callers pass 6000. */
export function showToast(text: string, action?: { label: string; run: () => void }, ms = 4000): void {
  toast.value = { text, ms, ...(action !== undefined ? { action } : {}) };
}

export function dismissToast(): void {
  toast.value = undefined;
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 46 test files and 748 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/context.ts src/ui/data.test.ts src/ui/data.ts src/ui/held-back.test.ts src/ui/held-back.ts src/ui/locked.test.ts src/ui/locked.ts src/ui/toast.test.ts src/ui/toast.ts
git commit -m "Add the signals layer over the store and the engine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Shared components

The building blocks every tab uses: bottom sheet, stepper, number pad, set chips, indicator marks, toast host, button, back bar, plus the shared component-test harness. Their styles append to `theme.css` (tokens only).

**Files:**
- Create: `src/ui/clock.test.ts`
- Create: `src/ui/components/shared/BackBar.test.tsx`
- Create: `src/ui/components/shared/BackBar.tsx`
- Create: `src/ui/components/shared/Button.test.tsx`
- Create: `src/ui/components/shared/Button.tsx`
- Create: `src/ui/components/shared/Marks.test.tsx`
- Create: `src/ui/components/shared/Marks.tsx`
- Create: `src/ui/components/shared/NumberPad.test.tsx`
- Create: `src/ui/components/shared/NumberPad.tsx`
- Create: `src/ui/components/shared/SetChips.test.tsx`
- Create: `src/ui/components/shared/SetChips.tsx`
- Create: `src/ui/components/shared/Sheet.test.tsx`
- Create: `src/ui/components/shared/Sheet.tsx`
- Create: `src/ui/components/shared/Stepper.test.tsx`
- Create: `src/ui/components/shared/Stepper.tsx`
- Create: `src/ui/components/shared/ToastHost.test.tsx`
- Create: `src/ui/components/shared/ToastHost.tsx`
- Create: `src/ui/components/shared/index.ts`
- Create: `src/ui/test-harness.tsx`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/types`, `src/ui/format`, `src/ui/toast`.
- Produces:
  - `src/ui/components/shared/BackBar.tsx`:
    - `export function BackBar(p: { title: string; onBack(): void; right?: ComponentChildren }): JSX.Element`
  - `src/ui/components/shared/Button.tsx`:
    - `export function Button(p:`
  - `src/ui/components/shared/Marks.tsx`:
    - `export function Marks(p: { amount: AmountIndicator; load?: LoadIndicator; provisional?: boolean }): JSX.Element`
  - `src/ui/components/shared/NumberPad.tsx`:
    - `export function NumberPad(p:`
  - `src/ui/components/shared/SetChips.tsx`:
    - `export function SetChips(p:`
  - `src/ui/components/shared/Sheet.tsx`:
    - `export const SWIPE_CLOSE_PX = 80`
    - `export function Sheet(p: { title: string; onClose(): void; children: ComponentChildren }): JSX.Element`
  - `src/ui/components/shared/Stepper.tsx`:
    - `export function Stepper(p:`
  - `src/ui/components/shared/ToastHost.tsx`:
    - `export function ToastHost(): JSX.Element`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/clock.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One clock: every write in the screens takes its time from `data.clock()`, which
 * tests control through `DataDeps.now`. A bare `new Date()` in a component would be a second clock.
 */
const COMPONENTS_DIR = join(import.meta.dirname, 'components');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('one clock', () => {
  it("no 'new Date()' in src/ui/components outside tests", () => {
    const offenders = walk(COMPONENTS_DIR)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /new Date\(\s*\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(COMPONENTS_DIR, f));
    expect(offenders).toEqual([]);
  });
});
```

Create `src/ui/components/shared/BackBar.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { BackBar } from './BackBar';

describe('BackBar', () => {
  it('renders the back button, the title and the right slot', () => {
    const onBack = vi.fn();
    render(<BackBar title="Session" onBack={onBack} right={<span>right</span>} />);
    expect(screen.getByRole('heading').textContent).toBe('Session');
    expect(screen.getByText('right')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/ui/components/shared/Button.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('maps kind to a class, defaults to secondary, honours disabled and ariaLabel', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button kind="primary" onClick={onClick}>Add</Button>
        <Button onClick={onClick}>Plain</Button>
        <Button kind="danger" disabled onClick={onClick} ariaLabel="Delete set">x</Button>
      </>,
    );
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add.className).toBe('btn btn--primary');
    expect(screen.getByRole('button', { name: 'Plain' }).className).toBe('btn btn--secondary');
    const del = screen.getByRole('button', { name: 'Delete set' });
    expect(del.className).toBe('btn btn--danger');
    expect((del as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/ui/components/shared/Marks.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { Marks } from './Marks';

const glyphs = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.marks__glyph'));

describe('Marks', () => {
  it('renders the amount glyph then the load glyph with labels', () => {
    render(<Marks amount="up" load="incomparable" />);
    const g = glyphs();
    expect(g.map((e) => e.textContent)).toEqual(['↑', '≠']);
    expect(g.map((e) => e.getAttribute('aria-label'))).toEqual(['more', 'not comparable']);
    expect(document.querySelector('.marks')?.classList.contains('is-provisional')).toBe(false);
  });

  it('omits a hidden or missing load glyph and dims provisional marks', () => {
    const { rerender } = render(<Marks amount="down" load="hidden" provisional />);
    expect(glyphs().map((e) => e.textContent)).toEqual(['↓']);
    expect(document.querySelector('.marks')?.classList.contains('is-provisional')).toBe(true);
    rerender(<Marks amount="none" />);
    expect(glyphs().map((e) => e.textContent)).toEqual(['–']);
    expect(glyphs()[0]?.getAttribute('aria-label')).toBe('no comparison');
  });
});
```

Create `src/ui/components/shared/NumberPad.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../format';
import { NumberPad } from './NumberPad';

const tap = (name: string): boolean => fireEvent.click(screen.getByRole('button', { name }));
const display = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const submit = (label = 'Add'): HTMLButtonElement => screen.getByRole('button', { name: label }) as HTMLButtonElement;

describe('NumberPad', () => {
  it('opens empty with the current value as a placeholder; digits and one decimal point start a fresh number', () => {
    const onSubmit = vi.fn();
    render(<NumberPad value={16} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    const field = display();
    expect(field.value).toBe('');
    expect(field.placeholder).toBe(formatAmount(16));
    expect(field.readOnly).toBe(true);
    expect(field.getAttribute('inputmode')).toBe('decimal');
    tap('1');
    tap('6');
    tap('.');
    tap('.');
    tap('5');
    expect(field.value).toBe('16.5');
    for (const d of ['0', '1', '2', '3', '4', '6', '7', '8', '9']) expect(screen.getByRole('button', { name: d })).toBeTruthy();
    tap('Add');
    expect(onSubmit).toHaveBeenCalledWith(16.5);
  });

  it('a jump replaces the value: 8 shown, 3 0 submits 30; 11.5 shown, 1 4 submits 14', () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<NumberPad value={8} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    tap('3');
    tap('0');
    tap('Add');
    expect(onSubmit).toHaveBeenLastCalledWith(30);
    unmount();
    render(<NumberPad value={11.5} submitLabel="Use" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    tap('1');
    tap('4');
    tap('Use');
    expect(onSubmit).toHaveBeenLastCalledWith(14);
  });

  it('the submit button carries the given label', () => {
    render(<NumberPad value={undefined} submitLabel="Use" allowZero={false} onSubmit={() => {}} onCancel={() => {}} />);
    expect(submit('Use')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('disables the submit when empty or 0, backspace deletes, Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<NumberPad value={undefined} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={onCancel} />);
    expect(display().value).toBe('');
    expect(display().placeholder).toBe('');
    expect(submit().disabled).toBe(true);
    tap('0');
    expect(submit().disabled).toBe(true);
    tap('Backspace');
    tap('3');
    expect(submit().disabled).toBe(false);
    tap('Backspace');
    expect(display().value).toBe('');
    expect(submit().disabled).toBe(true);
    tap('Cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('allowZero accepts 0 (external or band at 0 kg, spec 1 §3); empty stays disabled', () => {
    const onSubmit = vi.fn();
    render(<NumberPad value={undefined} submitLabel="Use" allowZero onSubmit={onSubmit} onCancel={() => {}} />);
    expect(submit('Use').disabled).toBe(true);
    tap('0');
    expect(submit('Use').disabled).toBe(false);
    tap('Use');
    expect(onSubmit).toHaveBeenCalledWith(0);
  });
});
```

Create `src/ui/components/shared/SetChips.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ladder, set } from '../../../model/test-fixtures';
import { formatAmount } from '../../format';
import { SetChips } from './SetChips';

const chips = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.setchips__chip'));

describe('SetChips', () => {
  it('renders the amounts (device locale) in the order given, marks last and marked, appends the proposed chip', () => {
    const sets = ladder([17, 16.5, 15]);
    const onTap = vi.fn();
    render(<SetChips sets={sets} variant="today" lastIndex={2} markIndex={1} proposed={14} onTap={onTap} />);
    expect(document.querySelector('.setchips')?.className).toBe('setchips setchips--today');
    const all = chips();
    expect(all.map((c) => c.textContent)).toEqual([17, 16.5, 15, 14].map(formatAmount));
    expect(all[2]?.classList.contains('is-last')).toBe(true);
    expect(all[1]?.classList.contains('is-marked')).toBe(true);
    expect(all[3]?.classList.contains('is-proposed')).toBe(true);
    expect(all[0]?.className).toBe('setchips__chip');
    fireEvent.click(screen.getByRole('button', { name: formatAmount(16.5) }));
    expect(onTap).toHaveBeenCalledWith(sets[1]);
  });

  it('reference variant without proposed or onTap renders plain chips; an aggregate set shows 100*', () => {
    render(<SetChips sets={[set({ reps: 100, aggregate: true })]} variant="reference" />);
    expect(document.querySelector('.setchips')?.className).toBe('setchips setchips--reference');
    expect(chips().map((c) => c.textContent)).toEqual([`${formatAmount(100)}*`]);
    expect(document.querySelector('.is-proposed')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

Create `src/ui/components/shared/Sheet.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('renders title and children as a modal dialog; Cancel and Escape close it', () => {
    const onClose = vi.fn();
    render(<Sheet title="Load" onClose={onClose}><p>body</p></Sheet>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Load')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a swipe down of more than 80 px on the title bar closes it; a shorter or upward swipe does not', () => {
    const onClose = vi.fn();
    render(<Sheet title="Load" onClose={onClose}><p>body</p></Sheet>);
    const head = screen.getByRole('heading', { name: 'Load' }).parentElement as HTMLElement;
    const swipe = (from: number, to: number): void => {
      fireEvent.touchStart(head, { touches: [{ clientX: 50, clientY: from }] });
      fireEvent.touchEnd(head, { changedTouches: [{ clientX: 50, clientY: to }] });
    };
    swipe(100, 160);
    swipe(300, 100);
    expect(onClose).not.toHaveBeenCalled();
    swipe(100, 181);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the dialog on mount so Escape works without an inner focus', () => {
    render(<Sheet title="Load" onClose={() => {}}><p>body</p></Sheet>);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});
```

Create `src/ui/components/shared/Stepper.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../format';
import { Stepper } from './Stepper';

describe('Stepper', () => {
  it('steps by step, never below min, and the value button opens the pad', () => {
    const onChange = vi.fn();
    const onOpenPad = vi.fn();
    render(<Stepper value={2} step={1} min={1} onChange={onChange} onOpenPad={onOpenPad} />);
    const value = screen.getByRole('button', { name: 'Edit value' });
    expect(value.textContent).toBe(formatAmount(2));
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(value);
    expect(onOpenPad).toHaveBeenCalledTimes(1);
  });

  it('shows – for undefined, + and − give min, − stays at min', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper value={undefined} step={5} min={1} onChange={onChange} onOpenPad={() => {}} />);
    expect(screen.getByRole('button', { name: 'Edit value' }).textContent).toBe('–');
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    rerender(<Stepper value={3} step={5} min={1} onChange={onChange} onOpenPad={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
```

Create `src/ui/components/shared/ToastHost.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, toast } from '../../toast';
import { ToastHost } from './ToastHost';

describe('ToastHost', () => {
  beforeEach(() => { vi.useFakeTimers(); dismissToast(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing without a toast, then the text and the action, which runs and dismisses', () => {
    render(<ToastHost />);
    expect(document.querySelector('.toast')).toBeNull();
    const run = vi.fn();
    act(() => { showToast('Set 14 deleted', { label: 'Undo', run }, 6000); });
    expect(screen.getByText('Set 14 deleted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(toast.value).toBeUndefined();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('auto-dismisses after ms', () => {
    render(<ToastHost />);
    act(() => { showToast('Saved here, not uploaded (app bug)'); });
    expect(screen.getByText('Saved here, not uploaded (app bug)')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    act(() => { vi.advanceTimersByTime(3999); });
    expect(toast.value).toBeDefined();
    act(() => { vi.advanceTimersByTime(1); });
    expect(toast.value).toBeUndefined();
    expect(document.querySelector('.toast')).toBeNull();
  });
});
```

Create `src/ui/test-harness.tsx`:

```tsx
import { signal } from '@preact/signals';
import { render } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import type { ComponentChildren } from 'preact';
import { expect, vi } from 'vitest';
import { exercisesFile, sessionFile } from '../model/test-fixtures';
import type { Exercise, FileKind, Session, SessionFile } from '../model/types';
import { openDb } from '../sync/db';
import { EXERCISES_PATH, sessionPath } from '../sync/paths';
import { Store } from '../sync/store';
import { AppContext, type AppDeps, type SyncActions } from './context';
import { Data, storeChanges, type FileOf, type WriteOutcome } from './data';
import { Router, type RouterWindow } from './router';

/** Test-only, shared by the component tests of every tab: a real Data over a Store on a fresh fake
 *  IndexedDB, with the files written through the store. */

export const pathOf = (s: Session): string => sessionPath(s.date, s.id);

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/log' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

export interface Mounted { data: Data; store: Store; deps: AppDeps }

export async function setup(input: { now: Date; sessions: Session[]; exercises?: Exercise[] | undefined; meta?: Record<string, unknown> }): Promise<Mounted> {
  const db = await openDb(new IDBFactory());
  // The same wiring as main.tsx: the store's own events reach Data (no channel in a test).
  const changes = storeChanges(undefined);
  const store = new Store(db, { onChange: changes.onChange });
  const files: [FileKind, string, unknown][] = input.sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)]);
  if (input.exercises !== undefined) files.unshift(['exercises', EXERCISES_PATH, exercisesFile(input.exercises)]);
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, input.now);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(input.meta ?? {})) await store.setMeta(key, value);
  const data = new Data({ store, now: () => input.now });
  changes.bind(data);
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  return { data, store, deps: { data, router: new Router(fakeWindow()), sync, ui } };
}

export function renderIn(deps: AppDeps, children: ComponentChildren): void {
  render(<AppContext.Provider value={deps}>{children}</AppContext.Provider>);
}

export async function fileAt(store: Store, path: string): Promise<SessionFile> {
  return (await store.getRow(path))?.content as SessionFile;
}

/** Every write of `data` that goes through reports `heldBack: true`, as a write that fails
 *  validation would (spec 3 §5), so the screens' held-back toast can be tested. */
export function reportHeldBack(data: Data): void {
  const edit = data.edit.bind(data);
  const create = data.create.bind(data);
  const held = (r: WriteOutcome): WriteOutcome => (r.ok ? { ok: true, heldBack: true } : r);
  vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>) => held(await edit(kind, path, fn)));
  vi.spyOn(data, 'create').mockImplementation(async (kind: FileKind, path: string, file: unknown) => held(await create(kind, path, file)));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/clock.test.ts src/ui/components/shared/BackBar.test.tsx src/ui/components/shared/Button.test.tsx src/ui/components/shared/Marks.test.tsx src/ui/components/shared/NumberPad.test.tsx src/ui/components/shared/SetChips.test.tsx src/ui/components/shared/Sheet.test.tsx src/ui/components/shared/Stepper.test.tsx src/ui/components/shared/ToastHost.test.tsx`

Expected: FAIL. The first error reads:

```
src/ui/components/shared/BackBar.test.tsx: Error: Failed to resolve import "./BackBar" from "src/ui/components/shared/BackBar.test.tsx". Does the file exist?
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/components/shared/BackBar.tsx`:

```tsx
import type { ComponentChildren, JSX } from 'preact';

/** A page header with a back button, the title and an optional right slot. */
export function BackBar(p: { title: string; onBack(): void; right?: ComponentChildren }): JSX.Element {
  return (
    <header class="backbar">
      <button type="button" class="backbar__back" aria-label="Back" onClick={() => p.onBack()}>‹</button>
      <h1 class="backbar__title">{p.title}</h1>
      <div class="backbar__right">{p.right}</div>
    </header>
  );
}
```

Create `src/ui/components/shared/Button.tsx`:

```tsx
import type { ComponentChildren, JSX } from 'preact';

/** Spec 4 §8: a 44 px touch target; kind maps to btn--primary / btn--secondary / btn--danger. */
export function Button(p: {
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  onClick(): void;
  children: ComponentChildren;
  ariaLabel?: string;
}): JSX.Element {
  const kind = p.kind ?? 'secondary';
  return (
    <button
      type="button"
      class={`btn btn--${kind}`}
      disabled={p.disabled ?? false}
      aria-label={p.ariaLabel}
      onClick={() => p.onClick()}
    >
      {p.children}
    </button>
  );
}
```

Create `src/ui/components/shared/Marks.tsx`:

```tsx
import type { JSX } from 'preact';
import type { AmountIndicator, LoadIndicator } from '../../../model/derive';
import { glyph, glyphLabel } from '../../format';

/** Spec 1 §7 / spec 4 §4: the amount glyph then the load glyph (omitted when hidden); dimmed while provisional. */
export function Marks(p: { amount: AmountIndicator; load?: LoadIndicator; provisional?: boolean }): JSX.Element {
  const showLoad = p.load !== undefined && p.load !== 'hidden';
  return (
    <span class={`marks${p.provisional ? ' is-provisional' : ''}`}>
      <span class="marks__glyph marks__amount" aria-label={glyphLabel(p.amount)}>{glyph(p.amount)}</span>
      {showLoad && p.load !== undefined && (
        <span class="marks__glyph marks__load" aria-label={glyphLabel(p.load)}>{glyph(p.load)}</span>
      )}
    </span>
  );
}
```

Create `src/ui/components/shared/NumberPad.tsx`:

```tsx
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { formatAmount } from '../../format';
import { Button } from './Button';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Parses the typed text; undefined when it is empty or not a number above 0 (at least 0 with `allowZero`). */
function parse(text: string, allowZero: boolean): number | undefined {
  if (text === '' || text === '.') return undefined;
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 || (allowZero && n === 0) ? n : undefined;
}

/**
 * Spec 4 §4 (U8): digits, '.', backspace and the submit button, for decimals (16.5) and jumps (30).
 * It opens empty with the current value as a placeholder, so the first key starts a fresh number
 * (no backspacing over the old value first). `submitLabel` names what the button does where the
 * pad is used
 * ("Add" adds the set, "Use" only sets the value); `allowZero` accepts 0 (a 0 kg external or band load).
 */
export function NumberPad(p: {
  value: number | undefined;
  submitLabel: string;
  allowZero: boolean;
  onSubmit(v: number): void;
  onCancel(): void;
}): JSX.Element {
  const [text, setText] = useState('');
  const parsed = parse(text, p.allowZero);
  const type = (ch: string): void => {
    if (ch === '.' && text.includes('.')) return;
    setText(text + ch);
  };
  const key = (label: string, onClick: () => void): JSX.Element => (
    <button type="button" class="numpad__key" aria-label={label} onClick={onClick}>{label}</button>
  );
  return (
    <div class="numpad">
      <input
        class="numpad__display"
        type="text"
        inputMode="decimal"
        readOnly
        value={text}
        placeholder={p.value === undefined ? '' : formatAmount(p.value)}
        aria-label="Value"
      />
      <div class="numpad__keys">
        {DIGITS.map((d) => key(d, () => type(d)))}
        {key('.', () => type('.'))}
        {key('0', () => type('0'))}
        <button type="button" class="numpad__key" aria-label="Backspace" onClick={() => setText(text.slice(0, -1))}>⌫</button>
      </div>
      <div class="numpad__actions">
        <Button kind="secondary" onClick={p.onCancel}>Cancel</Button>
        <Button kind="primary" disabled={parsed === undefined} onClick={() => { if (parsed !== undefined) p.onSubmit(parsed); }}>{p.submitLabel}</Button>
      </div>
    </div>
  );
}
```

Create `src/ui/components/shared/SetChips.tsx`:

```tsx
import type { JSX } from 'preact';
import { amountOf } from '../../../model/derive';
import type { WorkoutSet } from '../../../model/types';
import { formatAmount } from '../../format';

/** Spec 4 §4/§5: a block's sets as chips in the order given (callers pass liveSets); amounts in the device locale (§8); an aggregate set shows '100*'. */
export function SetChips(p: {
  sets: readonly WorkoutSet[];
  variant: 'today' | 'reference';
  lastIndex?: number;
  markIndex?: number;
  proposed?: number | undefined;
  onTap?(set: WorkoutSet): void;
}): JSX.Element {
  const classOf = (i: number): string => {
    const cls = ['setchips__chip'];
    if (i === p.lastIndex) cls.push('is-last');
    if (i === p.markIndex) cls.push('is-marked');
    return cls.join(' ');
  };
  const label = (s: WorkoutSet): string => `${formatAmount(amountOf(s))}${s.aggregate ? '*' : ''}`;
  const onTap = p.onTap;
  return (
    <div class={`setchips setchips--${p.variant}`}>
      {p.sets.map((s, i) =>
        onTap ? (
          <button key={s.id} type="button" class={classOf(i)} onClick={() => onTap(s)}>{label(s)}</button>
        ) : (
          <span key={s.id} class={classOf(i)}>{label(s)}</span>
        ),
      )}
      {typeof p.proposed === 'number' && (
        <span class="setchips__chip is-proposed" aria-label="proposed">{formatAmount(p.proposed)}</span>
      )}
    </div>
  );
}
```

Create `src/ui/components/shared/Sheet.tsx`:

```tsx
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Button } from './Button';

/** A downward swipe on the title bar longer than this closes the sheet (spec 4 §8). */
export const SWIPE_CLOSE_PX = 80;

/**
 * Spec 4 §8: a bottom sheet with a title, the content and a Cancel button. It slides up (theme.css),
 * closes on a swipe down on its title bar, on Cancel, on Escape (the dialog takes focus on mount)
 * and on a tap on the backdrop.
 */
export function Sheet(p: { title: string; onClose(): void; children: ComponentChildren }): JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const swipeFrom = useRef<number | undefined>(undefined);
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      p.onClose();
    }
  };
  const onTouchStart = (e: TouchEvent): void => {
    swipeFrom.current = e.touches[0]?.clientY;
  };
  const onTouchEnd = (e: TouchEvent): void => {
    const from = swipeFrom.current;
    swipeFrom.current = undefined;
    const to = e.changedTouches[0]?.clientY;
    if (from !== undefined && to !== undefined && to - from > SWIPE_CLOSE_PX) p.onClose();
  };
  return (
    <div class="sheet__backdrop" onClick={() => p.onClose()}>
      <div
        ref={dialog}
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="sheet__head" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <h2 class="sheet__title">{p.title}</h2>
        </div>
        <div class="sheet__body">{p.children}</div>
        <div class="sheet__foot">
          <Button kind="secondary" onClick={p.onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
```

Create `src/ui/components/shared/Stepper.tsx`:

```tsx
import type { JSX } from 'preact';
import { formatAmount } from '../../format';

/** Spec 4 §4 (U8): − and + step the value, never below min; + from an empty value gives min; the number opens the pad. */
export function Stepper(p: {
  value: number | undefined;
  step: number;
  min: number;
  onChange(v: number | undefined): void;
  onOpenPad(): void;
}): JSX.Element {
  const dec = (): void => {
    p.onChange(p.value === undefined ? p.min : Math.max(p.min, p.value - p.step));
  };
  const inc = (): void => {
    p.onChange(p.value === undefined ? p.min : p.value + p.step);
  };
  return (
    <div class="stepper">
      <button type="button" class="stepper__btn" aria-label="Decrease" onClick={dec}>−</button>
      <button type="button" class="stepper__value" aria-label="Edit value" onClick={() => p.onOpenPad()}>
        {p.value === undefined ? '–' : formatAmount(p.value)}
      </button>
      <button type="button" class="stepper__btn" aria-label="Increase" onClick={inc}>+</button>
    </div>
  );
}
```

Create `src/ui/components/shared/ToastHost.tsx`:

```tsx
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { dismissToast, toast } from '../../toast';

/** Spec 4 §8: at most one toast; auto-dismisses after its ms; the action runs and dismisses. */
export function ToastHost(): JSX.Element {
  const t = toast.value;
  useEffect(() => {
    if (!t) return undefined;
    const id = setTimeout(dismissToast, t.ms);
    return () => clearTimeout(id);
  }, [t]);
  if (!t) return <></>;
  const action = t.action;
  return (
    <div class="toast" role="status">
      <span class="toast__text">{t.text}</span>
      {action && (
        <button type="button" class="toast__action" onClick={() => { dismissToast(); action.run(); }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
```

Create `src/ui/components/shared/index.ts`:

```ts
export { BackBar } from './BackBar';
export { Button } from './Button';
export { Marks } from './Marks';
export { NumberPad } from './NumberPad';
export { SetChips } from './SetChips';
export { Sheet } from './Sheet';
export { Stepper } from './Stepper';
export { ToastHost } from './ToastHost';
```

Append to `src/ui/theme.css`:

```css
/* ---- .btn (shared/Button) ---- */
.btn {
  min-height: 44px;
  min-width: 44px;
  padding: 0 16px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-weight: 600;
}
.btn:disabled { opacity: 0.45; cursor: default; }
.btn--primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn--secondary { background: var(--panel-2); }
.btn--danger { background: transparent; border-color: var(--danger); color: var(--danger); }

/* ---- .sheet (shared/Sheet) ---- */
.sheet__backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
}
.sheet {
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0;
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 -8px 24px color-mix(in srgb, var(--bg) 60%, transparent);
  outline: none;
  /* Spec 4 §8: sheets slide up from the bottom. */
  animation: sheet-up 180ms ease-out;
}
@keyframes sheet-up {
  from { transform: translateY(100%); }
  to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sheet { animation: none; }
}
/* The title bar is the swipe-down handle (Sheet.tsx): it stays at the top of a long sheet, and the
   browser does not start a scroll from it, so the touch ends on it. */
.sheet__head {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: -12px -16px 0;
  padding: 8px 16px 0;
  background: var(--panel);
  touch-action: none;
}
.sheet__head::before {
  content: '';
  display: block;
  width: 36px;
  height: 4px;
  margin: 0 auto 4px;
  border-radius: 2px;
  background: var(--outline);
}
.sheet__title { margin: 4px 0 12px; font-size: 18px; }
.sheet__body { display: flex; flex-direction: column; gap: 12px; }
.sheet__foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

/* ---- .stepper (shared/Stepper) ---- */
.stepper { display: flex; align-items: center; gap: 8px; }
.stepper__btn {
  width: 56px;
  height: 56px;
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 28px;
  line-height: 1;
}
.stepper__value {
  flex: 1;
  min-width: 88px;
  height: 56px;
  border: 1px dashed var(--accent);
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}

/* ---- .numpad (shared/NumberPad) ---- */
.numpad { display: flex; flex-direction: column; gap: 12px; }
.numpad__display {
  width: 100%;
  height: 52px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font-size: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* The current value, shown until the first key starts a fresh number. */
.numpad__display::placeholder { color: var(--muted); opacity: 1; }
.numpad__keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.numpad__key {
  height: 52px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 22px;
}
.numpad__actions { display: flex; justify-content: flex-end; gap: 8px; }

/* ---- .setchips (shared/SetChips) ---- */
.setchips { display: flex; flex-wrap: wrap; gap: 6px; }
.setchips__chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--outline);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.setchips--today .setchips__chip { min-height: 44px; } /* spec 4 §8 touch targets */
.setchips--reference .setchips__chip { background: transparent; color: var(--muted); }
.setchips__chip.is-last { border-color: var(--ok); }
.setchips__chip.is-marked { border-color: var(--accent); color: var(--text); }
.setchips__chip.is-proposed { border-style: dashed; border-color: var(--accent); background: transparent; color: var(--accent); }

/* ---- .marks (shared/Marks) ---- */
.marks { display: inline-flex; gap: 2px; font-variant-numeric: tabular-nums; }
.marks__glyph { min-width: 1em; text-align: center; }
.marks.is-provisional { opacity: 0.5; }

/* ---- .toast (shared/ToastHost) ---- */
.toast {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px 8px 16px;
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--panel-2);
  color: var(--text);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 60%, transparent);
}
.toast__action {
  min-height: 44px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-weight: 600;
}

/* ---- .backbar (shared/BackBar) ---- */
/* .app__main already starts below the top inset, so the bar adds none of its own (two insets put the
   session page about 2 × 47 px down on a notched iPhone); it sticks just below the status-bar strip. */
.backbar {
  position: sticky;
  top: env(safe-area-inset-top, 0px);
  z-index: 10;
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 8px;
  background: var(--panel);
  border-bottom: 1px solid var(--outline);
}
.backbar__back {
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 28px;
  line-height: 1;
}
.backbar__title { margin: 0; font-size: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.backbar__right { display: flex; align-items: center; gap: 8px; }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 55 test files and 767 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/clock.test.ts src/ui/components/shared/BackBar.test.tsx src/ui/components/shared/BackBar.tsx src/ui/components/shared/Button.test.tsx src/ui/components/shared/Button.tsx src/ui/components/shared/Marks.test.tsx src/ui/components/shared/Marks.tsx src/ui/components/shared/NumberPad.test.tsx src/ui/components/shared/NumberPad.tsx src/ui/components/shared/SetChips.test.tsx src/ui/components/shared/SetChips.tsx src/ui/components/shared/Sheet.test.tsx src/ui/components/shared/Sheet.tsx src/ui/components/shared/Stepper.test.tsx src/ui/components/shared/Stepper.tsx src/ui/components/shared/ToastHost.test.tsx src/ui/components/shared/ToastHost.tsx src/ui/components/shared/index.ts src/ui/test-harness.tsx src/ui/theme.css
git commit -m "Add the shared UI components" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: App shell and the Sync tab; the old shell goes

Mounts the Preact app with the tab bar and the route switch, and builds the Sync tab with every function of the spec 3 shell (§7): connect and paste login, empty-folder choice, the Update button with its four states, status with the retry countdown, issue cards for every reason, data counts, sign out. `src/app/main.tsx` keeps all spec 3 wiring. The Log, Days, session and More screens are placeholders until the next tasks; the old `shell.ts`, `shell.css`, `shell.test.ts` and `main.ts` are deleted.

**Files:**
- Modify: `index.html`
- Create: `src/app/idle.test.ts`
- Create: `src/app/idle.ts`
- Delete: `src/app/main.ts`
- Create: `src/app/main.tsx`
- Delete: `src/app/shell.css`
- Delete: `src/app/shell.test.ts`
- Delete: `src/app/shell.ts`
- Modify: `src/app/sw-update.ts`
- Create: `src/ui/app.test.tsx`
- Create: `src/ui/app.tsx`
- Create: `src/ui/app.vm.test.ts`
- Create: `src/ui/app.vm.ts`
- Create: `src/ui/components/days/DaysTab.tsx`
- Create: `src/ui/components/days/SessionPage.tsx`
- Create: `src/ui/components/log/LogTab.tsx`
- Create: `src/ui/components/more/MoreTab.tsx`
- Create: `src/ui/components/sync/SyncTab.test.tsx`
- Create: `src/ui/components/sync/SyncTab.tsx`
- Create: `src/ui/components/sync/sync.vm.test.ts`
- Create: `src/ui/components/sync/sync.vm.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/app/config`, `src/app/triggers`, `src/model/derive`, `src/model/types`, `src/sync/auth`, `src/sync/channel`, `src/sync/db`, `src/sync/dropbox-client`, `src/sync/engine`, `src/sync/lock`, `src/sync/store`, `src/ui/components/shared`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/router`.
- Produces:
  - `src/app/idle.ts`:
    - `export interface IdleTimers`
    - `export function raceIdle(whenIdle: () => Promise<void>, ms: number, timers: IdleTimers = REAL_TIMERS): Promise<'idle' | 'timeout'>`
  - `src/app/sw-update.ts`:
    - `export interface SwUpdate`
    - `export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000`
    - `export function setupSwUpdate(onChange: () => void): SwUpdate`
  - `src/ui/app.tsx`:
    - `export function App(): JSX.Element`
  - `src/ui/app.vm.ts`:
    - `export type Tab = 'log' | 'days' | 'more' | 'sync'`
    - `export function badgeVm(input: { issues: number; softIssues: number; heldBack: number; connected: boolean; updateAvailable: boolean }): { count: number; dot: boolean }`
    - `export function clockModeFor(route: Route): 'fast' | 'slow'`
    - `export function tabOf(route: Route): Tab`
  - `src/ui/components/days/DaysTab.tsx`:
    - `export function DaysTab(): JSX.Element`
  - `src/ui/components/days/SessionPage.tsx`:
    - `export function SessionPage(p: { sessionId: string }): JSX.Element`
  - `src/ui/components/log/LogTab.tsx`:
    - `export function LogTab(): JSX.Element`
  - `src/ui/components/more/MoreTab.tsx`:
    - `export function MoreTab(): JSX.Element`
  - `src/ui/components/sync/SyncTab.tsx`:
    - `export function SyncTab(): JSX.Element`
  - `src/ui/components/sync/sync.vm.ts`:
    - `export type UpdateState = 'idle' | 'updating' | 'retrying' | 'failed'`
    - `export interface SyncVmInput`
    - `export interface IssueCard`
    - `export interface SyncVm`
    - `export function syncVm(input: SyncVmInput): SyncVm`

- [ ] **Step 1: Write the failing tests**

Create `src/app/idle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { raceIdle } from './idle';

describe('raceIdle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves 'idle' when whenIdle settles before the timeout", async () => {
    let settle: () => void = () => undefined;
    const whenIdle = () => new Promise<void>((r) => { settle = r; });
    const result = raceIdle(whenIdle, 10_000);
    vi.advanceTimersByTime(9_999);
    settle();
    await expect(result).resolves.toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves 'timeout' when whenIdle is still pending after ms", async () => {
    const whenIdle = () => new Promise<void>(() => undefined);
    const result = raceIdle(whenIdle, 10_000);
    vi.advanceTimersByTime(10_000);
    await expect(result).resolves.toBe('timeout');
  });

  it('uses the given timers', async () => {
    const timers = { setTimeout: vi.fn(() => 'id'), clearTimeout: vi.fn() };
    await expect(raceIdle(() => Promise.resolve(), 10_000, timers)).resolves.toBe('idle');
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(timers.clearTimeout).toHaveBeenCalledWith('id');
  });
});
```

Create `src/ui/app.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../sync/db';
import { block, ladder, session, sessionFile } from '../model/test-fixtures';
import { sessionPath } from '../sync/paths';
import type { Issue } from '../sync/store';
import { Store } from '../sync/store';
import { App } from './app';
import { AppContext, type AppDeps, type SyncActions } from './context';
import { Data } from './data';
import { Router, type RouterWindow } from './router';

function fakeWindow(hash: string): RouterWindow {
  const win: RouterWindow = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

async function mount(over: { hash?: string; connected?: boolean; issues?: Issue[]; before?: (store: Store) => Promise<void> } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  await over.before?.(store);
  const data = new Data({ store });
  await data.load();
  if (over.issues !== undefined) data.issues.value = over.issues;
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const router = new Router(fakeWindow(over.hash ?? '#/log'));
  const deps: AppDeps = {
    data, router, sync,
    ui: {
      connected: signal(over.connected ?? true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    },
  };
  render(<AppContext.Provider value={deps}><App /></AppContext.Provider>);
  return deps;
}

const heading = () => document.querySelector('main h2')?.textContent;

describe('App', () => {
  it('renders the screen of the current route and switches with the router', async () => {
    const { router } = await mount();
    act(() => { router.navigate({ tab: 'more' }); });
    expect(heading()).toBe('More');
    act(() => { router.navigate({ tab: 'sync' }); });
    expect(document.querySelector('.sync')).toBeTruthy();
  });

  it('tab buttons navigate and mark the active tab', async () => {
    const { router } = await mount();
    const tabs = screen.getAllByRole('button', { name: /^(Log|Days|More|Sync)$/ });
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(true);
    act(() => { screen.getByRole('button', { name: 'Days' }).click(); });
    expect(router.route.value).toEqual({ tab: 'days' });
    expect(screen.getByRole('button', { name: 'Days' }).classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(false);
  });

  it('shows 3 on the Sync tab for three issues', async () => {
    await mount({
      issues: [
        { path: 'a.json', reason: 'quarantined', detail: 'x' },
        { path: 'b.json', reason: 'duplicate', detail: 'y' },
        { path: 'c.txt', reason: 'unexpected-file', detail: 'z' },
      ],
    });
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('3');
    expect(document.querySelector('.tabbar__dot')).toBeNull();
  });

  it('counts a held-back write once, though the store lists it as an issue too', async () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    // 30 February fails a hard rule: the write stays local and queued, held back (spec 3 §5).
    const bad = sessionFile({ ...s, date: '2030-02-30' });
    const { data } = await mount({
      before: async (store) => {
        expect(await store.writeFile('session', sessionPath(s.date, s.id), bad, new Date('2030-03-04T11:00:00.000Z'))).toMatchObject({ ok: true, heldBack: expect.any(Array) });
      },
    });
    expect(data.issues.value.map((i) => i.reason)).toEqual(['held-back']);
    expect(data.heldBackCount.value).toBe(1);
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('1');
  });

  it('shows a dot when disconnected without issues, nothing when connected and clean', async () => {
    const { ui } = await mount({ connected: false });
    expect(document.querySelector('.tabbar__dot')).toBeTruthy();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
    act(() => { ui.connected.value = true; });
    expect(document.querySelector('.tabbar__dot')).toBeNull();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
  });
});
```

Create `src/ui/app.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { badgeVm, clockModeFor, tabOf } from './app.vm';
import type { Route } from './router';

const base = { issues: 0, softIssues: 0, heldBack: 0, connected: true, updateAvailable: false };

describe('badgeVm', () => {
  it('counts hard issues, soft issues and held-back writes', () => {
    expect(badgeVm({ ...base, issues: 2, softIssues: 1, heldBack: 3 })).toEqual({ count: 6, dot: false });
  });

  it('shows nothing when connected, up to date and clean', () => {
    expect(badgeVm(base)).toEqual({ count: 0, dot: false });
  });

  it('shows a dot alone when not connected or when an update waits', () => {
    expect(badgeVm({ ...base, connected: false })).toEqual({ count: 0, dot: true });
    expect(badgeVm({ ...base, updateAvailable: true })).toEqual({ count: 0, dot: true });
  });

  it('prefers the number over the dot', () => {
    expect(badgeVm({ ...base, issues: 1, connected: false, updateAvailable: true })).toEqual({ count: 1, dot: false });
  });
});

describe('clockModeFor', () => {
  it('ticks every second on the Log tab (the counter) and the Sync tab (the retry countdown), else every minute', () => {
    expect(clockModeFor({ tab: 'log' })).toBe('fast');
    expect(clockModeFor({ tab: 'sync' })).toBe('fast');
    expect(clockModeFor({ tab: 'days' })).toBe('slow');
    expect(clockModeFor({ tab: 'days', sessionId: 'abc' })).toBe('slow');
    expect(clockModeFor({ tab: 'more', page: 'calendar' })).toBe('slow');
  });
});

describe('tabOf', () => {
  const cases: ReadonlyArray<readonly [Route, ReturnType<typeof tabOf>]> = [
    [{ tab: 'log' }, 'log'],
    [{ tab: 'days' }, 'days'],
    [{ tab: 'days', sessionId: 'abc' }, 'days'],
    [{ tab: 'more' }, 'more'],
    [{ tab: 'more', page: 'exercises' }, 'more'],
    [{ tab: 'more', page: 'exercise', id: 'pull-up' }, 'more'],
    [{ tab: 'more', page: 'calendar' }, 'more'],
    [{ tab: 'more', page: 'bodyweight' }, 'more'],
    [{ tab: 'more', page: 'catalog' }, 'more'],
    [{ tab: 'more', page: 'catalog', id: 'ring-dip' }, 'more'],
    [{ tab: 'sync' }, 'sync'],
  ];
  it.each(cases)('%j → %s', (route, tab) => {
    expect(tabOf(route)).toBe(tab);
  });
});
```

Create `src/ui/components/sync/SyncTab.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { openDb } from '../../../sync/db';
import type { SyncStatus } from '../../../sync/engine';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import type { Issue, IssueReason } from '../../../sync/store';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { Router, type RouterWindow } from '../../router';
import { SyncTab } from './SyncTab';

const URL_WITH_QUERY = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';
const STATUS: SyncStatus = { phase: 'idle', online: true, connected: false, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/sync' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const NOW = new Date('2030-03-04T11:00:00.000Z');

async function deps(over: { connected?: boolean; pasteMode?: boolean; pasteUrl?: string; status?: Partial<SyncStatus>; issues?: Issue[]; sessions?: Session[]; exercises?: Exercise[] } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  if (over.exercises !== undefined) await store.writeFile('exercises', EXERCISES_PATH, exercisesFile(over.exercises), NOW);
  for (const s of over.sessions ?? []) await store.writeFile('session', sessionPath(s.date, s.id), sessionFile(s), NOW);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  data.status.value = { ...STATUS, ...over.status };
  data.issues.value = over.issues ?? [];
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(over.connected ?? false), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(over.pasteMode ?? false), pasteUrl: signal<string | undefined>(over.pasteUrl), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const all: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  return { ...all, mount: () => render(<AppContext.Provider value={all}><SyncTab /></AppContext.Provider>) };
}

describe('SyncTab, not connected', () => {
  it('Connect and Paste a code call their actions', async () => {
    const d = await deps();
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Dropbox' }));
    expect(d.sync.connect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a code instead' }));
    expect(d.sync.startPaste).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Not connected.')).toBeTruthy();
  });

  it('still lists the issues and the data the badge counts; no Status without a connection', async () => {
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'c1000000-0000-4000-8000-000000000001', date: '2030-03-02' });
    const d = await deps({
      sessions: [unknown],
      exercises: [exercise()],
      issues: [{ path: '/sessions/2030/2030-03-01_x.json', reason: 'held-back', detail: '/session/date: bad' }],
    });
    d.mount();
    expect(screen.getByText('Held back')).toBeTruthy();
    expect(screen.getByText('Unknown exercise')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeTruthy();
    expect(screen.getByText('Build b1 · storage persistent')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('says Connect again and keeps the data when the device holds local rows', async () => {
    const d = await deps({ status: { queueLength: 2 } });
    d.mount();
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
    expect(screen.getByText(/queued changes are kept/)).toBeTruthy();
  });

  it('shows the Dropbox link as a real link next to the code field (ported shell test)', async () => {
    const d = await deps({ pasteMode: true, pasteUrl: URL_WITH_QUERY });
    d.mount();
    const link = screen.getByRole('link', { name: 'Open Dropbox to get the code' });
    expect(link.getAttribute('href')).toBe(URL_WITH_QUERY);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(document.getElementById('code')).toBeTruthy();
    expect(screen.getByText('Dropbox may ask you to log in inside this sheet')).toBeTruthy();
  });

  it('shows the code field but no link while the login is being prepared; neither outside paste mode', async () => {
    const d = await deps({ pasteMode: true });
    d.mount();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Preparing the Dropbox link…')).toBeTruthy();
    expect(document.getElementById('code')).toBeTruthy();
    act(() => { d.ui.pasteMode.value = false; });
    expect(document.getElementById('code')).toBeNull();
  });

  it('Finish login passes the typed code, kept across a re-render (ported shell test)', async () => {
    const d = await deps({ pasteMode: true, pasteUrl: URL_WITH_QUERY });
    d.mount();
    const field = document.getElementById('code') as HTMLInputElement;
    fireEvent.input(field, { target: { value: ' abc123 ' } });
    act(() => { d.ui.loginError.value = 'login failed'; });
    expect(screen.getByText('login failed')).toBeTruthy();
    expect((document.getElementById('code') as HTMLInputElement).value).toBe(' abc123 ');
    fireEvent.click(screen.getByRole('button', { name: 'Finish login' }));
    expect(d.sync.submitCode).toHaveBeenCalledWith('abc123');
  });
});

describe('SyncTab, connected', () => {
  it('Sync now, Sign out and the status rows', async () => {
    const d = await deps({ connected: true, status: { connected: true, queueLength: 3, heldBackCount: 1, lastError: 'boom' } });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(d.sync.syncNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(d.sync.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3 (1 held back)')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Build b1 · storage persistent')).toBeTruthy();
  });

  it('says Connected in one line and orders the sections as spec 4 §7: Connection, Update, Status, Issues, Data', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    expect(screen.getByText('Connected to Dropbox.')).toBeTruthy();
    const order = Array.from(document.querySelectorAll('.sync section')).map((s) => s.querySelector('h2')?.textContent ?? s.querySelector('button')?.textContent);
    expect(order).toEqual(['Dropbox', 'Update app', 'Status', 'Issues', 'Data']);
  });

  it('the empty-folder choice follows the connection card', async () => {
    const d = await deps({ connected: true, status: { connected: true, emptyFolder: true } });
    d.mount();
    const titles = Array.from(document.querySelectorAll('.sync section h2')).map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual(['Dropbox', 'Empty Dropbox folder']);
  });

  it('counts the retry down as the clock ticks', async () => {
    const d = await deps({ connected: true, status: { connected: true, retryInMs: 10_000 } });
    d.mount();
    expect(screen.getByText('idle · retry in 10 s')).toBeTruthy();
    act(() => { d.data.now.value = new Date(NOW.getTime() + 3_000); });
    expect(screen.getByText('idle · retry in 7 s')).toBeTruthy();
    act(() => { d.data.now.value = new Date(NOW.getTime() + 30_000); });
    expect(screen.getByText('idle · retry in 0 s')).toBeTruthy();
  });

  it('Sync now is disabled while the engine works', async () => {
    const d = await deps({ connected: true, status: { connected: true, phase: 'pulling' } });
    d.mount();
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('empty folder offers the two choices', async () => {
    const d = await deps({ connected: true, status: { connected: true, emptyFolder: true } });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start with the seed catalog' }));
    expect(d.sync.chooseEmptyFolder).toHaveBeenCalledWith('seed');
    fireEvent.click(screen.getByRole('button', { name: "I'll copy files in, then sync" }));
    expect(d.sync.chooseEmptyFolder).toHaveBeenCalledWith('copy');
  });

  const CARDS: ReadonlyArray<readonly [IssueReason, string, string]> = [
    ['quarantined', 'Quarantined', "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it."],
    ['read-only', 'Read-only', 'Written by a newer app; update this app.'],
    ['needs-update', 'Needs a newer app', 'Written by a newer app; update this app.'],
    ['held-back', 'Held back', 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.'],
    ['duplicate', 'Duplicate file', 'Remove the second file in Dropbox; the first one holds the merged content.'],
    ['remote-deleted', 'Removed from Dropbox', 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.'],
    ['unexpected-file', 'Unexpected file', 'Not a CalisTally file; ignored.'],
    ['push-error', 'Upload failed', 'Retried automatically on the next sync.'],
  ];

  it.each(CARDS)('renders a %s card with its title, path, detail and advice', async (reason, title, advice) => {
    const d = await deps({ connected: true, status: { connected: true }, issues: [{ path: '/sessions/2030/2030-03-04_a.json', reason, detail: `the ${reason} detail` }] });
    d.mount();
    expect(document.querySelectorAll('.sync-issue')).toHaveLength(1);
    const card = document.querySelector('.sync-issue') as HTMLElement;
    expect(within(card).getByText(title)).toBeTruthy();
    expect(within(card).getByText('/sessions/2030/2030-03-04_a.json')).toBeTruthy();
    expect(within(card).getByText(`the ${reason} detail`)).toBeTruthy();
    expect(within(card).getByText(advice)).toBeTruthy();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('renders a soft card for a session with an unknown exercise, linking to its page', async () => {
    const unknown = session([block(ladder([5]), { exerciseId: 'nope' })], { id: 'c1000000-0000-4000-8000-000000000002', date: '2030-03-02' });
    const d = await deps({ connected: true, status: { connected: true }, sessions: [unknown], exercises: [exercise()] });
    d.mount();
    const card = document.querySelector('.sync-issue--soft') as HTMLElement;
    expect(within(card).getByText('Unknown exercise')).toBeTruthy();
    expect(within(card).getByText(/block 1: unknown exercise nope/)).toBeTruthy();
    expect(within(card).getByText('Nothing is blocked; open the session to fix the block.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open the session' }).getAttribute('href')).toBe(`#/days/${unknown.id}`);
  });

  it('shows None without issues', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    d.mount();
    expect(screen.getByText('None.')).toBeTruthy();
  });
});

describe('SyncTab, update', () => {
  it("hides the button without a waiting build; tapping it runs 'reloading' and stays Updating…", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    d.mount();
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
    act(() => { d.ui.updateAvailable.value = true; });
    const button = screen.getByRole('button', { name: 'Update app' });
    fireEvent.click(button);
    expect(d.sync.updateApp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();
    const after = screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement;
    expect(after.disabled).toBe(true);
  });

  it("'busy' once → Still syncing and a second call; 'busy' twice → Could not update, enabled again", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    // The second call stays pending until the test releases it, so the DOM shows the retrying state.
    let release: (r: 'reloading' | 'busy') => void = () => undefined;
    (d.sync.updateApp as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('busy')
      .mockImplementationOnce(() => new Promise<'reloading' | 'busy'>((r) => { release = r; }));
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Still syncing, trying again' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Still syncing, trying again' }) as HTMLButtonElement).disabled).toBe(true);
    release('busy');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Could not update; try again after sync' })).toBeTruthy());
    expect(d.sync.updateApp).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Could not update; try again after sync' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("'busy' then 'reloading' stays Updating…", async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    (d.sync.updateApp as ReturnType<typeof vi.fn>).mockResolvedValueOnce('busy').mockResolvedValueOnce('reloading');
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    await waitFor(() => expect(d.sync.updateApp).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy();
  });

  it('a rejected update ends in Could not update, enabled again', async () => {
    const d = await deps({ connected: true, status: { connected: true } });
    (d.sync.updateApp as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no service worker'));
    act(() => { d.ui.updateAvailable.value = true; });
    d.mount();
    fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
    const button = await screen.findByRole('button', { name: 'Could not update; try again after sync' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the too-new notice when a newer build wrote files and no update is offered', async () => {
    const d = await deps({ connected: true, status: { connected: true, tooNewSeen: true } });
    d.mount();
    expect(screen.getByText(/A newer version of the app wrote some files/)).toBeTruthy();
  });
});
```

Create `src/ui/components/sync/sync.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../../../sync/engine';
import type { Issue, IssueReason } from '../../../sync/store';
import type { SoftIssue } from '../../data';
import { formatDayLong, formatTime, localDate } from '../../format';
import { block, session } from '../../../model/test-fixtures';
import { syncVm, type SyncVmInput, type UpdateState } from './sync.vm';

const STATUS: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };
const COUNTS = { sessions: 0, exercises: 0, bodyweight: 0 };
const URL = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';

function input(over: Partial<SyncVmInput> = {}): SyncVmInput {
  return {
    status: STATUS, retryLeftMs: undefined, issues: [], softIssues: [], sessions: [], connected: true, loginError: undefined, homeScreenHint: false,
    pasteMode: false, pasteUrl: undefined, persisted: true, updateAvailable: false, updateState: 'idle', buildId: 'b1', counts: COUNTS, ...over,
  };
}

const status = (over: Partial<SyncStatus>): SyncStatus => ({ ...STATUS, ...over });

describe('syncVm connection', () => {
  it('not connected, nothing local', () => {
    expect(syncVm(input({ connected: false })).connection).toEqual({ kind: 'disconnected', hasLocal: false, hint: false, error: undefined, pasteMode: false, pasteUrl: undefined });
  });

  it('not connected with local data or a queue: connect again, data kept', () => {
    expect(syncVm(input({ connected: false, counts: { sessions: 3, exercises: 0, bodyweight: 0 } })).connection).toMatchObject({ kind: 'disconnected', hasLocal: true });
    expect(syncVm(input({ connected: false, status: status({ queueLength: 2 }) })).connection).toMatchObject({ kind: 'disconnected', hasLocal: true });
  });

  it('home-screen hint and login error', () => {
    expect(syncVm(input({ connected: false, homeScreenHint: true })).connection).toMatchObject({ hint: true });
    expect(syncVm(input({ connected: false, loginError: 'login failed' })).connection).toMatchObject({ error: 'login failed' });
  });

  it('shows the last sync error when there is no login error', () => {
    expect(syncVm(input({ connected: false, status: status({ lastError: 'expired' }) })).connection).toMatchObject({ error: 'Last error: expired' });
    expect(syncVm(input({ connected: false, loginError: 'bad code', status: status({ lastError: 'expired' }) })).connection).toMatchObject({ error: 'bad code' });
  });

  it('paste mode with and without url', () => {
    expect(syncVm(input({ connected: false, pasteMode: true })).connection).toMatchObject({ pasteMode: true, pasteUrl: undefined });
    expect(syncVm(input({ connected: false, pasteMode: true, pasteUrl: URL })).connection).toMatchObject({ pasteMode: true, pasteUrl: URL });
  });

  it('empty folder: connected, with the choice card until the owner chooses to copy', () => {
    const empty = syncVm(input({ status: status({ emptyFolder: true }) }));
    expect(empty.connection).toEqual({ kind: 'connected' });
    expect(empty.emptyFolder).toBe(true);
    const copying = syncVm(input({ status: status({ emptyFolder: true, emptyFolderChoice: 'copy' }) }));
    expect(copying.emptyFolder).toBe(false);
    expect(copying.emptyFolderNote).toBe(true);
    expect(syncVm(input({ connected: false, status: status({ emptyFolder: true }) })).emptyFolder).toBe(false);
  });

  it('connected', () => {
    expect(syncVm(input()).connection).toEqual({ kind: 'connected' });
    expect(syncVm(input()).emptyFolder).toBe(false);
  });

  it('Status only when connected; Issues and Data in every state', () => {
    expect(syncVm(input()).showStatus).toBe(true);
    const off = syncVm(input({ connected: false, issues: [{ path: 'p', reason: 'held-back', detail: 'd' }] }));
    expect(off.showStatus).toBe(false);
    expect(off.issues).toHaveLength(1);
  });
});

describe('syncVm update', () => {
  const cases: ReadonlyArray<readonly [UpdateState, string, boolean]> = [
    ['idle', 'Update app', false],
    ['updating', 'Updating…', true],
    ['retrying', 'Still syncing, trying again', true],
    ['failed', 'Could not update; try again after sync', false],
  ];
  it.each(cases)('%s → %s (disabled %s)', (state, label, disabled) => {
    const u = syncVm(input({ updateAvailable: true, updateState: state })).update;
    expect(u).toMatchObject({ show: true, label, disabled, tooNew: false });
    expect(u.note).toBe('A new version of the app is ready.');
  });

  it('is hidden without a waiting build; tooNew only then', () => {
    expect(syncVm(input()).update).toMatchObject({ show: false, tooNew: false, note: undefined });
    expect(syncVm(input({ status: status({ tooNewSeen: true }) })).update).toMatchObject({ show: false, tooNew: true });
    expect(syncVm(input({ status: status({ tooNewSeen: true }), updateAvailable: true })).update).toMatchObject({ show: true, tooNew: false });
  });
});

describe('syncVm status rows', () => {
  const rows = (s: Partial<SyncStatus>) => syncVm(input({ status: status(s) })).statusRows;
  const row = (s: Partial<SyncStatus>, label: string) => rows(s).find((r) => r.label === label);

  it('phase alone, with offline marker and the retry seconds left (counted down by Data, not the raw delay)', () => {
    expect(row({}, 'Phase')).toEqual({ label: 'Phase', value: 'idle' });
    expect(row({ phase: 'pulling', online: false }, 'Phase')).toEqual({ label: 'Phase', value: 'pulling · offline', error: true });
    const phase = (retryLeftMs: number | undefined, retryInMs: number) =>
      syncVm(input({ status: status({ retryInMs }), retryLeftMs })).statusRows.find((r) => r.label === 'Phase');
    expect(phase(4400, 10_000)).toEqual({ label: 'Phase', value: 'idle · retry in 4 s' });
    expect(phase(0, 10_000)).toEqual({ label: 'Phase', value: 'idle · retry in 0 s' });
    expect(phase(undefined, 10_000)).toEqual({ label: 'Phase', value: 'idle' });
  });

  it('last pull and push as local day and time, never when unknown', () => {
    expect(row({}, 'Last pull')).toEqual({ label: 'Last pull', value: 'never' });
    expect(row({}, 'Last push')).toEqual({ label: 'Last push', value: 'never' });
    const iso = '2030-03-04T11:05:00.000Z';
    const expected = `${formatDayLong(localDate(new Date(iso)))} ${formatTime(iso)}`;
    expect(row({ lastPullAt: iso }, 'Last pull')).toEqual({ label: 'Last pull', value: expected });
    expect(row({ lastPushAt: iso }, 'Last push')).toEqual({ label: 'Last push', value: expected });
  });

  it('queued with the held-back count', () => {
    expect(row({ queueLength: 2 }, 'Queued')).toEqual({ label: 'Queued', value: '2' });
    expect(row({ queueLength: 2, heldBackCount: 1 }, 'Queued')).toEqual({ label: 'Queued', value: '2 (1 held back)' });
  });

  it('error row only when there is one', () => {
    expect(row({}, 'Error')).toBeUndefined();
    expect(row({ lastError: 'boom' }, 'Error')).toEqual({ label: 'Error', value: 'boom', error: true });
    expect(rows({ lastError: 'boom' }).map((r) => r.label)).toEqual(['Phase', 'Last pull', 'Last push', 'Queued', 'Error']);
  });

  it('Sync now is disabled unless idle; the copy note shows while the folder stays empty', () => {
    expect(syncVm(input()).syncNowDisabled).toBe(false);
    expect(syncVm(input({ status: status({ phase: 'pushing' }) })).syncNowDisabled).toBe(true);
    expect(syncVm(input()).emptyFolderNote).toBe(false);
    expect(syncVm(input({ status: status({ emptyFolder: true, emptyFolderChoice: 'copy' }) })).emptyFolderNote).toBe(true);
  });
});

describe('syncVm issues', () => {
  const issue = (reason: IssueReason, detail = 'detail'): Issue => ({ path: `sessions/2030/2030-03-04-x.json`, reason, detail });
  const ADVICE: Record<IssueReason, string> = {
    'quarantined': "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it.",
    'read-only': 'Written by a newer app; update this app.',
    'needs-update': 'Written by a newer app; update this app.',
    'held-back': 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.',
    'duplicate': 'Remove the second file in Dropbox; the first one holds the merged content.',
    'remote-deleted': 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.',
    'unexpected-file': 'Not a CalisTally file; ignored.',
    'push-error': 'Retried automatically on the next sync.',
  };

  it.each(Object.keys(ADVICE) as IssueReason[])('one card per %s with its advice', (reason) => {
    const cards = syncVm(input({ issues: [issue(reason, 'the detail')] })).issues;
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toMatchObject({ path: 'sessions/2030/2030-03-04-x.json', reason, detail: 'the detail', advice: ADVICE[reason] });
    expect(card?.title.length).toBeGreaterThan(0);
    expect(card?.sessionId).toBeUndefined();
  });

  it('hard issues come first, then one soft card per session with its session id', () => {
    const s = session([block([], { exerciseId: 'foo', order: 0 }), block([], { order: 1 }), block([], { exerciseId: 'plank', order: 2 })], { id: 'b1000000-0000-4000-8000-000000000001', date: '2030-03-04' });
    const soft: SoftIssue = {
      path: 'sessions/2030/2030-03-04-s.json', sessionId: s.id, date: '2030-03-04',
      issues: [
        { level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise foo' },
        { level: 'soft', path: '/session/blocks/2/sets/1/reps', message: 'plank is measured in seconds' },
      ],
    };
    const cards = syncVm(input({ issues: [issue('held-back')], softIssues: [soft], sessions: [s] })).issues;
    expect(cards.map((c) => c.reason)).toEqual(['held-back', 'soft']);
    expect(cards[1]).toMatchObject({ path: soft.path, sessionId: s.id, title: 'Unknown exercise, metric mismatch' });
    expect(cards[1]?.detail).toBe(`${formatDayLong('2030-03-04')} · block 1: unknown exercise foo · block 3: plank is measured in seconds`);
    expect(cards[1]?.advice).toBe('Nothing is blocked; open the session to fix the block.');
  });

  it('numbers a block by its canonical position on the session page, not by its index in the file', () => {
    // File order: plank (order 5), a deleted block (order 0), foo (order 1). The page shows foo, then plank.
    const s = session(
      [
        block([], { exerciseId: 'plank', order: 5 }),
        block([], { exerciseId: 'dips', order: 0, deletedAt: '2030-03-04T12:00:00.000Z' }),
        block([], { exerciseId: 'foo', order: 1 }),
      ],
      { id: 'b1000000-0000-4000-8000-000000000002', date: '2030-03-04' },
    );
    const soft: SoftIssue = {
      path: 'p', sessionId: s.id, date: '2030-03-04',
      issues: [
        { level: 'soft', path: '/session/blocks/0/sets/0/reps', message: 'plank is measured in seconds' },
        { level: 'soft', path: '/session/blocks/2/exerciseId', message: 'unknown exercise foo' },
      ],
    };
    const card = syncVm(input({ softIssues: [soft], sessions: [s] })).issues[0];
    expect(card?.detail).toBe(`${formatDayLong('2030-03-04')} · block 2: plank is measured in seconds · block 1: unknown exercise foo`);
  });

  it('leaves the block number out when the session is not at hand', () => {
    const soft: SoftIssue = { path: 'p', sessionId: 'gone', date: '2030-03-04', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise foo' }] };
    expect(syncVm(input({ softIssues: [soft] })).issues[0]?.detail).toBe(`${formatDayLong('2030-03-04')} · unknown exercise foo`);
  });

  it('soft titles name the one kind when there is one', () => {
    const one = (message: string): SoftIssue => ({ path: 'p', sessionId: 's', date: '2030-03-04', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message }] });
    expect(syncVm(input({ softIssues: [one('unknown exercise foo')] })).issues[0]?.title).toBe('Unknown exercise');
    expect(syncVm(input({ softIssues: [one('plank is measured in seconds')] })).issues[0]?.title).toBe('Metric mismatch');
  });

  it('keys are unique across cards for the same path', () => {
    const cards = syncVm(input({ issues: [issue('duplicate'), issue('remote-deleted')] })).issues;
    expect(new Set(cards.map((c) => c.key)).size).toBe(2);
  });
});

describe('syncVm counts and footer', () => {
  it('passes the counts through', () => {
    expect(syncVm(input({ counts: { sessions: 3, exercises: 20, bodyweight: 5 } })).counts).toEqual({ sessions: 3, exercises: 20, bodyweight: 5 });
  });

  it('footer with persistent, not persistent, unknown', () => {
    expect(syncVm(input({ persisted: true })).footer).toBe('Build b1 · storage persistent');
    expect(syncVm(input({ persisted: false })).footer).toBe('Build b1 · storage not persistent');
    expect(syncVm(input({ persisted: undefined })).footer).toBe('Build b1 · storage unknown');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/idle.test.ts src/ui/app.test.tsx src/ui/app.vm.test.ts src/ui/components/sync/SyncTab.test.tsx src/ui/components/sync/sync.vm.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/app.vm.test.ts: Error: Cannot find module './app.vm' imported from src/ui/app.vm.test.ts
```


- [ ] **Step 3: Write the implementation**

Replace the whole content of `index.html` with:

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
    <link rel="stylesheet" href="./src/ui/theme.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/app/main.tsx"></script>
  </body>
</html>
```

Create `src/app/idle.ts`:

```ts
/** Timer functions the race needs; the default wraps the globals (a bare `setTimeout` as a method would lose its `this`). */
export interface IdleTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const REAL_TIMERS: IdleTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Spec 4 §7: wait for the engine to go idle, but at most `ms`; says which came first. */
export function raceIdle(whenIdle: () => Promise<void>, ms: number, timers: IdleTimers = REAL_TIMERS): Promise<'idle' | 'timeout'> {
  return new Promise<'idle' | 'timeout'>((resolve) => {
    let settled = false;
    const id = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, ms);
    whenIdle().then(
      () => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(id);
        resolve('idle');
      },
      () => {
        // A failed drain still means the engine stopped: treat it as idle.
        if (settled) return;
        settled = true;
        timers.clearTimeout(id);
        resolve('idle');
      },
    );
  });
}
```

Delete `src/app/main.ts`:

```
git rm src/app/main.ts
```

Create `src/app/main.tsx`:

```tsx
import { effect, signal } from '@preact/signals';
import { render } from 'preact';
import { Auth, AuthError } from '../sync/auth';
import { BroadcastChangeChannel } from '../sync/channel';
import { openDb } from '../sync/db';
import { DropboxHttpClient } from '../sync/dropbox-client';
import { Engine } from '../sync/engine';
import { WebLocksLeadership } from '../sync/lock';
import { Store } from '../sync/store';
import { App } from '../ui/app';
import { clockModeFor } from '../ui/app.vm';
import { AppContext, type AppDeps, type SyncActions, type UiState } from '../ui/context';
import { Data, storeChanges } from '../ui/data';
import { Router, routeHash, startRoute } from '../ui/router';
import { BASE_URL, BUILD_ID, DROPBOX_APP_KEY, redirectUri } from './config';
import { setupSwUpdate } from './sw-update';
import { attachTriggers } from './triggers';

/** Wires the sync library to the browser (spec 3 §12, §13) and mounts the Preact app (spec 4 §3). */
async function main(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  // The engine and the data signals are created after the store; store events reach them through these late bindings
  // (BroadcastChannel never delivers to the posting tab, so this tab's own changes go to Data directly).
  let engineRef: Engine | undefined;
  const db = await openDb();
  const channel = new BroadcastChangeChannel();
  const changes = storeChanges(channel);
  const store = new Store(db, {
    onChange: changes.onChange,
    onWrite: () => { engineRef?.requestPush(); },
  });
  const auth = new Auth(db, { appKey: DROPBOX_APP_KEY, redirectUri: redirectUri() }, { fetch: (input, init) => fetch(input, init) });
  const client = new DropboxHttpClient({
    fetch: (input, init) => fetch(input, init),
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
  });
  const engine = new Engine({ store, client, leadership: new WebLocksLeadership(), channel, buildId: BUILD_ID });
  engineRef = engine;
  await engine.init();

  const ui: UiState = {
    connected: signal(false),
    loginError: signal<string | undefined>(undefined),
    homeScreenHint: isIos() && !isStandalone(),
    pasteMode: signal(false),
    pasteUrl: signal<string | undefined>(undefined),
    persisted: signal<boolean | undefined>(undefined),
    updateAvailable: signal(false),
    buildId: BUILD_ID,
  };
  const sw = setupSwUpdate(() => { ui.updateAvailable.value = sw.updateAvailable; });

  // The OAuth redirect lands on the base URL with code and state (spec 3 §3).
  const params = new URLSearchParams(window.location.search);
  const afterOAuth = params.has('code') || params.has('error');
  if (afterOAuth) {
    if (params.has('code')) {
      try {
        await auth.completeLogin(params.get('code') as string, params.get('state') ?? undefined);
      } catch (e) {
        ui.loginError.value = e instanceof AuthError ? e.message : 'login failed';
      }
    } else {
      ui.loginError.value = `Dropbox did not authorise the app (${params.get('error_description') ?? params.get('error')})`;
    }
    window.history.replaceState(null, '', BASE_URL);
  }
  ui.connected.value = await auth.isConnected();
  if (!ui.connected.value) {
    engine.disconnect();
    // iOS may reload the installed app while the owner copies the code: bring the panel back.
    const resumed = await auth.resumePaste();
    if (resumed !== undefined) {
      ui.pasteMode.value = true;
      ui.pasteUrl.value = resumed;
    }
  }

  try {
    const persisted = (await navigator.storage?.persisted?.()) ? true : await navigator.storage?.persist?.();
    ui.persisted.value = persisted;
    await store.setMeta('persisted', persisted);
  } catch {
    ui.persisted.value = undefined;
  }

  const data = new Data({ store, engine, channel });
  changes.bind(data);
  await data.load();

  // Spec 4 §3 "Routing": Sync after the OAuth redirect; else Log while a session is open (§4 Resume);
  // else the last route; else Sync without data and connection; else Log.
  const hasLocalData = data.sessions.value.length > 0 || data.catalog.value !== undefined || data.bodyweight.value !== undefined;
  const router = new Router(window);
  router.navigate(
    startRoute({
      afterOAuth,
      openSession: data.openSession.value !== undefined,
      lastRoute: await data.getMeta<string>('lastRoute'),
      hasLocalData,
      connected: ui.connected.value,
    }),
    { replace: true },
  );
  effect(() => {
    const route = router.route.value;
    void data.setMeta('lastRoute', routeHash(route));
    data.setClock(clockModeFor(route));
  });

  /** Prepares the paste login and shows its link; the owner taps the link (spec 3 §3 fallback). */
  async function startPaste(): Promise<void> {
    ui.pasteMode.value = true;
    ui.pasteUrl.value = undefined;
    try {
      ui.pasteUrl.value = await auth.startLogin('paste');
      ui.loginError.value = undefined;
    } catch {
      ui.loginError.value = 'could not prepare the login; try again';
    }
  }

  async function finishPaste(code: string): Promise<void> {
    try {
      await auth.completeLogin(code);
      ui.loginError.value = undefined;
      ui.pasteMode.value = false;
      ui.pasteUrl.value = undefined;
      ui.connected.value = true;
      engine.reconnect();
      void engine.drain();
    } catch (e) {
      ui.loginError.value = e instanceof AuthError ? e.message : 'login failed';
    }
  }

  async function signOut(): Promise<void> {
    // Read the queue itself: engine.status.queueLength lags (and never updates in a non-leader tab).
    const pending = (await store.queue()).length;
    if (pending > 0 && !window.confirm(`${pending} change(s) have not reached Dropbox yet and will be lost. Sign out anyway?`)) return;
    engine.dispose();
    await Promise.race([engine.idle(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    await auth.signOut();
    await db.clearAll();
    window.location.reload();
  }

  const sync: SyncActions = {
    connect: () => { void auth.startLogin('redirect').then((url) => window.location.assign(url)); },
    startPaste: () => { void startPaste(); },
    submitCode: (code) => { void finishPaste(code); },
    syncNow: () => { void engine.drain(); },
    chooseEmptyFolder: (choice) => { void engine.chooseEmptyFolder(choice); },
    updateApp: () => sw.apply(() => engine.idle()),
    signOut: () => { void signOut(); },
  };

  let checkedForTooNew = false;
  engine.subscribe((status) => {
    // Spec 3 §12: a revoked login stops the engine; the Sync tab then offers "Connect again",
    // with the local data and the queue kept.
    ui.connected.value = status.connected;
    // Spec 3 §8: a file newer than this app means a newer build exists; look for it at once.
    if (status.tooNewSeen && !checkedForTooNew) {
      checkedForTooNew = true;
      void sw.check();
    }
  });
  attachTriggers(engine, sw);
  if (ui.connected.value) {
    sw.check().catch(() => undefined);
    void engine.drain();
  }

  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><App /></AppContext.Provider>, root);
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

void main();
```

Delete `src/app/shell.css`:

```
git rm src/app/shell.css
```

Delete `src/app/shell.test.ts`:

```
git rm src/app/shell.test.ts
```

Delete `src/app/shell.ts`:

```
git rm src/app/shell.ts
```

Replace the whole content of `src/app/sw-update.ts` with:

```ts
import { registerSW } from 'virtual:pwa-register';
import { raceIdle } from './idle';

/** The one-tap update (spec 3 §8, spec 4 §7): prompt mode, reload only when the engine is idle. */
export interface SwUpdate {
  /** A new build is installed and waiting. */
  updateAvailable: boolean;
  /** Ask the browser to look for a new service worker now. */
  check(): Promise<void>;
  /**
   * Activate the waiting build and reload once `whenIdle` resolves, at most 10 s later:
   * 'reloading' when the reload was requested, 'busy' when the engine did not go idle in time.
   */
  apply(whenIdle: () => Promise<void>): Promise<'reloading' | 'busy'>;
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
      if (await raceIdle(whenIdle, IDLE_WAIT_MS) === 'timeout') return 'busy';
      await updateSW(true);
      return 'reloading';
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

Create `src/ui/app.tsx`:

```tsx
import type { JSX } from 'preact';
import { badgeVm, tabOf, type Tab } from './app.vm';
import { DaysTab } from './components/days/DaysTab';
import { SessionPage } from './components/days/SessionPage';
import { LogTab } from './components/log/LogTab';
import { MoreTab } from './components/more/MoreTab';
import { ToastHost } from './components/shared';
import { SyncTab } from './components/sync/SyncTab';
import { useApp } from './context';
import type { Route } from './router';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'log', label: 'Log' },
  { id: 'days', label: 'Days' },
  { id: 'more', label: 'More' },
  { id: 'sync', label: 'Sync' },
];

function screenFor(route: Route): JSX.Element {
  switch (route.tab) {
    case 'log':
      return <LogTab />;
    case 'days':
      return route.sessionId === undefined ? <DaysTab /> : <SessionPage sessionId={route.sessionId} />;
    case 'more':
      return <MoreTab />;
    case 'sync':
      return <SyncTab />;
  }
}

/** Spec 4 §3: the route switch, the tab bar with the Sync badge (§7), and the toast host. */
export function App(): JSX.Element {
  const { data, router, ui } = useApp();
  const route = router.route.value;
  const active = tabOf(route);
  const badge = badgeVm({
    // store.issues() already lists held-back writes as 'held-back' issues; they are counted once, through heldBack.
    issues: data.issues.value.filter((i) => i.reason !== 'held-back').length,
    softIssues: data.softIssues.value.length,
    heldBack: data.heldBackCount.value,
    connected: ui.connected.value,
    updateAvailable: ui.updateAvailable.value,
  });
  return (
    <>
      <main class="app__main">{screenFor(route)}</main>
      <nav class="tabbar" aria-label="Tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            class={`tabbar__tab${active === t.id ? ' is-active' : ''}`}
            aria-label={t.label}
            aria-current={active === t.id ? 'page' : undefined}
            onClick={() => router.navigate({ tab: t.id })}
          >
            <span class="tabbar__label">{t.label}</span>
            {t.id === 'sync' && badge.count > 0 && <span class="tabbar__badge">{badge.count}</span>}
            {t.id === 'sync' && badge.dot && <span class="tabbar__dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>
      <ToastHost />
    </>
  );
}
```

Create `src/ui/app.vm.ts`:

```ts
import type { Route } from './router';

export type Tab = 'log' | 'days' | 'more' | 'sync';

/** Spec 4 §7 badge: the number of issues (hard and soft) plus held-back writes; a dot alone when not connected or an update waits. */
export function badgeVm(input: { issues: number; softIssues: number; heldBack: number; connected: boolean; updateAvailable: boolean }): { count: number; dot: boolean } {
  const count = input.issues + input.softIssues + input.heldBack;
  return { count, dot: count === 0 && (!input.connected || input.updateAvailable) };
}

/** The `now` tick for a route: every second where a number counts on screen (the Log tab's counter,
 *  the Sync tab's retry countdown), else every minute (spec 4 §3). */
export function clockModeFor(route: Route): 'fast' | 'slow' {
  const tab = tabOf(route);
  return tab === 'log' || tab === 'sync' ? 'fast' : 'slow';
}

/** The tab a route belongs to (the tab bar's active mark). */
export function tabOf(route: Route): Tab {
  return route.tab;
}
```

Create `src/ui/components/days/DaysTab.tsx`:

```tsx
import type { JSX } from 'preact';

/** Stub: the Days list (spec 4 §5) replaces it in task 10. */
export function DaysTab(): JSX.Element {
  return (
    <section class="placeholder">
      <h2>Days</h2>
    </section>
  );
}
```

Create `src/ui/components/days/SessionPage.tsx`:

```tsx
import type { JSX } from 'preact';

/** Stub: the session page (spec 4 §5) replaces it in task 11. */
export function SessionPage(p: { sessionId: string }): JSX.Element {
  return (
    <section class="placeholder">
      <h2>Session</h2>
      <p>{p.sessionId}</p>
    </section>
  );
}
```

Create `src/ui/components/log/LogTab.tsx`:

```tsx
import type { JSX } from 'preact';

/** Stub: the Log tab (spec 4 §4) replaces it in task 8. */
export function LogTab(): JSX.Element {
  return (
    <section class="placeholder">
      <h2>Log</h2>
    </section>
  );
}
```

Create `src/ui/components/more/MoreTab.tsx`:

```tsx
import type { JSX } from 'preact';

/** Plan 4a: the More tab is a menu placeholder; its screens come with plan 4b. */
export function MoreTab(): JSX.Element {
  return (
    <section class="placeholder">
      <h2>More</h2>
      <p>Exercises, calendar, bodyweight and catalog come with plan 4b.</p>
    </section>
  );
}
```

Create `src/ui/components/sync/SyncTab.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useApp } from '../../context';
import { Button } from '../shared';
import { syncVm, type IssueCard, type SyncVm, type UpdateState } from './sync.vm';

/**
 * Spec 4 §7: the Sync tab, replacing the shell of spec 3 §12 one to one, plus the soft issues and the
 * Update states. Sections top to bottom: Connection, Empty folder, Update, Status, Issues, Data.
 * Issues and Data render in every connection state, so the tab-bar badge is always explained; Status
 * needs a connection.
 */
export function SyncTab(): JSX.Element {
  const { data, sync, ui } = useApp();
  const updateState = useSignal<UpdateState>('idle');

  const vm = syncVm({
    status: data.status.value,
    retryLeftMs: data.retryLeftMs.value,
    issues: data.issues.value,
    softIssues: data.softIssues.value,
    sessions: data.liveSessions.value,
    connected: ui.connected.value,
    loginError: ui.loginError.value,
    homeScreenHint: ui.homeScreenHint,
    pasteMode: ui.pasteMode.value,
    pasteUrl: ui.pasteUrl.value,
    persisted: ui.persisted.value,
    updateAvailable: ui.updateAvailable.value,
    updateState: updateState.value,
    buildId: ui.buildId,
    counts: {
      sessions: data.liveSessions.value.length,
      exercises: data.exercises.value.filter((e) => e.deletedAt === undefined).length,
      bodyweight: data.bodyweight.value?.file.entries.filter((e) => e.deletedAt === undefined).length ?? 0,
    },
  });

  /** Tap → updating; the engine stayed busy for 10 s → retrying, one more try; busy again → failed; a reload keeps "Updating…". */
  async function runUpdate(): Promise<void> {
    updateState.value = 'updating';
    try {
      if (await sync.updateApp() === 'reloading') return;
      updateState.value = 'retrying';
      updateState.value = await sync.updateApp() === 'reloading' ? 'updating' : 'failed';
    } catch {
      // The service worker refused (it may have vanished): never leave the button disabled for good.
      updateState.value = 'failed';
    }
  }

  return (
    <div class="sync">
      <h1 class="sync__title">CalisTally</h1>
      {vm.connection.kind === 'disconnected' ? <Disconnected vm={vm} connection={vm.connection} /> : <ConnectedLine />}
      {vm.emptyFolder && <EmptyFolder />}
      {vm.update.show && (
        <section class="sync-card sync-card--notice">
          <p>{vm.update.note}</p>
          <Button kind="primary" disabled={vm.update.disabled} onClick={() => { void runUpdate(); }}>{vm.update.label}</Button>
        </section>
      )}
      {vm.update.tooNew && (
        <section class="sync-card sync-card--notice">
          <p>A newer version of the app wrote some files. They are shown read-only; update as soon as an update is offered.</p>
        </section>
      )}
      {vm.showStatus && <Status vm={vm} />}
      <section class="sync-card">
        <h2 class="sync-card__title">Issues</h2>
        {vm.issues.length === 0 ? <p class="sync--ok">None.</p> : <ul class="sync-issues">{vm.issues.map((card) => <IssueCardView key={card.key} card={card} />)}</ul>}
      </section>
      <section class="sync-card">
        <h2 class="sync-card__title">Data</h2>
        <dl class="sync-rows">
          <dt>Sessions</dt><dd>{vm.counts.sessions}</dd>
          <dt>Exercises</dt><dd>{vm.counts.exercises}</dd>
          <dt>Bodyweight entries</dt><dd>{vm.counts.bodyweight}</dd>
        </dl>
        <p class="sync__footer">{vm.footer}</p>
        {vm.connection.kind === 'connected' && (
          <div class="sync-actions">
            <Button kind="danger" onClick={() => sync.signOut()}>Sign out</Button>
          </div>
        )}
      </section>
    </div>
  );
}

function Disconnected(p: { vm: SyncVm; connection: Extract<SyncVm['connection'], { kind: 'disconnected' }> }): JSX.Element {
  const { sync } = useApp();
  const c = p.connection;
  const queued = p.vm.statusRows.find((r) => r.label === 'Queued');
  const codeRef = useRef<HTMLInputElement>(null);
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Dropbox</h2>
      <p>Not connected.</p>
      {c.hasLocal && <p>Your data and queued changes are kept. Connect again to resume syncing.</p>}
      {c.hasLocal && queued !== undefined && queued.value !== '0' && <p>Changes waiting for a connection: {queued.value}</p>}
      {c.hint && (
        <p class="sync-card--notice">
          On an iPhone, add this page to your Home Screen first (Share → Add to Home Screen) and open it from there. The login must happen inside the installed app.
        </p>
      )}
      {c.error !== undefined && <p class="sync--error">{c.error}</p>}
      <div class="sync-actions">
        <Button kind="primary" onClick={() => sync.connect()}>{c.hasLocal ? 'Connect again' : 'Connect to Dropbox'}</Button>
        <Button onClick={() => sync.startPaste()}>Paste a code instead</Button>
      </div>
      {c.pasteMode && (
        <div class="sync-paste">
          {c.pasteUrl === undefined ? (
            <p>Preparing the Dropbox link…</p>
          ) : (
            // A real link, not window.open after an await: a tapped link is never popup-blocked (iOS Safari).
            <p>1. <a href={c.pasteUrl} target="_blank" rel="noopener">Open Dropbox to get the code</a>, allow access, copy the code.</p>
          )}
          <p class="sync__muted">Dropbox may ask you to log in inside this sheet</p>
          <p>2. Paste the code here:</p>
          <input id="code" ref={codeRef} class="sync-paste__code" type="text" autocomplete="off" autocapitalize="off" spellcheck={false} />
          <Button kind="primary" onClick={() => sync.submitCode((codeRef.current?.value ?? '').trim())}>Finish login</Button>
        </div>
      )}
    </section>
  );
}

/** Spec 4 §7 "Connected: one line". */
function ConnectedLine(): JSX.Element {
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Dropbox</h2>
      <p class="sync--ok">Connected to Dropbox.</p>
    </section>
  );
}

function EmptyFolder(): JSX.Element {
  const { sync } = useApp();
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Empty Dropbox folder</h2>
      <p>The App folder holds no CalisTally files yet.</p>
      <div class="sync-actions">
        <Button kind="primary" onClick={() => sync.chooseEmptyFolder('seed')}>Start with the seed catalog</Button>
        <Button onClick={() => sync.chooseEmptyFolder('copy')}>I'll copy files in, then sync</Button>
      </div>
    </section>
  );
}

function Status(p: { vm: SyncVm }): JSX.Element {
  const { sync } = useApp();
  const vm = p.vm;
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Status</h2>
      <dl class="sync-rows">
        {vm.statusRows.map((r) => (
          <Fragment key={r.label}>
            <dt>{r.label}</dt>
            <dd class={r.error === true ? 'sync--error' : undefined}>{r.value}</dd>
          </Fragment>
        ))}
      </dl>
      <div class="sync-actions">
        <Button kind="primary" disabled={vm.syncNowDisabled} onClick={() => sync.syncNow()}>Sync now</Button>
      </div>
      {vm.emptyFolderNote && (
        <p class="sync__muted">The folder is still empty. Copy the files into <code>Dropbox/Apps/CalisTally</code>, wait for the desktop client, then tap Sync now.</p>
      )}
    </section>
  );
}

function IssueCardView(p: { card: IssueCard }): JSX.Element {
  const c = p.card;
  return (
    <li class={`sync-issue${c.reason === 'soft' ? ' sync-issue--soft' : ''}`}>
      <div class="sync-issue__head">
        <span class="sync-issue__title">{c.title}</span>
        <code class="sync-issue__path">{c.path}</code>
      </div>
      {c.detail.length > 0 && <p class="sync-issue__detail">{c.detail}</p>}
      <p class="sync-issue__advice">{c.advice}</p>
      {c.sessionId !== undefined && <a class="sync-issue__link" href={`#/days/${encodeURIComponent(c.sessionId)}`}>Open the session</a>}
    </li>
  );
}
```

Create `src/ui/components/sync/sync.vm.ts`:

```ts
import { liveBlocks } from '../../../model/derive';
import type { Session } from '../../../model/types';
import type { SyncStatus } from '../../../sync/engine';
import type { Issue, IssueReason } from '../../../sync/store';
import type { SoftIssue } from '../../data';
import { formatDayLong, formatTime, localDate } from '../../format';

/** Spec 4 §7: the Sync tab's pure view model; replaces the shell of spec 3 §12 one to one and adds the soft issues. */

export type UpdateState = 'idle' | 'updating' | 'retrying' | 'failed';

export interface SyncVmInput {
  status: SyncStatus;
  /** `Data.retryLeftMs`: the engine's retry delay counted down against `now`. */
  retryLeftMs: number | undefined;
  issues: Issue[];
  softIssues: SoftIssue[];
  /** The sessions the soft issues name, to number their blocks as the session page shows them. */
  sessions: readonly Session[];
  connected: boolean;
  loginError: string | undefined;
  homeScreenHint: boolean;
  pasteMode: boolean;
  pasteUrl: string | undefined;
  persisted: boolean | undefined;
  updateAvailable: boolean;
  updateState: UpdateState;
  buildId: string;
  counts: { sessions: number; exercises: number; bodyweight: number };
}

export interface IssueCard {
  key: string;
  path: string;
  reason: IssueReason | 'soft';
  title: string;
  detail: string;
  advice: string;
  sessionId?: string;
}

export interface SyncVm {
  connection:
    | { kind: 'disconnected'; hasLocal: boolean; hint: boolean; error: string | undefined; pasteMode: boolean; pasteUrl: string | undefined }
    | { kind: 'connected' };
  /** Spec 3 §11: the first pull found no data files and the owner has not chosen yet. */
  emptyFolder: boolean;
  /** Spec 4 §7: Status only when connected; Issues and Data in every state, so the badge is always explained. */
  showStatus: boolean;
  update: { show: boolean; label: string; disabled: boolean; note: string | undefined; tooNew: boolean };
  statusRows: { label: string; value: string; error?: boolean }[];
  syncNowDisabled: boolean;
  emptyFolderNote: boolean;
  issues: IssueCard[];
  counts: { sessions: number; exercises: number; bodyweight: number };
  footer: string;
}

const UPDATE_LABEL: Record<UpdateState, string> = {
  idle: 'Update app',
  updating: 'Updating…',
  retrying: 'Still syncing, trying again',
  failed: 'Could not update; try again after sync',
};

const UPDATE_NOTE = 'A new version of the app is ready.';

/** Spec 4 §7's table: the title and the action that applies, per reason. */
const CARD_TEXT: Record<IssueReason, { title: string; advice: string }> = {
  'quarantined': { title: 'Quarantined', advice: "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it." },
  'read-only': { title: 'Read-only', advice: 'Written by a newer app; update this app.' },
  'needs-update': { title: 'Needs a newer app', advice: 'Written by a newer app; update this app.' },
  'held-back': { title: 'Held back', advice: 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.' },
  'duplicate': { title: 'Duplicate file', advice: 'Remove the second file in Dropbox; the first one holds the merged content.' },
  'remote-deleted': { title: 'Removed from Dropbox', advice: 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.' },
  'unexpected-file': { title: 'Unexpected file', advice: 'Not a CalisTally file; ignored.' },
  'push-error': { title: 'Upload failed', advice: 'Retried automatically on the next sync.' },
};

// The session page does not flag blocks yet, so the advice does not claim it does.
const SOFT_ADVICE = 'Nothing is blocked; open the session to fix the block.';

function when(iso: string | undefined): string {
  if (iso === undefined) return 'never';
  return `${formatDayLong(localDate(new Date(iso)))} ${formatTime(iso)}`;
}

function phaseRow(s: SyncStatus, retryLeftMs: number | undefined): { label: string; value: string; error?: boolean } {
  let value: string = s.phase;
  if (!s.online) value += ' · offline';
  if (retryLeftMs !== undefined) value += ` · retry in ${Math.round(retryLeftMs / 1000)} s`;
  return s.online ? { label: 'Phase', value } : { label: 'Phase', value, error: true };
}

function statusRows(s: SyncStatus, retryLeftMs: number | undefined): SyncVm['statusRows'] {
  const rows: SyncVm['statusRows'] = [
    phaseRow(s, retryLeftMs),
    { label: 'Last pull', value: when(s.lastPullAt) },
    { label: 'Last push', value: when(s.lastPushAt) },
    { label: 'Queued', value: `${s.queueLength}${s.heldBackCount > 0 ? ` (${s.heldBackCount} held back)` : ''}` },
  ];
  if (s.lastError !== undefined) rows.push({ label: 'Error', value: s.lastError, error: true });
  return rows;
}

/**
 * 'block N: ' with N the block's 1-based position among the session's live blocks in canonical order,
 * as the session page lists them (the pointer's index is the file's array position, which carries no
 * meaning, spec 1 §3). Empty when the session or the block is not at hand.
 */
function blockNumber(pointer: string, session: Session | undefined): string {
  const m = /^\/session\/blocks\/(\d+)/.exec(pointer);
  if (m?.[1] === undefined || session === undefined) return '';
  const target = session.blocks[Number(m[1])];
  const position = target === undefined ? -1 : liveBlocks(session).indexOf(target);
  return position < 0 ? '' : `block ${position + 1}: `;
}

function softCard(soft: SoftIssue, session: Session | undefined): IssueCard {
  const unknown = soft.issues.some((i) => i.message.startsWith('unknown exercise'));
  const metric = soft.issues.some((i) => !i.message.startsWith('unknown exercise'));
  const kinds: string[] = [];
  if (unknown) kinds.push('Unknown exercise');
  if (metric) kinds.push(unknown ? 'metric mismatch' : 'Metric mismatch');
  return {
    key: `soft:${soft.path}`,
    path: soft.path,
    reason: 'soft',
    title: kinds.join(', '),
    detail: [formatDayLong(soft.date), ...soft.issues.map((i) => `${blockNumber(i.path, session)}${i.message}`)].join(' · '),
    advice: SOFT_ADVICE,
    sessionId: soft.sessionId,
  };
}

export function syncVm(input: SyncVmInput): SyncVm {
  const s = input.status;
  const c = input.counts;
  const hasLocal = s.queueLength > 0 || c.sessions > 0 || c.exercises > 0 || c.bodyweight > 0;

  let connection: SyncVm['connection'];
  if (!input.connected) {
    connection = {
      kind: 'disconnected',
      hasLocal,
      hint: input.homeScreenHint,
      error: input.loginError ?? (s.lastError !== undefined ? `Last error: ${s.lastError}` : undefined),
      pasteMode: input.pasteMode,
      pasteUrl: input.pasteUrl,
    };
  } else {
    connection = { kind: 'connected' };
  }

  const update: SyncVm['update'] = {
    show: input.updateAvailable,
    label: UPDATE_LABEL[input.updateState],
    disabled: input.updateState === 'updating' || input.updateState === 'retrying',
    note: input.updateAvailable ? UPDATE_NOTE : undefined,
    tooNew: !input.updateAvailable && s.tooNewSeen,
  };

  const hard: IssueCard[] = input.issues.map((i, n) => ({
    key: `${i.reason}:${i.path}:${n}`,
    path: i.path,
    reason: i.reason,
    title: CARD_TEXT[i.reason].title,
    detail: i.detail,
    advice: CARD_TEXT[i.reason].advice,
  }));

  const byId = new Map(input.sessions.map((x) => [x.id, x]));
  return {
    connection,
    emptyFolder: input.connected && s.emptyFolder && s.emptyFolderChoice !== 'copy',
    showStatus: input.connected,
    update,
    statusRows: statusRows(s, input.retryLeftMs),
    syncNowDisabled: s.phase !== 'idle',
    emptyFolderNote: s.emptyFolder && s.emptyFolderChoice === 'copy',
    issues: [...hard, ...input.softIssues.map((soft) => softCard(soft, byId.get(soft.sessionId)))],
    counts: { ...c },
    footer: `Build ${input.buildId} · storage ${input.persisted === undefined ? 'unknown' : input.persisted ? 'persistent' : 'not persistent'}`,
  };
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .app__main (app) ---- */
/* The scrolling area; the tab bar is fixed, so the bottom padding keeps the last row above it (the entry area adds its own later). */
.app__main {
  max-width: 40rem;
  margin: 0 auto;
  padding: env(safe-area-inset-top, 0px) 16px calc(56px + 16px + env(safe-area-inset-bottom, 0px));
}

/* ---- .tabbar (app) ---- */
.tabbar {
  position: fixed;
  bottom: 0;
  inset-inline: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--panel);
  border-top: 1px solid var(--outline);
}
.tabbar__tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 600;
}
.tabbar__tab.is-active { color: var(--accent); }
.tabbar__badge {
  position: absolute;
  top: 6px;
  left: calc(50% + 12px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: var(--on-accent);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.tabbar__dot {
  position: absolute;
  top: 10px;
  left: calc(50% + 16px);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

/* ---- .placeholder (stub screens) ---- */
.placeholder { padding: 24px 0; color: var(--muted); }
.placeholder h2 { margin: 0 0 8px; color: var(--text); }

/* ---- .sync (components/sync) ---- */
.sync { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.sync__title { margin: 0; font-size: 22px; }
.sync__footer { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.sync__muted { color: var(--muted); }
.sync--error { color: var(--danger); }
.sync--ok { color: var(--ok); }
.sync-card { padding: 12px 16px; border-radius: 12px; background: var(--panel); }
.sync-card p { margin: 6px 0; overflow-wrap: anywhere; }
.sync-card--notice { border-left: 3px solid var(--accent); }
.sync-card__title { margin: 0 0 8px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.sync-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sync-rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
.sync-rows dt { color: var(--muted); }
.sync-rows dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.sync-paste { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--outline); }
.sync-paste a { color: var(--accent); }
.sync-paste__code {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  margin: 4px 0 8px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}
.sync-issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sync-issue { padding: 8px 12px; border-radius: 10px; background: var(--panel-2); border-left: 3px solid var(--danger); }
.sync-issue--soft { border-left-color: var(--accent); }
.sync-issue__head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.sync-issue__title { font-weight: 600; }
.sync-issue__path { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.sync-issue__detail { color: var(--text); }
.sync-issue__advice { color: var(--muted); }
.sync-issue__link { color: var(--accent); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 59 test files and 845 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add index.html src/app/idle.test.ts src/app/idle.ts src/app/main.ts src/app/main.tsx src/app/shell.css src/app/shell.test.ts src/app/shell.ts src/app/sw-update.ts src/ui/app.test.tsx src/ui/app.tsx src/ui/app.vm.test.ts src/ui/app.vm.ts src/ui/components/days/DaysTab.tsx src/ui/components/days/SessionPage.tsx src/ui/components/log/LogTab.tsx src/ui/components/more/MoreTab.tsx src/ui/components/sync/SyncTab.test.tsx src/ui/components/sync/SyncTab.tsx src/ui/components/sync/sync.vm.test.ts src/ui/components/sync/sync.vm.ts src/ui/theme.css
git commit -m "Replace the diagnostic shell with the app shell and the Sync tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Log tab: start, reference and cards

The start picker with the proposed reference (§4 "Start"), resume, and the session screen with one card per reference block in the three states, the header (reference switch, Details, Start new, offline) and Done. The entry area, sheets and exercise search follow in Task 9.

**Files:**
- Create: `src/ui/components/log/LogScreen.tsx`
- Create: `src/ui/components/log/LogTab.test.tsx`
- Modify: `src/ui/components/log/LogTab.tsx`
- Create: `src/ui/components/log/StartPicker.tsx`
- Create: `src/ui/components/log/log-screen.vm.test.ts`
- Create: `src/ui/components/log/log-screen.vm.ts`
- Create: `src/ui/components/log/log-state.test.ts`
- Create: `src/ui/components/log/log-state.ts`
- Create: `src/ui/components/log/outcome.test.ts`
- Create: `src/ui/components/log/outcome.ts`
- Create: `src/ui/components/log/start-picker.vm.test.ts`
- Create: `src/ui/components/log/start-picker.vm.ts`
- Create: `src/ui/components/log/use-write-guard.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/edit`, `src/model/types`, `src/sync/paths`, `src/ui/components/shared`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/held-back`, `src/ui/toast`.
- Produces:
  - `src/ui/components/log/LogScreen.tsx`:
    - `export function LogScreen(p: { row: SessionRow; vm: LogScreenVm }): JSX.Element`
  - `src/ui/components/log/LogTab.tsx`:
    - `export function LogTab(): JSX.Element`
  - `src/ui/components/log/StartPicker.tsx`:
    - `export function StartPicker(): JSX.Element`
    - `export function PickerSheet(p: { mode: 'start' | 'change'; sessionId?: string; onClose(): void }): JSX.Element`
  - `src/ui/components/log/log-screen.vm.ts`:
    - `export type CardState = 'not-started' | 'current' | 'finished'`
    - `export interface CardVm`
    - `export interface CurrentVm`
    - `export interface LogScreenVm`
    - `export interface LogScreenInput`
    - `export function resolveReference(chosen: string | undefined, sessions: readonly Session[], catalog: readonly Exercise[], todayId: string): Session | undefined`
    - `export function logScreenVm(input: LogScreenInput): LogScreenVm`
  - `src/ui/components/log/log-state.ts`:
    - `export const currentBlockId: Signal<string | undefined> = signal<string | undefined>(undefined)`
    - `export const referenceId: Signal<string | 'none' | undefined> = signal<string | 'none' | undefined>(undefined)`
    - `export const referenceLoadedFor: Signal<string | undefined> = signal<string | undefined>(undefined)`
    - `export interface EntryDraft`
    - `export type DraftPatch = { [K in keyof EntryDraft]?: EntryDraft[K] | undefined }`
    - `export const entryDraft: Signal<Map<string, EntryDraft>> = signal<Map<string, EntryDraft>>(new Map())`
    - `export function draftFor(blockId: string): EntryDraft`
    - `export function typedValue(draft: EntryDraft, setNumber: number): number | undefined`
    - `export function setDraft(blockId: string, patch: DraftPatch): void`
    - `export function clearDraft(blockId: string): void`
  - `src/ui/components/log/outcome.ts`:
    - `export const HELD_BACK_TEXT = 'Saved here, not uploaded (app bug)'`
    - `export type Written = { ok: false } | { ok: true; heldBackNote: boolean }`
    - `export function quietOutcome(path: string, outcome: WriteOutcome): Written`
    - `export function showHeldBack(): void`
    - `export function reportOutcome(path: string, outcome: WriteOutcome): boolean`
    - `export async function editSessionQuiet(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<Written>`
    - `export async function editSession(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<boolean>`
  - `src/ui/components/log/start-picker.vm.ts`:
    - `export interface PickerRow`
    - `export interface StartPickerVm`
    - `export function startPickerVm(sessions: readonly Session[], catalog: ReadonlyMap<string, Exercise>, excludeId: string | undefined): StartPickerVm`
  - `src/ui/components/log/use-write-guard.ts`:
    - `export const HOLD_MS = 3000`
    - `export const ADD_SET_MIN_HOLD_MS = 800`
    - `export interface WriteGuard`
    - `export interface WriteGuardOptions`
    - `export function useWriteGuard(isShown: (id: string) => boolean, options: WriteGuardOptions = {}): WriteGuard`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/components/log/LogTab.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { FileKind, Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor } from './log-state';
import { LogTab } from './LogTab';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/log' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const pathOf = (s: Session): string => sessionPath(s.date, s.id);

async function mount(sessions: Session[], meta: Record<string, unknown> = {}) {
  const db = await openDb(new IDBFactory());
  let data: Data | undefined;
  const store = new Store(db, { onChange: (p) => void data?.refresh(p) });
  const files: [FileKind, string, unknown][] = [['exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL])], ...sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)])];
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, NOW);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(meta)) await store.setMeta(key, value);
  data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const deps: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
  return { data, store, router: deps.router };
}

async function sessionFiles(store: Store): Promise<SessionFile[]> {
  return (await store.sessions()).map((r) => r.file);
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  referenceLoadedFor.value = undefined;
  entryDraft.value = new Map();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** happy-dom has no window.confirm; the stub is undone after each test. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

async function fileOf(store: Store, s: Session): Promise<SessionFile> {
  return (await store.getRow(pathOf(s)))?.content as SessionFile;
}

// 2030-03-05 is a Tuesday.
const pastPush = (): Session =>
  session([block(ladder([8, 8], { completedAt: '2030-03-05T10:05:00.000Z' }), { exerciseId: 'dips-bar' }), block(ladder([17, 16, 15]), { exerciseId: 'push-ups', order: 1 })], {
    date: '2030-03-05',
    startedAt: '2030-03-05T10:00:00.000Z',
  });

describe('LogTab without an open session', () => {
  it('starts a session against the chosen reference: writes the file with startedAt and stores the choice', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const sheet = screen.getByRole('dialog', { name: 'Train against' });
    const row = within(sheet).getByRole('button', { name: /Tue 05 Mar/ });
    expect(row.textContent).toContain('Dips (Bar) · Push-ups');
    expect(row.textContent).toContain('proposed');
    fireEvent.click(row);

    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const started = (await sessionFiles(store)).find((f) => f.session.id !== past.id)?.session;
    expect(started?.startedAt).toBe(NOW.toISOString());
    expect(started?.date).toBe(localDate(NOW));
    expect(started?.blocks).toEqual([]);
    const id = started?.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe(past.id));
    // The open session now shows, with the reference in the header and its cards not started.
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card--not-started')).toHaveLength(2);
  });

  it('a double tap on a picker row starts one session', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const row = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: /Tue 05 Mar/ });
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('a double tap on No reference starts one session; the rows are disabled while it runs', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }) as HTMLButtonElement;
    fireEvent.click(none);
    await waitFor(() => expect(none.disabled).toBe(true));
    fireEvent.click(none);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('stores none for No reference', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.click(screen.getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const id = (await sessionFiles(store)).find((f) => f.session.startedAt === NOW.toISOString())?.session.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });
});

describe('LogTab with an open session', () => {
  function openToday(): Session {
    return session([block(ladder([8, 8], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'dips-bar' })], {
      date: '2030-03-07',
      startedAt: '2030-03-07T10:00:00.000Z',
    });
  }

  it('shows the cards; Start on a not-started card adds a block and makes it current', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    expect(dips.className).toContain('log-card--current');
    expect(within(dips).getByText('today 16 · 2 sets')).toBeTruthy();
    const push = screen.getByRole('article', { name: 'Push-ups' });
    expect(push.className).toContain('log-card--not-started');

    fireEvent.click(within(push).getByRole('button', { name: 'Start' }));
    await waitFor(async () => {
      const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
      expect(file.session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
    });
    const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
    const added = file.session.blocks[1];
    expect(added?.updatedAt).toBe(NOW.toISOString());
    expect(currentBlockId.value).toBe(added?.id);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
  });

  it('a double tap on Start adds one block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    await new Promise((r) => setTimeout(r, 30));
    expect((await fileOf(store, today)).session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
  });

  it('Start stays held after its write until the refreshed row shows the block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const refresh = data.refresh.bind(data);
    const pending: (() => void)[] = [];
    vi.spyOn(data, 'refresh').mockImplementation((path: string) => new Promise<void>((resolve) => {
      pending.push(() => void refresh(path).then(resolve));
    }));
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    fireEvent.click(start);
    await waitFor(async () => expect((await fileOf(store, today)).session.blocks).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    await new Promise((r) => setTimeout(r, 20));
    expect((await fileOf(store, today)).session.blocks).toHaveLength(2);
    act(() => { for (const run of pending) run(); });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
  });

  it("the header's Details opens the session page of the open session", async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(router.route.value).toEqual({ tab: 'days', sessionId: today.id });
  });

  it('a double tap on a row of the change picker stores the choice once', async () => {
    const past = pastPush();
    const today = openToday();
    const { data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const setMeta = vi.spyOn(data, 'setMeta');
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' });
    fireEvent.click(none);
    fireEvent.click(none);
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(setMeta.mock.calls.filter(([key]) => key === `reference:${today.id}`)).toHaveLength(1);
  });

  it('tapping a finished card makes it current again', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    fireEvent.click(dips.querySelector('.log-card__body') as Element);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it('the finished card has a keyboard target: a focusable button that Enter or Space makes current', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const target = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / });
    expect(target.tabIndex).toBe(0);
    fireEvent.keyDown(target, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
    // The current card offers no make-current target.
    expect(within(screen.getByRole('article', { name: 'Dips (Bar)' })).queryByRole('button', { name: /^Make Dips \(Bar\) current/ })).toBeNull();
  });

  it('Space on the make-current target works as Enter does', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block(ladder([17], { completedAt: '2030-03-07T10:25:00.000Z' }), { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    fireEvent.keyDown(within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / }), { key: ' ' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it('renders no card before the stored reference is read, so the proposal never flashes', async () => {
    const past = pastPush();
    const today = openToday();
    const db = await openDb(new IDBFactory());
    const store = new Store(db);
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL]), NOW);
    for (const s of [past, today]) await store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    const data = new Data({ store, now: () => NOW });
    await data.load();
    let answer: (v: string) => void = () => {};
    vi.spyOn(data, 'getMeta').mockImplementation(<T,>() => new Promise<T | undefined>((resolve) => { answer = (v) => resolve(v as T); }));
    const sync: SyncActions = {
      connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
      updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
    };
    const ui = {
      connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    };
    render(<AppContext.Provider value={{ data, router: new Router(fakeWindow()), sync, ui }}><LogTab /></AppContext.Provider>);
    await new Promise((r) => setTimeout(r, 10));
    // The proposal (Tue 05 Mar) would show the Push-ups card; nothing shows until the read finished.
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^vs / })).toBeNull();
    answer('none');
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(screen.queryByRole('article', { name: 'Push-ups' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy();
  });

  it('takes write times from data.clock(), not from the ticking now signal', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    // The screen re-renders with a later tick (the session stays open), so a handler that read
    // data.now at render time would write 10:31.
    act(() => { data.now.value = new Date(NOW.getTime() + 60_000); });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }));
    await waitFor(async () => expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks).toHaveLength(2));
    expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks[1]?.updatedAt).toBe(NOW.toISOString());
  });

  it('re-proposes when the stored reference is gone, and changing it writes only the meta key', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: 'deleted-session' });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await store.getMeta(`reference:${today.id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new asks first and writes nothing when declined', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    const confirm = answerConfirm(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^A session from \d\d:\d\d is still open\. Start a new one anyway\?$/);
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new, confirmed, writes a new session that takes over the screen', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(3));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });

  it('Done goes to the Days tab', async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(router.route.value).toEqual({ tab: 'days' });
  });

  it('Done writes nothing: no file write, the queue unchanged (spec 4 U7)', async () => {
    const today = openToday();
    const { store } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    const queueBefore = await store.queue();
    const rowBefore = await store.getRow(pathOf(today));
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).not.toHaveBeenCalled();
    expect(await store.queue()).toEqual(queueBefore);
    expect(await store.getRow(pathOf(today))).toEqual(rowBefore);
  });
});
```

Create `src/ui/components/log/log-screen.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Block, Exercise, Session } from '../../../model/types';
import { formatAmount, formatTime } from '../../format';
import { logScreenVm, resolveReference } from './log-screen.vm';

const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push', defaultLoadType: 'added' });
const DIAMOND = exercise({ id: 'diamond-push-ups', name: 'Diamond Push-ups', pattern: 'push', archived: true });
const PLANK = exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds' });
const CATALOG: ReadonlyMap<string, Exercise> = new Map([PUSH, DIPS, DIAMOND, PLANK].map((e) => [e.id, e]));

const STARTED = '2030-03-07T10:00:00.000Z';
const NOW = new Date('2030-03-07T10:30:00.000Z');

/** Sets with completedAt one minute apart from `from`. */
function timed(reps: number[], from: string, over: Parameters<typeof ladder>[1] = {}) {
  const t0 = Date.parse(from);
  return ladder(reps, over).map((s, i) => ({ ...s, completedAt: new Date(t0 + i * 60000).toISOString() }));
}

function fixture() {
  const refDips = block(ladder([8, 8, 8], { loadType: 'added', loadKg: 11.5 }), { exerciseId: 'dips-bar', order: 0 });
  const refPush = block(ladder([17, 16, 15, 14, 13, 12]), { exerciseId: 'push-ups', order: 1 });
  const refDiamond = block(ladder([20, 20]), { exerciseId: 'diamond-push-ups', order: 2 });
  const reference = session([refDips, refPush, refDiamond], { date: '2030-02-28' });
  const todayDips = block(timed([8, 8, 8], '2030-03-07T10:01:00.000Z', { loadType: 'added', loadKg: 12 }), { exerciseId: 'dips-bar', order: 0 });
  const todayPush = block(timed([17, 16, 15, 14], '2030-03-07T10:10:00.000Z'), { exerciseId: 'push-ups', order: 1 });
  const today = session([todayDips, todayPush], { date: '2030-03-07', startedAt: STARTED });
  return { reference, today, refDips, refPush, refDiamond, todayDips, todayPush };
}

const vmOf = (today: Session, reference: Session | undefined, over: { currentBlockId?: string; now?: Date; online?: boolean } = {}) =>
  logScreenVm({ today, reference, catalog: CATALOG, currentBlockId: over.currentBlockId, now: over.now ?? NOW, online: over.online ?? true });

describe('logScreenVm header', () => {
  it('shows the long date, the start time and the reference day', () => {
    const { today, reference } = fixture();
    expect(vmOf(today, reference).header).toEqual({ date: 'Thu 2030-03-07', startedAt: formatTime(STARTED), reference: 'vs Thu 28 Feb', offline: false });
  });

  it('has no reference text without a reference and flags offline', () => {
    const { today } = fixture();
    const header = vmOf(today, undefined, { online: false }).header;
    expect(header.reference).toBeUndefined();
    expect(header.offline).toBe(true);
  });
});

describe('logScreenVm cards', () => {
  it('pairs reference and today blocks: finished, current, not-started', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference);
    expect(vm.cards.map((c) => [c.key, c.exerciseId, c.state, c.todayBlockId, c.referenceBlockId])).toEqual([
      [f.refDips.id, 'dips-bar', 'finished', f.todayDips.id, f.refDips.id],
      [f.refPush.id, 'push-ups', 'current', f.todayPush.id, f.refPush.id],
      [f.refDiamond.id, 'diamond-push-ups', 'not-started', undefined, f.refDiamond.id],
    ]);
    const diamond = vm.cards[2];
    expect(diamond?.name).toBe('Diamond Push-ups');
    expect(diamond?.archived).toBe(true);
    expect(diamond?.todaySets).toEqual([]);
    expect(diamond?.referenceSets.map((s) => s.id)).toEqual(f.refDiamond.sets.map((s) => s.id));
    expect(diamond?.totals).toBeUndefined();
    expect(diamond?.proposed).toBeUndefined();
  });

  it('appends today-only blocks keyed by their own id; without a reference only today cards', () => {
    const f = fixture();
    const extra = block([set({ reps: 5, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'muscle-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [...f.today.blocks, extra] };
    const withRef = vmOf(today, f.reference);
    const last = withRef.cards[3];
    expect(last).toMatchObject({ key: extra.id, exerciseId: 'muscle-ups', name: 'muscle-ups', archived: false, metric: 'reps', referenceBlockId: undefined, state: 'current' });
    const noRef = vmOf(today, undefined);
    expect(noRef.cards.map((c) => c.key)).toEqual([f.todayDips.id, f.todayPush.id, extra.id]);
  });

  it('makes the named block current when it is a live block of today', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id });
    expect(vm.cards.map((c) => c.state)).toEqual(['current', 'finished', 'not-started']);
    expect(vm.current?.blockId).toBe(f.todayDips.id);
  });

  it('falls back to the last live block when currentBlockId is unknown or deleted', () => {
    const f = fixture();
    expect(vmOf(f.today, f.reference, { currentBlockId: 'nope' }).current?.blockId).toBe(f.todayPush.id);
    const deleted: Block = { ...f.todayDips, deletedAt: '2030-03-07T10:05:00.000Z' };
    const today: Session = { ...f.today, blocks: [deleted, f.todayPush] };
    const vm = vmOf(today, f.reference, { currentBlockId: deleted.id });
    expect(vm.current?.blockId).toBe(f.todayPush.id);
    expect(vm.cards[0]?.state).toBe('not-started');
  });

  it('has no current card in an empty session', () => {
    const f = fixture();
    const today: Session = { ...f.today, blocks: [] };
    const vm = vmOf(today, f.reference);
    expect(vm.current).toBeUndefined();
    expect(vm.cards.every((c) => c.state === 'not-started')).toBe(true);
  });

  it('proposes the reference set at the next position and marks it in the reference chips', () => {
    const f = fixture();
    const push = vmOf(f.today, f.reference).cards[1];
    expect(push?.proposed).toBe(13);
    expect(push?.markIndex).toBe(4);
  });

  it('proposes today’s last set without a mark once the reference runs out', () => {
    const f = fixture();
    const dips = vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id }).cards[0];
    expect(dips?.proposed).toBe(8);
    expect(dips?.markIndex).toBeUndefined();
  });

  it('a migrated aggregate set at the next position is neither proposed nor marked', () => {
    const refPush = block([set({ reps: 100, aggregate: true, order: 0 })], { exerciseId: 'push-ups' });
    const reference = session([refPush], { date: '2030-02-28', source: 'migrated' });
    const todayPush = block([], { exerciseId: 'push-ups' });
    const today = session([todayPush], { date: '2030-03-07', startedAt: STARTED });
    const push = vmOf(today, reference).cards[0];
    expect(push?.state).toBe('current');
    expect(push?.proposed).toBeUndefined();
    expect(push?.markIndex).toBeUndefined();
  });

  it('gives proposed and markIndex only to the current card', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference, { currentBlockId: f.todayDips.id });
    expect(vm.cards[1]?.proposed).toBeUndefined();
    expect(vm.cards[1]?.markIndex).toBeUndefined();
  });

  it('writes the totals text for today and last time', () => {
    const f = fixture();
    const push = vmOf(f.today, f.reference).cards[1];
    expect(push?.totals).toEqual({ today: `today ${formatAmount(62)} · 4 sets`, reference: `last ${formatAmount(87)} · 6 sets` });
  });

  it('says 1 set and leaves the reference text empty without a reference block', () => {
    const f = fixture();
    const extra = block([set({ reps: 5, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'push-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [...f.today.blocks, extra] };
    const card = vmOf(today, f.reference).cards[3];
    expect(card?.totals).toEqual({ today: 'today 5 · 1 set', reference: '' });
  });

  it('compares only finished cards that have both blocks', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference);
    // Dips: 24 = 24 reps, load +12 vs +11.5 kg.
    expect(vm.cards[0]?.marks).toEqual({ amount: 'same', load: 'up' });
    expect(vm.cards[1]?.marks).toBeUndefined(); // current
    expect(vm.cards[2]?.marks).toBeUndefined(); // not started
    const extra = block([set({ reps: 5, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'push-ups', order: 2 });
    const today: Session = { ...f.today, blocks: [...f.today.blocks, extra] };
    const onlyToday = vmOf(today, f.reference, { currentBlockId: f.todayDips.id }).cards[3];
    expect(onlyToday?.state).toBe('finished');
    expect(onlyToday?.marks).toBeUndefined();
  });

  it('takes the load text from today’s last set, else the reference, else the exercise default', () => {
    const f = fixture();
    const vm = vmOf(f.today, f.reference);
    expect(vm.cards[0]?.loadText).toBe(`+${formatAmount(12)} kg`);
    expect(vm.cards[2]?.loadText).toBe('bodyweight');
    const refDips = block(ladder([8], { loadType: 'added', loadKg: 11.5 }), { exerciseId: 'dips-bar' });
    const notStarted = vmOf({ ...f.today, blocks: [] }, session([refDips], { date: '2030-02-28' })).cards[0];
    expect(notStarted?.loadText).toBe(`+${formatAmount(11.5)} kg`);
    const fresh = block([], { exerciseId: 'dips-bar' });
    const own = vmOf({ ...f.today, blocks: [fresh] }, undefined).cards[0];
    expect(own?.loadText).toBe(`+${formatAmount(0)} kg`);
  });

  it('carries the block note of today’s block', () => {
    const f = fixture();
    const today: Session = { ...f.today, blocks: [f.todayDips, { ...f.todayPush, note: 'slow eccentrics' }] };
    expect(vmOf(today, f.reference).cards[1]?.blockNote).toBe('slow eccentrics');
    expect(vmOf(today, f.reference).cards[0]?.blockNote).toBeUndefined();
  });

  it('leaves out deleted sets and orders sets canonically', () => {
    const f = fixture();
    const sets = [set({ reps: 3, order: 2 }), set({ reps: 9, order: 1, deletedAt: '2030-03-07T10:02:00.000Z' }), set({ reps: 1, order: 0 })];
    const b = block(sets, { exerciseId: 'push-ups' });
    const card = vmOf({ ...f.today, blocks: [b] }, undefined).cards[0];
    expect(card?.todaySets.map((s) => 'reps' in s && s.reps)).toEqual([1, 3]);
  });
});

describe('logScreenVm counter and current', () => {
  it('counts from the latest completedAt; undefined before the first set', () => {
    const f = fixture();
    // The last push-up set completed at 10:13; now 10:30 → 17:00.
    expect(vmOf(f.today, f.reference).counter).toBe('17:00');
    expect(vmOf(f.today, f.reference, { now: new Date('2030-03-07T10:13:48.000Z') }).counter).toBe('0:48');
    expect(vmOf({ ...f.today, blocks: [block([], { exerciseId: 'push-ups' })] }, undefined).counter).toBeUndefined();
  });

  it('builds the entry data from the current card', () => {
    const f = fixture();
    expect(vmOf(f.today, f.reference).current).toEqual({
      blockId: f.todayPush.id,
      exerciseId: 'push-ups',
      name: 'Push-ups',
      metric: 'reps',
      setNumber: 5,
      proposed: 13,
      step: 1,
      load: { loadType: 'bodyweight', loadKg: 0, needsKg: false },
      loadText: 'bodyweight',
    });
  });

  it('steps by 5 for a timed exercise and asks for kg on a weighted default', () => {
    const f = fixture();
    const plank = block([timedSet({ seconds: 60, completedAt: '2030-03-07T10:20:00.000Z' })], { exerciseId: 'plank' });
    const current = vmOf({ ...f.today, blocks: [plank] }, undefined).current;
    expect(current).toMatchObject({ metric: 'seconds', step: 5, setNumber: 2, proposed: 60 });
    const dips = block([], { exerciseId: 'dips-bar' });
    expect(vmOf({ ...f.today, blocks: [dips] }, undefined).current?.load).toEqual({ loadType: 'added', loadKg: 0, needsKg: true });
  });
});

describe('resolveReference', () => {
  const catalog = [...CATALOG.values()];
  const pushOld = session([block([], { exerciseId: 'push-ups' })], { date: '2030-03-01' });
  const pushNew = session([block([], { exerciseId: 'push-ups' })], { date: '2030-03-05' });
  const today = session([], { date: '2030-03-07', startedAt: STARTED });
  const all = [pushOld, pushNew, today];

  it('uses the stored choice when it names a live session', () => {
    expect(resolveReference(pushOld.id, all, catalog, today.id)?.id).toBe(pushOld.id);
  });

  it('has no reference for none', () => {
    expect(resolveReference('none', all, catalog, today.id)).toBeUndefined();
  });

  it('re-proposes when the choice is missing, unknown (deleted) or today itself', () => {
    expect(resolveReference(undefined, all, catalog, today.id)?.id).toBe(pushNew.id);
    expect(resolveReference('gone', all, catalog, today.id)?.id).toBe(pushNew.id);
    expect(resolveReference(today.id, all, catalog, today.id)?.id).toBe(pushNew.id);
  });
});
```

Create `src/ui/components/log/log-state.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { clearDraft, draftFor, entryDraft, setDraft, typedValue } from './log-state';

afterEach(() => {
  entryDraft.value = new Map();
});

describe('entry drafts', () => {
  it('a block without a draft reads as empty', () => {
    expect(draftFor('a')).toEqual({});
  });

  it('setDraft merges a patch; undefined removes a field; drafts are per block', () => {
    setDraft('a', { typed: { amount: 12, setNumber: 2 }, note: 'slow' });
    setDraft('a', { load: { loadType: 'added', loadKg: 10 } });
    setDraft('b', { note: 'other' });
    expect(draftFor('a')).toEqual({ typed: { amount: 12, setNumber: 2 }, note: 'slow', load: { loadType: 'added', loadKg: 10 } });
    setDraft('a', { typed: undefined, note: undefined });
    expect(draftFor('a')).toEqual({ load: { loadType: 'added', loadKg: 10 } });
    expect(draftFor('b')).toEqual({ note: 'other' });
  });

  it('every change replaces the map (the signal notifies), and an emptied draft leaves it', () => {
    const before = entryDraft.value;
    setDraft('a', { typed: { amount: 3, setNumber: 1 } });
    expect(entryDraft.value).not.toBe(before);
    setDraft('a', { typed: undefined });
    expect(entryDraft.value.has('a')).toBe(false);
  });

  it('typedValue gives the typed amount only for the set number it was typed for', () => {
    setDraft('a', { typed: { amount: 15, setNumber: 3 } });
    expect(typedValue(draftFor('a'), 3)).toBe(15);
    expect(typedValue(draftFor('a'), 4)).toBeUndefined();
    expect(typedValue(draftFor('a'), 2)).toBeUndefined();
    expect(typedValue(draftFor('b'), 3)).toBeUndefined();
  });

  it('clearDraft drops the whole draft of one block', () => {
    setDraft('a', { typed: { amount: 3, setNumber: 1 }, load: { loadType: 'band', loadKg: 0 } });
    setDraft('b', { typed: { amount: 4, setNumber: 1 } });
    clearDraft('a');
    expect(entryDraft.value.has('a')).toBe(false);
    expect(draftFor('b')).toEqual({ typed: { amount: 4, setNumber: 1 } });
  });
});
```

Create `src/ui/components/log/outcome.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { EditError } from '../../../model/edit';
import { sessionFile } from '../../../model/test-fixtures';
import type { SessionFile } from '../../../model/types';
import type { WriteOutcome } from '../../data';
import { dismissToast, showToast, toast } from '../../toast';
import { editSession, editSessionQuiet, HELD_BACK_TEXT, quietOutcome, reportOutcome, showHeldBack } from './outcome';

afterEach(() => dismissToast());

describe('quietOutcome', () => {
  it('owes the held-back note the first time per path and shows nothing itself', () => {
    expect(quietOutcome('/quiet.json', { ok: true, heldBack: true })).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    expect(quietOutcome('/quiet.json', { ok: true, heldBack: true })).toEqual({ ok: true, heldBackNote: false });
    expect(quietOutcome('/quiet-ok.json', { ok: true, heldBack: false })).toEqual({ ok: true, heldBackNote: false });
  });

  it('still names a refusal', () => {
    expect(quietOutcome('/q.json', { ok: false, reason: 'changed' })).toEqual({ ok: false });
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
  });
});

describe('showHeldBack', () => {
  it('shows the note alone when no toast is showing', () => {
    showHeldBack();
    expect(toast.value).toEqual({ text: HELD_BACK_TEXT, ms: 4000 });
  });

  it('folds the note into the toast showing, keeping its action and time', () => {
    const run = (): void => {};
    showToast('Set 8 deleted', { label: 'Undo', run }, 6000);
    showHeldBack();
    expect(toast.value).toEqual({ text: `Set 8 deleted · ${HELD_BACK_TEXT}`, action: { label: 'Undo', run }, ms: 6000 });
    showHeldBack();
    expect(toast.value?.text).toBe(`Set 8 deleted · ${HELD_BACK_TEXT}`);
  });
});

describe('editSessionQuiet', () => {
  const fakeData = (outcome: WriteOutcome) => ({
    edit<F>(_kind: string, _path: string, fn: (file: F) => F): Promise<WriteOutcome> {
      fn(sessionFile() as F);
      return Promise.resolve(outcome);
    },
  });

  it('returns the owed note; an EditError becomes a toast', async () => {
    expect(await editSessionQuiet(fakeData({ ok: true, heldBack: true }), '/eq.json', (f: SessionFile) => f)).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    const failed = await editSessionQuiet(fakeData({ ok: true, heldBack: false }), '/eq.json', () => {
      throw new EditError('reps must be more than 0, got 0');
    });
    expect(failed).toEqual({ ok: false });
    expect(toast.value?.text).toBe('reps must be more than 0, got 0');
  });
});

describe('reportOutcome', () => {
  it('is quiet on a plain ok', () => {
    expect(reportOutcome('/a.json', { ok: true, heldBack: false })).toBe(true);
    expect(toast.value).toBeUndefined();
  });

  it('shows the held-back toast once per path', () => {
    expect(reportOutcome('/held.json', { ok: true, heldBack: true })).toBe(true);
    expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)');
    dismissToast();
    expect(reportOutcome('/held.json', { ok: true, heldBack: true })).toBe(true);
    expect(toast.value).toBeUndefined();
  });

  it('names a changed row and a refused row', () => {
    expect(reportOutcome('/b.json', { ok: false, reason: 'changed' })).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
    expect(reportOutcome('/b.json', { ok: false, reason: 'quarantined' })).toBe(false);
    expect(toast.value?.text).toBe('This file is read-only (quarantined)');
  });

  it("says a 'missing' session no longer exists instead of calling it read-only", () => {
    expect(reportOutcome('/sessions/2030/2030-03-07_00000000.json', { ok: false, reason: 'missing' })).toBe(false);
    expect(toast.value?.text).toBe('This session no longer exists');
    expect(reportOutcome('/exercises.json', { ok: false, reason: 'missing' })).toBe(false);
    expect(toast.value?.text).toBe('The exercise catalog is not here yet');
  });
});

describe('editSession', () => {
  /** A stand-in for Data.edit that applies fn to one file and returns the given outcome. */
  const fakeData = (outcome: WriteOutcome) => ({
    edit<F>(_kind: string, _path: string, fn: (file: F) => F): Promise<WriteOutcome> {
      fn(sessionFile() as F);
      return Promise.resolve(outcome);
    },
  });

  it('true on ok, false with the outcome toast otherwise', async () => {
    expect(await editSession(fakeData({ ok: true, heldBack: false }), '/s.json', (f: SessionFile) => f)).toBe(true);
    expect(await editSession(fakeData({ ok: false, reason: 'changed' }), '/s.json', (f: SessionFile) => f)).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
  });

  it('an EditError becomes a toast with its message', async () => {
    const result = await editSession(fakeData({ ok: true, heldBack: false }), '/s.json', () => {
      throw new EditError('reps must be more than 0, got 0');
    });
    expect(result).toBe(false);
    expect(toast.value?.text).toBe('reps must be more than 0, got 0');
  });

  it('any other error propagates', async () => {
    await expect(editSession(fakeData({ ok: true, heldBack: false }), '/s.json', () => {
      throw new TypeError('bug');
    })).rejects.toThrow('bug');
  });
});
```

Create `src/ui/components/log/start-picker.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, exercise, session } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { startPickerVm } from './start-picker.vm';

const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const LEGS = exercise({ id: 'squats', name: 'Squats', pattern: 'legs' });
const CATALOG: ReadonlyMap<string, Exercise> = new Map([PUSH, PULL, DIPS, LEGS].map((e) => [e.id, e]));

const day = (date: string, ...exerciseIds: string[]): Session =>
  session(exerciseIds.map((id, i) => block([], { exerciseId: id, order: i })), { date });

describe('startPickerVm', () => {
  it('lists recent sessions newest first with the proposal moved to the top and marked', () => {
    // push 03-01, pull 03-03, legs 03-05: the rotation proposes push (oldest of the latest per type).
    const push = day('2030-03-01', 'push-ups');
    const pull = day('2030-03-03', 'pull-ups');
    const legs = day('2030-03-05', 'squats');
    const vm = startPickerVm([push, pull, legs], CATALOG, undefined);
    expect(vm.rows.map((r) => r.sessionId)).toEqual([push.id, legs.id, pull.id]);
    expect(vm.rows.map((r) => r.proposed)).toEqual([true, false, false]);
    expect(vm.hasNone).toBe(true);
  });

  it('formats the title, keeps the label and joins de-duplicated exercise names in block order', () => {
    const s = session(
      [
        block([], { exerciseId: 'dips-bar', order: 0 }),
        block([], { exerciseId: 'push-ups', order: 1 }),
        block([], { exerciseId: 'dips-bar', order: 2 }),
      ],
      { date: '2030-03-07', label: 'push' },
    );
    const [row] = startPickerVm([s], CATALOG, undefined).rows;
    expect(row).toEqual({ sessionId: s.id, title: 'Thu 07 Mar', label: 'push', exercises: 'Dips (Bar) · Push-ups', proposed: true });
  });

  it('shows the raw id for an exercise missing from the catalog and no label when none is set', () => {
    const s = day('2030-03-07', 'muscle-ups');
    const [row] = startPickerVm([s], CATALOG, undefined).rows;
    expect(row?.exercises).toBe('muscle-ups');
    expect(row?.label).toBeUndefined();
  });

  it('shows at most ten recent sessions', () => {
    const sessions = Array.from({ length: 14 }, (_, i) => day(`2030-03-${String(i + 1).padStart(2, '0')}`, 'push-ups'));
    const vm = startPickerVm(sessions, CATALOG, undefined);
    // The proposal (the latest push day) is among the ten, so there are exactly ten rows.
    expect(vm.rows).toHaveLength(10);
    expect(vm.rows[0]?.sessionId).toBe(sessions[13]?.id);
    expect(vm.rows[9]?.sessionId).toBe(sessions[4]?.id);
  });

  it('puts a proposal older than the ten recent sessions on top, above the ten', () => {
    const legs = day('2030-02-01', 'squats');
    const push = Array.from({ length: 10 }, (_, i) => day(`2030-03-${String(i + 1).padStart(2, '0')}`, 'push-ups'));
    const vm = startPickerVm([legs, ...push], CATALOG, undefined);
    expect(vm.rows).toHaveLength(11);
    expect(vm.rows[0]).toMatchObject({ sessionId: legs.id, proposed: true });
  });

  it('leaves out the excluded session, also as a proposal', () => {
    const push = day('2030-03-01', 'push-ups');
    const pull = day('2030-03-03', 'pull-ups');
    const vm = startPickerVm([push, pull], CATALOG, push.id);
    expect(vm.rows.map((r) => r.sessionId)).toEqual([pull.id]);
    expect(vm.rows[0]?.proposed).toBe(true);
  });

  it('marks nothing when no session has a day type', () => {
    const empty = day('2030-03-01');
    const vm = startPickerVm([empty], CATALOG, undefined);
    expect(vm.rows).toEqual([{ sessionId: empty.id, title: 'Fri 01 Mar', label: undefined, exercises: '', proposed: false }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/log/LogTab.test.tsx src/ui/components/log/log-screen.vm.test.ts src/ui/components/log/log-state.test.ts src/ui/components/log/outcome.test.ts src/ui/components/log/start-picker.vm.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/log/log-state.test.ts: Error: Cannot find module './log-state' imported from src/ui/components/log/log-state.test.ts
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/components/log/LogScreen.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { addBlock, findBlock } from '../../../model/edit';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { Button, Marks, SetChips } from '../shared';
import type { CardVm, LogScreenVm } from './log-screen.vm';
import { currentBlockId } from './log-state';
import { editSession } from './outcome';
import { PickerSheet } from './StartPicker';
import { useWriteGuard } from './use-write-guard';

type Open =
  | { kind: 'picker'; mode: 'start' | 'change' }
  | { kind: 'set'; setId: string }
  | { kind: 'block'; blockId: string; name: string }
  | { kind: 'search' };

/** Spec 4 §4 "The screen": header, cards, Other exercise…, Done. The entry area is rendered by LogTab. */
export function LogScreen(p: { row: SessionRow; vm: LogScreenVm }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  const close = (): void => {
    open.value = undefined;
  };
  const { header } = p.vm;
  const path = p.row.path;

  // One Start at a time (a card's Start, or a pick in the search), held until the card shows the
  // new block: a second tap would add a second block of the exercise, an unpaired extra card.
  const guard = useWriteGuard((blockId) => findBlock(p.row.file.session, blockId) !== undefined);

  const startBlock = (exerciseId: string): Promise<void> =>
    guard.run(async () => {
      const now = data.clock();
      let added: string | undefined;
      const ok = await editSession(data, path, (f) => {
        const result = addBlock(f, exerciseId, now);
        added = result.blockId;
        return result.file;
      });
      if (!ok || added === undefined) return undefined;
      currentBlockId.value = added;
      return added;
    });

  const sheet = open.value;
  return (
    <section class="log">
      <header class="log-head">
        <div class="log-head__when">
          {header.date} · {header.startedAt}
        </div>
        <div class="log-head__actions">
          <button type="button" class="log-head__ref" onClick={() => (open.value = { kind: 'picker', mode: 'change' })}>
            {header.reference ?? 'No reference'} ▾
          </button>
          {/* Spec 4 §4 header: label, notes, tags, date and late entries live on the session page (§5). */}
          <Button onClick={() => router.navigate({ tab: 'days', sessionId: p.row.file.session.id })}>Details</Button>
          {header.offline && <span class="log-head__offline">offline</span>}
          <Button onClick={() => (open.value = { kind: 'picker', mode: 'start' })}>Start new</Button>
        </div>
      </header>

      {p.vm.cards.map((c) => (
        <Card
          key={c.key}
          card={c}
          counter={p.vm.counter}
          starting={guard.held()}
          onStart={() => void startBlock(c.exerciseId)}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onTapName={(blockId) => (open.value = { kind: 'block', blockId, name: c.name })}
        />
      ))}

      <div class="log-foot">
        <Button onClick={() => (open.value = { kind: 'search' })}>Other exercise…</Button>
        <Button onClick={() => router.navigate({ tab: 'days' })}>Done</Button>
      </div>

      {sheet?.kind === 'picker' && <PickerSheet mode={sheet.mode} sessionId={p.row.file.session.id} onClose={close} />}
      {/* The set, block and search sheets follow in task 9. */}
    </section>
  );
}

function Card(p: {
  card: CardVm;
  counter: string | undefined;
  /** A Start is running or waiting for its block to show: every Start is disabled. */
  starting: boolean;
  onStart(): void;
  onTapSet(setId: string): void;
  onTapName(blockId: string): void;
}): JSX.Element {
  const c = p.card;
  const started = c.state !== 'not-started';
  const current = c.state === 'current';
  const todayBlockId = c.todayBlockId;
  // Spec 4 §4: tapping a finished card makes it current again, so a forgotten set can be added there.
  const makeCurrent =
    c.state === 'finished' && todayBlockId !== undefined
      ? () => {
          currentBlockId.value = todayBlockId;
        }
      : undefined;
  // The keyboard and screen-reader target is the part of the body without controls of its own
  // (last time's chips, the note, the totals); a pointer tap anywhere on the body works too.
  const target: JSX.HTMLAttributes<HTMLDivElement> =
    makeCurrent !== undefined
      ? {
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            makeCurrent();
          },
        }
      : {};
  return (
    <article class={`log-card log-card--${c.state}`} aria-label={c.name}>
      <div class="log-card__head">
        <h3 class="log-card__name">
          {todayBlockId === undefined ? (
            c.name
          ) : (
            <button type="button" class="log-card__namebtn" onClick={() => p.onTapName(todayBlockId)}>{c.name}</button>
          )}
          {c.archived && <span class="log-card__archived">archived</span>}
        </h3>
        {started ? <span class="log-card__load">{c.loadText}</span> : <Button kind="primary" disabled={p.starting} onClick={p.onStart}>Start</Button>}
      </div>
      <div class="log-card__body" onClick={makeCurrent}>
        {started && (
          <>
            {c.referenceSets.length > 0 && <div class="log-card__caption">Today</div>}
            {/* A chip tap opens the set sheet only; it never also makes the card current. */}
            <div class="log-card__today" onClick={(e) => e.stopPropagation()}>
              <SetChips
                sets={c.todaySets}
                variant="today"
                proposed={c.proposed}
                onTap={(s) => p.onTapSet(s.id)}
                {...(current && c.todaySets.length > 0 ? { lastIndex: c.todaySets.length - 1 } : {})}
              />
            </div>
          </>
        )}
        <div class={`log-card__rest${makeCurrent !== undefined ? ' is-target' : ''}`} {...target}>
          {/* The target's name comes from its content (so the marks stay readable); this line leads it. */}
          {makeCurrent !== undefined && <span class="visually-hidden">Make {c.name} current. </span>}
          {c.referenceSets.length > 0 && (
            <>
              {started && <div class="log-card__caption">Last time</div>}
              <SetChips sets={c.referenceSets} variant="reference" {...(c.markIndex !== undefined ? { markIndex: c.markIndex } : {})} />
            </>
          )}
          {c.blockNote !== undefined && <p class="log-card__note">{c.blockNote}</p>}
          {c.totals !== undefined && (
            <div class="log-card__totals">
              <span>{c.totals.today}</span>
              {c.totals.reference !== '' && <span>{c.totals.reference}</span>}
              {c.marks !== undefined && <Marks amount={c.marks.amount} load={c.marks.load} provisional />}
              {current && p.counter !== undefined && (
                <span class="log-card__counter" aria-label="Since the last set">{p.counter}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
```

Replace the whole content of `src/ui/components/log/LogTab.tsx` with:

```tsx
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { logScreenVm, resolveReference } from './log-screen.vm';
import { currentBlockId, referenceId, referenceLoadedFor } from './log-state';
import { LogScreen } from './LogScreen';
import { StartPicker } from './StartPicker';

/** Spec 4 §4: the start picker without an open session, else the open session (Resume). */
export function LogTab(): JSX.Element {
  const { data } = useApp();
  const row = data.openSession.value;
  return row === undefined ? <StartPicker /> : <OpenSession row={row} />;
}

function OpenSession(p: { row: SessionRow }): JSX.Element {
  const { data } = useApp();
  const today = p.row.file.session;
  const id = today.id;

  // Load the reference choice whenever the open session changes. Until `referenceLoadedFor`
  // names this session nothing is rendered, so the proposal never flashes in before the stored
  // choice (a missing choice re-proposes, §4). A remount for the same session (a tab switch)
  // keeps the choice already read and renders at once.
  useEffect(() => {
    if (referenceLoadedFor.value === id) return;
    let live = true;
    referenceId.value = undefined;
    void data.getMeta<string>(`reference:${id}`).then(
      (v) => {
        if (!live) return;
        referenceId.value = v;
        referenceLoadedFor.value = id;
      },
      () => {
        if (live) referenceLoadedFor.value = id;
      },
    );
    return () => {
      live = false;
    };
  }, [data, id]);

  if (referenceLoadedFor.value !== id) return <section class="log" aria-busy="true" />;

  const reference = resolveReference(referenceId.value, data.liveSessions.value, data.exercises.value, id);
  const vm = logScreenVm({
    today,
    reference,
    catalog: data.exerciseById.value,
    currentBlockId: currentBlockId.value,
    now: data.now.value,
    online: data.status.value.online,
  });
  return <LogScreen row={p.row} vm={vm} />;
}
```

Create `src/ui/components/log/StartPicker.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { EditError, startSession } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { sessionPath } from '../../../sync/paths';
import { useApp } from '../../context';
import { formatTime, localDate } from '../../format';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor } from './log-state';
import { reportOutcome } from './outcome';
import { startPickerVm } from './start-picker.vm';

/** Spec 4 §4 "Start": the one button of the Log tab without an open session. */
export function StartPicker(): JSX.Element {
  const picking = useSignal(false);
  return (
    <section class="log-start">
      <Button kind="primary" onClick={() => (picking.value = true)}>Start session</Button>
      {picking.value && <PickerSheet mode="start" onClose={() => (picking.value = false)} />}
    </section>
  );
}

/**
 * The "Train against" sheet. `start` writes a new session file and then stores the choice;
 * `change` (the header's "vs … ▾") stores the choice for `sessionId` only.
 */
export function PickerSheet(p: { mode: 'start' | 'change'; sessionId?: string; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const vm = startPickerVm(data.liveSessions.value, data.exerciseById.value, p.mode === 'change' ? p.sessionId : undefined);

  const start = async (choice: string): Promise<void> => {
    const open = data.openSession.value?.file.session;
    if (open?.startedAt !== undefined && !window.confirm(`A session from ${formatTime(open.startedAt)} is still open. Start a new one anyway?`)) {
      p.onClose();
      return;
    }
    const now = data.clock();
    let file: SessionFile;
    try {
      file = startSession(now, localDate(now));
    } catch (e) {
      if (e instanceof EditError) {
        showToast(e.message);
        return;
      }
      throw e;
    }
    const path = sessionPath(file.session.date, file.session.id);
    // The choice is stored before the file exists, so the Log tab's read of it (when the new
    // session's row arrives) never finds it missing and never shows the proposal first.
    await data.setMeta(`reference:${file.session.id}`, choice);
    if (!reportOutcome(path, await data.create('session', path, file))) return;
    referenceId.value = choice;
    referenceLoadedFor.value = file.session.id;
    currentBlockId.value = undefined;
    entryDraft.value = new Map();
    p.onClose();
  };

  const change = async (choice: string): Promise<void> => {
    if (p.sessionId !== undefined) {
      await data.setMeta(`reference:${p.sessionId}`, choice);
      referenceId.value = choice;
    }
    p.onClose();
  };

  // Busy while a start runs: a second tap would write a second session file (an
  // empty one closed at once by the other, left on the Days list and in Dropbox).
  const busy = useSignal(false);
  const choose = async (choice: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await (p.mode === 'start' ? start(choice) : change(choice));
    } finally {
      busy.value = false;
    }
  };

  return (
    <Sheet title="Train against" onClose={p.onClose}>
      <ul class="picker">
        {vm.rows.map((r) => (
          <li key={r.sessionId}>
            <button
              type="button"
              class={`picker__row${r.proposed ? ' is-proposed' : ''}`}
              disabled={busy.value}
              onClick={() => void choose(r.sessionId)}
            >
              <span class="picker__head">
                <span class="picker__title">{r.title}</span>
                {r.label !== undefined && <span class="picker__label">{r.label}</span>}
                {r.proposed && <span class="picker__tag">proposed</span>}
              </span>
              <span class="picker__exercises">{r.exercises}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" class="picker__row picker__none" disabled={busy.value} onClick={() => void choose('none')}>
            No reference
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
```

Create `src/ui/components/log/log-screen.vm.ts`:

```ts
import {
  blockTotals,
  compareBlockPair,
  defaultCurrentBlock,
  latestCompletedAt,
  liveBlocks,
  liveSets,
  metricOf,
  pairCards,
  proposedAmount,
  proposeReference,
  stepFor,
  stickyLoad,
  type BlockIndicator,
  type CardPair,
  type StickyLoad,
} from '../../../model/derive';
import type { Block, Exercise, Session, WorkoutSet } from '../../../model/types';
import { formatAmount, formatClock, formatDay, formatDayLong, formatLoad, formatTime } from '../../format';

export type CardState = 'not-started' | 'current' | 'finished';

export interface CardVm {
  key: string; // reference block id, else today block id
  exerciseId: string;
  name: string;
  archived: boolean;
  metric: 'reps' | 'seconds';
  state: CardState;
  todayBlockId: string | undefined;
  referenceBlockId: string | undefined;
  todaySets: WorkoutSet[]; // liveSets, canonical order
  referenceSets: WorkoutSet[];
  loadText: string;
  proposed: number | undefined; // only for the current card
  markIndex: number | undefined; // only for the current card, when the reference has that position
  totals: { today: string; reference: string } | undefined; // undefined for not-started
  marks: BlockIndicator | undefined; // finished cards with both blocks
  blockNote: string | undefined;
}

export interface CurrentVm {
  blockId: string;
  exerciseId: string;
  name: string;
  metric: 'reps' | 'seconds';
  setNumber: number;
  proposed: number | undefined;
  step: number;
  load: StickyLoad;
  loadText: string;
}

export interface LogScreenVm {
  header: { date: string; startedAt: string; reference: string | undefined; offline: boolean };
  cards: CardVm[];
  counter: string | undefined;
  current: CurrentVm | undefined;
}

export interface LogScreenInput {
  today: Session;
  reference: Session | undefined;
  catalog: ReadonlyMap<string, Exercise>;
  currentBlockId: string | undefined;
  now: Date;
  online: boolean;
}

/** Spec 4 §4 "Resume": the stored choice when it names a live session other than today; 'none'
 *  means no reference; a missing or deleted choice is re-proposed. `sessions` are the live ones. */
export function resolveReference(chosen: string | undefined, sessions: readonly Session[], catalog: readonly Exercise[], todayId: string): Session | undefined {
  if (chosen === 'none') return undefined;
  const found = chosen === undefined || chosen === todayId ? undefined : sessions.find((s) => s.id === chosen && s.deletedAt === undefined);
  return found ?? proposeReference(sessions, catalog, todayId);
}

const sets = (block: Block | undefined): WorkoutSet[] => (block === undefined ? [] : liveSets(block));

function totalsText(prefix: string, block: Block): string {
  const t = blockTotals(block);
  return `${prefix} ${formatAmount(t.amount)} · ${t.setCount} ${t.setCount === 1 ? 'set' : 'sets'}`;
}

/** The exercise's metric; for an id missing from the catalog, the metric of the sets shown. */
function metricFor(exercise: Exercise | undefined, todaySets: WorkoutSet[], referenceSets: WorkoutSet[]): 'reps' | 'seconds' {
  if (exercise !== undefined) return exercise.metric;
  const first = todaySets[0] ?? referenceSets[0];
  return first === undefined ? 'reps' : metricOf(first);
}

function cardOf(pair: CardPair, exercise: Exercise | undefined, current: string | undefined): CardVm {
  const today = pair.today;
  const reference = pair.reference;
  const todaySets = sets(today);
  const referenceSets = sets(reference);
  const state: CardState = today === undefined ? 'not-started' : today.id === current ? 'current' : 'finished';
  const load = stickyLoad(today, reference, exercise);
  const isCurrent = state === 'current';
  const mark = todaySets.length;
  return {
    key: reference?.id ?? today?.id ?? pair.exerciseId,
    exerciseId: pair.exerciseId,
    name: exercise?.name ?? pair.exerciseId,
    archived: exercise?.archived ?? false,
    metric: metricFor(exercise, todaySets, referenceSets),
    state,
    todayBlockId: today?.id,
    referenceBlockId: reference?.id,
    todaySets,
    referenceSets,
    loadText: formatLoad(load.loadType, load.loadKg),
    proposed: isCurrent ? proposedAmount(today, reference) : undefined,
    // A migrated aggregate set is a total, not the set at that position: no mark (spec 4 §4).
    markIndex: isCurrent && mark < referenceSets.length && referenceSets[mark]?.aggregate !== true ? mark : undefined,
    totals: today === undefined ? undefined : { today: totalsText('today', today), reference: reference === undefined ? '' : totalsText('last', reference) },
    marks: state === 'finished' && today !== undefined && reference !== undefined ? compareBlockPair(today, reference) : undefined,
    blockNote: today?.note,
  };
}

/** Spec 4 §4 "The screen": the header, the cards, the counter and the entry area's data. */
export function logScreenVm(input: LogScreenInput): LogScreenVm {
  const { today, reference, catalog, now } = input;
  const named = input.currentBlockId;
  const effectiveCurrent =
    named !== undefined && liveBlocks(today).some((b) => b.id === named) ? named : defaultCurrentBlock(today)?.id;
  const pairs = pairCards(today, reference);
  const cards = pairs.map((p) => cardOf(p, catalog.get(p.exerciseId), effectiveCurrent));

  const latest = latestCompletedAt(today);
  const counter = latest === undefined ? undefined : formatClock(Math.max(0, (now.getTime() - Date.parse(latest)) / 1000));

  const index = cards.findIndex((c) => c.state === 'current');
  const card = cards[index];
  const pair = pairs[index];
  let current: CurrentVm | undefined;
  if (card !== undefined && pair !== undefined && card.todayBlockId !== undefined) {
    const load = stickyLoad(pair.today, pair.reference, catalog.get(card.exerciseId));
    current = {
      blockId: card.todayBlockId,
      exerciseId: card.exerciseId,
      name: card.name,
      metric: card.metric,
      setNumber: card.todaySets.length + 1,
      proposed: card.proposed,
      step: stepFor(card.metric),
      load,
      loadText: formatLoad(load.loadType, load.loadKg),
    };
  }

  return {
    header: {
      date: formatDayLong(today.date),
      startedAt: today.startedAt === undefined ? '' : formatTime(today.startedAt),
      reference: reference === undefined ? undefined : `vs ${formatDay(reference.date)}`,
      offline: !input.online,
    },
    cards,
    counter,
    current,
  };
}
```

Create `src/ui/components/log/log-state.ts`:

```ts
import { signal, type Signal } from '@preact/signals';
import type { LoadType } from '../../../model/types';

/** Spec 4 §4 "Current block": the block the owner last started or added a set to (in memory only).
 *  undefined → the last live block of today (logScreenVm's fallback). */
export const currentBlockId: Signal<string | undefined> = signal<string | undefined>(undefined);

/** The open session's reference choice, loaded from meta `reference:<sessionId>` when the open
 *  session changes: a session id, 'none', or undefined (not loaded yet or missing → re-propose). */
export const referenceId: Signal<string | 'none' | undefined> = signal<string | 'none' | undefined>(undefined);

/** The session id whose stored reference `referenceId` holds. A remount of the Log tab for the same
 *  session (a tab switch) shows the cards at once instead of reading the meta key again. */
export const referenceLoadedFor: Signal<string | undefined> = signal<string | undefined>(undefined);

/** What the owner set up for a block's next set and has not added yet: the typed value, the note
 *  and the load wait for Add set instead of being lost on a re-render or a tab switch. */
export interface EntryDraft {
  /** The stepper's value when the owner changed it, with the set number it was typed for. It counts
   *  only while the block's next set number is still that one (`typedValue`): a set added elsewhere
   *  (the session page, a pull) or a delete moves the number on and the proposal shows again. */
  typed?: { amount: number; setNumber: number };
  /** The pending set note. */
  note?: string;
  /** The load chosen on the load button; sticky for the block after Add set. */
  load?: { loadType: LoadType; loadKg: number };
}

/** A draft field set to undefined in a patch is removed. */
export type DraftPatch = { [K in keyof EntryDraft]?: EntryDraft[K] | undefined };

/** The entry area's drafts keyed by block id, in module state so a tab switch (which unmounts the
 *  Log tab) loses nothing. Keyed by block, so a note never carries over to another block. */
export const entryDraft: Signal<Map<string, EntryDraft>> = signal<Map<string, EntryDraft>>(new Map());

export function draftFor(blockId: string): EntryDraft {
  return entryDraft.value.get(blockId) ?? {};
}

/** The typed amount for `setNumber`, or undefined when nothing was typed for that set number. */
export function typedValue(draft: EntryDraft, setNumber: number): number | undefined {
  return draft.typed !== undefined && draft.typed.setNumber === setNumber ? draft.typed.amount : undefined;
}

export function setDraft(blockId: string, patch: DraftPatch): void {
  const next: EntryDraft = { ...draftFor(blockId) };
  for (const key of Object.keys(patch) as (keyof EntryDraft)[]) {
    if (patch[key] === undefined) delete next[key];
  }
  if (patch.typed !== undefined) next.typed = patch.typed;
  if (patch.note !== undefined) next.note = patch.note;
  if (patch.load !== undefined) next.load = patch.load;
  const map = new Map(entryDraft.value);
  if (Object.keys(next).length === 0) map.delete(blockId);
  else map.set(blockId, next);
  entryDraft.value = map;
}

export function clearDraft(blockId: string): void {
  if (!entryDraft.value.has(blockId)) return;
  const map = new Map(entryDraft.value);
  map.delete(blockId);
  entryDraft.value = map;
}
```

Create `src/ui/components/log/outcome.ts`:

```ts
import { EditError } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../../../sync/paths';
import type { Data, WriteOutcome } from '../../data';
import { noteHeldBack } from '../../held-back';
import { showToast, toast } from '../../toast';

export const HELD_BACK_TEXT = 'Saved here, not uploaded (app bug)';

/** A refusal in plain words: 'missing' (no ok row at the path) is not a read-only file. */
function refusalText(path: string, reason: Exclude<WriteOutcome, { ok: true }>['reason']): string {
  if (reason === 'changed') return 'Changed elsewhere, try again';
  if (reason === 'missing') {
    if (path === EXERCISES_PATH) return 'The exercise catalog is not here yet';
    if (path === BODYWEIGHT_PATH) return 'The bodyweight log is not here yet';
    return 'This session no longer exists';
  }
  return `This file is read-only (${reason})`;
}

/** A write's result for a caller that shows a toast of its own right after it (an Undo toast, or a
 *  second write): `heldBackNote` is true when this path's once-only held-back note is still owed. */
export type Written = { ok: false } | { ok: true; heldBackNote: boolean };

/** Spec 4 §9: refusals become a toast at once; a first held-back write is only reported back, so the
 *  caller can fold the note into its own toast with `showHeldBack` instead of having it replaced. */
export function quietOutcome(path: string, outcome: WriteOutcome): Written {
  if (outcome.ok) return { ok: true, heldBackNote: outcome.heldBack && noteHeldBack(path) };
  showToast(refusalText(path, outcome.reason));
  return { ok: false };
}

/** The held-back note. A toast already showing (an Undo, an error) keeps its action and time and
 *  carries the note after its own text, so neither message replaces the other. */
export function showHeldBack(): void {
  const current = toast.value;
  if (current === undefined) {
    showToast(HELD_BACK_TEXT);
    return;
  }
  if (current.text.includes(HELD_BACK_TEXT)) return;
  toast.value = { ...current, text: `${current.text} · ${HELD_BACK_TEXT}` };
}

/** Spec 4 §9: the toasts for a write's outcome. True when the write went through (held back or not). */
export function reportOutcome(path: string, outcome: WriteOutcome): boolean {
  const written = quietOutcome(path, outcome);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}

/** One session edit through Data.edit with the toasts of `quietOutcome`, and an EditError from `fn`
 *  shown as a toast with its message. */
export async function editSessionQuiet(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<Written> {
  try {
    return quietOutcome(path, await data.edit('session', path, fn));
  } catch (e) {
    if (e instanceof EditError) {
      showToast(e.message);
      return { ok: false };
    }
    throw e;
  }
}

/** One session edit through Data.edit: the outcome toasts of reportOutcome, and an EditError from
 *  `fn` shown as a toast with its message. True when the write went through. */
export async function editSession(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<boolean> {
  const written = await editSessionQuiet(data, path, fn);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}
```

Create `src/ui/components/log/start-picker.vm.ts`:

```ts
import { proposeReference, recentSessions, sessionExerciseIds } from '../../../model/derive';
import type { Exercise, Session } from '../../../model/types';
import { formatDay } from '../../format';

/** Spec 4 §4 "Start": one line per candidate reference session. */
export interface PickerRow {
  sessionId: string;
  title: string; // 'Thu 07 Mar'
  label: string | undefined;
  exercises: string; // names joined ' · '
  proposed: boolean;
}

export interface StartPickerVm {
  rows: PickerRow[];
  /** "No reference" is always the last line. */
  hasNone: true;
}

function rowOf(s: Session, catalog: ReadonlyMap<string, Exercise>, proposed: boolean): PickerRow {
  return {
    sessionId: s.id,
    title: formatDay(s.date),
    label: s.label,
    exercises: sessionExerciseIds(s).map((id) => catalog.get(id)?.name ?? id).join(' · '),
    proposed,
  };
}

/** The ten most recent live sessions, newest first; the proposal on top and marked. A proposal
 *  older than those ten (proposeReference looks at every session) still goes on top, above the ten. */
export function startPickerVm(sessions: readonly Session[], catalog: ReadonlyMap<string, Exercise>, excludeId: string | undefined): StartPickerVm {
  const recent = recentSessions(sessions, excludeId, 10);
  const proposal = proposeReference(sessions, [...catalog.values()], excludeId);
  const rest = recent.filter((s) => s.id !== proposal?.id).map((s) => rowOf(s, catalog, false));
  return { rows: proposal === undefined ? rest : [rowOf(proposal, catalog, true), ...rest], hasNone: true };
}
```

Create `src/ui/components/log/use-write-guard.ts`:

```ts
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

/** How long a guard waits at most for the refreshed row to show what its write added. */
export const HOLD_MS = 3000;

/** Add set's minimum hold after a successful add: sets are about a minute apart, so a
 *  second tap within this time is a double tap, even when the refreshed row already shows the set. */
export const ADD_SET_MIN_HOLD_MS = 800;

export interface WriteGuard {
  /** True while a write runs, and after it until the screen shows the record it added. */
  held(): boolean;
  /** Runs `write` unless held. `write` returns the id of the record it added (or undefined). */
  run(write: () => Promise<string | undefined>): Promise<void>;
}

export interface WriteGuardOptions {
  /** After a write that added a record, hold at least this long (ms), shown or not. Default 0. */
  minHoldMs?: number;
}

/**
 * The busy rule for a write button whose screen changes only when the refreshed row
 * arrives (Start on a card, Add set): the button ignores a tap while its write runs and also after
 * it, until `isShown(id)` says the screen's row holds the added record, or HOLD_MS passed. Without
 * the second part a quick second tap lands between the write and the refresh and adds again.
 * With `minHoldMs` the button also stays held that long after the add, because the refresh can land
 * a few ms after the tap, well before a double tap's second click.
 */
export function useWriteGuard(isShown: (id: string) => boolean, options: WriteGuardOptions = {}): WriteGuard {
  const minHoldMs = options.minHoldMs ?? 0;
  const busy = useSignal(false);
  const awaiting = useSignal<string | undefined>(undefined);
  /** Counts successful adds; each one restarts the minimum hold. */
  const added = useSignal(0);
  const cooling = useSignal(false);

  useEffect(() => {
    if (awaiting.value === undefined) return;
    const timer = setTimeout(() => (awaiting.value = undefined), HOLD_MS);
    return () => clearTimeout(timer);
  }, [awaiting.value]);

  useEffect(() => {
    if (added.value === 0 || minHoldMs <= 0) return;
    cooling.value = true;
    const timer = setTimeout(() => (cooling.value = false), minHoldMs);
    return () => clearTimeout(timer);
  }, [added.value]);

  const held = (): boolean => {
    if (busy.value) return true;
    if (cooling.value) return true;
    const id = awaiting.value;
    return id !== undefined && !isShown(id);
  };

  const run = async (write: () => Promise<string | undefined>): Promise<void> => {
    if (held()) return;
    busy.value = true;
    try {
      const id = await write();
      if (id !== undefined) {
        awaiting.value = id;
        // Held at once, not only when the effect runs after the next render.
        if (minHoldMs > 0) cooling.value = true;
        added.value = added.value + 1;
      }
    } finally {
      busy.value = false;
    }
  };

  return { held, run };
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .log-start, .picker (components/log/StartPicker) ---- */
.log-start { display: flex; justify-content: center; padding: 48px 0; }
.log-start .btn { min-width: 60%; }
.picker { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.picker__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  text-align: left;
}
.picker__row.is-proposed { border-color: var(--accent); }
.picker__row:disabled { opacity: 0.45; cursor: default; }
.picker__head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.picker__title { font-weight: 600; }
.picker__label { color: var(--muted); }
.picker__tag { color: var(--accent); font-size: 13px; }
.picker__exercises { color: var(--muted); font-size: 14px; }
.picker__none { justify-content: center; color: var(--muted); }

/* ---- .log, .log-head, .log-card, .log-foot (components/log/LogScreen) ---- */
.log { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.log-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.log-head__when { font-weight: 600; font-variant-numeric: tabular-nums; }
.log-head__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.log-head__ref {
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
}
.log-head__offline { color: var(--danger); font-size: 14px; }
.log-card { padding: 10px 12px; border: 2px solid transparent; border-radius: 12px; background: var(--panel); }
.log-card--current { border-color: var(--accent); }
.log-card--finished .log-card__body { cursor: pointer; }
.log-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; }
.log-card__name { margin: 0; font-size: 17px; }
.log-card__namebtn {
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: inherit;
  font-weight: inherit;
  text-align: left;
}
.log-card__archived { margin-left: 8px; color: var(--muted); font-size: 12px; font-weight: 400; text-transform: uppercase; }
.log-card__load { color: var(--muted); font-variant-numeric: tabular-nums; }
.log-card__body { display: flex; flex-direction: column; gap: 6px; }
.log-card__rest { display: flex; flex-direction: column; gap: 6px; }
.log-card__rest.is-target { min-height: 44px; border-radius: 8px; }
.log-card__rest.is-target:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.log-card__caption { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.log-card__note { margin: 0; color: var(--muted); font-style: italic; overflow-wrap: anywhere; }
.log-card__totals { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
.log-card__counter { margin-left: auto; color: var(--accent); font-weight: 600; }
.log-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 0 12px; }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 64 test files and 911 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/log/LogScreen.tsx src/ui/components/log/LogTab.test.tsx src/ui/components/log/LogTab.tsx src/ui/components/log/StartPicker.tsx src/ui/components/log/log-screen.vm.test.ts src/ui/components/log/log-screen.vm.ts src/ui/components/log/log-state.test.ts src/ui/components/log/log-state.ts src/ui/components/log/outcome.test.ts src/ui/components/log/outcome.ts src/ui/components/log/start-picker.vm.test.ts src/ui/components/log/start-picker.vm.ts src/ui/components/log/use-write-guard.ts src/ui/theme.css
git commit -m "Add the Log tab: start picker, reference and cards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Log tab: entry area, sheets and exercise search

The stepper with the proposed value and the number pad, Add set with the sticky load, the load, set, block and note sheets, delete with Undo, the per-block drafts that survive a tab switch, and the exercise search with inline create (catalog written before the block).

**Files:**
- Create: `src/ui/components/log/BlockSheet.test.tsx`
- Create: `src/ui/components/log/BlockSheet.tsx`
- Create: `src/ui/components/log/EntryArea.test.tsx`
- Create: `src/ui/components/log/EntryArea.tsx`
- Create: `src/ui/components/log/ExerciseSearch.held-back.test.tsx`
- Create: `src/ui/components/log/ExerciseSearch.test.tsx`
- Create: `src/ui/components/log/ExerciseSearch.tsx`
- Create: `src/ui/components/log/LoadSheet.tsx`
- Modify: `src/ui/components/log/LogScreen.tsx`
- Modify: `src/ui/components/log/LogTab.test.tsx`
- Modify: `src/ui/components/log/LogTab.tsx`
- Create: `src/ui/components/log/NoteSheet.tsx`
- Create: `src/ui/components/log/SetSheet.test.tsx`
- Create: `src/ui/components/log/SetSheet.tsx`
- Create: `src/ui/components/log/exercise-search.vm.test.ts`
- Create: `src/ui/components/log/exercise-search.vm.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/catalog`, `src/model/derive`, `src/model/edit`, `src/model/schema`, `src/model/slug`, `src/model/types`, `src/sync/paths`, `src/ui/components/log/StartPicker`, `src/ui/components/log/log-screen.vm`, `src/ui/components/log/log-state`, `src/ui/components/log/outcome`, `src/ui/components/log/use-write-guard`, `src/ui/components/shared`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/toast`.
- Produces:
  - `src/ui/components/log/BlockSheet.tsx`:
    - `export function BlockSheet(p: { row: SessionRow; blockId: string; name: string; move?: { up: boolean; down: boolean }; onClose(): void }): JSX.Element`
  - `src/ui/components/log/EntryArea.tsx`:
    - `export function EntryArea(p: { row: SessionRow; current: CurrentVm }): JSX.Element`
  - `src/ui/components/log/ExerciseSearch.tsx`:
    - `export function ExerciseSearch(p: { onPick(exerciseId: string): Promise<void>; onClose(): void }): JSX.Element`
  - `src/ui/components/log/LoadSheet.tsx`:
    - `export interface Load`
    - `export function LoadSheet(p: { load: Load; onSave(load: Load): void; onClose(): void }): JSX.Element`
  - `src/ui/components/log/LogScreen.tsx`:
    - `export function LogScreen(p: { row: SessionRow; vm: LogScreenVm }): JSX.Element`
  - `src/ui/components/log/LogTab.tsx`:
    - `export function LogTab(): JSX.Element`
  - `src/ui/components/log/NoteSheet.tsx`:
    - `export function NoteSheet(p: { title: string; value: string; onSave(text: string): void; onClose(): void }): JSX.Element`
  - `src/ui/components/log/SetSheet.tsx`:
    - `export type SetSheetProps = { row: SessionRow; onClose(): void } & ({ setId: string } | { blockId: string; create: true; timed: boolean })`
    - `export function SetSheet(p: SetSheetProps): JSX.Element`
  - `src/ui/components/log/exercise-search.vm.ts`:
    - `export interface ExerciseSearchVm`
    - `export function exerciseSearchVm(catalog: readonly Exercise[], query: string): ExerciseSearchVm`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/components/log/BlockSheet.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import { setBlockNote } from '../../../model/edit';
import type { Session } from '../../../model/types';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, entryDraft, referenceId, setDraft } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, reportHeldBack, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session =>
  session(
    [
      block(ladder([8, 8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'dips-bar' }),
      block(ladder([15], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'push-ups', order: 1 }),
    ],
    { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' },
  );

async function mount(today: Session) {
  const m = await setup({ now: NOW, sessions: [today], exercises: [PUSH, DIPS], meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy());
  return m;
}

const openSheet = (): HTMLElement => {
  fireEvent.click(within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: 'Dips (Bar)' }));
  return screen.getByRole('dialog', { name: 'Dips (Bar)' });
};

describe('BlockSheet (a card name)', () => {
  it('saves the block note', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const sheet = openSheet();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Block note' }), { target: { value: 'rings next time' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.note).toBe('rings next time'));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.updatedAt).toBe(NOW.toISOString());
    await waitFor(() => expect(screen.getByText('rings next time')).toBeTruthy());
    expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull();
  });

  it('Save note with the note unchanged writes nothing and closes', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const writes = vi.spyOn(store, 'writeFile');
    const sheet = openSheet();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Block note' }), { target: { value: '  ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('a held-back Delete block folds the held-back note into the Undo toast', async () => {
    const today = openToday();
    const { data, store } = await mount(today);
    reportHeldBack(data);
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Delete block' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.deletedAt).toBe(NOW.toISOString()));
    await waitFor(() => expect(toast.value?.text).toBe('Dips (Bar) deleted · Saved here, not uploaded (app bug)'));
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
  });

  it('Make current makes the card current', async () => {
    const today = openToday();
    await mount(today);
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Make current' }));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
    expect(currentBlockId.value).toBe(today.blocks[0]?.id);
  });

  it('Delete block writes a tombstone; Undo writes the undelete', async () => {
    const today = openToday();
    const { store } = await mount(today);
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Delete block' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.deletedAt).toBe(NOW.toISOString()));
    expect(toast.value?.text).toBe('Dips (Bar) deleted');
    expect(toast.value?.ms).toBe(6000);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Dips (Bar)' })).toBeNull());

    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy());
  });

  it('a double tap on Delete block writes once and keeps the Undo toast', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const writes = vi.spyOn(store, 'writeFile');
    const sheet = openSheet();
    const remove = within(sheet).getByRole('button', { name: 'Delete block' }) as HTMLButtonElement;
    fireEvent.click(remove);
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    await waitFor(() => expect(toast.value?.text).toBe('Dips (Bar) deleted'));
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(toast.value?.text).toBe('Dips (Bar) deleted');
  });

  it('a double tap on Save note writes once', async () => {
    const today = openToday();
    const { store } = await mount(today);
    const writes = vi.spyOn(store, 'writeFile');
    const sheet = openSheet();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Block note' }), { target: { value: 'rings next time' } });
    const save = within(sheet).getByRole('button', { name: 'Save note' }) as HTMLButtonElement;
    fireEvent.click(save);
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('Save note with the note untouched keeps a note another device wrote while the sheet was open', async () => {
    const today = openToday();
    const dips = today.blocks[0]?.id ?? '';
    const { data, store } = await mount(today);
    const sheet = openSheet();
    await data.edit('session', pathOf(today), (f) => setBlockNote(f, dips, 'from the PC', new Date('2030-03-07T10:29:00.000Z')));
    await waitFor(() => expect(screen.getByText('from the PC')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dips (Bar)' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.note).toBe('from the PC');
  });

  it("Delete block drops the block's entry draft", async () => {
    const today = openToday();
    const dips = today.blocks[0]?.id ?? '';
    await mount(today);
    setDraft(dips, { note: 'left shoulder' });
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Delete block' }));
    await waitFor(() => expect(toast.value?.text).toBe('Dips (Bar) deleted'));
    expect(entryDraft.value.has(dips)).toBe(false);
  });
});
```

Create `src/ui/components/log/EntryArea.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import type { JSX } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addSet } from '../../../model/edit';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatLoad } from '../../format';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, entryDraft, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const WEIGHTED = exercise({ id: 'weighted-pull-ups', name: 'Weighted Pull-ups', pattern: 'pull', defaultLoadType: 'added' });
const PLANK = exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds' });
const CATALOG = [PUSH, WEIGHTED, PLANK];

/** The Log tab, or another tab's stand-in: switching unmounts and remounts LogTab as App does. */
const onLog = signal(true);
function Tabs(): JSX.Element {
  return onLog.value ? <LogTab /> : <p>Days</p>;
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  entryDraft.value = new Map();
  onLog.value = true;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (blocks: Parameters<typeof session>[0]): Session =>
  session(blocks, { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mount(sessions: Session[], meta: Record<string, unknown>) {
  const m = await setup({ now: NOW, sessions, exercises: CATALOG, meta });
  renderIn(m.deps, <Tabs />);
  return m;
}

const entry = (): HTMLElement => screen.getByRole('region', { name: 'Entry' });
const value = (): string => within(entry()).getByRole('button', { name: 'Edit value' }).textContent ?? '';
const tapAll = (scope: HTMLElement, keys: string[]): void => {
  for (const key of keys) fireEvent.click(within(scope).getByRole('button', { name: key }));
};

describe('EntryArea', () => {
  it('Add set writes the proposed amount with completedAt and the sticky load; the stepper then shows the next proposal', async () => {
    const past = session([block(ladder([17, 16, 15], { loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })], {
      date: '2030-03-05',
      startedAt: '2030-03-05T10:00:00.000Z',
    });
    const today = openToday([block([], { exerciseId: 'push-ups' })]);
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });

    await waitFor(() => expect(value()).toBe('17'));
    expect(entry().textContent).toContain('Push-ups · set 1');
    expect(within(entry()).getByRole('button', { name: formatLoad('added', 10) })).toBeTruthy();

    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 17' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    const written = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0];
    expect(written).toMatchObject({ reps: 17, loadType: 'added', loadKg: 10, completedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(written?.note).toBeUndefined();

    await waitFor(() => expect(value()).toBe('16'));
    expect(entry().textContent).toContain('set 2');
    expect(currentBlockId.value).toBe(today.blocks[0]?.id);
  });

  it('the set number has a span of its own, so a long name truncates before it (375 px)', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    expect(entry().querySelector('.entry__name')?.textContent).toBe('Push-ups');
    expect(entry().querySelector('.entry__set')?.textContent).toBe('· set 2');
  });

  it('the load button and the note change the next set; after Add the note is gone and the load stays', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z', loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));

    fireEvent.click(within(entry()).getByRole('button', { name: formatLoad('added', 10) }));
    const sheet = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'bodyweight' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy());

    fireEvent.click(within(entry()).getByRole('button', { name: 'note' }));
    const noteSheet = screen.getByRole('dialog', { name: 'Set note' });
    fireEvent.input(within(noteSheet).getByRole('textbox'), { target: { value: 'slow' } });
    fireEvent.click(within(noteSheet).getByRole('button', { name: 'Save' }));

    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    const written = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1];
    expect(written).toMatchObject({ reps: 8, loadType: 'bodyweight', loadKg: 0, note: 'slow' });
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    expect(within(entry()).getByRole('button', { name: 'note' }).className).not.toContain('is-set');
    expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy();
  });

  it('needsKg: the first Add of the block opens the load sheet and adds with the chosen kg', async () => {
    const today = openToday([block([], { exerciseId: 'weighted-pull-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('–'));
    const disabled = within(entry()).getByRole('button', { name: 'Add set' }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);

    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Load' });
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(0);
    expect(within(sheet).getByRole('button', { name: 'added' }).getAttribute('aria-pressed')).toBe('true');
    tapAll(sheet, ['1', '2', '.', '5', 'Use']);

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 1, loadType: 'added', loadKg: 12.5, completedAt: NOW.toISOString() });
    expect(screen.queryByRole('dialog', { name: 'Load' })).toBeNull();
  });

  it("the pad's Add adds the set at once with the typed value and closes the pad", async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Edit value' }));
    const pad = screen.getByRole('dialog', { name: 'Amount' });
    tapAll(pad, ['1', '6', '.', '5', 'Add']);
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 16.5, completedAt: NOW.toISOString() });
    expect(screen.queryByRole('dialog', { name: 'Amount' })).toBeNull();
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
  });

  it("the pad's Add follows the load-sheet-first rule when a weight is required", async () => {
    const today = openToday([block([], { exerciseId: 'weighted-pull-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('–'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Edit value' }));
    tapAll(screen.getByRole('dialog', { name: 'Amount' }), ['5', 'Add']);
    const load = await screen.findByRole('dialog', { name: 'Load' });
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(0);
    tapAll(load, ['1', '0', 'Use']);
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 5, loadType: 'added', loadKg: 10 });
  });

  it('the load sheet takes 0 kg for band and external (spec 1 §3) and requires more for added', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'bodyweight' }));
    const sheet = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'added' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '0' }));
    expect((within(sheet).getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'band' }));
    expect((within(sheet).getByRole('button', { name: 'Use' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(within(entry()).getByRole('button', { name: formatLoad('band', 0) })).toBeTruthy());
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ loadType: 'band', loadKg: 0 });
  });

  it('an EditError from addSet shows its message as a toast and writes nothing', async () => {
    // A reps set in a block of a seconds exercise (a soft metric mismatch): adding seconds is refused.
    const today = openToday([block(ladder([30]), { exerciseId: 'plank' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('30'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 30' }));
    await waitFor(() => expect(toast.value?.text).toBe("the block's sets count reps, not seconds"));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1);
  });

  it('a double tap on Add set adds one set', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    const add = within(entry()).getByRole('button', { name: 'Add set · 8' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);
  });

  it('Add set stays held for a minimum time after an add, even when the refreshed row shows at once', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    // A double tap 150 ms apart: the refresh has long landed, the second tap must still not add.
    await new Promise((r) => setTimeout(r, 150));
    const again = within(entry()).getByRole('button', { name: /^Add set/ }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    fireEvent.click(again);
    await new Promise((r) => setTimeout(r, 30));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);

    // After the minimum hold the button is free again and the next tap adds.
    await waitFor(() => expect((within(entry()).getByRole('button', { name: /^Add set/ }) as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
    fireEvent.click(within(entry()).getByRole('button', { name: /^Add set/ }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(3));
  });

  it('Add set stays held after the write until the refreshed row shows the new set', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store, data } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    const refresh = data.refresh.bind(data);
    const pending: (() => void)[] = [];
    vi.spyOn(data, 'refresh').mockImplementation((path: string) => new Promise<void>((resolve) => {
      pending.push(() => void refresh(path).then(resolve));
    }));
    const add = within(entry()).getByRole('button', { name: 'Add set · 8' }) as HTMLButtonElement;
    fireEvent.click(add);
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    // The write is done, the screen still shows set 2: a second tap must not add a third set.
    expect(entry().textContent).toContain('set 2');
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    await new Promise((r) => setTimeout(r, 20));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);

    act(() => { for (const run of pending) run(); });
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    // Free again once the set shows and the minimum hold (ADD_SET_MIN_HOLD_MS) has passed.
    await waitFor(() => expect((within(entry()).getByRole('button', { name: /^Add set/ }) as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
  });

  it('a value typed for a set number does not come back after a delete lowers the set count', async () => {
    const today = openToday([block(ladder([8, 9], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('9'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 10' }));
    await waitFor(() => expect(entry().textContent).toContain('set 4'));

    const chips = screen.getByRole('article', { name: 'Push-ups' }).querySelector('.setchips--today') as HTMLElement;
    fireEvent.click(within(chips).getByRole('button', { name: '10' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[2]?.deletedAt).toBeDefined());
    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    expect(value()).toBe('9');
  });

  it('a typed value does not carry over to the next set number when a set arrives from elsewhere', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups' })]);
    const { store, data } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    await waitFor(() => expect(value()).toBe('10'));

    // The session page (or a pull from the other device) adds set 2 while the Log tab is away.
    act(() => { onLog.value = false; });
    const blockId = today.blocks[0]?.id ?? '';
    const result = await data.edit('session', pathOf(today), (f) => addSet(f, blockId, { reps: 7, loadType: 'bodyweight', loadKg: 0 }, data.clock()).file);
    expect(result.ok).toBe(true);
    act(() => { onLog.value = true; });

    await waitFor(() => expect(entry().textContent).toContain('set 3'));
    expect(value()).toBe('7');
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2);
  });

  it('a load chosen for a block stays with that block and never applies to another one', async () => {
    const today = openToday([
      block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z', loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups', order: 0 }),
      block(ladder([5], { completedAt: '2030-03-07T10:20:00.000Z', loadType: 'added', loadKg: 20 }), { exerciseId: 'weighted-pull-ups', order: 1 }),
    ]);
    await mount([today], { [`reference:${today.id}`]: 'none' });
    const makeCurrent = (name: string): void => {
      fireEvent.click(within(screen.getByRole('article', { name })).getByRole('button', { name }));
      fireEvent.click(within(screen.getByRole('dialog', { name })).getByRole('button', { name: 'Make current' }));
    };
    await waitFor(() => expect(entry().textContent).toContain('Weighted Pull-ups · set 2'));
    makeCurrent('Push-ups');
    await waitFor(() => expect(entry().textContent).toContain('Push-ups · set 2'));

    fireEvent.click(within(entry()).getByRole('button', { name: formatLoad('added', 10) }));
    const sheet = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'bodyweight' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy());

    makeCurrent('Weighted Pull-ups');
    await waitFor(() => expect(entry().textContent).toContain('Weighted Pull-ups · set 2'));
    expect(within(entry()).getByRole('button', { name: formatLoad('added', 20) })).toBeTruthy();
    makeCurrent('Push-ups');
    await waitFor(() => expect(entry().textContent).toContain('Push-ups · set 2'));
    expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy();
  });

  it('a set note never carries over to another block', async () => {
    const today = openToday([
      block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z' }), { exerciseId: 'push-ups', order: 0 }),
      block(ladder([5], { completedAt: '2030-03-07T10:20:00.000Z', loadType: 'added', loadKg: 20 }), { exerciseId: 'weighted-pull-ups', order: 1 }),
    ]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(entry().textContent).toContain('Weighted Pull-ups · set 2'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'note' }));
    const noteSheet = screen.getByRole('dialog', { name: 'Set note' });
    fireEvent.input(within(noteSheet).getByRole('textbox'), { target: { value: 'left shoulder' } });
    fireEvent.click(within(noteSheet).getByRole('button', { name: 'Save' }));

    fireEvent.click(within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Push-ups' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Push-ups' })).getByRole('button', { name: 'Make current' }));
    await waitFor(() => expect(entry().textContent).toContain('Push-ups · set 2'));
    expect(within(entry()).getByRole('button', { name: 'note' }).className).not.toContain('is-set');
    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 8' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]?.note).toBeUndefined();
  });

  it('the stepper value, the note and the chosen load survive a switch to another tab and back', async () => {
    const today = openToday([block(ladder([8], { completedAt: '2030-03-07T10:10:00.000Z', loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })]);
    const { store } = await mount([today], { [`reference:${today.id}`]: 'none' });
    await waitFor(() => expect(value()).toBe('8'));
    fireEvent.click(within(entry()).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(entry()).getByRole('button', { name: formatLoad('added', 10) }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Load' })).getByRole('button', { name: 'bodyweight' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Load' })).getByRole('button', { name: 'Save' }));
    fireEvent.click(within(entry()).getByRole('button', { name: 'note' }));
    fireEvent.input(within(screen.getByRole('dialog', { name: 'Set note' })).getByRole('textbox'), { target: { value: 'slow negatives' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set note' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(value()).toBe('9'));

    act(() => { onLog.value = false; });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Entry' })).toBeNull());
    act(() => { onLog.value = true; });
    await waitFor(() => expect(value()).toBe('9'));
    expect(within(entry()).getByRole('button', { name: 'note' }).className).toContain('is-set');
    expect(within(entry()).getByRole('button', { name: 'bodyweight' })).toBeTruthy();

    fireEvent.click(within(entry()).getByRole('button', { name: 'Add set · 9' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 9, loadType: 'bodyweight', note: 'slow negatives' });
  });
});
```

Create `src/ui/components/log/ExerciseSearch.held-back.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercise, session } from '../../../model/test-fixtures';
import type { FileKind } from '../../../model/types';
import type { FileOf, WriteOutcome } from '../../data';
import { renderIn, setup } from '../../test-harness';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';

// A file of its own: the once-per-path held-back note (src/ui/held-back.ts) is module state, and
// ExerciseSearch.test.tsx already uses up the note for exercises.json.

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

describe('ExerciseSearch (held-back catalog)', () => {
  it('a held-back catalog write shows its note when the session write is quiet', async () => {
    const today = session([], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });
    const { data, deps } = await setup({ now: NOW, sessions: [today], exercises: [PUSH], meta: { [`reference:${today.id}`]: 'none' } });
    const edit = data.edit.bind(data);
    vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> => {
      const r = await edit(kind, path, fn);
      return r.ok && kind === 'exercises' ? { ok: true, heldBack: true } : r;
    });
    renderIn(deps, <LogTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Other exercise…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Other exercise…' }));
    const sheet = screen.getByRole('dialog', { name: 'Exercise' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Search exercises' }), { target: { value: 'Ring Rows' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(() => expect(currentBlockId.value).toBeDefined());
    await waitFor(() => expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)'));
  });
});
```

Create `src/ui/components/log/ExerciseSearch.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercise, session } from '../../../model/test-fixtures';
import type { Exercise, ExercisesFile, FileKind, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import type { FileOf, WriteOutcome } from '../../data';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push', family: 'push-up' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' });
const OLD = exercise({ id: 'kipping-pull-ups', name: 'Kipping Pull-ups', pattern: 'pull', family: 'pull-up', archived: true });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session => session([], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mount(today: Session, exercises: Exercise[] | undefined) {
  const m = await setup({ now: NOW, sessions: [today], exercises, meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Other exercise…' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Other exercise…' }));
  const sheet = screen.getByRole('dialog', { name: 'Exercise' });
  return { ...m, sheet };
}

const search = (sheet: HTMLElement, text: string): void => {
  fireEvent.input(within(sheet).getByRole('textbox', { name: 'Search exercises' }), { target: { value: text } });
};

describe('ExerciseSearch', () => {
  it('lists live entries by name as typed, archived ones in their own group; picking one adds a block and makes it current', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    search(sheet, 'pull');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Push-ups' })).toBeNull());
    expect(within(sheet).getByText('Archived (1)')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: /^Create/ })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Pull-ups' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups']));
    const added = (await fileAt(store, pathOf(today))).session.blocks[0];
    await waitFor(() => expect(currentBlockId.value).toBe(added?.id));
    expect(screen.queryByRole('dialog', { name: 'Exercise' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Entry' }).textContent).toContain('Pull-ups · set 1'));
  });

  it('Create writes the catalog before the session, and the block references the new id', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    expect((within(form).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Ring Rows');
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'pull' } });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Family' }), { target: { value: 'row' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks).toHaveLength(1));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([EXERCISES_PATH, pathOf(today)]);
    const catalog = (await store.getRow(EXERCISES_PATH))?.content as ExercisesFile;
    const created = catalog.exercises.find((e) => e.name === 'Ring Rows');
    expect(created).toMatchObject({
      id: 'ring-rows', pattern: 'pull', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: 'row', archived: false, updatedAt: NOW.toISOString(),
    });
    const added = (await fileAt(store, pathOf(today))).session.blocks[0];
    expect(added?.exerciseId).toBe('ring-rows');
    await waitFor(() => expect(currentBlockId.value).toBe(added?.id));
  });

  it('a name that exists already uses that entry and writes no catalog', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Rows”' }));
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: ' pull-UPS ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['pull-ups']));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([pathOf(today)]);
  });

  it('Create on the name of a deleted entry undeletes it, writes the catalog first and adds its block', async () => {
    const gone = exercise({ id: 'ring-rows', name: 'Ring Rows', pattern: 'pull', deletedAt: '2030-01-02T10:00:00.000Z', updatedAt: '2030-01-02T10:00:00.000Z' });
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, gone]);
    const writes = vi.spyOn(store, 'writeFile');
    search(sheet, 'ring rows');
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Ring Rows' })).toBeNull());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “ring rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['ring-rows']));
    expect(writes.mock.calls.map((c) => c[1])).toEqual([EXERCISES_PATH, pathOf(today)]);
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.filter((e) => e.name.toLowerCase() === 'ring rows')).toHaveLength(1);
    const revived = catalog.find((e) => e.id === 'ring-rows');
    expect(revived?.deletedAt).toBeUndefined();
    expect(revived?.updatedAt).toBe(NOW.toISOString());
  });

  it('Create on the name of an archived entry unarchives it and adds its block', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL, OLD]);
    search(sheet, 'Kipping Pull-ups');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Kipping Pull-ups”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks.map((b) => b.exerciseId)).toEqual(['kipping-pull-ups']));
    const catalog = ((await store.getRow(EXERCISES_PATH))?.content as ExercisesFile).exercises;
    expect(catalog.find((e) => e.id === 'kipping-pull-ups')).toMatchObject({ archived: false, updatedAt: NOW.toISOString() });
  });

  it("a held-back catalog write keeps its note when the session write shows a toast of its own", async () => {
    const today = openToday();
    const { data, sheet } = await mount(today, [PUSH, PULL]);
    const edit = data.edit.bind(data);
    vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> => {
      if (kind !== 'exercises') return { ok: false, reason: 'changed' };
      const r = await edit(kind, path, fn);
      return r.ok ? { ok: true, heldBack: true } : r;
    });
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));
    await waitFor(() => expect(toast.value?.text).toBe('Changed elsewhere, try again · Saved here, not uploaded (app bug)'));
  });
  it('a double tap on Create exercise adds one block', async () => {
    const today = openToday();
    const { store, sheet } = await mount(today, [PUSH, PULL]);
    search(sheet, 'Ring Rows');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    const create = within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(currentBlockId.value).toBeDefined());
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks).toHaveLength(1);
  });

  // The quiet-session case is in ExerciseSearch.held-back.test.tsx: the once-per-path note for
  // exercises.json is module state, so that case needs a module of its own.

  it('without a catalog, Create is disabled with the reason', async () => {
    const today = openToday();
    const { sheet } = await mount(today, undefined);
    search(sheet, 'Ring Rows');
    await waitFor(() => expect(within(sheet).getByText('catalog not available')).toBeTruthy());
    expect((within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

Replace the whole content of `src/ui/components/log/LogTab.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { FileKind, Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor } from './log-state';
import { LogTab } from './LogTab';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/log' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const pathOf = (s: Session): string => sessionPath(s.date, s.id);

async function mount(sessions: Session[], meta: Record<string, unknown> = {}) {
  const db = await openDb(new IDBFactory());
  let data: Data | undefined;
  const store = new Store(db, { onChange: (p) => void data?.refresh(p) });
  const files: [FileKind, string, unknown][] = [['exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL])], ...sessions.map((s): [FileKind, string, unknown] => ['session', pathOf(s), sessionFile(s)])];
  for (const [kind, path, file] of files) {
    const result = await store.writeFile(kind, path, file, NOW);
    expect(result).toEqual({ ok: true });
  }
  for (const [key, value] of Object.entries(meta)) await store.setMeta(key, value);
  data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const deps: AppDeps = { data, router: new Router(fakeWindow()), sync, ui };
  render(<AppContext.Provider value={deps}><LogTab /></AppContext.Provider>);
  return { data, store, router: deps.router };
}

async function sessionFiles(store: Store): Promise<SessionFile[]> {
  return (await store.sessions()).map((r) => r.file);
}

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  referenceLoadedFor.value = undefined;
  entryDraft.value = new Map();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** happy-dom has no window.confirm; the stub is undone after each test. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn((_message?: string) => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

async function fileOf(store: Store, s: Session): Promise<SessionFile> {
  return (await store.getRow(pathOf(s)))?.content as SessionFile;
}

// 2030-03-05 is a Tuesday.
const pastPush = (): Session =>
  session([block(ladder([8, 8], { completedAt: '2030-03-05T10:05:00.000Z' }), { exerciseId: 'dips-bar' }), block(ladder([17, 16, 15]), { exerciseId: 'push-ups', order: 1 })], {
    date: '2030-03-05',
    startedAt: '2030-03-05T10:00:00.000Z',
  });

describe('LogTab without an open session', () => {
  it('starts a session against the chosen reference: writes the file with startedAt and stores the choice', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const sheet = screen.getByRole('dialog', { name: 'Train against' });
    const row = within(sheet).getByRole('button', { name: /Tue 05 Mar/ });
    expect(row.textContent).toContain('Dips (Bar) · Push-ups');
    expect(row.textContent).toContain('proposed');
    fireEvent.click(row);

    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const started = (await sessionFiles(store)).find((f) => f.session.id !== past.id)?.session;
    expect(started?.startedAt).toBe(NOW.toISOString());
    expect(started?.date).toBe(localDate(NOW));
    expect(started?.blocks).toEqual([]);
    const id = started?.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe(past.id));
    // The open session now shows, with the reference in the header and its cards not started.
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card--not-started')).toHaveLength(2);
  });

  it('a double tap on a picker row starts one session', async () => {
    const past = pastPush();
    const { store } = await mount([past]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const row = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: /Tue 05 Mar/ });
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('a double tap on No reference starts one session; the rows are disabled while it runs', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }) as HTMLButtonElement;
    fireEvent.click(none);
    await waitFor(() => expect(none.disabled).toBe(true));
    fireEvent.click(none);
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('stores none for No reference', async () => {
    const { store } = await mount([pastPush()]);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    fireEvent.click(screen.getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(2));
    const id = (await sessionFiles(store)).find((f) => f.session.startedAt === NOW.toISOString())?.session.id ?? '';
    await waitFor(async () => expect(await store.getMeta(`reference:${id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });
});

describe('LogTab with an open session', () => {
  function openToday(): Session {
    return session([block(ladder([8, 8], { completedAt: '2030-03-07T10:20:00.000Z' }), { exerciseId: 'dips-bar' })], {
      date: '2030-03-07',
      startedAt: '2030-03-07T10:00:00.000Z',
    });
  }

  it('shows the cards; Start on a not-started card adds a block and makes it current', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    expect(dips.className).toContain('log-card--current');
    expect(within(dips).getByText('today 16 · 2 sets')).toBeTruthy();
    const push = screen.getByRole('article', { name: 'Push-ups' });
    expect(push.className).toContain('log-card--not-started');

    fireEvent.click(within(push).getByRole('button', { name: 'Start' }));
    await waitFor(async () => {
      const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
      expect(file.session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
    });
    const file = (await store.getRow(pathOf(today)))?.content as SessionFile;
    const added = file.session.blocks[1];
    expect(added?.updatedAt).toBe(NOW.toISOString());
    expect(currentBlockId.value).toBe(added?.id);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
  });

  it('a double tap on Start adds one block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    await new Promise((r) => setTimeout(r, 30));
    expect((await fileOf(store, today)).session.blocks.map((b) => b.exerciseId)).toEqual(['dips-bar', 'push-ups']);
  });

  it('Start stays held after its write until the refreshed row shows the block', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    const refresh = data.refresh.bind(data);
    const pending: (() => void)[] = [];
    vi.spyOn(data, 'refresh').mockImplementation((path: string) => new Promise<void>((resolve) => {
      pending.push(() => void refresh(path).then(resolve));
    }));
    const start = within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    fireEvent.click(start);
    await waitFor(async () => expect((await fileOf(store, today)).session.blocks).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    await new Promise((r) => setTimeout(r, 20));
    expect((await fileOf(store, today)).session.blocks).toHaveLength(2);
    act(() => { for (const run of pending) run(); });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
  });

  it("the header's Details opens the session page of the open session", async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(router.route.value).toEqual({ tab: 'days', sessionId: today.id });
  });

  it('a double tap on a row of the change picker stores the choice once', async () => {
    const past = pastPush();
    const today = openToday();
    const { data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    const setMeta = vi.spyOn(data, 'setMeta');
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    const none = within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' });
    fireEvent.click(none);
    fireEvent.click(none);
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(setMeta.mock.calls.filter(([key]) => key === `reference:${today.id}`)).toHaveLength(1);
  });

  it('tapping a finished card makes it current again', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const dips = screen.getByRole('article', { name: 'Dips (Bar)' });
    fireEvent.click(dips.querySelector('.log-card__body') as Element);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it('the finished card has a keyboard target: a focusable button that Enter or Space makes current', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const target = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / });
    expect(target.tabIndex).toBe(0);
    fireEvent.keyDown(target, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
    // The current card offers no make-current target.
    expect(within(screen.getByRole('article', { name: 'Dips (Bar)' })).queryByRole('button', { name: /^Make Dips \(Bar\) current/ })).toBeNull();
  });

  it('Space on the make-current target works as Enter does', async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block(ladder([17], { completedAt: '2030-03-07T10:25:00.000Z' }), { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    fireEvent.keyDown(within(screen.getByRole('article', { name: 'Dips (Bar)' })).getByRole('button', { name: /^Make Dips \(Bar\) current\. / }), { key: ' ' });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--current'));
  });

  it("a tap on a finished card's today chip opens the set sheet and does not make the card current", async () => {
    const past = pastPush();
    const today = openToday();
    today.blocks.push(block([], { exerciseId: 'push-ups', order: 1 }));
    await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current'));
    const chip = within(screen.getByRole('article', { name: 'Dips (Bar)' })).getAllByRole('button', { name: '8' })[0] as HTMLElement;
    fireEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Set' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('article', { name: 'Dips (Bar)' }).className).toContain('log-card--finished');
    expect(screen.getByRole('article', { name: 'Push-ups' }).className).toContain('log-card--current');
  });

  it('renders no card before the stored reference is read, so the proposal never flashes', async () => {
    const past = pastPush();
    const today = openToday();
    const db = await openDb(new IDBFactory());
    const store = new Store(db);
    await store.writeFile('exercises', EXERCISES_PATH, exercisesFile([PUSH, DIPS, PULL]), NOW);
    for (const s of [past, today]) await store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    const data = new Data({ store, now: () => NOW });
    await data.load();
    let answer: (v: string) => void = () => {};
    vi.spyOn(data, 'getMeta').mockImplementation(<T,>() => new Promise<T | undefined>((resolve) => { answer = (v) => resolve(v as T); }));
    const sync: SyncActions = {
      connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
      updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
    };
    const ui = {
      connected: signal(true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    };
    render(<AppContext.Provider value={{ data, router: new Router(fakeWindow()), sync, ui }}><LogTab /></AppContext.Provider>);
    await new Promise((r) => setTimeout(r, 10));
    // The proposal (Tue 05 Mar) would show the Push-ups card; nothing shows until the read finished.
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^vs / })).toBeNull();
    answer('none');
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(screen.queryByRole('article', { name: 'Push-ups' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Dips (Bar)' })).toBeTruthy();
  });

  it('takes write times from data.clock(), not from the ticking now signal', async () => {
    const past = pastPush();
    const today = openToday();
    const { store, data } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
    // The screen re-renders with a later tick (the session stays open), so a handler that read
    // data.now at render time would write 10:31.
    act(() => { data.now.value = new Date(NOW.getTime() + 60_000); });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(within(screen.getByRole('article', { name: 'Push-ups' })).getByRole('button', { name: 'Start' }));
    await waitFor(async () => expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks).toHaveLength(2));
    expect(((await store.getRow(pathOf(today)))?.content as SessionFile).session.blocks[1]?.updatedAt).toBe(NOW.toISOString());
  });

  it('re-proposes when the stored reference is gone, and changing it writes only the meta key', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: 'deleted-session' });
    await waitFor(() => expect(screen.getByRole('button', { name: /^vs Tue 05 Mar/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^vs Tue 05 Mar/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await store.getMeta(`reference:${today.id}`)).toBe('none'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new asks first and writes nothing when declined', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    const confirm = answerConfirm(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^A session from \d\d:\d\d is still open\. Start a new one anyway\?$/);
    expect(await sessionFiles(store)).toHaveLength(2);
  });

  it('Start new, confirmed, writes a new session that takes over the screen', async () => {
    const past = pastPush();
    const today = openToday();
    const { store } = await mount([past, today], { [`reference:${today.id}`]: past.id });
    answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start new' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start new' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Train against' })).getByRole('button', { name: 'No reference' }));
    await waitFor(async () => expect(await sessionFiles(store)).toHaveLength(3));
    await waitFor(() => expect(screen.getByRole('button', { name: /^No reference/ })).toBeTruthy());
    expect(document.querySelectorAll('.log-card')).toHaveLength(0);
  });

  it('Done goes to the Days tab', async () => {
    const today = openToday();
    const { router } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(router.route.value).toEqual({ tab: 'days' });
  });

  it('Done writes nothing: no file write, the queue unchanged (spec 4 U7)', async () => {
    const today = openToday();
    const { store } = await mount([today]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    const queueBefore = await store.queue();
    const rowBefore = await store.getRow(pathOf(today));
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).not.toHaveBeenCalled();
    expect(await store.queue()).toEqual(queueBefore);
    expect(await store.getRow(pathOf(today))).toEqual(rowBefore);
  });
});
```

Create `src/ui/components/log/SetSheet.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { block, exercise, ladder, session } from '../../../model/test-fixtures';
import { setSetFields } from '../../../model/edit';
import type { Session } from '../../../model/types';
import { sessionRowById } from '../../data';
import { formatLoad } from '../../format';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';
import { SetSheet } from './SetSheet';
import { fileAt, pathOf, renderIn, reportHeldBack, setup } from '../../test-harness';

const NOW = new Date('2030-03-07T10:30:00.000Z');
const DONE = '2030-03-07T10:10:00.000Z';
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });
const WEIGHTED = exercise({ id: 'weighted-pull-ups', name: 'Weighted Pull-ups', pattern: 'pull', defaultLoadType: 'added' });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

const openToday = (): Session =>
  session([block(ladder([8, 9], { completedAt: DONE }), { exerciseId: 'push-ups' })], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });

async function mountLog(today: Session) {
  const m = await setup({ now: NOW, sessions: [today], exercises: [PUSH, WEIGHTED], meta: { [`reference:${today.id}`]: 'none' } });
  renderIn(m.deps, <LogTab />);
  await waitFor(() => expect(screen.getByRole('article', { name: 'Push-ups' })).toBeTruthy());
  return m;
}

const chip = (amount: string): HTMLElement =>
  within(screen.getByRole('article', { name: 'Push-ups' }).querySelector('.setchips--today') as HTMLElement).getByRole('button', { name: amount });

describe('SetSheet (edit, from a today chip)', () => {
  it('Delete writes a tombstone; Undo writes the undelete', async () => {
    const today = openToday();
    const setId = today.blocks[0]?.sets[0]?.id ?? '';
    const { store } = await mountLog(today);
    fireEvent.click(chip('8'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]?.deletedAt).toBe(NOW.toISOString()));
    expect(toast.value?.text).toBe('Set 8 deleted');
    expect(toast.value?.ms).toBe(6000);
    expect(screen.queryByRole('dialog', { name: 'Set' })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: '8' })).toBeNull());

    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]?.deletedAt).toBeUndefined());
    const restored = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0];
    expect(restored).toMatchObject({ id: setId, reps: 8, completedAt: DONE });
    await waitFor(() => expect(chip('8')).toBeTruthy());
  });

  it('a held-back Delete folds the held-back note into the Undo toast', async () => {
    const today = openToday();
    const { data, store } = await mountLog(today);
    reportHeldBack(data);
    fireEvent.click(chip('8'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]?.deletedAt).toBe(NOW.toISOString()));
    await waitFor(() => expect(toast.value?.text).toBe('Set 8 deleted · Saved here, not uploaded (app bug)'));
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
  });

  it('a double tap on Save writes once', async () => {
    const today = openToday();
    const { store } = await mountLog(today);
    fireEvent.click(chip('9'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    const writes = vi.spyOn(store, 'writeFile');
    const save = within(sheet).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set' })).toBeNull());
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('Save changes amount, load and note and never touches completedAt', async () => {
    const today = openToday();
    const { store } = await mountLog(today);
    fireEvent.click(chip('9'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: ' strict ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'bodyweight' }));
    const load = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(load).getByRole('button', { name: 'added' }));
    for (const key of ['5']) fireEvent.click(within(load).getByRole('button', { name: key }));
    fireEvent.click(within(load).getByRole('button', { name: 'Use' }));
    const back = screen.getByRole('dialog', { name: 'Set' });
    expect(within(back).getByRole('button', { name: formatLoad('added', 5) })).toBeTruthy();
    expect(within(back).getByRole('button', { name: 'Edit value' }).textContent).toBe('10');
    fireEvent.click(within(back).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 10 }));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({
      reps: 10, loadType: 'added', loadKg: 5, note: 'strict', completedAt: DONE, updatedAt: NOW.toISOString(),
    });
    expect(screen.queryByRole('dialog', { name: 'Set' })).toBeNull();
  });

  it("Save writes only what the owner changed: another device's load change made while the sheet was open survives", async () => {
    const today = session([block(ladder([8], { completedAt: DONE, loadType: 'added', loadKg: 10 }), { exerciseId: 'push-ups' })], {
      date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z',
    });
    const setId = today.blocks[0]?.sets[0]?.id ?? '';
    const { data, store } = await mountLog(today);
    fireEvent.click(chip('8'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    await data.edit('session', pathOf(today), (f) => setSetFields(f, setId, { loadKg: 12 }, new Date('2030-03-07T10:29:00.000Z')));
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Push-ups' })).getByText(formatLoad('added', 12))).toBeTruthy());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 9 }));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 9, loadType: 'added', loadKg: 12 });
  });

  it("a note-only Save keeps another device's amount change made while the sheet was open", async () => {
    const today = openToday();
    const setId = today.blocks[0]?.sets[1]?.id ?? '';
    const { data, store } = await mountLog(today);
    fireEvent.click(chip('9'));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    await data.edit('session', pathOf(today), (f) => setSetFields(f, setId, { reps: 13 }, new Date('2030-03-07T10:29:00.000Z')));
    await waitFor(() => expect(chip('13')).toBeTruthy());
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: 'strict' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]?.note).toBe('strict'));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 13, note: 'strict' });
  });

  it("the set sheet's pad reads Use and only sets the value", async () => {
    const today = openToday();
    const { store } = await mountLog(today);
    fireEvent.click(chip('9'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Set' })).getByRole('button', { name: 'Edit value' }));
    const pad = screen.getByRole('dialog', { name: 'Amount' });
    for (const key of ['1', '2', 'Use']) fireEvent.click(within(pad).getByRole('button', { name: key }));
    const back = screen.getByRole('dialog', { name: 'Set' });
    expect(within(back).getByRole('button', { name: 'Edit value' }).textContent).toBe('12');
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[1]).toMatchObject({ reps: 9 });
  });
});

describe('SetSheet (create, as the session page uses it)', () => {
  async function mountCreate(today: Session, blockIndex: number, timed: boolean) {
    const m = await setup({ now: NOW, sessions: [today], exercises: [PUSH, WEIGHTED] });
    const row = sessionRowById(m.data.sessions.value, today.id);
    if (row === undefined) throw new Error('no row');
    const onClose = vi.fn();
    renderIn(m.deps, <SetSheet row={row} blockId={today.blocks[blockIndex]?.id ?? ''} create timed={timed} onClose={onClose} />);
    return { ...m, onClose };
  }

  it('timed: false adds a set without completedAt, starting from the last set', async () => {
    const today = openToday();
    const { store, onClose } = await mountCreate(today, 0, false);
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    expect(within(sheet).getByRole('button', { name: 'Edit value' }).textContent).toBe('9');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(3));
    const added = (await fileAt(store, pathOf(today))).session.blocks[0]?.sets[2];
    expect(added).toMatchObject({ reps: 9, loadType: 'bodyweight', loadKg: 0, updatedAt: NOW.toISOString() });
    expect(added?.completedAt).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('a double tap on Add set adds one set', async () => {
    const today = openToday();
    const { store, onClose } = await mountCreate(today, 0, false);
    const add = within(screen.getByRole('dialog', { name: 'New set' })).getByRole('button', { name: 'Add set' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(3);
  });

  it('timed: true stamps completedAt; a weighted exercise asks for the kg first', async () => {
    const today = session([block([], { exerciseId: 'weighted-pull-ups' })], { date: '2030-03-07' });
    const { store } = await mountCreate(today, 0, true);
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    expect((within(sheet).getByRole('button', { name: 'Add set' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    const load = screen.getByRole('dialog', { name: 'Load' });
    fireEvent.click(within(load).getByRole('button', { name: '7' }));
    fireEvent.click(within(load).getByRole('button', { name: 'Use' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets).toHaveLength(1));
    expect((await fileAt(store, pathOf(today))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 1, loadType: 'added', loadKg: 7, completedAt: NOW.toISOString() });
  });
});
```

Create `src/ui/components/log/exercise-search.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exercise } from '../../../model/test-fixtures';
import { exerciseSearchVm } from './exercise-search.vm';

const CATALOG = [
  exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push', family: 'push-up' }),
  exercise({ id: 'diamond-push-ups', name: 'Diamond Push-ups', pattern: 'push', family: 'push-up' }),
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull', family: 'pull-up' }),
  exercise({ id: 'chin-ups', name: 'Chin-ups', pattern: 'pull', family: 'pull-up' }),
  exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' }),
  exercise({ id: 'old-push-ups', name: 'Old Push-ups', pattern: 'push', family: 'push-up', archived: true }),
  exercise({ id: 'gone-push-ups', name: 'Gone Push-ups', pattern: 'push', deletedAt: '2030-01-02T10:00:00.000Z' }),
];

const ids = (list: { id: string }[]): string[] => list.map((e) => e.id);

describe('exerciseSearchVm', () => {
  it('an empty query lists every live entry, by family then name, families without a name last', () => {
    const vm = exerciseSearchVm(CATALOG, '');
    expect(ids(vm.live)).toEqual(['chin-ups', 'pull-ups', 'diamond-push-ups', 'push-ups', 'dips-bar']);
    expect(ids(vm.archived)).toEqual(['old-push-ups']);
    expect(vm.canCreate).toBe(false);
  });

  it('filters by name, case-insensitively; tombstones never show', () => {
    const vm = exerciseSearchVm(CATALOG, 'PUSH');
    expect(ids(vm.live)).toEqual(['diamond-push-ups', 'push-ups']);
    expect(ids(vm.archived)).toEqual(['old-push-ups']);
  });

  it('offers Create when no entry has the typed name', () => {
    expect(exerciseSearchVm(CATALOG, 'Ring Rows').canCreate).toBe(true);
    expect(exerciseSearchVm(CATALOG, '  ').canCreate).toBe(false);
    expect(exerciseSearchVm(CATALOG, 'push').canCreate).toBe(true);
  });

  it('no Create for the exact name of a live entry', () => {
    expect(exerciseSearchVm(CATALOG, ' push-UPS ').canCreate).toBe(false);
  });

  it('Create for the exact name of an archived or deleted entry (createExercise unarchives or undeletes it)', () => {
    expect(exerciseSearchVm(CATALOG, 'Old Push-ups').canCreate).toBe(true);
    expect(exerciseSearchVm(CATALOG, ' gone  PUSH-UPS ').canCreate).toBe(true);
  });

  it('trims and collapses spaces in the query', () => {
    expect(ids(exerciseSearchVm(CATALOG, '  diamond   push ').live)).toEqual(['diamond-push-ups']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/log/BlockSheet.test.tsx src/ui/components/log/EntryArea.test.tsx src/ui/components/log/ExerciseSearch.held-back.test.tsx src/ui/components/log/ExerciseSearch.test.tsx src/ui/components/log/LogTab.test.tsx src/ui/components/log/SetSheet.test.tsx src/ui/components/log/exercise-search.vm.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/log/EntryArea.test.tsx: TestingLibraryElementError: Unable to find role="region" and name "Entry"
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/components/log/BlockSheet.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { deleteBlock, findBlock, moveBlock, setBlockNote, undeleteBlock } from '../../../model/edit';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { clearDraft, currentBlockId } from './log-state';
import { editSession, editSessionQuiet, showHeldBack } from './outcome';

/**
 * Spec 4 §4: a card's exercise name opens this sheet: block note, "Make current", "Delete block" (Undo toast).
 * Spec 4 §5: the session page passes `move` and gets "Move up" / "Move down" (`moveBlock`) in place of
 * "Make current"; a direction the block cannot go is disabled.
 */
export function BlockSheet(p: { row: SessionRow; blockId: string; name: string; move?: { up: boolean; down: boolean }; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const path = p.row.path;
  const blockId = p.blockId;
  const block = findBlock(p.row.file.session, blockId);
  // Initialised once: a re-render from a pull never loses what was typed (spec 4 §8).
  const note = useSignal(block?.note ?? '');
  // The note as the sheet opened with it: a note another device wrote meanwhile is never written
  // back over when the owner did not change it here.
  const openedNote = useRef(block?.note ?? '');
  const busy = useSignal(false);

  /** One write at a time: a second tap while the first is pending would move the
   *  block twice, write the note twice or re-stamp the tombstone. */
  const guarded = async (write: () => Promise<void>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const move = (direction: 'up' | 'down'): Promise<void> =>
    guarded(async () => {
      const now = data.clock();
      if (await editSession(data, path, (f) => moveBlock(f, blockId, direction, now))) p.onClose();
    });

  const saveNote = (): Promise<void> =>
    guarded(async () => {
      const text = note.value;
      // setBlockNote trims and drops a blank note; an unchanged note writes nothing (no updatedAt bump).
      if (text.trim() === openedNote.current.trim()) {
        p.onClose();
        return;
      }
      const now = data.clock();
      if (await editSession(data, path, (f) => setBlockNote(f, blockId, text, now))) p.onClose();
    });

  const makeCurrent = (): void => {
    currentBlockId.value = blockId;
    p.onClose();
  };

  const remove = (): Promise<void> => guarded(removeOnce);

  const removeOnce = async (): Promise<void> => {
    const now = data.clock();
    const written = await editSessionQuiet(data, path, (f) => deleteBlock(f, blockId, now));
    if (!written.ok) return;
    if (currentBlockId.value === blockId) currentBlockId.value = undefined;
    clearDraft(blockId);
    p.onClose();
    showToast(
      `${p.name} deleted`,
      { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteBlock(f, blockId, data.clock())) },
      6000,
    );
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  };

  return (
    <Sheet title={p.name} onClose={p.onClose}>
      {block === undefined || block.deletedAt !== undefined ? (
        <p class="blocksheet__gone">This block is no longer there.</p>
      ) : (
        <>
          <input
            class="blocksheet__note"
            type="text"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="Block note"
            aria-label="Block note"
            value={note.value}
            onInput={(e) => (note.value = e.currentTarget.value)}
          />
          <Button disabled={busy.value} onClick={() => void saveNote()}>Save note</Button>
          {p.move === undefined ? (
            <Button onClick={makeCurrent}>Make current</Button>
          ) : (
            <>
              <Button disabled={!p.move.up || busy.value} onClick={() => void move('up')}>Move up</Button>
              <Button disabled={!p.move.down || busy.value} onClick={() => void move('down')}>Move down</Button>
            </>
          )}
          <Button kind="danger" disabled={busy.value} onClick={() => void remove()}>Delete block</Button>
        </>
      )}
    </Sheet>
  );
}
```

Create `src/ui/components/log/EntryArea.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { addSet, findSet, type SetInput } from '../../../model/edit';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { formatAmount, formatLoad } from '../../format';
import { Button, NumberPad, Sheet, Stepper } from '../shared';
import { LoadSheet, type Load } from './LoadSheet';
import type { CurrentVm } from './log-screen.vm';
import { currentBlockId, draftFor, setDraft, typedValue } from './log-state';
import { NoteSheet } from './NoteSheet';
import { editSession } from './outcome';
import { ADD_SET_MIN_HOLD_MS, useWriteGuard } from './use-write-guard';

/**
 * Spec 4 §4 "Entry area": pinned above the tab bar while a current block exists. The stepper shows
 * the proposal unless the owner changed it; the typed value, the set note and a load chosen on the
 * load button live in the block's draft (`log-state.ts`), so a tab switch loses none of them. After
 * Add set the value and the note go; the chosen load stays for the block. A typed value counts only
 * for the set number it was typed for, so a set added elsewhere brings the proposal back.
 */
export function EntryArea(p: { row: SessionRow; current: CurrentVm }): JSX.Element {
  const { data } = useApp();
  const c = p.current;
  const path = p.row.path;
  const draft = draftFor(c.blockId);

  const sheet = useSignal<'load' | 'note' | 'pad' | undefined>(undefined);
  /** The amount to add once the load sheet saves (a weight was required first). */
  const addAfterLoad = useSignal<number | undefined>(undefined);
  // Add is held while a write runs and until the screen shows its set: a second tap before the
  // set number moves on would add a further set at a proposal the owner never saw. The refresh can
  // land a few ms after the tap, so Add also stays held for a minimum time (a double tap).
  const guard = useWriteGuard((setId) => findSet(p.row.file.session, setId) !== undefined, { minHoldMs: ADD_SET_MIN_HOLD_MS });

  const value = typedValue(draft, c.setNumber) ?? c.proposed;
  const override = draft.load;
  const load: Load = override ?? { loadType: c.load.loadType, loadKg: c.load.loadKg };
  const loadText = override === undefined ? c.loadText : formatLoad(override.loadType, override.loadKg);
  const hasNote = (draft.note ?? '').trim() !== '';

  const add = (amount: number, setLoad: Load): Promise<void> => guard.run(() => addOnce(amount, setLoad));

  /** Writes one set; the id of the set written, or undefined when nothing was written. */
  const addOnce = async (amount: number, setLoad: Load): Promise<string | undefined> => {
    const now = data.clock();
    const blockId = c.blockId;
    const text = (draftFor(blockId).note ?? '').trim();
    const input: SetInput = {
      ...(c.metric === 'reps' ? { reps: amount } : { seconds: amount }),
      loadType: setLoad.loadType,
      loadKg: setLoad.loadKg,
      ...(text !== '' ? { note: text } : {}),
      completedAt: now.toISOString(),
    };
    let added: string | undefined;
    const ok = await editSession(data, path, (f) => {
      const result = addSet(f, blockId, input, now);
      added = result.setId; // a replay on the fresh row makes a new id; the last one is the one written
      return result.file;
    });
    if (!ok) return undefined;
    currentBlockId.value = blockId;
    // The stepper goes back to the proposal and the note is used up; the chosen load stays sticky.
    setDraft(blockId, { typed: undefined, note: undefined });
    return added;
  };

  /** "Add set" and the pad's Add: a weight is required (spec 1 §5) and nothing gives one yet → the
   *  load sheet first, before the block's first write. */
  const requestAdd = (amount: number | undefined): void => {
    if (amount === undefined || guard.held()) return;
    if (override === undefined && c.load.needsKg && c.setNumber === 1) {
      addAfterLoad.value = amount;
      sheet.value = 'load';
      return;
    }
    void add(amount, load);
  };

  const closeSheet = (): void => {
    sheet.value = undefined;
    addAfterLoad.value = undefined;
  };

  const saveLoad = (next: Load): void => {
    setDraft(c.blockId, { load: next });
    const thenAdd = addAfterLoad.value;
    closeSheet();
    if (thenAdd !== undefined) void add(thenAdd, next);
  };

  const blockId = c.blockId;
  return (
    <>
      <div class="entry-spacer" aria-hidden="true" />
      <section class="entry" aria-label="Entry">
        <div class="entry__inner">
          <div class="entry__top">
            {/* Only the name truncates: the set number is the owner's place in the ladder (spec 4 §1). */}
            <span class="entry__what">
              <b class="entry__name">{c.name}</b>{' '}
              <span class="entry__set">· set {c.setNumber}</span>
            </span>
            <button type="button" class="entry__load" onClick={() => (sheet.value = 'load')}>{loadText}</button>
            <button type="button" class={`entry__note${hasNote ? ' is-set' : ''}`} onClick={() => (sheet.value = 'note')}>note</button>
          </div>
          <Stepper
            value={value}
            step={c.step}
            min={1}
            onChange={(v) => setDraft(blockId, { typed: v === undefined ? undefined : { amount: v, setNumber: c.setNumber } })}
            onOpenPad={() => (sheet.value = 'pad')}
          />
          <Button kind="primary" disabled={value === undefined || guard.held()} onClick={() => requestAdd(value)}>
            {value === undefined ? 'Add set' : `Add set · ${formatAmount(value)}`}
          </Button>
        </div>
      </section>

      {sheet.value === 'load' && <LoadSheet load={load} onSave={saveLoad} onClose={closeSheet} />}
      {sheet.value === 'note' && (
        <NoteSheet
          title="Set note"
          value={draft.note ?? ''}
          onSave={(text) => {
            setDraft(blockId, { note: text.trim() === '' ? undefined : text });
            closeSheet();
          }}
          onClose={closeSheet}
        />
      )}
      {sheet.value === 'pad' && (
        <Sheet title="Amount" onClose={closeSheet}>
          <NumberPad
            value={value}
            submitLabel="Add"
            allowZero={false}
            onSubmit={(v) => {
              // Kept as the stepper's value too, so a cancelled load sheet does not lose it.
              setDraft(blockId, { typed: { amount: v, setNumber: c.setNumber } });
              closeSheet();
              requestAdd(v);
            }}
            onCancel={closeSheet}
          />
        </Sheet>
      )}
    </>
  );
}
```

Create `src/ui/components/log/ExerciseSearch.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createExercise, type NewExerciseFields } from '../../../model/catalog';
import { LOAD_TYPES, PATTERNS } from '../../../model/schema';
import type { Exercise, LoadType, Pattern } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { Button, Sheet } from '../shared';
import { exerciseSearchVm } from './exercise-search.vm';
import { quietOutcome, showHeldBack } from './outcome';

interface Draft {
  name: string;
  pattern: Pattern;
  metric: 'reps' | 'seconds';
  perSide: boolean;
  defaultLoadType: LoadType;
  family: string;
}

/**
 * Spec 4 §4 "Exercises": the catalog search behind "Other exercise…". Picking an entry hands its id
 * to `onPick` (the Log tab adds a block and makes it current). Create writes the catalog first and
 * then hands over the new id, so the catalog upload goes ahead of the session (spec 3 S12). Without
 * a readable catalog, Create is disabled and existing entries can still be picked.
 */
export function ExerciseSearch(p: { onPick(exerciseId: string): Promise<void>; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const query = useSignal('');
  const draft = useSignal<Draft | undefined>(undefined);
  const catalogOk = data.catalog.value !== undefined && !data.refusedRows.value.some((r) => r.path === EXERCISES_PATH);

  const pick = (id: string): void => {
    p.onClose();
    void p.onPick(id);
  };

  const busy = useSignal(false);

  /** One create at a time: a second tap during the catalog write would add a second block. */
  const create = async (d: Draft): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await createOnce(d);
    } finally {
      busy.value = false;
    }
  };

  const createOnce = async (d: Draft): Promise<void> => {
    const name = d.name.trim();
    if (name === '') return;
    const fields: NewExerciseFields = {
      pattern: d.pattern,
      metric: d.metric,
      perSide: d.perSide,
      defaultLoadType: d.defaultLoadType,
      ...(d.family.trim() !== '' ? { family: d.family.trim() } : {}),
    };
    const now = data.clock();
    const before = data.exercises.value;
    const preview = createExercise(name, fields, before, now);
    // An existing live entry needs no write; one that was archived or deleted is revived by the write.
    if (preview.existing && preview.catalog.every((e, i) => e === before[i])) {
      pick(preview.exercise.id);
      return;
    }
    let made: Exercise | undefined;
    const outcome = await data.edit('exercises', EXERCISES_PATH, (f) => {
      const result = createExercise(name, fields, f.exercises, now);
      made = result.exercise;
      return { ...f, exercises: result.catalog };
    });
    const written = quietOutcome(EXERCISES_PATH, outcome);
    if (!written.ok || made === undefined) return;
    p.onClose();
    await p.onPick(made.id);
    // Shown after the block's write, so a toast of that write cannot replace it; it joins that toast.
    if (written.heldBackNote) showHeldBack();
  };

  const d = draft.value;
  if (d !== undefined) {
    return <CreateForm draft={d} busy={busy.value} onChange={(next) => (draft.value = next)} onSubmit={() => void create(d)} onBack={() => (draft.value = undefined)} />;
  }

  const vm = exerciseSearchVm(data.exercises.value, query.value);
  const typed = query.value.trim().replace(/\s+/g, ' ');
  return (
    <Sheet title="Exercise" onClose={p.onClose}>
      <input
        class="exsearch__input"
        type="text"
        autocomplete="off"
        enterkeyhint="search"
        placeholder="Search"
        aria-label="Search exercises"
        value={query.value}
        onInput={(e) => (query.value = e.currentTarget.value)}
      />
      <EntryList entries={vm.live} onPick={pick} />
      {vm.archived.length > 0 && (
        <details class="exsearch__archived">
          <summary>Archived ({vm.archived.length})</summary>
          <EntryList entries={vm.archived} onPick={pick} />
        </details>
      )}
      {vm.canCreate && (
        <div class="exsearch__create">
          <Button
            kind="primary"
            disabled={!catalogOk}
            onClick={() => (draft.value = { name: typed, pattern: 'other', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: '' })}
          >
            {`Create “${typed}”`}
          </Button>
          {!catalogOk && <span class="exsearch__reason">catalog not available</span>}
        </div>
      )}
    </Sheet>
  );
}

/** Entries grouped by family (the order exerciseSearchVm gives), a heading per family. */
function EntryList(p: { entries: readonly Exercise[]; onPick(id: string): void }): JSX.Element {
  const rows: JSX.Element[] = [];
  let family: string | undefined | null = null;
  for (const e of p.entries) {
    if (e.family !== family) {
      family = e.family;
      rows.push(<li key={`family:${family ?? ''}`} class="exsearch__family">{family ?? 'Other'}</li>);
    }
    rows.push(
      <li key={e.id}>
        <button type="button" class="exsearch__entry" onClick={() => p.onPick(e.id)}>{e.name}</button>
      </li>,
    );
  }
  return <ul class="exsearch__list">{rows}</ul>;
}

/** The select's value as one of the allowed literals, else the previous value. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

function CreateForm(p: { draft: Draft; busy: boolean; onChange(d: Draft): void; onSubmit(): void; onBack(): void }): JSX.Element {
  const d = p.draft;
  const set = (patch: Partial<Draft>): void => p.onChange({ ...d, ...patch });
  return (
    <Sheet title="New exercise" onClose={p.onBack}>
      <label class="exform__field">
        <span>Name</span>
        <input type="text" autocomplete="off" aria-label="Name" value={d.name} onInput={(e) => set({ name: e.currentTarget.value })} />
      </label>
      <label class="exform__field">
        <span>Pattern</span>
        <select aria-label="Pattern" value={d.pattern} onChange={(e) => set({ pattern: oneOf(PATTERNS, e.currentTarget.value, d.pattern) })}>
          {PATTERNS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Metric</span>
        <select aria-label="Metric" value={d.metric} onChange={(e) => set({ metric: e.currentTarget.value === 'seconds' ? 'seconds' : 'reps' })}>
          <option value="reps">reps</option>
          <option value="seconds">seconds</option>
        </select>
      </label>
      <label class="exform__check">
        <input type="checkbox" checked={d.perSide} onChange={(e) => set({ perSide: e.currentTarget.checked })} />
        <span>Per side</span>
      </label>
      <label class="exform__field">
        <span>Default load</span>
        <select aria-label="Default load" value={d.defaultLoadType} onChange={(e) => set({ defaultLoadType: oneOf(LOAD_TYPES, e.currentTarget.value, d.defaultLoadType) })}>
          {LOAD_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Family</span>
        <input type="text" autocomplete="off" aria-label="Family" placeholder="optional" value={d.family} onInput={(e) => set({ family: e.currentTarget.value })} />
      </label>
      <Button kind="primary" disabled={d.name.trim() === '' || p.busy} onClick={p.onSubmit}>Create exercise</Button>
    </Sheet>
  );
}
```

Create `src/ui/components/log/LoadSheet.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { LOAD_TYPES } from '../../../model/schema';
import type { LoadType } from '../../../model/types';
import { Button, NumberPad, Sheet } from '../shared';

export interface Load {
  loadType: LoadType;
  loadKg: number;
}

/** Spec 4 §4 "Sticky load": the five load types and a kg pad (hidden for bodyweight, which carries 0 kg).
 *  The pad's Use saves a weighted load; bodyweight saves with its own button. */
export function LoadSheet(p: { load: Load; onSave(load: Load): void; onClose(): void }): JSX.Element {
  const type = useSignal<LoadType>(p.load.loadType);
  return (
    <Sheet title="Load" onClose={p.onClose}>
      <div class="loadsheet__types" role="group" aria-label="Load type">
        {LOAD_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            class={`loadsheet__type${t === type.value ? ' is-active' : ''}`}
            aria-pressed={t === type.value}
            onClick={() => (type.value = t)}
          >
            {t}
          </button>
        ))}
      </div>
      {type.value === 'bodyweight' ? (
        <Button kind="primary" onClick={() => p.onSave({ loadType: 'bodyweight', loadKg: 0 })}>Save</Button>
      ) : (
        <>
          <div class="loadsheet__caption">kg</div>
          {/* Spec 1 §3: external and band may carry 0 kg; added and assist need a weight. "Use" sets
              the load only: the caller decides whether a set is written. */}
          <NumberPad
            value={p.load.loadKg > 0 ? p.load.loadKg : undefined}
            submitLabel="Use"
            allowZero={type.value === 'external' || type.value === 'band'}
            onSubmit={(kg) => p.onSave({ loadType: type.value, loadKg: kg })}
            onCancel={p.onClose}
          />
        </>
      )}
    </Sheet>
  );
}
```

Replace the whole content of `src/ui/components/log/LogScreen.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { addBlock, findBlock } from '../../../model/edit';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { Button, Marks, SetChips } from '../shared';
import type { CardVm, LogScreenVm } from './log-screen.vm';
import { currentBlockId } from './log-state';
import { BlockSheet } from './BlockSheet';
import { ExerciseSearch } from './ExerciseSearch';
import { editSession } from './outcome';
import { SetSheet } from './SetSheet';
import { PickerSheet } from './StartPicker';
import { useWriteGuard } from './use-write-guard';

type Open =
  | { kind: 'picker'; mode: 'start' | 'change' }
  | { kind: 'set'; setId: string }
  | { kind: 'block'; blockId: string; name: string }
  | { kind: 'search' };

/** Spec 4 §4 "The screen": header, cards, Other exercise…, Done. The entry area is rendered by LogTab. */
export function LogScreen(p: { row: SessionRow; vm: LogScreenVm }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  const close = (): void => {
    open.value = undefined;
  };
  const { header } = p.vm;
  const path = p.row.path;

  // One Start at a time (a card's Start, or a pick in the search), held until the card shows the
  // new block: a second tap would add a second block of the exercise, an unpaired extra card.
  const guard = useWriteGuard((blockId) => findBlock(p.row.file.session, blockId) !== undefined);

  const startBlock = (exerciseId: string): Promise<void> =>
    guard.run(async () => {
      const now = data.clock();
      let added: string | undefined;
      const ok = await editSession(data, path, (f) => {
        const result = addBlock(f, exerciseId, now);
        added = result.blockId;
        return result.file;
      });
      if (!ok || added === undefined) return undefined;
      currentBlockId.value = added;
      return added;
    });

  const sheet = open.value;
  return (
    <section class="log">
      <header class="log-head">
        <div class="log-head__when">
          {header.date} · {header.startedAt}
        </div>
        <div class="log-head__actions">
          <button type="button" class="log-head__ref" onClick={() => (open.value = { kind: 'picker', mode: 'change' })}>
            {header.reference ?? 'No reference'} ▾
          </button>
          {/* Spec 4 §4 header: label, notes, tags, date and late entries live on the session page (§5). */}
          <Button onClick={() => router.navigate({ tab: 'days', sessionId: p.row.file.session.id })}>Details</Button>
          {header.offline && <span class="log-head__offline">offline</span>}
          <Button onClick={() => (open.value = { kind: 'picker', mode: 'start' })}>Start new</Button>
        </div>
      </header>

      {p.vm.cards.map((c) => (
        <Card
          key={c.key}
          card={c}
          counter={p.vm.counter}
          starting={guard.held()}
          onStart={() => void startBlock(c.exerciseId)}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onTapName={(blockId) => (open.value = { kind: 'block', blockId, name: c.name })}
        />
      ))}

      <div class="log-foot">
        <Button onClick={() => (open.value = { kind: 'search' })}>Other exercise…</Button>
        <Button onClick={() => router.navigate({ tab: 'days' })}>Done</Button>
      </div>

      {sheet?.kind === 'picker' && <PickerSheet mode={sheet.mode} sessionId={p.row.file.session.id} onClose={close} />}
      {sheet?.kind === 'set' && <SetSheet row={p.row} setId={sheet.setId} onClose={close} />}
      {sheet?.kind === 'block' && <BlockSheet row={p.row} blockId={sheet.blockId} name={sheet.name} onClose={close} />}
      {sheet?.kind === 'search' && <ExerciseSearch onPick={startBlock} onClose={close} />}
    </section>
  );
}

function Card(p: {
  card: CardVm;
  counter: string | undefined;
  /** A Start is running or waiting for its block to show: every Start is disabled. */
  starting: boolean;
  onStart(): void;
  onTapSet(setId: string): void;
  onTapName(blockId: string): void;
}): JSX.Element {
  const c = p.card;
  const started = c.state !== 'not-started';
  const current = c.state === 'current';
  const todayBlockId = c.todayBlockId;
  // Spec 4 §4: tapping a finished card makes it current again, so a forgotten set can be added there.
  const makeCurrent =
    c.state === 'finished' && todayBlockId !== undefined
      ? () => {
          currentBlockId.value = todayBlockId;
        }
      : undefined;
  // The keyboard and screen-reader target is the part of the body without controls of its own
  // (last time's chips, the note, the totals); a pointer tap anywhere on the body works too.
  const target: JSX.HTMLAttributes<HTMLDivElement> =
    makeCurrent !== undefined
      ? {
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            makeCurrent();
          },
        }
      : {};
  return (
    <article class={`log-card log-card--${c.state}`} aria-label={c.name}>
      <div class="log-card__head">
        <h3 class="log-card__name">
          {todayBlockId === undefined ? (
            c.name
          ) : (
            <button type="button" class="log-card__namebtn" onClick={() => p.onTapName(todayBlockId)}>{c.name}</button>
          )}
          {c.archived && <span class="log-card__archived">archived</span>}
        </h3>
        {started ? <span class="log-card__load">{c.loadText}</span> : <Button kind="primary" disabled={p.starting} onClick={p.onStart}>Start</Button>}
      </div>
      <div class="log-card__body" onClick={makeCurrent}>
        {started && (
          <>
            {c.referenceSets.length > 0 && <div class="log-card__caption">Today</div>}
            {/* A chip tap opens the set sheet only; it never also makes the card current. */}
            <div class="log-card__today" onClick={(e) => e.stopPropagation()}>
              <SetChips
                sets={c.todaySets}
                variant="today"
                proposed={c.proposed}
                onTap={(s) => p.onTapSet(s.id)}
                {...(current && c.todaySets.length > 0 ? { lastIndex: c.todaySets.length - 1 } : {})}
              />
            </div>
          </>
        )}
        <div class={`log-card__rest${makeCurrent !== undefined ? ' is-target' : ''}`} {...target}>
          {/* The target's name comes from its content (so the marks stay readable); this line leads it. */}
          {makeCurrent !== undefined && <span class="visually-hidden">Make {c.name} current. </span>}
          {c.referenceSets.length > 0 && (
            <>
              {started && <div class="log-card__caption">Last time</div>}
              <SetChips sets={c.referenceSets} variant="reference" {...(c.markIndex !== undefined ? { markIndex: c.markIndex } : {})} />
            </>
          )}
          {c.blockNote !== undefined && <p class="log-card__note">{c.blockNote}</p>}
          {c.totals !== undefined && (
            <div class="log-card__totals">
              <span>{c.totals.today}</span>
              {c.totals.reference !== '' && <span>{c.totals.reference}</span>}
              {c.marks !== undefined && <Marks amount={c.marks.amount} load={c.marks.load} provisional />}
              {current && p.counter !== undefined && (
                <span class="log-card__counter" aria-label="Since the last set">{p.counter}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
```

Replace the whole content of `src/ui/components/log/LogTab.tsx` with:

```tsx
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { EntryArea } from './EntryArea';
import { logScreenVm, resolveReference } from './log-screen.vm';
import { currentBlockId, referenceId, referenceLoadedFor } from './log-state';
import { LogScreen } from './LogScreen';
import { StartPicker } from './StartPicker';

/** Spec 4 §4: the start picker without an open session, else the open session (Resume). */
export function LogTab(): JSX.Element {
  const { data } = useApp();
  const row = data.openSession.value;
  return row === undefined ? <StartPicker /> : <OpenSession row={row} />;
}

function OpenSession(p: { row: SessionRow }): JSX.Element {
  const { data } = useApp();
  const today = p.row.file.session;
  const id = today.id;

  // Load the reference choice whenever the open session changes. Until `referenceLoadedFor`
  // names this session nothing is rendered, so the proposal never flashes in before the stored
  // choice (a missing choice re-proposes, §4). A remount for the same session (a tab switch)
  // keeps the choice already read and renders at once.
  useEffect(() => {
    if (referenceLoadedFor.value === id) return;
    let live = true;
    referenceId.value = undefined;
    void data.getMeta<string>(`reference:${id}`).then(
      (v) => {
        if (!live) return;
        referenceId.value = v;
        referenceLoadedFor.value = id;
      },
      () => {
        if (live) referenceLoadedFor.value = id;
      },
    );
    return () => {
      live = false;
    };
  }, [data, id]);

  if (referenceLoadedFor.value !== id) return <section class="log" aria-busy="true" />;

  const reference = resolveReference(referenceId.value, data.liveSessions.value, data.exercises.value, id);
  const vm = logScreenVm({
    today,
    reference,
    catalog: data.exerciseById.value,
    currentBlockId: currentBlockId.value,
    now: data.now.value,
    online: data.status.value.online,
  });
  return (
    <>
      <LogScreen row={p.row} vm={vm} />
      {vm.current !== undefined && <EntryArea row={p.row} current={vm.current} />}
    </>
  );
}
```

Create `src/ui/components/log/NoteSheet.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { Button, Sheet } from '../shared';

/** A one-line text sheet (a set note, a block note); Save hands back the text as typed (edit.ts trims it). */
export function NoteSheet(p: { title: string; value: string; onSave(text: string): void; onClose(): void }): JSX.Element {
  const draft = useSignal(p.value);
  return (
    <Sheet title={p.title} onClose={p.onClose}>
      <input
        class="notesheet__input"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        aria-label="Note"
        value={draft.value}
        onInput={(e) => (draft.value = e.currentTarget.value)}
      />
      <Button kind="primary" onClick={() => p.onSave(draft.value)}>Save</Button>
    </Sheet>
  );
}
```

Create `src/ui/components/log/SetSheet.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { amountOf, liveSets, metricOf, proposedAmount, stepFor, stickyLoad } from '../../../model/derive';
import { addSet, deleteSet, findBlock, findSet, setSetFields, undeleteSet, type SetFields, type SetInput } from '../../../model/edit';
import type { Block, Exercise, WorkoutSet } from '../../../model/types';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { formatAmount, formatLoad } from '../../format';
import { showToast } from '../../toast';
import { Button, NumberPad, Sheet, Stepper } from '../shared';
import { LoadSheet, type Load } from './LoadSheet';
import { editSession, editSessionQuiet, showHeldBack } from './outcome';

/**
 * Spec 4 §4 "set sheet". Edit (`setId`, a tap on a today chip): stepper, load, note, Save
 * (`setSetFields`, only the fields that changed, never completedAt) and Delete with an Undo toast.
 * Create (`blockId` + `create`, the session page's late entries): the same fields and "Add set";
 * `timed` decides whether the new set carries `completedAt` (only the Log tab's sets are timed).
 */
export type SetSheetProps = { row: SessionRow; onClose(): void } & ({ setId: string } | { blockId: string; create: true; timed: boolean });

interface Target {
  block: Block;
  set: WorkoutSet | undefined; // undefined in create mode
  metric: 'reps' | 'seconds';
  exercise: Exercise | undefined;
}

function metricFor(block: Block, exercise: Exercise | undefined): 'reps' | 'seconds' {
  const first = liveSets(block)[0];
  if (first !== undefined) return metricOf(first);
  return exercise?.metric ?? 'reps';
}

export function SetSheet(p: SetSheetProps): JSX.Element {
  const { data } = useApp();
  const session = p.row.file.session;
  const catalog = data.exerciseById.value;
  let target: Target | undefined;
  if ('setId' in p) {
    const found = findSet(session, p.setId);
    if (found !== undefined && found.set.deletedAt === undefined) {
      target = { block: found.block, set: found.set, metric: metricOf(found.set), exercise: catalog.get(found.block.exerciseId) };
    }
  } else {
    const block = findBlock(session, p.blockId);
    if (block !== undefined && block.deletedAt === undefined) {
      const exercise = catalog.get(block.exerciseId);
      target = { block, set: undefined, metric: metricFor(block, exercise), exercise };
    }
  }
  if (target === undefined) {
    return (
      <Sheet title="Set" onClose={p.onClose}>
        <p class="setsheet__gone">This set is no longer there.</p>
      </Sheet>
    );
  }
  return <SetForm {...p} target={target} />;
}

function SetForm(p: SetSheetProps & { target: Target }): JSX.Element {
  const { data } = useApp();
  const { block, set, metric } = p.target;
  const path = p.row.path;
  const sticky = stickyLoad(block, undefined, p.target.exercise);

  // The values the sheet opened with, kept once. Save sends only what differs from them, so a field
  // another device changed while the sheet was open is never written back.
  const opened = useRef<{ amount: number | undefined; load: Load; note: string }>({
    amount: set === undefined ? proposedAmount(block, undefined) : amountOf(set),
    load: set === undefined ? { loadType: sticky.loadType, loadKg: sticky.loadKg } : { loadType: set.loadType, loadKg: set.loadKg },
    note: set?.note ?? '',
  });
  // Initialised once: a re-render from a pull never loses what was typed (spec 4 §8).
  const amount = useSignal<number | undefined>(opened.current.amount);
  const load = useSignal<Load>(opened.current.load);
  const loadChosen = useSignal(false);
  const note = useSignal(opened.current.note);
  const sub = useSignal<'load' | 'pad' | undefined>(undefined);
  const saveAfterLoad = useSignal(false);
  const busy = useSignal(false);

  const closeSub = (): void => {
    sub.value = undefined;
    saveAfterLoad.value = false;
  };

  /** One write at a time: a second tap while a write is pending does nothing (it would write twice,
   *  since Data.edit replays on the fresh row). */
  const guarded = async (write: () => Promise<void>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const saveEdit = (current: WorkoutSet, value: number): Promise<void> => guarded(async () => {
    const l = load.value;
    const text = note.value.trim();
    const was = opened.current;
    const fields: SetFields = {
      ...(value !== was.amount ? (metric === 'reps' ? { reps: value } : { seconds: value }) : {}),
      ...(l.loadType !== was.load.loadType || l.loadKg !== was.load.loadKg ? { loadType: l.loadType, loadKg: l.loadKg } : {}),
      ...(text !== was.note.trim() ? { note: text === '' ? null : text } : {}),
    };
    if (Object.keys(fields).length === 0) {
      p.onClose();
      return;
    }
    const now = data.clock();
    if (await editSession(data, path, (f) => setSetFields(f, current.id, fields, now))) p.onClose();
  });

  const saveNew = (value: number, l: Load): Promise<void> => guarded(async () => {
    if ('setId' in p) return;
    const now = data.clock();
    const text = note.value.trim();
    const input: SetInput = {
      ...(metric === 'reps' ? { reps: value } : { seconds: value }),
      loadType: l.loadType,
      loadKg: l.loadKg,
      ...(text !== '' ? { note: text } : {}),
      ...(p.timed ? { completedAt: now.toISOString() } : {}),
    };
    const blockId = block.id;
    if (await editSession(data, path, (f) => addSet(f, blockId, input, now).file)) p.onClose();
  });

  const onSave = (): void => {
    const value = amount.value;
    if (value === undefined) return;
    if (set !== undefined) {
      void saveEdit(set, value);
      return;
    }
    // Same rule as the entry area: a weight is required and nothing gives one yet.
    if (sticky.needsKg && !loadChosen.value) {
      saveAfterLoad.value = true;
      sub.value = 'load';
      return;
    }
    void saveNew(value, load.value);
  };

  const onDelete = (current: WorkoutSet): Promise<void> => guarded(async () => {
    const now = data.clock();
    const setId = current.id;
    const written = await editSessionQuiet(data, path, (f) => deleteSet(f, setId, now));
    if (!written.ok) return;
    p.onClose();
    showToast(
      `Set ${formatAmount(amountOf(current))} deleted`,
      { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteSet(f, setId, data.clock())) },
      6000,
    );
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  });

  if (sub.value === 'load') {
    return (
      <LoadSheet
        load={load.value}
        onSave={(l) => {
          load.value = l;
          loadChosen.value = true;
          const thenSave = saveAfterLoad.value;
          closeSub();
          if (thenSave && amount.value !== undefined) void saveNew(amount.value, l);
        }}
        onClose={closeSub}
      />
    );
  }
  if (sub.value === 'pad') {
    return (
      <Sheet title="Amount" onClose={closeSub}>
        <NumberPad
          value={amount.value}
          submitLabel="Use"
          allowZero={false}
          onSubmit={(v) => {
            amount.value = v;
            closeSub();
          }}
          onCancel={closeSub}
        />
      </Sheet>
    );
  }

  // Spec 4 §5: a migrated aggregate set takes a note or a Delete only (edit.ts refuses amount and load changes).
  const aggregate = set?.aggregate === true;
  return (
    <Sheet title={set === undefined ? 'New set' : 'Set'} onClose={p.onClose}>
      {aggregate && set !== undefined ? (
        <p class="setsheet__aggregate">{`${formatAmount(amountOf(set))} total, set count unknown`}</p>
      ) : (
        <>
          <Stepper value={amount.value} step={stepFor(metric)} min={1} onChange={(v) => (amount.value = v)} onOpenPad={() => (sub.value = 'pad')} />
          <div class="setsheet__row">
            <span class="setsheet__label">Load</span>
            <button type="button" class="setsheet__load" onClick={() => (sub.value = 'load')}>
              {formatLoad(load.value.loadType, load.value.loadKg)}
            </button>
          </div>
        </>
      )}
      <input
        class="setsheet__note"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="Note"
        aria-label="Note"
        value={note.value}
        onInput={(e) => (note.value = e.currentTarget.value)}
      />
      <div class="setsheet__actions">
        {set !== undefined && (
          <Button kind="danger" disabled={busy.value} onClick={() => void onDelete(set)}>Delete</Button>
        )}
        <Button kind="primary" disabled={amount.value === undefined || busy.value} onClick={onSave}>
          {set === undefined ? 'Add set' : 'Save'}
        </Button>
      </div>
    </Sheet>
  );
}
```

Create `src/ui/components/log/exercise-search.vm.ts`:

```ts
import { normalizeName } from '../../../model/slug';
import type { Exercise } from '../../../model/types';

export interface ExerciseSearchVm {
  live: Exercise[];
  archived: Exercise[];
  canCreate: boolean;
}

/** By family (entries without one last), then by name. */
function byFamilyThenName(a: Exercise, b: Exercise): number {
  const fa = a.family;
  const fb = b.family;
  if (fa !== fb) {
    if (fa === undefined) return 1;
    if (fb === undefined) return -1;
    return fa.localeCompare(fb);
  }
  return a.name.localeCompare(b.name);
}

/** Spec 4 §4 "Exercises": the catalog filtered by name as typed (trimmed, spaces collapsed, any case);
 *  live entries first, archived ones in their own group; tombstones never show. Create is offered
 *  when the query is not blank and no *live* entry (not deleted, not archived) has exactly that
 *  name (spec 4 §4). For an archived or deleted name, Create goes through createExercise, which
 *  returns that entry unarchived or undeleted (spec 1 §3 "Name uniqueness"). */
export function exerciseSearchVm(catalog: readonly Exercise[], query: string): ExerciseSearchVm {
  const wanted = normalizeName(query);
  const matching = catalog.filter((e) => e.deletedAt === undefined && normalizeName(e.name).includes(wanted));
  const liveExact = catalog.some((e) => e.deletedAt === undefined && !e.archived && normalizeName(e.name) === wanted);
  return {
    live: matching.filter((e) => !e.archived).sort(byFamilyThenName),
    archived: matching.filter((e) => e.archived).sort(byFamilyThenName),
    canCreate: wanted !== '' && !liveExact,
  };
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .entry (components/log/EntryArea) ---- */
/* Pinned above the tab bar (56 px + safe area); the spacer keeps the last card scrollable above it,
   and the toast moves above it while it shows. */
.entry {
  position: fixed;
  inset-inline: 0;
  bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  z-index: 5;
  background: var(--panel);
  border-top: 1px solid var(--outline);
}
.entry__inner { display: flex; flex-direction: column; gap: 8px; max-width: 40rem; margin: 0 auto; padding: 8px 16px; }
.entry__inner > .btn { width: 100%; }
.entry__top { display: flex; align-items: center; gap: 8px; min-height: 44px; }
/* At 375 px a long name ('Diamond Push-ups', 'Australian Pull-ups') next to the load and note
   buttons leaves about 150 px: only the name truncates, the set number always shows. */
.entry__what { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 0.3em; white-space: nowrap; }
.entry__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.entry__set { flex: none; }
.entry__load, .entry__note {
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.entry__load::after { content: ' ▾'; color: var(--muted); }
.entry__note { color: var(--muted); }
.entry__note.is-set { border-color: var(--accent); color: var(--accent); }
.entry-spacer { height: 190px; }
body:has(.entry) .toast { bottom: calc(56px + 190px + env(safe-area-inset-bottom, 0px)); }

/* ---- .loadsheet, .notesheet (components/log/LoadSheet, NoteSheet) ---- */
.loadsheet__types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.loadsheet__type {
  min-height: 44px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
}
.loadsheet__type.is-active { border-color: var(--accent); color: var(--accent); }
.loadsheet__caption { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.notesheet__input, .setsheet__note, .blocksheet__note, .exsearch__input, .exform__field input, .exform__field select {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}

/* ---- .setsheet, .blocksheet (components/log/SetSheet, BlockSheet) ---- */
.setsheet__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.setsheet__label { color: var(--muted); }
.setsheet__load {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
}
.setsheet__load::after { content: ' ▾'; color: var(--muted); }
.setsheet__actions { display: flex; justify-content: space-between; gap: 8px; }
.setsheet__actions .btn--primary { margin-left: auto; }
.setsheet__gone, .blocksheet__gone { margin: 0; color: var(--muted); }

/* ---- .exsearch, .exform (components/log/ExerciseSearch) ---- */
.exsearch__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.exsearch__family { padding: 8px 0 2px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.exsearch__entry {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  text-align: left;
}
.exsearch__archived summary { min-height: 44px; display: flex; align-items: center; color: var(--muted); cursor: pointer; }
.exsearch__archived .exsearch__entry { color: var(--muted); }
.exsearch__create { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.exsearch__reason { color: var(--muted); font-size: 14px; }
.exform__field { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 14px; }
.exform__check { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.exform__check input { width: 22px; height: 22px; accent-color: var(--accent); }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 70 test files and 962 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/log/BlockSheet.test.tsx src/ui/components/log/BlockSheet.tsx src/ui/components/log/EntryArea.test.tsx src/ui/components/log/EntryArea.tsx src/ui/components/log/ExerciseSearch.held-back.test.tsx src/ui/components/log/ExerciseSearch.test.tsx src/ui/components/log/ExerciseSearch.tsx src/ui/components/log/LoadSheet.tsx src/ui/components/log/LogScreen.tsx src/ui/components/log/LogTab.test.tsx src/ui/components/log/LogTab.tsx src/ui/components/log/NoteSheet.tsx src/ui/components/log/SetSheet.test.tsx src/ui/components/log/SetSheet.tsx src/ui/components/log/exercise-search.vm.test.ts src/ui/components/log/exercise-search.vm.ts src/ui/theme.css
git commit -m "Add the Log tab entry area, sheets and exercise search" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Days list and past sessions

The chronological list with the chips (filter by block pattern, never by label), month groups, per-exercise indicators, the open and locked rows (§5 "Days list"), and Add past session (no `startedAt`).

**Files:**
- Create: `src/ui/components/days/DaysTab.test.tsx`
- Modify: `src/ui/components/days/DaysTab.tsx`
- Create: `src/ui/components/days/PastSessionSheet.tsx`
- Create: `src/ui/components/days/days.vm.test.ts`
- Create: `src/ui/components/days/days.vm.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/edit`, `src/model/types`, `src/sync/paths`, `src/ui/components/log/outcome`, `src/ui/components/shared`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/locked`, `src/ui/toast`.
- Produces:
  - `src/ui/components/days/DaysTab.tsx`:
    - `export function DaysTab(): JSX.Element`
  - `src/ui/components/days/PastSessionSheet.tsx`:
    - `export const justCreated = signal<string | undefined>(undefined)`
    - `export function PastSessionSheet(p: { onClose(): void }): JSX.Element`
  - `src/ui/components/days/days.vm.ts`:
    - `export type DaysChip = Chip | 'all'`
    - `export interface DayRow`
    - `export interface MonthGroup`
    - `export interface DaysVm`
    - `export const DAYS_CHIPS: ReadonlyArray<{ id: DaysChip; label: string }> = [`
    - `export function isDaysChip(value: unknown): value is DaysChip`
    - `export function daysVm(input:`
    - `export type ExerciseMarks = ReadonlyMap<string, ReadonlyMap<string, AmountIndicator>>`
    - `export function exerciseMarks(sessions: readonly Session[]): Map<string, Map<string, AmountIndicator>>`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/components/days/DaysTab.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { block, exercise, exercisesFile, ladder, session, sessionFile } from '../../../model/test-fixtures';
import type { Session, SessionFile } from '../../../model/types';
import { openDb } from '../../../sync/db';
import { EXERCISES_PATH, sessionPath } from '../../../sync/paths';
import { Store, type FileRow } from '../../../sync/store';
import { AppContext, type AppDeps, type SyncActions } from '../../context';
import { Data } from '../../data';
import { localDate } from '../../format';
import { Router, type RouterWindow } from '../../router';
import { toast } from '../../toast';
import { DaysTab } from './DaysTab';

const NOW = new Date('2030-03-09T11:00:00.000Z');

function fakeWindow(): RouterWindow {
  const win: RouterWindow = {
    location: { hash: '#/days' },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

const PULL = session([block(ladder([8, 8]), { exerciseId: 'pull-ups' })], { id: 'a1000000-0000-4000-8000-000000000001', date: '2030-03-04', dateUncertain: true, source: 'migrated' });
const PUSH = session([block(ladder([10]), { exerciseId: 'dips' })], { id: 'b2000000-0000-4000-8000-000000000002', date: '2030-03-07', label: 'push' });
const OPEN = session([], { id: 'c3000000-0000-4000-8000-000000000003', date: '2030-03-09', startedAt: '2030-03-09T10:30:00.000Z' });

function okRow(s: Session, version = 1): FileRow {
  return { path: sessionPath(s.date, s.id), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', issues: [], version };
}

async function setup(over: { refused?: FileRow[]; chip?: string; open?: Session } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  await store.saveRow({
    path: EXERCISES_PATH, kind: 'exercises', rev: 'r1', status: 'ok', issues: [], version: 1,
    content: exercisesFile([exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }), exercise({ id: 'dips', name: 'Dips', pattern: 'push' })]),
  });
  for (const s of [PULL, PUSH, over.open ?? OPEN]) await store.saveRow(okRow(s));
  for (const r of over.refused ?? []) await store.saveRow(r);
  if (over.chip !== undefined) await store.setMeta('daysChip', over.chip);
  const data = new Data({ store, now: () => NOW });
  await data.load();
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const ui = {
    connected: signal(false), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
    pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
    updateAvailable: signal(false), buildId: 'b1',
  };
  const router = new Router(fakeWindow());
  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><DaysTab /></AppContext.Provider>);
  return { store, data, router };
}

const rowOf = (text: string): HTMLButtonElement => {
  const button = screen.getByText(text).closest('button');
  if (button === null) throw new Error(`no row for ${text}`);
  return button;
};

describe('DaysTab', () => {
  it('renders the rows newest first under a month header, with ?, label, exercises and open', async () => {
    await setup();
    expect(screen.getByText('March 2030').classList.contains('days__month')).toBe(true);
    const rows = Array.from(document.querySelectorAll('.days-row'));
    expect(rows.map((r) => r.querySelector('.days-row__day')?.textContent)).toEqual(['Sat 09 Mar', 'Thu 07 Mar', 'Mon 04 Mar?']);
    expect(rowOf('Thu 07 Mar').textContent).toContain('Push');
    expect(rowOf('Thu 07 Mar').textContent).toContain('Dips');
    expect(rowOf('Sat 09 Mar').textContent).toContain('open');
    expect(rowOf('Thu 07 Mar').textContent).not.toContain('open');
  });

  it('a chip tap filters by pattern and stores the chip in meta', async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    await waitFor(() => expect(document.querySelectorAll('.days-row')).toHaveLength(1));
    expect(rowOf('Mon 04 Mar').textContent).toContain('Pull-ups');
    expect(screen.getByRole('button', { name: 'Pull' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(async () => expect(await store.getMeta('daysChip')).toBe('pull'));
  });

  it('loads the stored chip on mount and shows the empty text when nothing matches', async () => {
    await setup({ chip: 'legs' });
    await waitFor(() => expect(screen.getByText('No session matches this filter.')).toBeTruthy());
    expect(document.querySelectorAll('.days-row')).toHaveLength(0);
  });

  it('a row opens its session page; the open session goes to the Log tab', async () => {
    const { router } = await setup();
    fireEvent.click(rowOf('Thu 07 Mar'));
    expect(router.route.value).toEqual({ tab: 'days', sessionId: PUSH.id });
    fireEvent.click(rowOf('Sat 09 Mar'));
    expect(router.route.value).toEqual({ tab: 'log' });
  });

  it('lists a refused session with a lock and opens it like any other', async () => {
    const locked = session([block(ladder([5]), { exerciseId: 'dips' })], { id: 'd4000000-0000-4000-8000-000000000004', date: '2030-02-20' });
    const { router } = await setup({ refused: [{ ...okRow(locked), status: 'needs-update' }] });
    expect(screen.getByText('February 2030')).toBeTruthy();
    const row = rowOf('Wed 20 Feb');
    expect(row.querySelector('[aria-label="read-only"]')).toBeTruthy();
    expect(rowOf('Thu 07 Mar').querySelector('[aria-label="read-only"]')).toBeNull();
    fireEvent.click(row);
    expect(router.route.value).toEqual({ tab: 'days', sessionId: locked.id });
  });

  it('does not list the loser of a duplicate pair: its ok twin is the one row, editable (spec 3 §6)', async () => {
    const twin = okRow(PUSH);
    await setup({ refused: [{ ...twin, path: sessionPath(PUSH.date, 'ffffffff-0000-4000-8000-00000000000f'), duplicateOf: twin.path }] });
    expect(document.querySelectorAll('.days-row')).toHaveLength(3);
    expect(rowOf('Thu 07 Mar').querySelector('[aria-label="read-only"]')).toBeNull();
  });

  it('does not list a refused row whose session id an ok row holds: its route would open the ok one', async () => {
    const other = { ...okRow({ ...PUSH, date: '2030-02-20' }), status: 'needs-update' as const };
    await setup({ refused: [other] });
    expect(document.querySelectorAll('.days-row')).toHaveLength(3);
    expect(document.querySelector('[aria-label="read-only"]')).toBeNull();
  });

  it('Add past session writes a session without startedAt and opens its page', async () => {
    const { store, router } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe(localDate(NOW));
    fireEvent.input(input, { target: { value: '2030-03-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.route.value).toMatchObject({ tab: 'days', sessionId: expect.any(String) }));
    const route = router.route.value;
    if (route.tab !== 'days' || route.sessionId === undefined) throw new Error('not on a session page');
    const row = await store.getRow(sessionPath('2030-03-02', route.sessionId));
    const file = row?.content as SessionFile;
    expect(file.session).toMatchObject({ id: route.sessionId, date: '2030-03-02', source: 'app', blocks: [], tags: [] });
    expect(file.session.startedAt).toBeUndefined();
    expect(file.session.updatedAt).toBe(NOW.toISOString());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Add past session shows the held-back toast and still opens the page', async () => {
    const { data, router } = await setup();
    vi.spyOn(data, 'create').mockResolvedValue({ ok: true, heldBack: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)'));
    expect(router.route.value).toMatchObject({ tab: 'days', sessionId: expect.any(String) });
  });

  it.each([
    ['quarantined', 'This file is read-only (quarantined)'],
    ['changed', 'Changed elsewhere, try again'],
  ] as const)('Add past session names a refused write (%s) with the shared toast text and keeps the sheet usable', async (reason, text) => {
    const { data, router } = await setup();
    vi.spyOn(data, 'create').mockResolvedValue({ ok: false, reason });
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe(text));
    expect(router.route.value).toEqual({ tab: 'days' });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Add past session ignores a second tap on Create while the first write runs', async () => {
    const { data, store } = await setup();
    const creates = vi.spyOn(data, 'create');
    const before = (await store.sessions()).length;
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    const create = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(creates).toHaveBeenCalledTimes(1);
    expect((await store.sessions()).length).toBe(before + 1);
  });

  it("the open session's marks are dimmed as provisional; a closed session's are not", async () => {
    const open = session([block(ladder([8], { completedAt: '2030-03-09T10:40:00.000Z' }), { exerciseId: 'dips' })], { id: OPEN.id, date: OPEN.date, startedAt: '2030-03-09T10:30:00.000Z' });
    await setup({ open });
    const openMarks = rowOf('Sat 09 Mar').querySelector('.marks');
    expect(openMarks?.classList.contains('is-provisional')).toBe(true);
    expect(openMarks?.querySelector('[aria-label="less"]')).toBeTruthy();
    expect(rowOf('Thu 07 Mar').querySelector('.marks')?.classList.contains('is-provisional')).toBe(false);
  });

  it('a malformed quarantined session (label 5, a number among the tags) stays off the list and breaks nothing', async () => {
    const bad = session([block(ladder([5]), { exerciseId: 'dips' })], { id: 'e5000000-0000-4000-8000-000000000005', date: '2030-02-21' });
    const raw = { schemaVersion: 1, session: { ...bad, label: 5, tags: [7] } };
    await setup({ refused: [{ ...okRow(bad), content: raw, status: 'quarantined' }] });
    expect(document.querySelectorAll('.days-row')).toHaveLength(3);
    expect(screen.queryByText('February 2030')).toBeNull();
  });

  it('Add past session survives a failing store: error toast, Create enabled again, no unhandled rejection', async () => {
    const { data, router } = await setup();
    vi.spyOn(data, 'create').mockRejectedValue(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe('Not saved: disk full'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(router.route.value).toEqual({ tab: 'days' });
  });

  it('Add past session refuses an invalid date with a toast and writes nothing', async () => {
    const { store } = await setup();
    const before = (await store.rows()).length;
    fireEvent.click(screen.getByRole('button', { name: 'Add past session' }));
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(toast.value?.text).toBe('Pick a valid date.'));
    expect((await store.rows()).length).toBe(before);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
```

Create `src/ui/components/days/days.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exerciseIndicator, sessionExerciseIds } from '../../../model/derive';
import { block, exercise, ladder, session, set, timedSet } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import { formatMinutes } from '../../format';
import { daysVm, exerciseMarks, type DaysChip } from './days.vm';

const CATALOG: Exercise[] = [
  exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' }),
  exercise({ id: 'dips', name: 'Dips', pattern: 'push' }),
  exercise({ id: 'squats', name: 'Squats', pattern: 'legs' }),
  exercise({ id: 'plank', name: 'Plank', pattern: 'core', metric: 'seconds' }),
];

function vm(over: { sessions?: Session[]; lockedSessions?: Session[]; chip?: DaysChip; openSessionId?: string } = {}) {
  return daysVm({
    sessions: over.sessions ?? [],
    lockedSessions: over.lockedSessions ?? [],
    catalog: CATALOG,
    chip: over.chip ?? 'all',
    openSessionId: over.openSessionId,
  });
}

const ids = (v: ReturnType<typeof vm>): string[] => v.months.flatMap((m) => m.rows.map((r) => r.sessionId));

describe('daysVm', () => {
  it('lists sessions newest first, grouped by month with a month title', () => {
    const a = session([block(ladder([5]))], { date: '2030-02-27' });
    const b = session([block(ladder([5]))], { date: '2030-03-04' });
    const c = session([block(ladder([5]))], { date: '2030-03-07' });
    const v = vm({ sessions: [a, c, b] });
    expect(v.months.map((m) => [m.key, m.title])).toEqual([['2030-03', 'March 2030'], ['2030-02', 'February 2030']]);
    expect(v.months[0]?.rows.map((r) => r.sessionId)).toEqual([c.id, b.id]);
    expect(v.months[1]?.rows.map((r) => r.sessionId)).toEqual([a.id]);
    expect(v.months[0]?.rows[0]?.day).toBe('Thu 07 Mar');
    expect(v.empty).toBe(false);
  });

  it('orders two sessions of one day by session order (start time), newest first', () => {
    const early = session([], { date: '2030-03-04', startedAt: '2030-03-04T08:00:00.000Z' });
    const late = session([], { date: '2030-03-04', startedAt: '2030-03-04T18:00:00.000Z' });
    expect(ids(vm({ sessions: [early, late] }))).toEqual([late.id, early.id]);
  });

  it('leaves tombstoned sessions out', () => {
    const gone = session([block(ladder([5]))], { date: '2030-03-04', deletedAt: '2030-03-05T10:00:00.000Z' });
    expect(vm({ sessions: [gone] }).empty).toBe(true);
  });

  it('offers All · Push · Pull · Legs · Other with the active one marked', () => {
    const v = vm({ chip: 'pull' });
    expect(v.chips.map((c) => [c.id, c.label, c.active])).toEqual([
      ['all', 'All', false], ['push', 'Push', false], ['pull', 'Pull', true], ['legs', 'Legs', false], ['other', 'Other', false],
    ]);
  });

  it('filters by the blocks’ exercise pattern, never by the label', () => {
    const pullDay = session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-04', label: 'push' });
    const mixed = session([block(ladder([5]), { exerciseId: 'dips' }), block(ladder([5]), { exerciseId: 'squats', order: 1 })], { date: '2030-03-05', label: 'pull' });
    const core = session([block([timedSet()], { exerciseId: 'plank' })], { date: '2030-03-06' });
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'pull' }))).toEqual([pullDay.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'push' }))).toEqual([mixed.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'legs' }))).toEqual([mixed.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'other' }))).toEqual([core.id]);
    expect(ids(vm({ sessions: [pullDay, mixed, core], chip: 'all' }))).toEqual([core.id, mixed.id, pullDay.id]);
  });

  it('marks an uncertain date and passes the label through as display text', () => {
    const s = session([], { date: '2030-03-04', dateUncertain: true, label: 'mixed' });
    const t = session([], { date: '2030-03-05' });
    const rows = vm({ sessions: [s, t] }).months[0]?.rows ?? [];
    expect(rows.map((r) => [r.uncertain, r.label])).toEqual([[false, undefined], [true, 'Mixed']]);
  });

  it('lists the exercises in block order, de-duplicated, with the per-exercise mark against all sessions', () => {
    const before = session([block(ladder([5, 5]), { exerciseId: 'pull-ups' }), block(ladder([10]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-01' });
    const now = session([
      block(ladder([6, 6]), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([10]), { exerciseId: 'dips', order: 1 }),
      block(ladder([1]), { exerciseId: 'pull-ups', order: 2 }),
      block(ladder([5]), { exerciseId: 'gone-exercise', order: 3 }),
    ], { date: '2030-03-04' });
    const row = vm({ sessions: [before, now], chip: 'push' }).months[0]?.rows[0];
    expect(row?.sessionId).toBe(now.id);
    expect(row?.exercises).toEqual([
      { id: 'pull-ups', name: 'Pull-ups', mark: 'up' },
      { id: 'dips', name: 'Dips', mark: 'same' },
      { id: 'gone-exercise', name: 'gone-exercise', mark: 'none' },
    ]);
  });

  it('computes marks against all live sessions even when the chip hides the earlier one', () => {
    const before = session([block(ladder([5]), { exerciseId: 'squats' }), block(ladder([10]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-01' });
    // Against the filtered list squats would compare with `before` (5 → 8, up); against all sessions with `legsOnly` (9 → 8, down).
    const legsOnly = session([block(ladder([9]), { exerciseId: 'squats' })], { date: '2030-03-02' });
    const now = session([block(ladder([8]), { exerciseId: 'squats' }), block(ladder([11]), { exerciseId: 'pull-ups', order: 1 })], { date: '2030-03-04' });
    const v = vm({ sessions: [before, legsOnly, now], chip: 'pull' });
    expect(ids(v)).toEqual([now.id, before.id]);
    expect(v.months[0]?.rows[0]?.exercises.map((e) => e.mark)).toEqual(['down', 'up']);
  });

  it('shows the span for a live session and nothing for a migrated one', () => {
    const live = session([block([
      set({ order: 0, completedAt: '2030-03-04T10:05:00.000Z' }),
      set({ order: 1, completedAt: '2030-03-04T10:48:00.000Z' }),
    ])], { date: '2030-03-04', startedAt: '2030-03-04T10:00:00.000Z' });
    const migrated = session([block(ladder([5]))], { date: '2030-03-03', source: 'migrated' });
    const rows = vm({ sessions: [live, migrated] }).months[0]?.rows ?? [];
    expect(rows[0]?.span).toBe(formatMinutes(48 * 60));
    expect(rows[1]?.span).toBeUndefined();
  });

  it('flags the open session only', () => {
    const a = session([], { date: '2030-03-04', startedAt: '2030-03-04T10:00:00.000Z' });
    const b = session([], { date: '2030-03-03' });
    const rows = vm({ sessions: [a, b], openSessionId: a.id }).months[0]?.rows ?? [];
    expect(rows.map((r) => r.open)).toEqual([true, false]);
  });

  it('merges locked sessions into the order, marks them locked, filters them by chip and never as open', () => {
    const ok = session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-04' });
    const locked = session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-03-05' });
    const all = vm({ sessions: [ok], lockedSessions: [locked], openSessionId: locked.id });
    expect(all.months[0]?.rows.map((r) => [r.sessionId, r.locked, r.open])).toEqual([[locked.id, true, false], [ok.id, false, false]]);
    expect(ids(vm({ sessions: [ok], lockedSessions: [locked], chip: 'pull' }))).toEqual([ok.id]);
  });

  it('is empty when no session matches', () => {
    const s = session([block(ladder([5]), { exerciseId: 'pull-ups' })], { date: '2030-03-04' });
    const v = vm({ sessions: [s], chip: 'legs' });
    expect(v.months).toEqual([]);
    expect(v.empty).toBe(true);
  });
});

describe('exerciseMarks', () => {
  it('gives every live session the same per-exercise marks as exerciseIndicator against all live sessions', () => {
    const sessions: Session[] = [
      session([block(ladder([5, 5]), { exerciseId: 'pull-ups' }), block(ladder([10]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-01' }),
      // empty, note-less block of pull-ups: no evidence, skipped as a comparison base
      session([block([], { exerciseId: 'pull-ups' }), block(ladder([9]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-02' }),
      // note-only block: evidence, unknown total → 'none' for the next one
      session([block([], { exerciseId: 'dips', note: 'felt off' })], { date: '2030-03-03' }),
      // two sessions on one day: ordered by start time
      session([block(ladder([6, 6]), { exerciseId: 'pull-ups' })], { date: '2030-03-04', startedAt: '2030-03-04T18:00:00.000Z' }),
      session([block(ladder([7]), { exerciseId: 'pull-ups' }), block(ladder([8]), { exerciseId: 'dips', order: 1 })], { date: '2030-03-04', startedAt: '2030-03-04T08:00:00.000Z' }),
      session([block(ladder([4]), { exerciseId: 'squats' }), block(ladder([3]), { exerciseId: 'pull-ups', order: 1 }), block(ladder([3]), { exerciseId: 'pull-ups', order: 2 })], { date: '2030-03-06' }),
      session([block([set({ reps: 100, aggregate: true })], { exerciseId: 'squats' })], { date: '2030-03-07', source: 'migrated' }),
      session([block(ladder([20]), { exerciseId: 'squats' })], { date: '2030-03-08' }),
      session([block(ladder([1]), { exerciseId: 'dips' })], { date: '2030-03-09', deletedAt: '2030-03-09T12:00:00.000Z' }),
      session([block(ladder([12]), { exerciseId: 'dips' })], { date: '2030-03-10' }),
      session([block(ladder([6, 6]), { exerciseId: 'dips' })], { date: '2030-03-11' }),
    ];
    const marks = exerciseMarks(sessions);
    const live = sessions.filter((s) => s.deletedAt === undefined);
    expect([...marks.keys()].sort()).toEqual(live.map((s) => s.id).sort());
    for (const s of live) {
      const expected = new Map(sessionExerciseIds(s).map((id) => [id, exerciseIndicator(sessions, s, id)]));
      expect(marks.get(s.id)).toEqual(expected);
    }
    // the fixture really exercises every branch
    const all = live.flatMap((s) => [...(marks.get(s.id)?.values() ?? [])]);
    expect(new Set(all)).toEqual(new Set(['up', 'down', 'same', 'none']));
  });
});

describe('daysVm with precomputed marks', () => {
  it('takes the marks of a live session from `marks` when given (DaysTab computes them once per data change)', () => {
    const s = session([block(ladder([5]), { exerciseId: 'dips' })], { date: '2030-03-04' });
    const v = daysVm({ sessions: [s], lockedSessions: [], catalog: CATALOG, chip: 'all', openSessionId: undefined, marks: new Map([[s.id, new Map([['dips', 'up' as const]])]]) });
    expect(v.months[0]?.rows[0]?.exercises).toEqual([{ id: 'dips', name: 'Dips', mark: 'up' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/components/days/DaysTab.test.tsx src/ui/components/days/days.vm.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/days/days.vm.test.ts: Error: Cannot find module './days.vm' imported from src/ui/components/days/days.vm.test.ts
```


- [ ] **Step 3: Write the implementation**

Replace the whole content of `src/ui/components/days/DaysTab.tsx` with:

```tsx
import { useComputed, useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../../context';
import { lockedSessionsOf } from '../../locked';
import { Button, Marks } from '../shared';
import { daysVm, exerciseMarks, isDaysChip, type DayRow, type DaysChip } from './days.vm';
import { PastSessionSheet } from './PastSessionSheet';

const CHIP_META = 'daysChip';

/** Spec 4 §5 "Days list": chips (remembered in meta), Add past session, month groups of rows. */
export function DaysTab(): JSX.Element {
  const { data, router } = useApp();
  const chip = useSignal<DaysChip>('all');
  const adding = useSignal(false);
  /** A tap before the stored chip arrives wins over it. */
  const tapped = useRef(false);

  useEffect(() => {
    let alive = true;
    void data.getMeta<unknown>(CHIP_META).then((stored) => {
      if (alive && !tapped.current && isDaysChip(stored)) chip.value = stored;
    });
    return () => { alive = false; };
  }, []);

  // Computed once per data change, not on every chip tap.
  const marks = useComputed(() => exerciseMarks(data.liveSessions.value));
  const locked = useComputed(() => lockedSessionsOf(data.refusedRows.value, new Set(data.sessions.value.map((r) => r.file.session.id))));

  const vm = daysVm({
    sessions: data.liveSessions.value,
    lockedSessions: locked.value,
    catalog: data.exercises.value,
    chip: chip.value,
    openSessionId: data.openSession.value?.file.session.id,
    marks: marks.value,
  });

  function pick(id: DaysChip): void {
    tapped.current = true;
    chip.value = id;
    void data.setMeta(CHIP_META, id);
  }

  function openRow(row: DayRow): void {
    if (row.open) router.navigate({ tab: 'log' });
    else router.navigate({ tab: 'days', sessionId: row.sessionId });
  }

  return (
    <div class="days">
      <div class="days__chips" role="group" aria-label="Filter by pattern">
        {vm.chips.map((c) => (
          <button
            key={c.id}
            type="button"
            class={`days__chip${c.active ? ' is-active' : ''}`}
            aria-pressed={c.active}
            onClick={() => pick(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div class="days__add">
        <Button onClick={() => { adding.value = true; }}>Add past session</Button>
      </div>
      {vm.empty && (
        <p class="days__empty">{chip.value === 'all' ? 'No sessions yet.' : 'No session matches this filter.'}</p>
      )}
      {vm.months.map((m) => (
        <section key={m.key} class="days__group">
          <h2 class="days__month">{m.title}</h2>
          <ul class="days__list">
            {m.rows.map((r, i) => (
              <li key={`${r.locked ? 'locked' : 'ok'}:${r.sessionId}:${i}`}>
                <Row row={r} onOpen={() => openRow(r)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {adding.value && <PastSessionSheet onClose={() => { adding.value = false; }} />}
    </div>
  );
}

/** One session. The open session's marks are dimmed: provisional until it closes (spec 4 §14). */
function Row(p: { row: DayRow; onOpen(): void }): JSX.Element {
  const r = p.row;
  return (
    <button
      type="button"
      class={`days-row${r.open ? ' is-open' : ''}${r.locked ? ' is-locked' : ''}`}
      onClick={() => p.onOpen()}
    >
      <span class="days-row__head">
        <span class="days-row__day">
          <span class="days-row__date">{r.day}</span>
          {r.uncertain && <span class="days-row__uncertain" title="date estimated by the migration">?</span>}
        </span>
        <span class="days-row__label">{r.label ?? '—'}</span>
        {r.open && <span class="days-row__open">open</span>}
        {r.span !== undefined && <span class="days-row__span">{r.span}</span>}
        {r.locked && <LockGlyph />}
      </span>
      {r.exercises.length > 0 && (
        <span class="days-row__exercises">
          {r.exercises.map((e) => (
            <span key={e.id} class="days-row__exercise">
              {e.name} <Marks amount={e.mark} provisional={r.open} />
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** A padlock in the muted colour (currentColor of .days-row__lock): the row opens read-only. */
function LockGlyph(): JSX.Element {
  return (
    <span class="days-row__lock" role="img" aria-label="read-only">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" />
      </svg>
    </span>
  );
}
```

Create `src/ui/components/days/PastSessionSheet.tsx`:

```tsx
import { signal, useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createPastSession, EditError } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { sessionPath } from '../../../sync/paths';
import { useApp } from '../../context';
import type { WriteOutcome } from '../../data';
import { localDate } from '../../format';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { reportOutcome } from '../log/outcome';

/**
 * The id of the session this device created last. `data.create` returns before the store's change
 * refreshes the signals, so the session page treats "no row yet" for this id as loading, not missing.
 */
export const justCreated = signal<string | undefined>(undefined);

/** Spec 4 §5 "New past session": a date (default today, local) → createPastSession (no startedAt), write, open its page. */
export function PastSessionSheet(p: { onClose(): void }): JSX.Element {
  const { data, router } = useApp();
  const date = useSignal(localDate(data.clock()));
  const busy = useSignal(false);

  async function create(): Promise<void> {
    if (busy.value) return;
    let file: SessionFile;
    try {
      file = createPastSession(date.value, data.clock());
    } catch (e) {
      if (e instanceof EditError) {
        showToast('Pick a valid date.');
        return;
      }
      throw e;
    }
    const path = sessionPath(file.session.date, file.session.id);
    busy.value = true;
    let outcome: WriteOutcome;
    try {
      outcome = await data.create('session', path, file);
    } catch (e) {
      // An IndexedDB failure: nothing was saved; the sheet stays open for another try.
      showToast(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      busy.value = false;
    }
    // The shared toasts of spec 4 §9: a refusal named in plain words, the held-back note once per path.
    if (!reportOutcome(path, outcome)) return;
    justCreated.value = file.session.id;
    p.onClose();
    router.navigate({ tab: 'days', sessionId: file.session.id });
  }

  return (
    <Sheet title="Add past session" onClose={p.onClose}>
      <label class="past-session__field">
        <span class="past-session__label">Date</span>
        <input
          class="past-session__date"
          type="date"
          value={date.value}
          onInput={(e) => { date.value = e.currentTarget.value; }}
        />
      </label>
      <Button kind="primary" disabled={busy.value} onClick={() => { void create(); }}>Create</Button>
    </Sheet>
  );
}
```

Create `src/ui/components/days/days.vm.ts`:

```ts
import {
  blocksOf,
  compareSessions,
  exerciseIndicator,
  exerciseSessionTotal,
  liveSets,
  matchesChip,
  sessionExerciseIds,
  sessionSpan,
  sortSessions,
  type AmountIndicator,
  type Chip,
} from '../../../model/derive';
import type { Block, Exercise, Session } from '../../../model/types';
import { formatDay, formatLabel, formatMinutes, formatMonth } from '../../format';

/** Spec 4 §5 "Days list": chips, rows newest first, month groups. Pure. */

export type DaysChip = Chip | 'all';

export interface DayRow {
  sessionId: string;
  /** 'Thu 07 Mar' */
  day: string;
  uncertain: boolean;
  /** The session label as display text ('Push'); display only, never a filter. */
  label: string | undefined;
  exercises: { id: string; name: string; mark: AmountIndicator }[];
  /** formatMinutes of sessionSpan; undefined for migrated and past sessions. */
  span: string | undefined;
  open: boolean;
  locked: boolean;
}

export interface MonthGroup {
  /** 'YYYY-MM' */
  key: string;
  /** formatMonth */
  title: string;
  rows: DayRow[];
}

export interface DaysVm {
  chips: { id: DaysChip; label: string; active: boolean }[];
  months: MonthGroup[];
  empty: boolean;
}

export const DAYS_CHIPS: ReadonlyArray<{ id: DaysChip; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'legs', label: 'Legs' },
  { id: 'other', label: 'Other' },
];

export function isDaysChip(value: unknown): value is DaysChip {
  return DAYS_CHIPS.some((c) => c.id === value);
}

export function daysVm(input: {
  sessions: readonly Session[];
  lockedSessions: readonly Session[];
  catalog: readonly Exercise[];
  chip: DaysChip;
  openSessionId: string | undefined;
  /** `exerciseMarks(sessions)`, when the caller keeps it across chip changes; computed here otherwise. */
  marks?: ExerciseMarks | undefined;
}): DaysVm {
  const live = sortSessions(input.sessions);
  const marks = input.marks ?? exerciseMarks(live);
  const locked = new Set<Session>(input.lockedSessions);
  const names = new Map(input.catalog.map((e) => [e.id, e.name]));
  const shown = sortSessions([...live, ...input.lockedSessions])
    .reverse()
    .filter((s) => matchesChip(s, input.catalog, input.chip));

  const months: MonthGroup[] = [];
  for (const s of shown) {
    const isLocked = locked.has(s);
    const span = sessionSpan(s);
    const row: DayRow = {
      sessionId: s.id,
      day: formatDay(s.date),
      uncertain: s.dateUncertain === true,
      label: s.label === undefined ? undefined : formatLabel(s.label),
      exercises: sessionExerciseIds(s).map((id) => ({
        id,
        name: names.get(id) ?? id,
        // Locked sessions are not among the live ones, so they are compared one by one (few rows).
        mark: (isLocked ? undefined : marks.get(s.id)?.get(id)) ?? exerciseIndicator(live, s, id),
      })),
      span: span === undefined ? undefined : formatMinutes(span.seconds),
      open: !isLocked && s.id === input.openSessionId,
      locked: isLocked,
    };
    const key = s.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last !== undefined && last.key === key) last.rows.push(row);
    else months.push({ key, title: formatMonth(s.date), rows: [row] });
  }

  return {
    chips: DAYS_CHIPS.map((c) => ({ ...c, active: c.id === input.chip })),
    months,
    empty: months.length === 0,
  };
}

/** Per live session id, per exercise id: the per-exercise indicator (spec 1 §7). */
export type ExerciseMarks = ReadonlyMap<string, ReadonlyMap<string, AmountIndicator>>;

/** A live block of X that is evidence of training X (as in compare.ts): live sets or a note. */
function hasEvidence(b: Block): boolean {
  return liveSets(b).length > 0 || b.note !== undefined;
}

/**
 * `exerciseIndicator(sessions, s, id)` for every live session and each of its exercises, in one pass
 * over the session order instead of a sort per call (600 sessions took ~80 ms the other way).
 * A test holds it equal to `exerciseIndicator`.
 */
export function exerciseMarks(sessions: readonly Session[]): Map<string, Map<string, AmountIndicator>> {
  const out = new Map<string, Map<string, AmountIndicator>>();
  /** Per exercise: the earlier sessions with evidence of it, in session order. */
  const evidence = new Map<string, Session[]>();
  for (const s of sortSessions(sessions)) {
    const ids = sessionExerciseIds(s);
    const marks = new Map<string, AmountIndicator>();
    for (const id of ids) {
      const earlier = evidence.get(id) ?? [];
      let previous: Session | undefined;
      for (let i = earlier.length - 1; i >= 0; i--) {
        const e = earlier[i];
        if (e !== undefined && e.id !== s.id && compareSessions(e, s) < 0) {
          previous = e;
          break;
        }
      }
      marks.set(id, previous === undefined ? 'none' : trendOf(s, previous, id));
    }
    out.set(s.id, marks);
    for (const id of ids) {
      if (!blocksOf(s, id).some(hasEvidence)) continue;
      const list = evidence.get(id);
      if (list === undefined) evidence.set(id, [s]);
      else list.push(s);
    }
  }
  return out;
}

function trendOf(current: Session, previous: Session, exerciseId: string): AmountIndicator {
  const c = exerciseSessionTotal(current, exerciseId);
  const p = exerciseSessionTotal(previous, exerciseId);
  if (c.unknown || p.unknown) return 'none';
  return c.amount > p.amount ? 'up' : c.amount < p.amount ? 'down' : 'same';
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .days, .days-row, .past-session (components/days: list and Add past session) ---- */
.days { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
.days__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.days__chip {
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
  border: 1px solid var(--outline);
  border-radius: 22px;
  background: var(--panel);
  color: var(--muted);
  font-weight: 600;
}
.days__chip.is-active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.days__add { display: flex; }
.days__empty { margin: 8px 0; color: var(--muted); }
.days__group { display: flex; flex-direction: column; }
/* Sticky under the top of the scrolling area; the background hides the rows passing below. */
.days__month {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 8px 0 6px;
  background: var(--bg);
  color: var(--muted);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.days__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.days-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--panel);
  text-align: left;
}
.days-row.is-open { border-color: var(--ok); }
.days-row.is-locked { background: var(--panel-2); }
.days-row__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.days-row__day { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.days-row__uncertain { color: var(--accent); }
.days-row__label { color: var(--muted); }
.days-row__open { color: var(--ok); font-weight: 600; }
.days-row__span { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.days-row__lock { display: inline-flex; align-self: center; color: var(--muted); }
.days-row__exercises { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 14px; }
.days-row__exercise { white-space: nowrap; }
.past-session__field { display: flex; flex-direction: column; gap: 6px; }
.past-session__label { color: var(--muted); font-size: 14px; }
.past-session__date {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel-2);
}
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 72 test files and 992 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/components/days/DaysTab.test.tsx src/ui/components/days/DaysTab.tsx src/ui/components/days/PastSessionSheet.tsx src/ui/components/days/days.vm.test.ts src/ui/components/days/days.vm.ts src/ui/theme.css
git commit -m "Add the Days list and Add past session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Session page

The page for every session, open or closed (§5 "Session page"): header sheet (date with the "date is exact" switch, label, notes, tags), blocks with sets, loads, intervals, totals and indicators, untimed Add set, Add block, move, delete with Undo, delete session, the migrated shapes, and the read-only banner for refused files.

**Files:**
- Modify: `src/ui/app.test.tsx`
- Create: `src/ui/components/days/SessionHeaderSheet.tsx`
- Create: `src/ui/components/days/SessionPage.test.tsx`
- Modify: `src/ui/components/days/SessionPage.tsx`
- Create: `src/ui/components/days/session-page.vm.test.ts`
- Create: `src/ui/components/days/session-page.vm.ts`
- Modify: `src/ui/theme.css`

**Interfaces:**
- Consumes: `src/model/derive`, `src/model/edit`, `src/model/schema`, `src/model/types`, `src/sync/store`, `src/ui/components/days/PastSessionSheet`, `src/ui/components/log/BlockSheet`, `src/ui/components/log/ExerciseSearch`, `src/ui/components/log/SetSheet`, `src/ui/components/log/outcome`, `src/ui/components/shared`, `src/ui/context`, `src/ui/data`, `src/ui/format`, `src/ui/locked`, `src/ui/toast`.
- Produces:
  - `src/ui/components/days/SessionHeaderSheet.tsx`:
    - `export function SessionHeaderSheet(p: { row: SessionRow; onClose(): void }): JSX.Element`
  - `src/ui/components/days/SessionPage.tsx`:
    - `export function SessionPage(p: { sessionId: string }): JSX.Element`
  - `src/ui/components/days/session-page.vm.ts`:
    - `export interface SetRow`
    - `export interface BlockRow`
    - `export interface SessionPageVm`
    - `export interface SessionPageInput`
    - `export function sessionPageVm(input: SessionPageInput): SessionPageVm`
    - `export function readOnlyReason(row: FileRow): string`
    - `export function notesChanged(stored: string | undefined, draft: string): boolean`

- [ ] **Step 1: Write the failing tests**

Replace the whole content of `src/ui/app.test.tsx` with:

```tsx
// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { act, render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../sync/db';
import { block, ladder, session, sessionFile } from '../model/test-fixtures';
import { sessionPath } from '../sync/paths';
import type { Issue } from '../sync/store';
import { Store } from '../sync/store';
import { App } from './app';
import { AppContext, type AppDeps, type SyncActions } from './context';
import { Data } from './data';
import { Router, type RouterWindow } from './router';

function fakeWindow(hash: string): RouterWindow {
  const win: RouterWindow = {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
    history: {
      pushState(_d, _u, url) { win.location.hash = url; },
      replaceState(_d, _u, url) { win.location.hash = url; },
    },
  };
  return win;
}

async function mount(over: { hash?: string; connected?: boolean; issues?: Issue[]; before?: (store: Store) => Promise<void> } = {}) {
  const store = new Store(await openDb(new IDBFactory()));
  await over.before?.(store);
  const data = new Data({ store });
  await data.load();
  if (over.issues !== undefined) data.issues.value = over.issues;
  const sync: SyncActions = {
    connect: vi.fn(), startPaste: vi.fn(), submitCode: vi.fn(), syncNow: vi.fn(), chooseEmptyFolder: vi.fn(),
    updateApp: vi.fn(() => Promise.resolve<'reloading' | 'busy'>('reloading')), signOut: vi.fn(),
  };
  const router = new Router(fakeWindow(over.hash ?? '#/log'));
  const deps: AppDeps = {
    data, router, sync,
    ui: {
      connected: signal(over.connected ?? true), loginError: signal<string | undefined>(undefined), homeScreenHint: false,
      pasteMode: signal(false), pasteUrl: signal<string | undefined>(undefined), persisted: signal<boolean | undefined>(true),
      updateAvailable: signal(false), buildId: 'b1',
    },
  };
  render(<AppContext.Provider value={deps}><App /></AppContext.Provider>);
  return deps;
}

const heading = () => document.querySelector('main h2')?.textContent;

describe('App', () => {
  it('renders the screen of the current route and switches with the router', async () => {
    const { router } = await mount();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeTruthy(); // the Log tab without an open session
    act(() => { router.navigate({ tab: 'days' }); });
    expect(document.querySelector('main .days')).toBeTruthy();
    act(() => { router.navigate({ tab: 'days', sessionId: 'abc' }); });
    expect(document.querySelector('main h1')?.textContent).toBe('Session'); // the session page's BackBar
    expect(screen.getByText('This session is not here.')).toBeTruthy();
    act(() => { router.navigate({ tab: 'more' }); });
    expect(heading()).toBe('More');
    act(() => { router.navigate({ tab: 'sync' }); });
    expect(document.querySelector('.sync')).toBeTruthy();
  });

  it('tab buttons navigate and mark the active tab', async () => {
    const { router } = await mount();
    const tabs = screen.getAllByRole('button', { name: /^(Log|Days|More|Sync)$/ });
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(true);
    act(() => { screen.getByRole('button', { name: 'Days' }).click(); });
    expect(router.route.value).toEqual({ tab: 'days' });
    expect(screen.getByRole('button', { name: 'Days' }).classList.contains('is-active')).toBe(true);
    expect(screen.getByRole('button', { name: 'Log' }).classList.contains('is-active')).toBe(false);
  });

  it('shows 3 on the Sync tab for three issues', async () => {
    await mount({
      issues: [
        { path: 'a.json', reason: 'quarantined', detail: 'x' },
        { path: 'b.json', reason: 'duplicate', detail: 'y' },
        { path: 'c.txt', reason: 'unexpected-file', detail: 'z' },
      ],
    });
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('3');
    expect(document.querySelector('.tabbar__dot')).toBeNull();
  });

  it('counts a held-back write once, though the store lists it as an issue too', async () => {
    const s = session([block(ladder([5]))], { date: '2030-03-04' });
    // 30 February fails a hard rule: the write stays local and queued, held back (spec 3 §5).
    const bad = sessionFile({ ...s, date: '2030-02-30' });
    const { data } = await mount({
      before: async (store) => {
        expect(await store.writeFile('session', sessionPath(s.date, s.id), bad, new Date('2030-03-04T11:00:00.000Z'))).toMatchObject({ ok: true, heldBack: expect.any(Array) });
      },
    });
    expect(data.issues.value.map((i) => i.reason)).toEqual(['held-back']);
    expect(data.heldBackCount.value).toBe(1);
    expect(document.querySelector('.tabbar__badge')?.textContent).toBe('1');
  });

  it('shows a dot when disconnected without issues, nothing when connected and clean', async () => {
    const { ui } = await mount({ connected: false });
    expect(document.querySelector('.tabbar__dot')).toBeTruthy();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
    act(() => { ui.connected.value = true; });
    expect(document.querySelector('.tabbar__dot')).toBeNull();
    expect(document.querySelector('.tabbar__badge')).toBeNull();
  });
});
```

Create `src/ui/components/days/SessionPage.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSessionFields } from '../../../model/edit';
import { block, exercise, ladder, session, set, sessionFile, T0 } from '../../../model/test-fixtures';
import type { Session } from '../../../model/types';
import { formatAmount, formatDayLong } from '../../format';
import { dismissToast, toast } from '../../toast';
import { fileAt, pathOf, renderIn, setup } from '../../test-harness';
import { justCreated } from './PastSessionSheet';
import { SessionPage } from './SessionPage';

const NOW = new Date('2030-03-09T12:00:00.000Z');
const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push' });
const ROWS = exercise({ id: 'australian-pull-ups', name: 'Australians', pattern: 'pull' });

afterEach(() => {
  dismissToast();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  justCreated.value = undefined;
});

const threeBlocks = (over: Partial<Session> = {}): Session =>
  session(
    [
      block(ladder([8, 7], { completedAt: '2030-03-07T10:05:00.000Z' }), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([12]), { exerciseId: 'dips-bar', order: 1 }),
      block(ladder([15]), { exerciseId: 'australian-pull-ups', order: 2 }),
    ],
    { date: '2030-03-07', tags: ['deload'], ...over },
  );

async function mount(s: Session, others: Session[] = [], opts: { staleNow?: Date } = {}) {
  const m = await setup({ now: NOW, sessions: [...others, s], exercises: [PULL, DIPS, ROWS] });
  // A `now` signal away from the clock from the first render on: a handler or a render that read it shows it.
  if (opts.staleNow !== undefined) m.data.now.value = opts.staleNow;
  renderIn(m.deps, <SessionPage sessionId={s.id} />);
  return m;
}

const article = (name: string): HTMLElement => screen.getByRole('article', { name });

/** happy-dom has no window.confirm; the page calls it before Delete session. Undone in afterEach. */
function answerConfirm(answer: boolean) {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

/** A 'now' far from the clock: a write that took its time from the ticking signal would show it. */
const STALE_NOW = new Date('2030-03-01T00:00:00.000Z');

describe('SessionPage', () => {
  it('renders the header and the blocks in canonical order', async () => {
    const s = threeBlocks({ notes: 'felt strong', label: 'pull' });
    await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('heading', { name: formatDayLong('2030-03-07') })).toBeTruthy();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Pull-ups', 'Dips (Bar)', 'Australians']);
    expect(within(article('Pull-ups')).getByText(`${formatAmount(15)} · 2 sets`)).toBeTruthy();
    expect(within(article('Pull-ups')).getByRole('button', { name: '8' })).toBeTruthy();
    expect(screen.getByText('felt strong')).toBeTruthy();
    // Display text through formatLabel, as on the Days list.
    expect(screen.getByText('Pull')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag deload' })).toBeTruthy();
  });

  it('the exercise name opens its history', async () => {
    const s = threeBlocks();
    const { deps } = await mount(s);
    await waitFor(() => expect(article('Dips (Bar)')).toBeTruthy());
    fireEvent.click(within(article('Dips (Bar)')).getByRole('button', { name: 'Dips (Bar)' }));
    expect(deps.router.route.value).toEqual({ tab: 'more', page: 'exercise', id: 'dips-bar' });
  });

  it('Add set writes a set without completedAt', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Add set' }));
    const sheet = screen.getByRole('dialog', { name: 'New set' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets).toHaveLength(3));
    const added = (await fileAt(store, pathOf(s))).session.blocks[0]?.sets[2];
    expect(added).toMatchObject({ reps: 7, loadType: 'bodyweight', updatedAt: NOW.toISOString() });
    expect(added?.completedAt).toBeUndefined();
    await waitFor(() => expect(within(article('Pull-ups')).getByText(`${formatAmount(22)} · 3 sets`)).toBeTruthy());
  });

  it('Move down gives the block a midpoint order and touches only that block', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Block options' }));
    const sheet = screen.getByRole('dialog', { name: 'Pull-ups' });
    expect((within(sheet).getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).queryByRole('button', { name: 'Make current' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Move down' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.order).toBe(1.5));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.blocks[0]?.updatedAt).toBe(NOW.toISOString());
    expect(after.blocks.slice(1).map((b) => [b.order, b.updatedAt])).toEqual([[1, T0], [2, T0]]);
    expect(after.updatedAt).toBe(T0);
    await waitFor(() => expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Dips (Bar)', 'Pull-ups', 'Australians']));
  });

  it('Delete session tombstones the session only, goes to Days, and Undo restores it', async () => {
    const s = threeBlocks();
    const { store, deps } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    answerConfirm(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBe(NOW.toISOString()));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.blocks.every((b) => b.deletedAt === undefined && b.sets.every((x) => x.deletedAt === undefined))).toBe(true);
    expect(deps.router.route.value).toEqual({ tab: 'days' });
    expect(toast.value?.action?.label).toBe('Undo');
    expect(toast.value?.ms).toBe(6000);
    toast.value?.action?.run();
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
  });

  it('a cancelled confirm deletes nothing', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const asked = answerConfirm(false);
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
  });

  it('a tombstoned session shows Deleted with Undo', async () => {
    const s = threeBlocks({ deletedAt: '2030-03-08T10:00:00.000Z' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Add block' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy());
  });

  it('a refused row renders read-only with a banner and no edit controls', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.data.refresh(pathOf(s));
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/newer app/);
    expect(screen.getByRole('link', { name: 'Sync tab' }).getAttribute('href')).toBe('#/sync');
    for (const name of ['Edit', 'Add set', 'Add block', 'Block options', 'Delete session', 'Remove tag deload', 'Add tag', 'Edit notes']) {
      expect(screen.queryAllByRole('button', { name })).toHaveLength(0);
    }
    expect(within(article('Pull-ups')).queryByRole('button', { name: '8' })).toBeNull();
    expect(within(article('Pull-ups')).getByText('8')).toBeTruthy();
  });

  it('resolves an id like the Days list: the ok row first, then the first refused row; a duplicate loser is never reached', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [s], exercises: [PULL, DIPS, ROWS] });
    // A refused row of the same id as an ok row: the ok row opens, editable, no banner.
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_other.json', kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_other.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy();
  });

  it('two refused rows of one id: the first one opens, with its own reason', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_a.json', kind: 'session', rev: 'r1', content: { ...sessionFile(s), schemaVersion: 99 }, status: 'needs-update', issues: [], version: 1 });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_b.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_a.json');
    await m.data.refresh('/sessions/2030/2030-03-07_b.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/newer app/);
  });

  it('the loser of a duplicate pair alone does not open (spec 3 §6 hides it; the Sync tab lists it)', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: '/sessions/2030/2030-03-07_b.json', kind: 'session', rev: 'r1', content: sessionFile(s), status: 'ok', duplicateOf: '/sessions/2030/2030-03-07_a.json', issues: [], version: 1 });
    await m.data.refresh('/sessions/2030/2030-03-07_b.json');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    expect(screen.getByText('This session is not here.')).toBeTruthy();
  });

  it('renders and edits an open session like a closed one: no redirect, Add set writes no completedAt', async () => {
    const s = session([block(ladder([8], { completedAt: '2030-03-09T11:40:00.000Z' }), { exerciseId: 'pull-ups' })], {
      date: '2030-03-09',
      startedAt: '2030-03-09T11:30:00.000Z',
    });
    const m = await setup({ now: NOW, sessions: [s], exercises: [PULL, DIPS, ROWS] });
    expect(m.data.openSession.value?.file.session.id).toBe(s.id);
    m.deps.router.navigate({ tab: 'days', sessionId: s.id });
    const navigate = vi.spyOn(m.deps.router, 'navigate');
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: 'Add set' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New set' })).getByRole('button', { name: 'Add set' }));
    await waitFor(async () => expect((await fileAt(m.store, pathOf(s))).session.blocks[0]?.sets).toHaveLength(2));
    expect((await fileAt(m.store, pathOf(s))).session.blocks[0]?.sets[1]?.completedAt).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.input(within(screen.getByRole('dialog', { name: 'Add tag' })).getByRole('textbox', { name: 'New tag' }), { target: { value: 'gym' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add tag' })).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await fileAt(m.store, pathOf(s))).session.tags).toEqual(['gym']));
    expect(navigate).not.toHaveBeenCalled();
    expect(m.deps.router.route.value).toEqual({ tab: 'days', sessionId: s.id });
  });

  it('a session just created on this device shows as loading, not missing, until its row arrives', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    justCreated.value = s.id;
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    expect(screen.queryByText('This session is not here.')).toBeNull();
    expect(document.querySelector('section.session[aria-busy="true"]')).toBeTruthy();
    await m.store.writeFile('session', pathOf(s), sessionFile(s), NOW);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('removing a tag ignores a second tap while the first write runs', async () => {
    const s = threeBlocks();
    const { data, store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    const chip = screen.getByRole('button', { name: 'Remove tag deload' });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('the Undo of a deleted session ignores a second tap while the first write runs', async () => {
    const s = threeBlocks({ deletedAt: '2030-03-08T10:00:00.000Z' });
    const { data, store } = await mount(s);
    await waitFor(() => expect(screen.getByText('Deleted')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.deletedAt).toBeUndefined());
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('adding a tag the session already has writes nothing and closes the sheet', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: ' deload ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add tag' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('the set interval and the stated rest carry spoken labels', async () => {
    const s = session(
      [
        block(
          [
            set({ order: 0, reps: 8, completedAt: '2030-03-07T10:00:00.000Z' }),
            set({ order: 1, reps: 8, completedAt: '2030-03-07T10:01:02.000Z' }),
            // restSec only on a set without completedAt (migrated shape, spec 2).
            set({ order: 2, reps: 8, restSec: 120 }),
          ],
          { exerciseId: 'pull-ups' },
        ),
      ],
      { date: '2030-03-07' },
    );
    await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(screen.getByLabelText('interval 1:02 since the previous set').textContent).toBe('+1:02');
    expect(screen.getByLabelText(`stated rest ${formatAmount(120)} s`).textContent).toBe(`rest ${formatAmount(120)} s`);
  });

  it('the read-only banner link to the Sync tab is a touch target', async () => {
    const s = threeBlocks();
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL, DIPS, ROWS] });
    await m.store.saveRow({ path: pathOf(s), kind: 'session', rev: 'r1', content: sessionFile(s), status: 'quarantined', issues: [], version: 1 });
    await m.data.refresh(pathOf(s));
    renderIn(m.deps, <SessionPage sessionId={s.id} />);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    // theme.css gives .session__banner-link a 44 px min-height (no layout in happy-dom).
    expect(screen.getByRole('link', { name: 'Sync tab' }).classList.contains('session__banner-link')).toBe(true);
  });

  it('notes Save ignores a second tap while the first write runs', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'new' } });
    const save = within(sheet).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('new'));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('notes Save without an edit writes nothing, even for a migrated note with surrounding whitespace', async () => {
    const s = threeBlocks({ notes: '  raw row  ', source: 'migrated' });
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Notes' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notes' })).toBeNull());
    expect(writes).not.toHaveBeenCalled();
  });

  it('Add tag ignores a second tap while the first write runs', async () => {
    const s = threeBlocks();
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    const edits = vi.spyOn(data, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: 'hotel gym' } });
    const add = within(sheet).getByRole('button', { name: 'Add' });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['deload', 'hotel gym']));
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('an unknown id says so', async () => {
    const m = await setup({ now: NOW, sessions: [], exercises: [PULL] });
    renderIn(m.deps, <SessionPage sessionId="nope" />);
    expect(screen.getByText('This session is not here.')).toBeTruthy();
  });

  it('a migrated aggregate set: totals text, and its sheet offers note and Delete only', async () => {
    const agg = set({ reps: 100, aggregate: true, order: 0 });
    const s = session(
      [block([agg], { exerciseId: 'pull-ups' }), block([], { exerciseId: 'dips-bar', order: 1, note: '3x max' })],
      { date: '2030-03-07', source: 'migrated', dateUncertain: true },
    );
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    expect(within(article('Pull-ups')).getByText(`${formatAmount(100)} total, set count unknown`)).toBeTruthy();
    expect(within(article('Dips (Bar)')).getByText('no sets recorded')).toBeTruthy();
    expect(screen.getByText('date estimated by the migration')).toBeTruthy();
    fireEvent.click(within(article('Pull-ups')).getByRole('button', { name: `${formatAmount(100)}*` }));
    const sheet = screen.getByRole('dialog', { name: 'Set' });
    expect(within(sheet).queryByRole('button', { name: 'Increase' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Edit value' })).toBeNull();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Note' }), { target: { value: 'ladders' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets[0]?.note).toBe('ladders'));
    expect((await fileAt(store, pathOf(s))).session.blocks[0]?.sets[0]).toMatchObject({ reps: 100, aggregate: true });
  });

  it('a tag tap removes it; Add tag offers tags seen elsewhere and free text', async () => {
    const other = session([], { date: '2030-03-01', tags: ['travel', 'deload'] });
    const s = threeBlocks();
    const { store } = await mount(s, [other]);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag deload' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove tag deload' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    let sheet = screen.getByRole('dialog', { name: 'Add tag' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'travel' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['travel']));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove tag travel' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    sheet = screen.getByRole('dialog', { name: 'Add tag' });
    expect(within(sheet).queryByRole('button', { name: 'travel' })).toBeNull();
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'New tag' }), { target: { value: 'hotel gym' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual(['travel', 'hotel gym']));
    expect((await fileAt(store, pathOf(s))).session.blocks.every((b) => b.updatedAt === T0)).toBe(true);
  });

  it('notes edit in a sheet', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'line one\nline two' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('line one\nline two'));
  });

  it('page writes take their time from data.clock(), not from the ticking now signal', async () => {
    const s = threeBlocks();
    const { store, data } = await mount(s, [], { staleNow: STALE_NOW });
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    // A later tick lands too (inside act, so any re-render happens before the taps).
    await act(() => { data.now.value = new Date(STALE_NOW.getTime() + 1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag deload' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.tags).toEqual([]));
    expect((await fileAt(store, pathOf(s))).session.updatedAt).toBe(NOW.toISOString());
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Exercise' })).getByRole('button', { name: 'Dips (Bar)' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks).toHaveLength(4));
    expect((await fileAt(store, pathOf(s))).session.blocks[3]?.updatedAt).toBe(NOW.toISOString());
  });

  it('Add block picks an exercise from the search', async () => {
    const s = threeBlocks();
    const { store } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    const sheet = screen.getByRole('dialog', { name: 'Exercise' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dips (Bar)' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.blocks).toHaveLength(4));
    expect((await fileAt(store, pathOf(s))).session.blocks[3]).toMatchObject({ exerciseId: 'dips-bar', order: 3, sets: [] });
  });
});

describe('SessionHeaderSheet', () => {
  it('Save with "date is exact" drops dateUncertain; a changed date says the file keeps its name', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '2030-03-06' } });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Date is exact' }));
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'legs' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.date).toBe('2030-03-06'));
    const after = (await fileAt(store, pathOf(s))).session;
    expect(after.dateUncertain).toBeUndefined();
    expect(after.label).toBe('legs');
    expect(after.updatedAt).toBe(NOW.toISOString());
    expect(toast.value?.text).toBe('The file keeps its old name');
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  it('saving with the switch off keeps dateUncertain; no switch on an exact date', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'n' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('n'));
    expect((await fileAt(store, pathOf(s))).session.dateUncertain).toBe(true);
    expect(toast.value).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog', { name: 'Session' })).getByRole('switch', { name: 'Date is exact' })).toBeTruthy();
  });

  it('a changed date with the switch off keeps dateUncertain', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', dateUncertain: true });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '2030-03-05' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.date).toBe('2030-03-05'));
    expect((await fileAt(store, pathOf(s))).session.dateUncertain).toBe(true);
  });

  it('the label select shows display text and stores the label value', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const select = within(screen.getByRole('dialog', { name: 'Session' })).getByRole('combobox', { name: 'Label' }) as HTMLSelectElement;
    const legs = [...select.options].find((o) => o.value === 'legs');
    expect(legs?.textContent).toBe('Legs');
    fireEvent.change(select, { target: { value: 'legs' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Session' })).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('legs'));
  });

  it('an unrelated save leaves a migrated note with surrounding whitespace as it was', async () => {
    const s = session([], { date: '2030-03-07', source: 'migrated', notes: '  raw row\n' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'pull' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('pull'));
    expect((await fileAt(store, pathOf(s))).session.notes).toBe('  raw row\n');
  });

  it('takes the write time from data.clock(), not from the ticking now signal', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store, data } = await mount(s, [], { staleNow: STALE_NOW });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    await act(() => { data.now.value = new Date(STALE_NOW.getTime() + 1000); });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Label' }), { target: { value: 'pull' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.label).toBe('pull'));
    expect((await fileAt(store, pathOf(s))).session.updatedAt).toBe(NOW.toISOString());
  });

  it('Save writes only what the owner changed against the opened values: a label and date changed elsewhere meanwhile survive', async () => {
    const s = session([], { date: '2030-03-07', label: 'push', notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // The PC's change lands (a pull) while the sheet is open.
    await act(async () => {
      await data.edit('session', pathOf(s), (f) => setSessionFields(f, { label: 'pull', date: '2030-03-06' }, new Date('2030-03-09T11:59:00.000Z')));
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: formatDayLong('2030-03-06') })).toBeTruthy());
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'new' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await fileAt(store, pathOf(s))).session.notes).toBe('new'));
    expect((await fileAt(store, pathOf(s))).session).toMatchObject({ label: 'pull', date: '2030-03-06' });
    expect(toast.value?.text).not.toBe('The file keeps its old name');
  });

  it('notes edited elsewhere while the notes sheet is open: an unchanged Save keeps them', async () => {
    const s = threeBlocks({ notes: 'old' });
    const { store, data } = await mount(s);
    await waitFor(() => expect(article('Pull-ups')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    const sheet = screen.getByRole('dialog', { name: 'Notes' });
    await act(async () => {
      await data.edit('session', pathOf(s), (f) => setSessionFields(f, { notes: 'from the PC' }, new Date('2030-03-09T11:59:00.000Z')));
    });
    // The refreshed row reached the page (its notes line behind the sheet).
    await waitFor(() => expect(screen.getByText('from the PC')).toBeTruthy());
    // The owner types and returns to the text the sheet opened with: nothing to write.
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'old!' } });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Notes' }), { target: { value: 'old' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notes' })).toBeNull());
    expect((await fileAt(store, pathOf(s))).session.notes).toBe('from the PC');
  });

  it('an exact date shows no switch; an empty date is refused with a toast', async () => {
    const s = session([], { date: '2030-03-07' });
    const { store } = await mount(s);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Session' });
    expect(within(sheet).queryByRole('switch')).toBeNull();
    const writes = vi.spyOn(store, 'writeFile');
    fireEvent.input(within(sheet).getByLabelText('Date'), { target: { value: '' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.value?.text).toBe('Enter a date'));
    expect(writes).not.toHaveBeenCalled();
  });
});
```

Create `src/ui/components/days/session-page.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set } from '../../../model/test-fixtures';
import type { Exercise, Session } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { formatAmount, formatDayLong, formatLoad, formatLoadShort } from '../../format';
import { notesChanged, readOnlyReason, sessionPageVm } from './session-page.vm';

const PULL = exercise({ id: 'pull-ups', name: 'Pull-ups', pattern: 'pull' });
const DIPS = exercise({ id: 'dips-bar', name: 'Dips (Bar)', pattern: 'push', archived: true });
const catalogOf = (...xs: Exercise[]): Map<string, Exercise> => new Map(xs.map((x) => [x.id, x]));
const CATALOG = catalogOf(PULL, DIPS);

const vmOf = (s: Session, all: Session[] = [s], readOnlyReasonText?: string) =>
  sessionPageVm({ session: s, allSessions: all, catalog: CATALOG, readOnlyReason: readOnlyReasonText });

describe('sessionPageVm: header', () => {
  it('title, label, tags, notes, flags', () => {
    const s = session([], { date: '2030-03-07', label: 'pull', tags: ['deload'], notes: 'raw row', dateUncertain: true, source: 'migrated' });
    const vm = vmOf(s);
    expect(vm).toMatchObject({
      title: formatDayLong('2030-03-07'),
      uncertain: true,
      label: 'Pull',
      tags: ['deload'],
      notes: 'raw row',
      migrated: true,
      readOnly: undefined,
      deleted: false,
      blocks: [],
    });
  });

  it('an app session without extras', () => {
    const vm = vmOf(session([], { date: '2030-03-07' }));
    expect(vm).toMatchObject({ uncertain: false, label: undefined, notes: undefined, migrated: false, deleted: false });
  });

  it('read-only reason and deleted', () => {
    const s = session([], { deletedAt: '2030-03-08T10:00:00.000Z' });
    const vm = vmOf(s, [], 'Quarantined');
    expect(vm.readOnly).toEqual({ reason: 'Quarantined' });
    expect(vm.deleted).toBe(true);
  });
});

describe('sessionPageVm: blocks and sets', () => {
  it('blocks in canonical order with names, archived and unknown marks, move flags', () => {
    const s = session([
      block(ladder([5]), { exerciseId: 'mystery', order: 2 }),
      block(ladder([8]), { exerciseId: 'dips-bar', order: 1 }),
      block(ladder([10]), { exerciseId: 'pull-ups', order: 0 }),
      block(ladder([3]), { exerciseId: 'pull-ups', order: 3, deletedAt: '2030-03-07T11:00:00.000Z' }),
    ]);
    const blocks = vmOf(s).blocks;
    expect(blocks.map((b) => [b.name, b.archived, b.unknownExercise, b.canMoveUp, b.canMoveDown])).toEqual([
      ['Pull-ups', false, false, false, true],
      ['Dips (Bar)', true, false, true, true],
      ['mystery', false, true, true, false],
    ]);
  });

  it('set rows: amount, load only where it differs from the first set, note, rest, completedAt', () => {
    const s = session([
      block(
        [
          set({ order: 0, reps: 8, loadType: 'added', loadKg: 10 }),
          set({ order: 1, reps: 7.5, loadType: 'added', loadKg: 10, note: 'slow', restSec: 120 }),
          set({ order: 2, reps: 6, loadType: 'added', loadKg: 5, completedAt: '2030-03-07T10:10:00.000Z' }),
          set({ order: 3, reps: 99, deletedAt: '2030-03-07T11:00:00.000Z' }),
        ],
        { exerciseId: 'pull-ups' },
      ),
    ]);
    const rows = vmOf(s).blocks[0]?.sets ?? [];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.amount)).toEqual([formatAmount(8), formatAmount(7.5), formatAmount(6)]);
    expect(rows.map((r) => r.load)).toEqual([undefined, undefined, formatLoadShort('added', 5)]);
    expect(rows[1]).toMatchObject({
      note: 'slow',
      rest: `rest ${formatAmount(120)} s`,
      restLabel: `stated rest ${formatAmount(120)} s`,
      aggregate: false,
      completedAt: undefined,
    });
    expect(rows[0]).toMatchObject({ note: undefined, rest: undefined, restLabel: undefined });
    expect(rows[2]?.completedAt).toBe('2030-03-07T10:10:00.000Z');
    expect(vmOf(s).blocks[0]?.load).toBe(formatLoad('added', 10));
  });

  it('a plain bodyweight block shows no block load', () => {
    const s = session([block(ladder([8, 9]), { exerciseId: 'pull-ups' })]);
    expect(vmOf(s).blocks[0]?.load).toBeUndefined();
  });

  it('interval labels from setIntervals', () => {
    const s = session([
      block(
        [
          set({ order: 0, reps: 8, completedAt: '2030-03-07T10:00:00.000Z' }),
          set({ order: 1, reps: 8, completedAt: '2030-03-07T10:01:02.000Z' }),
          set({ order: 2, reps: 8 }),
        ],
        { exerciseId: 'pull-ups' },
      ),
    ]);
    expect(vmOf(s).blocks[0]?.sets.map((r) => r.interval)).toEqual([undefined, '+1:02', undefined]);
    // Read aloud as an interval, never as rest (spec 4 §5).
    expect(vmOf(s).blocks[0]?.sets.map((r) => r.intervalLabel)).toEqual([undefined, 'interval 1:02 since the previous set', undefined]);
  });

  it('totals text', () => {
    const s = session([block(ladder([8, 7, 6]), { exerciseId: 'pull-ups' }), block(ladder([10]), { exerciseId: 'dips-bar', order: 1 })]);
    expect(vmOf(s).blocks.map((b) => b.totals)).toEqual([`${formatAmount(21)} · 3 sets`, `${formatAmount(10)} · 1 set`]);
  });

  it('a migrated aggregate set: aggregate flag and "<n> total, set count unknown"', () => {
    const s = session([block([set({ reps: 100, aggregate: true })], { exerciseId: 'pull-ups' })], { source: 'migrated' });
    const b = vmOf(s).blocks[0];
    expect(b?.sets[0]?.aggregate).toBe(true);
    expect(b?.totals).toBe(`${formatAmount(100)} total, set count unknown`);
    expect(b?.noteOnly).toBe(false);
  });

  it('a note-only block', () => {
    const s = session([block([], { exerciseId: 'pull-ups', note: '3x max' }), block([], { exerciseId: 'dips-bar', order: 1 })], { source: 'migrated' });
    const [noteOnly, empty] = vmOf(s).blocks;
    expect(noteOnly).toMatchObject({ noteOnly: true, note: '3x max', sets: [] });
    expect(empty).toMatchObject({ noteOnly: false, note: undefined });
  });

  it('block marks and the exercise mark against earlier sessions', () => {
    const before = session([block(ladder([8, 8]), { exerciseId: 'pull-ups' })], { date: '2030-03-04' });
    const today = session([block(ladder([9, 8]), { exerciseId: 'pull-ups' })], { date: '2030-03-07' });
    const b = vmOf(today, [before, today]).blocks[0];
    expect(b?.marks).toEqual({ amount: 'up', load: 'hidden' });
    expect(b?.exerciseMark).toBe('up');
    const first = vmOf(before, [before, today]).blocks[0];
    expect(first?.marks).toEqual({ amount: 'none', load: 'none' });
    expect(first?.exerciseMark).toBe('none');
  });
});

describe('refused rows', () => {
  const row = (over: Partial<FileRow>): FileRow => ({
    path: 'sessions/2030/2030-03-07-x.json', kind: 'session', rev: 'r1', content: {}, status: 'ok', issues: [], version: 1, ...over,
  });

  it('readOnlyReason names the reason', () => {
    expect(readOnlyReason(row({ status: 'read-only' }))).toMatch(/newer app/);
    expect(readOnlyReason(row({ status: 'needs-update' }))).toMatch(/newer app/);
    expect(readOnlyReason(row({ status: 'quarantined' }))).toMatch(/Quarantined/);
    expect(readOnlyReason(row({ duplicateOf: 'sessions/2030/other.json' }))).toMatch(/Duplicate/);
  });
});

describe('notesChanged', () => {
  it('compares after the normalisation setSessionFields applies (trim, blank is none)', () => {
    expect(notesChanged('  raw row\n', '  raw row\n')).toBe(false);
    expect(notesChanged('  raw row\n', 'raw row')).toBe(false);
    expect(notesChanged(undefined, '   ')).toBe(false);
    expect(notesChanged(undefined, '')).toBe(false);
    expect(notesChanged('old', 'new')).toBe(true);
    expect(notesChanged('old', '  ')).toBe(true);
    expect(notesChanged(undefined, 'n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/app.test.tsx src/ui/components/days/SessionPage.test.tsx src/ui/components/days/session-page.vm.test.ts`

Expected: FAIL. The first error reads:

```
src/ui/components/days/session-page.vm.test.ts: Error: Cannot find module './session-page.vm' imported from src/ui/components/days/session-page.vm.test.ts
```


- [ ] **Step 3: Write the implementation**

Create `src/ui/components/days/SessionHeaderSheet.tsx`:

```tsx
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { setSessionFields, type SessionFields } from '../../../model/edit';
import { SESSION_LABELS } from '../../../model/schema';
import type { SessionLabel } from '../../../model/types';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { formatLabel } from '../../format';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { editSessionQuiet, HELD_BACK_TEXT, showHeldBack } from '../log/outcome';
import { notesChanged } from './session-page.vm';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function labelOf(value: string): SessionLabel | undefined {
  return SESSION_LABELS.find((l) => l === value);
}

/**
 * Spec 4 §5 header: date, the "date is exact" switch (only on a `dateUncertain` session), label and
 * notes. Save writes only the fields the owner changed, compared with the values the sheet opened
 * with (never with the refreshed row, so a field another device changed meanwhile is not written
 * back), through `setSessionFields`, which touches the session record only. The file
 * keeps its name when the date changes (spec 1 D12); a toast says so.
 */
export function SessionHeaderSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const s = p.row.file.session;
  const path = p.row.path;
  // The session as the sheet opened: the baseline of every comparison.
  const opened = useRef({ date: s.date, label: s.label, notes: s.notes });
  // Initialised once: a re-render from a pull never loses what was typed (spec 4 §8).
  const date = useSignal(s.date);
  const exact = useSignal(false);
  const label = useSignal<string>(s.label ?? '');
  const notes = useSignal(s.notes ?? '');
  /** Notes go into the write only when the owner typed in them (a migrated note keeps its whitespace). */
  const notesEdited = useSignal(false);
  const busy = useSignal(false);

  const save = async (): Promise<void> => {
    if (busy.value) return;
    const d = date.value.trim();
    if (!DATE_RE.test(d)) {
      showToast('Enter a date');
      return;
    }
    const nextLabel = labelOf(label.value);
    const text = notes.value;
    const was = opened.current;
    const fields: SessionFields = {
      ...(d !== was.date ? { date: d } : {}),
      ...(s.dateUncertain === true && exact.value ? { dateExact: true as const } : {}),
      ...(nextLabel !== was.label ? { label: nextLabel ?? null } : {}),
      // setSessionFields trims and removes a blank text.
      ...(notesEdited.value && notesChanged(was.notes, text) ? { notes: text } : {}),
    };
    if (Object.keys(fields).length === 0) {
      p.onClose();
      return;
    }
    busy.value = true;
    try {
      const now = data.clock();
      const written = await editSessionQuiet(data, path, (f) => setSessionFields(f, fields, now));
      if (!written.ok) return;
      p.onClose();
      if (fields.date !== undefined) {
        showToast('The file keeps its old name');
        if (written.heldBackNote) showHeldBack();
      } else if (written.heldBackNote) {
        showToast(HELD_BACK_TEXT);
      }
    } finally {
      busy.value = false;
    }
  };

  return (
    <Sheet title="Session" onClose={p.onClose}>
      <label class="sessionsheet__field">
        <span>Date</span>
        <input type="date" aria-label="Date" value={date.value} onInput={(e) => (date.value = e.currentTarget.value)} />
      </label>
      {s.dateUncertain === true && (
        <label class="sessionsheet__switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Date is exact"
            checked={exact.value}
            onChange={(e) => (exact.value = e.currentTarget.checked)}
          />
          <span>Date is exact</span>
        </label>
      )}
      <label class="sessionsheet__field">
        <span>Label</span>
        <select aria-label="Label" value={label.value} onChange={(e) => (label.value = e.currentTarget.value)}>
          <option value="">none</option>
          {SESSION_LABELS.map((l) => <option key={l} value={l}>{formatLabel(l)}</option>)}
        </select>
      </label>
      <label class="sessionsheet__field">
        <span>Notes</span>
        <textarea
          aria-label="Notes"
          rows={4}
          value={notes.value}
          onInput={(e) => {
            notes.value = e.currentTarget.value;
            notesEdited.value = true;
          }}
        />
      </label>
      <Button kind="primary" disabled={busy.value} onClick={() => void save()}>Save</Button>
    </Sheet>
  );
}
```

Replace the whole content of `src/ui/components/days/SessionPage.tsx` with:

```tsx
import { useSignal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { liveBlocks, liveSets } from '../../../model/derive';
import { addBlock, deleteSession, setSessionFields, undeleteSession } from '../../../model/edit';
import type { Session, WorkoutSet } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { useApp } from '../../context';
import { sessionRowById, type SessionRow } from '../../data';
import { lockedSessionRows } from '../../locked';
import { showToast } from '../../toast';
import { BackBar, Button, Marks, SetChips, Sheet } from '../shared';
import { BlockSheet } from '../log/BlockSheet';
import { ExerciseSearch } from '../log/ExerciseSearch';
import { editSession, editSessionQuiet, showHeldBack } from '../log/outcome';
import { SetSheet } from '../log/SetSheet';
import { justCreated } from './PastSessionSheet';
import { SessionHeaderSheet } from './SessionHeaderSheet';
import { notesChanged, readOnlyReason, sessionPageVm, type BlockRow, type SetRow } from './session-page.vm';

type Open =
  | { kind: 'header' }
  | { kind: 'notes' }
  | { kind: 'tag' }
  | { kind: 'set'; setId: string }
  | { kind: 'add-set'; blockId: string }
  | { kind: 'block'; blockId: string; name: string; up: boolean; down: boolean }
  | { kind: 'search' };

/** The ok row (editable unless tombstoned), or a refused row's session, read-only with the banner's reason. */
type Resolved = { session: Session; row: SessionRow; reason: undefined } | { session: Session; row: undefined; reason: string };

/**
 * Spec 4 §5: the same lookup as the Days list, so the list and the page agree on which file an id
 * opens: the ok row first, then the refused rows `lockedSessionRows` lists (never a duplicate loser).
 */
function resolve(rows: readonly SessionRow[], refused: readonly FileRow[], id: string): Resolved | undefined {
  const row = sessionRowById(rows, id);
  if (row !== undefined) return { session: row.file.session, row, reason: undefined };
  const locked = lockedSessionRows(refused, new Set(rows.map((r) => r.file.session.id))).find((l) => l.session.id === id);
  return locked === undefined ? undefined : { session: locked.session, row: undefined, reason: readOnlyReason(locked.row) };
}

/**
 * Spec 4 §5 "Session page" (`#/days/<sessionId>`): header (date, label, tags, notes), the blocks in
 * canonical order with their sets, totals and indicators, and the edits (set and block sheets, Add
 * set without completedAt, Add block, Delete session with Undo). A refused row is shown read-only
 * with a banner and no edit control; a tombstoned session shows "Deleted" with Undo. An open session
 * renders and edits here too (spec 4 §5); its Days row still goes to the Log tab.
 */
export function SessionPage(p: { sessionId: string }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  /** One write at a time for the page's own buttons (tag chips, Undo): a second tap is ignored. */
  const busy = useSignal(false);
  const close = (): void => {
    open.value = undefined;
  };

  const found = resolve(data.sessions.value, data.refusedRows.value, p.sessionId);
  const pending = found === undefined && justCreated.value === p.sessionId;
  useEffect(() => {
    // The row arrived: the loading state has done its job.
    if (found !== undefined && justCreated.value === p.sessionId) justCreated.value = undefined;
  }, [found !== undefined, p.sessionId]);
  // Just created here (Add past session opens its page at once, spec 4 §5): the store's change has
  // not refreshed the signals yet, so show a loading state instead of "not found".
  if (pending) return <section class="session" aria-busy="true" />;
  if (found === undefined) {
    return (
      <section class="session">
        <BackBar title="Session" onBack={() => router.back()} />
        <p class="session__missing">This session is not here.</p>
      </section>
    );
  }

  const { session, row } = found;
  const vm = sessionPageVm({ session, allSessions: data.liveSessions.value, catalog: data.exerciseById.value, readOnlyReason: found.reason });
  // Edit controls only on an ok row of a live session (spec 4 §5 "Refused rows").
  const editable = row !== undefined && !vm.deleted ? row : undefined;
  const setsById = new Map<string, WorkoutSet>(liveBlocks(session).flatMap(liveSets).map((s) => [s.id, s]));

  /** Runs one page write unless one is running; the flag clears when it settles. */
  const guarded = async (write: () => Promise<unknown>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const removeTag = (r: SessionRow, tag: string): void => {
    const now = data.clock();
    void guarded(() => editSession(data, r.path, (f) => setSessionFields(f, { tags: f.session.tags.filter((t) => t !== tag) }, now)));
  };

  const deleteThis = async (r: SessionRow): Promise<void> => {
    if (!window.confirm('Delete this session? Undo is offered for a few seconds.')) return;
    const now = data.clock();
    const path = r.path;
    const written = await editSessionQuiet(data, path, (f) => deleteSession(f, now));
    if (!written.ok) return;
    router.navigate({ tab: 'days' });
    showToast('Session deleted', { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteSession(f, data.clock())) }, 6000);
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  };

  const addBlockTo = async (r: SessionRow, exerciseId: string): Promise<void> => {
    const now = data.clock();
    await editSession(data, r.path, (f) => addBlock(f, exerciseId, now).file);
  };

  const sheet = open.value;
  return (
    <section class="session">
      <BackBar
        title={vm.title}
        onBack={() => router.back()}
        right={editable !== undefined && <Button onClick={() => (open.value = { kind: 'header' })}>Edit</Button>}
      />

      {vm.readOnly !== undefined && (
        <div class="session__banner" role="alert">
          {vm.readOnly.reason}. Open the <a class="session__banner-link" href="#/sync">Sync tab</a> for details.
        </div>
      )}

      {vm.deleted && row !== undefined && (
        <div class="session__deleted">
          <span>Deleted</span>
          <Button disabled={busy.value} onClick={() => void guarded(() => editSession(data, row.path, (f) => undeleteSession(f, data.clock())))}>Undo</Button>
        </div>
      )}

      <div class="session-head">
        {vm.uncertain && (
          <p class="session-head__uncertain">
            <span aria-hidden="true">? </span>
            <span>date estimated by the migration</span>
          </p>
        )}
        <div class="session-head__line">
          {vm.label !== undefined && <span class="session-head__label">{vm.label}</span>}
          {vm.tags.map((t) =>
            editable !== undefined ? (
              <button key={t} type="button" class="session-head__tag" aria-label={`Remove tag ${t}`} disabled={busy.value} onClick={() => removeTag(editable, t)}>
                {t} ×
              </button>
            ) : (
              <span key={t} class="session-head__tag">{t}</span>
            ),
          )}
          {editable !== undefined && (
            <button type="button" class="session-head__tag session-head__tag--add" aria-label="Add tag" onClick={() => (open.value = { kind: 'tag' })}>
              + tag
            </button>
          )}
        </div>
        {editable !== undefined ? (
          <button type="button" class="session-head__notes" aria-label="Edit notes" onClick={() => (open.value = { kind: 'notes' })}>
            {vm.notes ?? <span class="session-head__placeholder">Notes</span>}
          </button>
        ) : (
          vm.notes !== undefined && <p class="session-head__notes">{vm.notes}</p>
        )}
      </div>

      {vm.blocks.map((b) => (
        <BlockView
          key={b.blockId}
          block={b}
          setsById={setsById}
          editable={editable !== undefined}
          onName={() => router.navigate({ tab: 'more', page: 'exercise', id: b.exerciseId })}
          onOptions={() => (open.value = { kind: 'block', blockId: b.blockId, name: b.name, up: b.canMoveUp, down: b.canMoveDown })}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onAddSet={() => (open.value = { kind: 'add-set', blockId: b.blockId })}
        />
      ))}

      {editable !== undefined && (
        <div class="session__foot">
          <Button onClick={() => (open.value = { kind: 'search' })}>Add block</Button>
          <Button kind="danger" onClick={() => void deleteThis(editable)}>Delete session</Button>
        </div>
      )}

      {editable !== undefined && sheet?.kind === 'header' && <SessionHeaderSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'notes' && <NotesSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'tag' && <TagSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'set' && <SetSheet row={editable} setId={sheet.setId} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'add-set' && <SetSheet row={editable} blockId={sheet.blockId} create timed={false} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'block' && (
        <BlockSheet row={editable} blockId={sheet.blockId} name={sheet.name} move={{ up: sheet.up, down: sheet.down }} onClose={close} />
      )}
      {editable !== undefined && sheet?.kind === 'search' && <ExerciseSearch onPick={(id) => addBlockTo(editable, id)} onClose={close} />}
    </section>
  );
}

function BlockView(p: {
  block: BlockRow;
  setsById: ReadonlyMap<string, WorkoutSet>;
  editable: boolean;
  onName(): void;
  onOptions(): void;
  onTapSet(setId: string): void;
  onAddSet(): void;
}): JSX.Element {
  const b = p.block;
  return (
    <article class="session-block" aria-label={b.name}>
      <div class="session-block__head">
        <h3 class="session-block__name">
          <button type="button" class="session-block__namebtn" onClick={p.onName}>{b.name}</button>
          {b.archived && <span class="session-block__flag">archived</span>}
          {b.unknownExercise && <span class="session-block__flag">not in the catalog</span>}
        </h3>
        {b.load !== undefined && <span class="session-block__load">{b.load}</span>}
        {p.editable && (
          <button type="button" class="session-block__options" aria-label="Block options" onClick={p.onOptions}>⋯</button>
        )}
      </div>
      {b.note !== undefined && <p class="session-block__note">{b.note}</p>}
      {b.noteOnly ? (
        <p class="session-block__empty">no sets recorded</p>
      ) : (
        <div class="session-block__sets">
          {b.sets.map((r) => (
            <SetCell key={r.setId} row={r} set={p.setsById.get(r.setId)} {...(p.editable ? { onTap: p.onTapSet } : {})} />
          ))}
        </div>
      )}
      <div class="session-block__totals">
        {!b.noteOnly && <span>{b.totals}</span>}
        <Marks amount={b.marks.amount} load={b.marks.load} />
        <span class="session-block__exmark">
          exercise <Marks amount={b.exerciseMark} />
        </span>
      </div>
      {p.editable && (
        <div class="session-block__actions">
          <Button onClick={p.onAddSet}>Add set</Button>
        </div>
      )}
    </article>
  );
}

/** One set: its chip (SetChips with one set) and the small line with load, interval and rest below
 *  it. The interval and the rest carry spoken labels, so '+1:02' is never read as rest. */
function SetCell(p: { row: SetRow; set: WorkoutSet | undefined; onTap?(setId: string): void }): JSX.Element | null {
  if (p.set === undefined) return null;
  const meta: { text: string; label: string | undefined }[] = [];
  if (p.row.load !== undefined) meta.push({ text: p.row.load, label: undefined });
  if (p.row.interval !== undefined) meta.push({ text: p.row.interval, label: p.row.intervalLabel });
  if (p.row.rest !== undefined) meta.push({ text: p.row.rest, label: p.row.restLabel });
  const onTap = p.onTap;
  return (
    <div class="session-set">
      <SetChips sets={[p.set]} variant="today" {...(onTap !== undefined ? { onTap: (s: WorkoutSet) => onTap(s.id) } : {})} />
      {meta.length > 0 && (
        <div class="session-set__meta">
          {meta.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              {m.label === undefined ? <span>{m.text}</span> : <span role="img" aria-label={m.label}>{m.text}</span>}
            </Fragment>
          ))}
        </div>
      )}
      {p.row.note !== undefined && <div class="session-set__note">{p.row.note}</div>}
    </div>
  );
}

/** Spec 4 §5: the session notes, multi-line; a blank text removes them (edit.ts trims). A save that
 *  does not change the words the sheet opened with writes nothing (`notesChanged`), so a migrated note
 *  keeps its whitespace and notes another device wrote meanwhile are not overwritten. */
function NotesSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  // The notes as the sheet opened; never re-read from a refreshed row.
  const opened = useRef(p.row.file.session.notes);
  const draft = useSignal(opened.current ?? '');
  const edited = useSignal(false);
  const busy = useSignal(false);
  const save = async (): Promise<void> => {
    if (busy.value) return;
    const text = draft.value;
    if (!edited.value || !notesChanged(opened.current, text)) {
      p.onClose();
      return;
    }
    busy.value = true;
    try {
      const now = data.clock();
      if (await editSession(data, p.row.path, (f) => setSessionFields(f, { notes: text }, now))) p.onClose();
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title="Notes" onClose={p.onClose}>
      <textarea
        class="sessionsheet__notes"
        aria-label="Notes"
        rows={6}
        value={draft.value}
        onInput={(e) => {
          draft.value = e.currentTarget.value;
          edited.value = true;
        }}
      />
      <Button kind="primary" disabled={busy.value} onClick={() => void save()}>Save</Button>
    </Sheet>
  );
}

/** Spec 4 §5: add a tag from those seen in all sessions, or type a new one. */
function TagSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const draft = useSignal('');
  const busy = useSignal(false);
  const own = new Set(p.row.file.session.tags);
  const seen = [...new Set(data.liveSessions.value.flatMap((s) => s.tags))].filter((t) => !own.has(t)).sort((a, b) => a.localeCompare(b));
  const add = async (raw: string): Promise<void> => {
    if (busy.value) return;
    const tag = raw.trim();
    if (tag === '') return;
    busy.value = true;
    try {
      const now = data.clock();
      const ok = await editSession(data, p.row.path, (f) => (f.session.tags.includes(tag) ? f : setSessionFields(f, { tags: [...f.session.tags, tag] }, now)));
      if (ok) p.onClose();
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title="Add tag" onClose={p.onClose}>
      {seen.length > 0 && (
        <div class="tagsheet__seen">
          {seen.map((t) => (
            <button key={t} type="button" class="session-head__tag" disabled={busy.value} onClick={() => void add(t)}>{t}</button>
          ))}
        </div>
      )}
      <input
        class="tagsheet__input"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="New tag"
        aria-label="New tag"
        value={draft.value}
        onInput={(e) => (draft.value = e.currentTarget.value)}
      />
      <Button kind="primary" disabled={busy.value || draft.value.trim() === ''} onClick={() => void add(draft.value)}>Add</Button>
    </Sheet>
  );
}
```

Create `src/ui/components/days/session-page.vm.ts`:

```ts
import {
  blockIndicator,
  blockTotals,
  exerciseIndicator,
  liveBlocks,
  liveSets,
  setIntervals,
  type AmountIndicator,
  type BlockIndicator,
} from '../../../model/derive';
import type { Block, Exercise, Session, WorkoutSet } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { formatAmount, formatClock, formatDayLong, formatLabel, formatLoad, formatLoadShort } from '../../format';

export interface SetRow {
  setId: string;
  amount: string;
  /** formatLoadShort when it differs from the block's first live set. */
  load: string | undefined;
  note: string | undefined;
  /** '+1:02' from setIntervals (an interval, not rest). */
  interval: string | undefined;
  /** The interval read aloud: 'interval 1:02 since the previous set'. */
  intervalLabel: string | undefined;
  /** 'rest 120 s' from restSec. */
  rest: string | undefined;
  /** The stated rest read aloud: 'stated rest 120 s'. */
  restLabel: string | undefined;
  aggregate: boolean;
  completedAt: string | undefined;
}

export interface BlockRow {
  blockId: string;
  exerciseId: string;
  name: string;
  archived: boolean;
  unknownExercise: boolean;
  note: string | undefined;
  /** The block's load (formatLoad of its first live set) unless that is plain bodyweight; the set rows show only differences from it. */
  load: string | undefined;
  sets: SetRow[];
  noteOnly: boolean;
  /** '143 · 14 sets' or '100 total, set count unknown'. */
  totals: string;
  marks: BlockIndicator;
  exerciseMark: AmountIndicator;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface SessionPageVm {
  title: string;
  uncertain: boolean;
  /** The label as display text ('Pull', formatLabel). */
  label: string | undefined;
  tags: string[];
  notes: string | undefined;
  migrated: boolean;
  readOnly: { reason: string } | undefined;
  blocks: BlockRow[];
  deleted: boolean;
}

export interface SessionPageInput {
  session: Session;
  /** The live sessions the indicators compare against. */
  allSessions: readonly Session[];
  catalog: ReadonlyMap<string, Exercise>;
  readOnlyReason: string | undefined;
}

const sameLoad = (a: WorkoutSet, b: WorkoutSet): boolean => a.loadType === b.loadType && a.loadKg === b.loadKg;

function totalsText(block: Block): string {
  const t = blockTotals(block);
  if (t.hasAggregate) return `${formatAmount(t.amount)} total, set count unknown`;
  return `${formatAmount(t.amount)} · ${t.setCount} ${t.setCount === 1 ? 'set' : 'sets'}`;
}

function setRow(s: WorkoutSet, first: WorkoutSet | undefined, intervals: ReadonlyMap<string, number>): SetRow {
  const interval = intervals.get(s.id);
  return {
    setId: s.id,
    amount: formatAmount('reps' in s ? s.reps : s.seconds),
    load: first === undefined || sameLoad(s, first) ? undefined : formatLoadShort(s.loadType, s.loadKg),
    note: s.note,
    interval: interval === undefined ? undefined : `+${formatClock(interval)}`,
    intervalLabel: interval === undefined ? undefined : `interval ${formatClock(interval)} since the previous set`,
    rest: s.restSec === undefined ? undefined : `rest ${formatAmount(s.restSec)} s`,
    restLabel: s.restSec === undefined ? undefined : `stated rest ${formatAmount(s.restSec)} s`,
    aggregate: s.aggregate === true,
    completedAt: s.completedAt,
  };
}

/** Spec 4 §5 "Session page": the header and the blocks in canonical order, with the derived values of spec 1 §7. */
export function sessionPageVm(input: SessionPageInput): SessionPageVm {
  const { session, allSessions, catalog } = input;
  const intervals = setIntervals(session);
  const live = liveBlocks(session);
  const blocks = live.map((b, i): BlockRow => {
    const exercise = catalog.get(b.exerciseId);
    const sets = liveSets(b);
    const first = sets[0];
    return {
      blockId: b.id,
      exerciseId: b.exerciseId,
      name: exercise?.name ?? b.exerciseId,
      archived: exercise?.archived ?? false,
      unknownExercise: exercise === undefined,
      note: b.note,
      load: first === undefined || first.loadType === 'bodyweight' ? undefined : formatLoad(first.loadType, first.loadKg),
      sets: sets.map((s) => setRow(s, first, intervals)),
      noteOnly: sets.length === 0 && b.note !== undefined,
      totals: totalsText(b),
      marks: blockIndicator(allSessions, session, b),
      exerciseMark: exerciseIndicator(allSessions, session, b.exerciseId),
      canMoveUp: i > 0,
      canMoveDown: i < live.length - 1,
    };
  });
  return {
    title: formatDayLong(session.date),
    uncertain: session.dateUncertain === true,
    label: session.label === undefined ? undefined : formatLabel(session.label),
    tags: [...session.tags],
    notes: session.notes,
    migrated: session.source === 'migrated',
    readOnly: input.readOnlyReason === undefined ? undefined : { reason: input.readOnlyReason },
    blocks,
    deleted: session.deletedAt !== undefined,
  };
}

/** The read-only banner's reason (the Sync tab's card titles, spec 4 §7). */
export function readOnlyReason(row: FileRow): string {
  if (row.duplicateOf !== undefined) return `Duplicate file: the same session as ${row.duplicateOf}`;
  switch (row.status) {
    case 'read-only':
      return 'Read-only: written by a newer app version';
    case 'needs-update':
      return 'Needs a newer app to change this session';
    case 'quarantined':
      return 'Quarantined: this file failed validation';
    case 'ok':
      return 'Read-only';
  }
}

const normalNotes = (text: string | undefined): string | undefined => {
  const t = (text ?? '').trim();
  return t === '' ? undefined : t;
};

/**
 * Whether saving `draft` as the notes would change them: both sides go through the normalisation
 * `setSessionFields` applies (trim, blank removes), so a migrated note with surrounding whitespace is
 * never rewritten by a save that did not change its words.
 */
export function notesChanged(stored: string | undefined, draft: string): boolean {
  return normalNotes(draft) !== normalNotes(stored);
}
```

Append to `src/ui/theme.css`:

```css
/* ---- .session, .session-head, .session-block, .session-set (components/days/SessionPage) ---- */
.session { display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; }
.session__missing { color: var(--muted); }
.session__banner { padding: 10px 12px; border: 1px solid var(--danger); border-radius: 10px; color: var(--text); background: var(--panel); }
.session__banner a { color: var(--accent); }
/* At least 44 px tall (spec 4 §8 touch targets). */
.session__banner-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 4px; }
.session__deleted { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-radius: 10px; background: var(--panel); color: var(--danger); font-weight: 600; }
.session__foot { display: flex; justify-content: space-between; gap: 8px; padding-top: 8px; }
.session-head { display: flex; flex-direction: column; gap: 6px; }
.session-head__uncertain { margin: 0; color: var(--muted); font-size: 14px; }
.session-head__line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.session-head__label { padding: 4px 10px; border-radius: 999px; background: var(--panel-2); color: var(--accent); font-size: 14px; text-transform: capitalize; }
.session-head__tag {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}
span.session-head__tag { display: inline-flex; align-items: center; min-height: 32px; }
.session-head__tag--add { border-style: dashed; color: var(--muted); }
.session-head__notes {
  margin: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font-size: 15px;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.session-head__placeholder { color: var(--muted); }
.session-block { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 12px; background: var(--panel); }
.session-block__head { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.session-block__name { margin: 0; flex: 1; font-size: 17px; }
.session-block__namebtn {
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: inherit;
  font-weight: inherit;
  text-align: left;
}
.session-block__flag { margin-left: 8px; color: var(--muted); font-size: 12px; font-weight: 400; text-transform: uppercase; }
.session-block__load { color: var(--muted); font-variant-numeric: tabular-nums; }
.session-block__options {
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 18px;
}
.session-block__note { margin: 0; color: var(--muted); font-style: italic; overflow-wrap: anywhere; }
.session-block__empty { margin: 0; color: var(--muted); }
.session-block__sets { display: flex; flex-wrap: wrap; gap: 8px; }
.session-block__totals { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
.session-block__exmark { display: inline-flex; align-items: center; gap: 4px; }
.session-block__actions { display: flex; justify-content: flex-end; }
.session-set { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.session-set__meta, .session-set__note { max-width: 120px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; text-align: center; overflow-wrap: anywhere; }
.session-set__note { font-style: italic; }

/* ---- .sessionsheet, .tagsheet, .setsheet__aggregate (components/days/SessionHeaderSheet, SessionPage sheets; log/SetSheet) ---- */
.sessionsheet__field { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 14px; }
.sessionsheet__field input, .sessionsheet__field select, .sessionsheet__field textarea, .sessionsheet__notes, .tagsheet__input {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--outline);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font-size: 16px; /* no zoom on focus (spec 4 §10 notes) */
  font-family: inherit;
}
.sessionsheet__switch { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.sessionsheet__switch input { width: 22px; height: 22px; accent-color: var(--accent); }
.tagsheet__seen { display: flex; flex-wrap: wrap; gap: 6px; }
.setsheet__aggregate { margin: 0; color: var(--muted); }
```

- [ ] **Step 4: Run the full suite and the typecheck**

Run: `npm test` and `npm run typecheck`

Expected: PASS, 74 test files and 1041 tests; the typecheck prints nothing.

- [ ] **Step 5: Commit**

```
git add src/ui/app.test.tsx src/ui/components/days/SessionHeaderSheet.tsx src/ui/components/days/SessionPage.test.tsx src/ui/components/days/SessionPage.tsx src/ui/components/days/session-page.vm.test.ts src/ui/components/days/session-page.vm.ts src/ui/theme.css
git commit -m "Add the session page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


### Task 12: Device checklist, CLAUDE.md, push and PR

No code. This task ends plan 4a: the owner checks the build on the real devices, CLAUDE.md records the new state, and the branch goes to a PR.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Verify everything once more**

Run: `npm test`, `npm run typecheck`, `npm run build`

Expected: the test and typecheck counts of Task 11's last step; the build prints `dist/sw.js` and an `index-*.js` of about 50 kB gzipped.

- [ ] **Step 2: Run the app locally with the owner (PC, Chrome)**

Run `npm run dev` and ask the owner to open `http://localhost:5173/` in Chrome. Guide one step at a time and wait for each report. The dev server reads the owner's real Dropbox only after they connect, which they do themselves; nothing here writes to it unless they log a set.

1. The app opens on the Sync tab if not connected, else on the Log tab. The four tabs switch; the Sync badge counts issues.
2. Sync tab: every function of the old shell is there (connect or connected line, status, Sync now, issues, Update app when a build waits, build id, storage, sign out).
3. Days tab: the migrated history appears month by month; the chips filter by block pattern; a row opens its session page; the `?` shows on migrated estimated dates.
4. Do not log anything on the PC unless the owner wants a test session; if they do, delete it afterwards on the session page (a tombstone; the file stays, which is expected).

- [ ] **Step 3: Update CLAUDE.md**

In the status paragraph: spec 4 is split into plans 4a (this plan, the gym build) and 4b (More tab); plan 4a implemented under `src/ui/` with Preact 10 and signals; the app replaces the diagnostic shell. In "Read first", add spec 4 (`docs/superpowers/specs/2026-10-10-training-views-design.md`) and this plan. In "Core rules", add: screens write only through `Data.edit`/`Data.create` with timestamps from `data.clock()`; Log-tab sets carry `completedAt`, session-page sets never; colours only as tokens in `src/ui/theme.css`; pure view models in `*.vm.ts` tested in Node, component tests under happy-dom only for interactions that write. In "Repo layout", add `src/ui/` (data, router, format, theme, components per tab, shared components) and replace the shell files under `src/app/` with `main.tsx`, `idle.ts`. In "Stack": Preact 10.29 with `@preact/signals` 2 (pinned below 11), TSX via tsconfig and Vite's Oxc, happy-dom and Testing Library for component tests; no chart library (U5). In "To fill in later": remove "Spec 4: the training views; the UI framework choice; the issues screen replacing the shell"; add "Plan 4b: More tab (exercise history, calendar, bodyweight, catalog) and soft-issue flags" and "CSV export (deferred, spec 4 U10)".

Commit:

```bash
git add CLAUDE.md
git commit -m "Record plan 4a in CLAUDE.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin spec/training-views
gh pr create --base main --head spec/training-views --title "Training views, part 4a: the gym build" --body-file pr-body.md
```

Write `pr-body.md` (outside the commit; delete it after) with: what 4a delivers (Log, Days, session page, Sync tab replacing the shell; More placeholder), the decisions U1–U13 in one line each, the test and typecheck counts, the device checklist below as unticked boxes, and the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The owner merges; never merge locally, never delete branches.

- [ ] **Step 5: Device checklist (after the merge and deploy, with the owner)**

The deploy workflow publishes `main` to `https://joergbaender.github.io/calistally/`. Guide the owner one step at a time on the installed iPhone app and wait for each report:

1. **Update:** the installed app shows "Update app" on the Sync tab; tap it: "Updating…", then the app reloads on the new build (build id in the Sync tab's footer).
2. **Start:** Log tab → Start session → the picker lists recent sessions with the proposed reference on top → tap it. The screen shows one card per reference block.
3. **Log one-handed:** Start the first card, add sets with the stepper (one tap when matching last time, + then Add when beating it). The entry area stays above the tab bar and inside the safe area; nothing is hidden behind the home indicator. The current position is marked in last time's ladder; the counter runs.
4. **Pad:** tap the big number: the pad opens empty; type a value and Add: the set is logged at once.
5. **Load:** change the load on a weighted exercise; the next set inherits it.
6. **Undo:** tap one of today's sets → Delete → Undo within 6 s: the set is back.
7. **New exercise:** Other exercise… → type a new name → Create → the block starts; the catalog file in the Dropbox App folder holds the new entry after the next sync.
8. **Airplane mode** for three sets: the Log header shows "offline"; sets still log. Back online: the queue drains without a tap (Sync tab: Queued 0).
9. **Kill and reopen** the app mid-ladder: it opens on the Log tab with the same session, reference and position.
10. **Details:** the Log header's Details opens the session page; add a note; back.
11. **PC:** the open session appears on the PC's Days list (marked open) after a sync; an edit there (a session note) reaches the phone.
12. **Done** → Days: today's session on top. Its page shows the sets, totals and indicators.
13. **Paste login text** (only if the owner signs out to test it): the panel says Dropbox may ask for a login inside the sheet.

Record the results in the PR or in the memory note; anything that fails becomes a fix on a new branch or an item for plan 4b's "corrections" task.
