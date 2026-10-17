# Theme Picker Implementation Plan (spec 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five colour themes, chosen per device on a new More page, applied before the app draws anything, with every theme checked for contrast by a test.

**Architecture:** All colours stay in `src/ui/theme.css`: Slate & Amber on `:root, [data-theme="slate"]`, one `[data-theme="<id>"]` block per other theme, each declaring every token. `src/ui/theme.ts` holds the theme list (ids, names, kinds; no colours), the fallback, `applyTheme` (sets `data-theme` on `<html>` and the `theme-color` meta from the computed `--status-bar`) and `loadTheme` (the start step). The choice lives in the store's meta under `theme`; a module signal `currentTheme` (like `toast`) feeds the More line and the Theme page.

**Tech Stack:** Unchanged: Preact 10.29 with `@preact/signals` 2, Vite 8, Vitest 5 with happy-dom and Testing Library. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-18-theme-picker-design.md` (spec 5), approved by the owner on 2026-10-18. Spec 4 (`docs/superpowers/specs/2026-10-10-training-views-design.md`) U11, §3, §6, §8, §13 are amended by Task 4.

**Prerequisite:** the spec PR (`spec/theme-picker`, holding spec 5 and this plan) is merged into `main`. Start from a freshly pulled `main` on a new branch `feat/theme-picker`. Before the first commit, `git config user.email` must print `170411984+joergbaender@users.noreply.github.com`.

**The code in this plan was prototyped and run while planning**, in a throwaway worktree on top of `main` at `d17f1b3`: typecheck clean, the full suite green at the end of every task with the counts given in each task's last step, `npm run build` passing. A headless Chrome run of the build (fresh profile, no Dropbox login) confirmed that each Theme row shows its own colours, that `theme-color` follows `--status-bar` including the `var(--bg)` themes (`#111827`, `#1f2937`, `#1a1020`, `#4a1477`, `#5a4426`), that `color-scheme` follows the kind, and that the choice survives a reload. Copy the code as written; where a test and the code disagree, the code is the reference.

## Global Constraints

- **No model change.** `MODEL_VERSION` stays 1; nothing new reaches Dropbox; the only new stored value is the meta key `theme` holding a theme id.
- **Colours only in `src/ui/theme.css`** (spec 4 U11). The literal-colour test in `src/ui/theme.test.ts` is not changed and keeps passing. It skips only files whose names end in `theme.css` or `theme.test.ts`; a new test that needs a literal colour lives in such a file (`apply-theme.test.ts` does).
- **Theme values are exactly spec 5 §3** (ids `slate`, `daylight`, `berry`, `ultraviolet`, `dune`; names Slate & Amber, Daylight, Berry Night, Ultraviolet, Dune; in that order).
- **Every write control ignores a second tap until its write lands:** the Theme rows use the shared `useBusy`.
- **Touch targets** at least 44 px; the Theme rows are at least 52 px (the More menu's line height).
- Tests run in Node; component and DOM tests carry `// @vitest-environment happy-dom` as their first line. Fixtures are synthetic, dates in 2030.
- Nothing touches the owner's Dropbox: no sign in or out on the dev server, no API calls.
- Write files with the Write/Edit tools. The working copy uses CRLF line endings (`core.autocrlf=true`); don't match line endings in shell scripts.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but does not spell out as tests, most likely to bite first. Each is pinned to a test in the task that owns the code.

1. **A row painted in one theme inside a page of another** inherits the page's `var()`-derived tokens (`--chip-push`, `--status-bar`, `--scrim`, …) unless its own block declares them. → Task 2 "every theme block declares every token of spec 4 §8 and spec 5 §3, and color-scheme"; Task 3 "lists the five themes, each painted in its own theme, with the current one checked".
2. **Two quick taps on two different rows** must not leave the screen in one theme and meta in another. → Task 3 "a second tap while the write is in flight is ignored".
3. **A value from a later version in meta** (a sixth theme id) must not break the start or the page. → Task 1 "applies Slate & Amber for a value from a later version"; Task 3's view model "reads an unknown current id as Slate & Amber".
4. **The meta read failing at start** must not stop the app. → Task 1 "applies Slate & Amber when the read fails".
5. **Slate & Amber must render exactly as before**: the new strip, scrim and shadow tokens equal today's `--bg` mixes. → Task 2 "Slate & Amber renders as before spec 5: strip, scrim and shadow are its old --bg mixes".

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/theme.ts` | Theme list, `themeIdOr`, `themeName`, `applyTheme`, `loadTheme`, `currentTheme`, `THEME_META_KEY` |
| `src/ui/apply-theme.test.ts` | Tests of `theme.ts` (happy-dom; the name ends in `theme.test.ts` so it may hold literal colours) |
| `src/app/main.tsx` | Calls `loadTheme` right after the store exists |
| `src/ui/theme.css` | The five token blocks; the strip, scrim and shadow rules on the new tokens; the More line value and the Theme rows |
| `src/ui/theme.test.ts` | Token completeness, ids, `color-scheme`, Slate unchanged, contrast per theme |
| `src/ui/router.ts` | `'theme'` as a More page |
| `src/ui/components/more/theme.vm.ts` | Rows of the Theme page |
| `src/ui/components/more/ThemePage.tsx` | The page |
| `src/ui/components/more/MoreTab.tsx` | The fifth line and the route case |
| `CLAUDE.md`, spec 4 | Status, rules, layout; the pointers of spec 5 §11 |

---

### Task 1: The theme module and the start

Spec 5 §5 and §7: the theme list without colours, the fallback for anything unknown, applying a theme to `<html>` and the `theme-color` meta, and reading the stored theme before anything else at start.

**Files:**
- Create: `src/ui/apply-theme.test.ts`
- Create: `src/ui/theme.ts`
- Modify: `src/app/main.tsx` (imports; after the `new Store(...)` statement)

**Interfaces:**
- Consumes: `signal`, `Signal` from `@preact/signals`; `Store.getMeta<T>(key): Promise<T | undefined>`.
- Produces (all from `src/ui/theme.ts`):
  - `THEMES: readonly { id; name; kind: 'dark' | 'light' }[]` (`as const`, order of spec 5 §3)
  - `type ThemeId = 'slate' | 'daylight' | 'berry' | 'ultraviolet' | 'dune'`
  - `THEME_META_KEY = 'theme'`
  - `currentTheme: Signal<ThemeId>` (initially `'slate'`)
  - `themeIdOr(value: unknown): ThemeId`
  - `themeName(id: ThemeId): string`
  - `applyTheme(id: ThemeId, doc?: Document): void`
  - `loadTheme(read: () => Promise<unknown>, doc?: Document): Promise<ThemeId>`

- [ ] **Step 1: Write the failing test** `src/ui/apply-theme.test.ts`

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, currentTheme, loadTheme, themeIdOr, themeName, THEMES } from './theme';

/** Spec 5 §5. The file name ends in theme.test.ts, so the literal-colour test of spec 4 §8 skips it. */
const STYLE = `
  :root, [data-theme="slate"] { --status-bar: #111827; }
  [data-theme="dune"] { --status-bar: #5a4426; }
`;

beforeEach(() => {
  document.head.innerHTML = `<meta name="theme-color" content="#111827"><style>${STYLE}</style>`;
  delete document.documentElement.dataset.theme;
  currentTheme.value = 'slate';
});
afterEach(() => {
  document.head.innerHTML = '';
  delete document.documentElement.dataset.theme;
  currentTheme.value = 'slate';
});

const themeColor = (): string | null => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

describe('themeIdOr', () => {
  it.each(THEMES.map((t) => t.id))('keeps the known id %s', (id) => {
    expect(themeIdOr(id)).toBe(id);
  });

  it.each([undefined, null, '', 'neon', 'Dune', 3, { id: 'dune' }])('reads %j as Slate & Amber', (value) => {
    expect(themeIdOr(value)).toBe('slate');
  });
});

describe('themeName', () => {
  it('names every theme', () => {
    expect(THEMES.map((t) => themeName(t.id))).toEqual(['Slate & Amber', 'Daylight', 'Berry Night', 'Ultraviolet', 'Dune']);
  });
});

describe('applyTheme', () => {
  it('sets data-theme on <html> and the theme-color meta from --status-bar', () => {
    applyTheme('dune');
    expect(document.documentElement.dataset.theme).toBe('dune');
    expect(themeColor()).toBe('#5a4426');
  });

  it('sets data-theme for Slate & Amber too', () => {
    applyTheme('dune');
    applyTheme('slate');
    expect(document.documentElement.dataset.theme).toBe('slate');
    expect(themeColor()).toBe('#111827');
  });

  it('does not throw without a theme-color meta', () => {
    document.head.innerHTML = `<style>${STYLE}</style>`;
    expect(() => applyTheme('dune')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dune');
  });

  it('leaves the meta alone when --status-bar is not defined', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#111827">';
    applyTheme('dune');
    expect(themeColor()).toBe('#111827');
  });
});

describe('loadTheme', () => {
  it('applies the stored theme and sets currentTheme', async () => {
    await expect(loadTheme(() => Promise.resolve('dune'))).resolves.toBe('dune');
    expect(document.documentElement.dataset.theme).toBe('dune');
    expect(currentTheme.value).toBe('dune');
  });

  it('applies Slate & Amber when nothing is stored', async () => {
    await expect(loadTheme(() => Promise.resolve(undefined))).resolves.toBe('slate');
    expect(document.documentElement.dataset.theme).toBe('slate');
  });

  it('applies Slate & Amber for a value from a later version', async () => {
    await expect(loadTheme(() => Promise.resolve('neon'))).resolves.toBe('slate');
    expect(currentTheme.value).toBe('slate');
  });

  it('applies Slate & Amber when the read fails', async () => {
    currentTheme.value = 'dune';
    await expect(loadTheme(() => Promise.reject(new Error('idb')))).resolves.toBe('slate');
    expect(document.documentElement.dataset.theme).toBe('slate');
    expect(currentTheme.value).toBe('slate');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/ui/apply-theme.test.ts`
Expected: FAIL, the import of `./theme` cannot be resolved.

- [ ] **Step 3: Write `src/ui/theme.ts`**

```ts
import { signal, type Signal } from '@preact/signals';

/** Spec 5 §3: the five themes in the order the Theme page lists them. The colours live in theme.css only. */
export const THEMES = [
  { id: 'slate', name: 'Slate & Amber', kind: 'dark' },
  { id: 'daylight', name: 'Daylight', kind: 'light' },
  { id: 'berry', name: 'Berry Night', kind: 'dark' },
  { id: 'ultraviolet', name: 'Ultraviolet', kind: 'light' },
  { id: 'dune', name: 'Dune', kind: 'light' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

/** The meta key of the chosen theme (spec 5 §5). */
export const THEME_META_KEY = 'theme';

/** The theme this tab shows; set at start (`loadTheme`) and on a tap on the Theme page. */
export const currentTheme: Signal<ThemeId> = signal<ThemeId>('slate');

/** A known id, else Slate & Amber: nothing stored, a value from a later version, anything malformed. */
export function themeIdOr(value: unknown): ThemeId {
  return THEMES.find((t) => t.id === value)?.id ?? 'slate';
}

export function themeName(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.name ?? 'Slate & Amber';
}

/**
 * Sets `data-theme` on `<html>` and points `<meta name="theme-color">` at the theme's `--status-bar`,
 * read from the computed style so no colour is written in code (spec 5 §5, T7).
 */
export function applyTheme(id: ThemeId, doc: Document = document): void {
  const html = doc.documentElement;
  html.dataset.theme = id;
  const meta = doc.querySelector('meta[name="theme-color"]');
  const view = doc.defaultView;
  if (meta === null || view === null) return;
  const value = view.getComputedStyle(html).getPropertyValue('--status-bar').trim();
  if (value !== '') meta.setAttribute('content', value);
}

/**
 * At start, before anything else (spec 5 §5, T3): reads the stored theme, applies it and sets
 * `currentTheme`. A failed read gives Slate & Amber and never stops the start.
 */
export async function loadTheme(read: () => Promise<unknown>, doc: Document = document): Promise<ThemeId> {
  let id: ThemeId = 'slate';
  try {
    id = themeIdOr(await read());
  } catch {
    // Slate & Amber
  }
  applyTheme(id, doc);
  currentTheme.value = id;
  return id;
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/ui/apply-theme.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Call `loadTheme` at start in `src/app/main.tsx`**

Add the import after the router import:

```ts
import { Router, routeHash, startRoute } from '../ui/router';
import { loadTheme, THEME_META_KEY } from '../ui/theme';
```

and, directly after the statement `const store = new Store(db, { ... });` and before `const auth = new Auth(...)`:

```ts
  // Spec 5 §5: the stored theme first, so nothing is ever drawn in another one.
  await loadTheme(() => store.getMeta(THEME_META_KEY));
```

Nothing else in the start order changes. `index.html` keeps `<meta name="theme-color" content="#111827">` and the `black-translucent` status bar; `vite.config.ts` and the icons are not touched (spec 5 T7).

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; 90 test files, 1308 tests passed.

- [ ] **Step 7: Commit**

```bash
git add src/ui/theme.ts src/ui/apply-theme.test.ts src/app/main.tsx
git commit -m "Add the theme module and apply the stored theme at start

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The theme blocks and the contrast test

Spec 5 §3, §4 and §8: one block per theme in `theme.css`, the three new tokens, the three `--bg` mixes and the strip moved onto them, and tests that every block is complete and every theme meets the contrast thresholds.

**Files:**
- Modify: `src/ui/theme.css` (the token block at the top, `body::before`, `.sheet__backdrop`, `.sheet`, the toast rule with `box-shadow: 0 8px 24px …`)
- Modify: `src/ui/theme.test.ts`

**Interfaces:**
- Consumes: `THEMES` from `src/ui/theme.ts` (Task 1).
- Produces: the tokens `--status-bar`, `--scrim`, `--shadow` in every block; the selectors `:root, [data-theme="slate"]` and `[data-theme="<id>"]` that Task 3's rows rely on.

- [ ] **Step 1: Write the failing tests** in `src/ui/theme.test.ts`

Add `import { THEMES } from './theme';` after the `vitest` import. Replace the test `'theme.css defines every token of spec 4 §8'` (keep `'no literal colour outside theme.css'` exactly as it is) with the following, and append the rest of the block below the `describe('theme tokens', …)`:

```ts
  it('every theme block declares every token of spec 4 §8 and spec 5 §3, and color-scheme', () => {
    const blocks = themeBlocks();
    for (const t of THEMES) {
      expect([...(blocks.get(t.id)?.keys() ?? [])].sort(), t.id).toEqual([...TOKENS, 'color-scheme'].sort());
    }
  });

  it('the theme blocks are exactly the themes of theme.ts, in its order', () => {
    expect([...themeBlocks().keys()]).toEqual(THEMES.map((t) => t.id));
  });

  it('color-scheme matches each theme kind', () => {
    const blocks = themeBlocks();
    for (const t of THEMES) expect(blocks.get(t.id)?.get('color-scheme'), t.id).toBe(t.kind);
  });

  it('Slate & Amber renders as before spec 5: strip, scrim and shadow are its old --bg mixes', () => {
    const slate = themeBlocks().get('slate');
    expect(slate?.get('--status-bar')).toBe('var(--bg)');
    expect(slate?.get('--scrim')).toBe('color-mix(in srgb, var(--bg) 70%, transparent)');
    expect(slate?.get('--shadow')).toBe('color-mix(in srgb, var(--bg) 60%, transparent)');
  });
});

/** Spec 5 §8: contrast of every theme, computed from theme.css itself. */
describe('theme contrast', () => {
  const blocks = themeBlocks();
  const SURFACES = ['--bg', '--panel', '--panel-2'] as const;
  const TEXT = ['--text', '--muted', '--accent', '--ok', '--danger'] as const;
  const DOTS = ['--chip-push', '--chip-pull', '--chip-legs', '--chip-other'] as const;

  it.each(THEMES.map((t) => t.id))('%s: text 4.5:1, dots 3:1, white on the status strip 4.5:1', (id) => {
    const block = blocks.get(id);
    if (block === undefined) throw new Error(`no block for ${id}`);
    const colour = (token: string): string => resolveHex(block, token, id);
    const failures: string[] = [];
    const check = (fg: string, bg: string, min: number, fgLabel = fg): void => {
      const r = contrast(fg.startsWith('#') ? fg : colour(fg), colour(bg));
      if (r < min) failures.push(`${id}: ${fgLabel} on ${bg} is ${r.toFixed(2)}, needs ${min}`);
    };
    for (const fg of TEXT) for (const bg of SURFACES) check(fg, bg, 4.5);
    check('--on-accent', '--accent', 4.5);
    check('--on-accent', '--danger', 4.5);
    check('#ffffff', '--status-bar', 4.5, 'iOS status-bar white');
    for (const fg of DOTS) for (const bg of SURFACES) check(fg, bg, 3);
    expect(failures).toEqual([]);
  });

  it('flags a pair below its threshold (the check itself)', () => {
    expect(contrast('#777777', '#888888')).toBeLessThan(3);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

const TOKENS = [
  '--bg', '--panel', '--panel-2', '--text', '--muted', '--accent', '--ok', '--danger', '--outline', '--on-accent',
  '--chip-push', '--chip-pull', '--chip-legs', '--chip-other', '--status-bar', '--scrim', '--shadow',
];

/** theme id → (property → value) for `:root, [data-theme="slate"]` and each `[data-theme="<id>"]` block, in file order. */
function themeBlocks(): Map<string, Map<string, string>> {
  const css = readFileSync(join(UI_DIR, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map<string, Map<string, string>>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim();
    const id = /^:root\s*,\s*\[data-theme="slate"\]$/.test(selector) ? 'slate' : /^\[data-theme="([a-z]+)"\]$/.exec(selector)?.[1];
    if (id === undefined) continue;
    const props = new Map<string, string>();
    for (const d of (m[2] ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) props.set(d[1] ?? '', (d[2] ?? '').trim());
    blocks.set(id, props);
  }
  return blocks;
}

/** A token's #rrggbb value inside its own block, following var() references. */
function resolveHex(block: Map<string, string>, token: string, id: string, seen: string[] = []): string {
  const value = block.get(token);
  if (value === undefined) throw new Error(`${id}: ${token} is not declared`);
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (ref === undefined || seen.includes(ref)) throw new Error(`${id}: ${token} is neither #rrggbb nor var(--token): ${value}`);
  return resolveHex(block, ref, id, [...seen, token]);
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel(((n >> 16) & 255) / 255) + 0.7152 * channel(((n >> 8) & 255) / 255) + 0.0722 * channel((n & 255) / 255);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/ui/theme.test.ts`
Expected: FAIL, 9 of 11: no block matches yet (the old selector is plain `:root`), so the completeness, ids, `color-scheme` and Slate tests fail and every contrast case throws "no block for …"; only the literal-colour test and the check of `contrast` itself pass.

- [ ] **Step 3: Replace the token block at the top of `src/ui/theme.css`**

Replace the comment line and the whole `:root { … }` block (everything before `/* ---- base ---- */`) with:

```css
/* Spec 4 §8, spec 5 §4: the token blocks, one per theme. Components reference tokens only.
   Every block declares every token, the var() ones too: a custom property resolves where it is
   declared, so a row painted in one theme inside a page of another would otherwise inherit the
   page's --chip-push, --scrim and so on. A test checks completeness and contrast (spec 5 §8). */
:root, [data-theme="slate"] {
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
  /* Calendar dots by chip (spec 4 §6); legs gets its own colour so it never reads as an error. */
  --chip-push: var(--accent);
  --chip-pull: var(--ok);
  --chip-legs: #60a5fa;
  --chip-other: var(--muted);
  /* Behind the iOS status bar, whose text is always white (black-translucent; spec 5 T5). */
  --status-bar: var(--bg);
  /* The sheet backdrop and the shadows (spec 5 T6). */
  --scrim: color-mix(in srgb, var(--bg) 70%, transparent);
  --shadow: color-mix(in srgb, var(--bg) 60%, transparent);
}
[data-theme="daylight"] {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-2: #eceff4;
  --text: #111827;
  --muted: #4b5563;
  --accent: #a14a08;
  --ok: #047857;
  --danger: #b91c1c;
  --outline: #cfd5de;
  --on-accent: #ffffff;
  --chip-push: var(--accent);
  --chip-pull: var(--ok);
  --chip-legs: #1d4ed8;
  --chip-other: var(--muted);
  --status-bar: #1f2937;
  --scrim: color-mix(in srgb, var(--text) 35%, transparent);
  --shadow: color-mix(in srgb, var(--text) 18%, transparent);
}
[data-theme="berry"] {
  color-scheme: dark;
  --bg: #1a1020;
  --panel: #291a30;
  --panel-2: #36223f;
  --text: #f5e9f2;
  --muted: #bba5bb;
  --accent: #e879f9;
  --ok: #5eead4;
  --danger: #ff7a7a;
  --outline: #4a3352;
  --on-accent: #1a1020;
  --chip-push: var(--accent);
  --chip-pull: var(--ok);
  --chip-legs: #93c5fd;
  --chip-other: var(--muted);
  --status-bar: var(--bg);
  --scrim: color-mix(in srgb, var(--bg) 70%, transparent);
  --shadow: color-mix(in srgb, var(--bg) 60%, transparent);
}
[data-theme="ultraviolet"] {
  color-scheme: light;
  --bg: #f4e6ff;
  --panel: #ffffff;
  --panel-2: #ecd3ff;
  --text: #2b0a52;
  --muted: #6a2f99;
  --accent: #a01591;
  --ok: #04664a;
  --danger: #b01a1a;
  --outline: #dcb6f7;
  --on-accent: #ffffff;
  --chip-push: var(--accent);
  --chip-pull: var(--ok);
  --chip-legs: #1d4ed8;
  --chip-other: var(--muted);
  --status-bar: #4a1477;
  --scrim: color-mix(in srgb, var(--text) 35%, transparent);
  --shadow: color-mix(in srgb, var(--text) 18%, transparent);
}
[data-theme="dune"] {
  color-scheme: light;
  --bg: #e9dfc8;
  --panel: #f6f0e2;
  --panel-2: #e2d5b8;
  --text: #2b2216;
  --muted: #5e4f37;
  --accent: #6b4e24;
  --ok: #3f6212;
  --danger: #b42318;
  --outline: #c9b994;
  --on-accent: #ffffff;
  --chip-push: var(--accent);
  --chip-pull: var(--ok);
  --chip-legs: #1e4f7a;
  --chip-other: var(--muted);
  --status-bar: #5a4426;
  --scrim: color-mix(in srgb, var(--text) 35%, transparent);
  --shadow: color-mix(in srgb, var(--text) 18%, transparent);
}
```

The 35 % and 18 % are the starting point of spec 5 §3; the owner sees them at device check step 5 and may ask for a change, which must keep every test green.

- [ ] **Step 4: Move the strip, the backdrop and the two shadows onto the new tokens** in `src/ui/theme.css`

| Rule | Old declaration | New declaration |
|---|---|---|
| `body::before` | `background: var(--bg);` | `background: var(--status-bar);` |
| `.sheet__backdrop` | `background: color-mix(in srgb, var(--bg) 70%, transparent);` | `background: var(--scrim);` |
| `.sheet` | `box-shadow: 0 -8px 24px color-mix(in srgb, var(--bg) 60%, transparent);` | `box-shadow: 0 -8px 24px var(--shadow);` |
| the toast rule (the one with `background: var(--panel-2)` before `.toast__action`) | `box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 60%, transparent);` | `box-shadow: 0 8px 24px var(--shadow);` |

After this step, `color-mix` appears only inside the five token blocks: `grep -n "color-mix" src/ui/theme.css` lists exactly ten lines, all `--scrim` or `--shadow`.

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run src/ui/theme.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; 90 test files, 1317 tests passed.

- [ ] **Step 7: Commit**

```bash
git add src/ui/theme.css src/ui/theme.test.ts
git commit -m "Add the five theme blocks with a contrast test per theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Theme page and the More line

Spec 5 §6: `#/more/theme`, a fifth line on More with the current name, and the page of five rows, each painted in its own theme, applying a tap at once and storing it in meta.

**Files:**
- Modify: `src/ui/router.ts` (`MorePage`, `MORE_PLAIN`)
- Modify: `src/ui/router.test.ts` (the `TABLE`, the unknown-hash test)
- Create: `src/ui/components/more/theme.vm.ts`, `src/ui/components/more/theme.vm.test.ts`
- Create: `src/ui/components/more/ThemePage.tsx`, `src/ui/components/more/ThemePage.test.tsx`
- Modify: `src/ui/components/more/MoreTab.tsx`
- Modify: `src/ui/theme.css` (`.more-menu__item`; new rules after `.more-page__empty`)

**Interfaces:**
- Consumes: from Task 1 `THEMES`, `themeIdOr`, `themeName`, `applyTheme`, `currentTheme`, `THEME_META_KEY`, `type ThemeId`; from Task 2 the `[data-theme]` blocks; `useBusy`, `BackBar` from `../shared`; `showToast`, `toast` from `../../toast`; `Data.setMeta(key, value): Promise<void>`; `setup`, `renderIn` from `src/ui/test-harness.tsx`.
- Produces: `MorePage` includes `'theme'`; `themeRows(current: string): ThemeRow[]` with `ThemeRow = { id: ThemeId; name: string; kind: string; current: boolean }`; `ThemePage(): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/router.test.ts`, add after the row `['#/more/catalog/ring-dip', …]` of `TABLE`:

```ts
  ['#/more/theme', { tab: 'more', page: 'theme' }],
```

and in `'sends unknown hashes to the Log tab'`, after the `#/more/calendar/extra` line:

```ts
    expect(parseRoute('#/more/theme/dune')).toEqual({ tab: 'log' });
```

Create `src/ui/components/more/theme.vm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { themeRows } from './theme.vm';

describe('themeRows', () => {
  it('lists the five themes in order with their kinds', () => {
    expect(themeRows('slate').map((r) => [r.id, r.name, r.kind])).toEqual([
      ['slate', 'Slate & Amber', 'dark · default'],
      ['daylight', 'Daylight', 'light'],
      ['berry', 'Berry Night', 'dark'],
      ['ultraviolet', 'Ultraviolet', 'light'],
      ['dune', 'Dune', 'light'],
    ]);
  });

  it('marks exactly the current theme', () => {
    expect(themeRows('dune').filter((r) => r.current).map((r) => r.id)).toEqual(['dune']);
  });

  it('reads an unknown current id as Slate & Amber', () => {
    expect(themeRows('neon').filter((r) => r.current).map((r) => r.id)).toEqual(['slate']);
  });
});
```

Create `src/ui/components/more/ThemePage.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIn, setup } from '../../test-harness';
import { currentTheme } from '../../theme';
import { toast } from '../../toast';
import { MoreTab } from './MoreTab';

const NOW = new Date('2030-03-05T10:00:00.000Z');

beforeEach(() => {
  currentTheme.value = 'slate';
  document.documentElement.dataset.theme = 'slate';
});
afterEach(() => {
  currentTheme.value = 'slate';
  delete document.documentElement.dataset.theme;
  toast.value = undefined;
  vi.restoreAllMocks();
});

async function mount(hash: '#/more' | '#/more/theme') {
  const m = await setup({ now: NOW, sessions: [] });
  m.deps.router.navigate(hash === '#/more' ? { tab: 'more' } : { tab: 'more', page: 'theme' });
  renderIn(m.deps, <MoreTab />);
  return m;
}

const radio = (name: RegExp): HTMLElement => screen.getByRole('radio', { name });

describe('More menu (spec 5 §6)', () => {
  it('shows the fifth line with the current theme and opens the Theme page', async () => {
    currentTheme.value = 'dune';
    const { deps } = await mount('#/more');
    const line = screen.getByRole('button', { name: /^Theme/ });
    expect(line.textContent).toBe('ThemeDune');
    fireEvent.click(line);
    expect(deps.router.route.value).toEqual({ tab: 'more', page: 'theme' });
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy());
  });
});

describe('ThemePage (spec 5 §6)', () => {
  it('lists the five themes, each painted in its own theme, with the current one checked', async () => {
    await mount('#/more/theme');
    const rows = screen.getAllByRole('radio');
    expect(rows.map((r) => r.dataset.theme)).toEqual(['slate', 'daylight', 'berry', 'ultraviolet', 'dune']);
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(rows[0]?.textContent).toContain('dark · default');
    expect(rows[4]?.textContent).toContain('light');
  });

  it('a tap applies the theme at once, moves the tick and stores it in meta', async () => {
    const { store } = await mount('#/more/theme');
    fireEvent.click(radio(/Dune/));
    expect(document.documentElement.dataset.theme).toBe('dune');
    expect(currentTheme.value).toBe('dune');
    await waitFor(() => expect(radio(/Dune/).getAttribute('aria-checked')).toBe('true'));
    expect(radio(/Slate & Amber/).getAttribute('aria-checked')).toBe('false');
    await waitFor(async () => expect(await store.getMeta('theme')).toBe('dune'));
  });

  it('a tap on the current theme writes nothing', async () => {
    const { data } = await mount('#/more/theme');
    const setMeta = vi.spyOn(data, 'setMeta');
    fireEvent.click(radio(/Slate & Amber/));
    expect(setMeta).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe('slate');
  });

  it('a second tap while the write is in flight is ignored', async () => {
    const { data, store } = await mount('#/more/theme');
    let release!: () => void;
    const setMeta = vi.spyOn(data, 'setMeta').mockImplementation((key, value) =>
      new Promise<void>((resolve) => { release = () => { void store.setMeta(key, value).then(resolve); }; }));
    fireEvent.click(radio(/Dune/));
    fireEvent.click(radio(/Berry Night/));
    expect(setMeta).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dune');
    release();
    await waitFor(async () => expect(await store.getMeta('theme')).toBe('dune'));
    await waitFor(() => expect((radio(/Berry Night/) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a failed meta write keeps the theme for this run and says so', async () => {
    const { data } = await mount('#/more/theme');
    vi.spyOn(data, 'setMeta').mockRejectedValue(new Error('idb'));
    fireEvent.click(radio(/Ultraviolet/));
    expect(document.documentElement.dataset.theme).toBe('ultraviolet');
    await waitFor(() => expect(toast.value?.text).toBe('Theme not saved on this device'));
    expect(currentTheme.value).toBe('ultraviolet');
  });

  it('Back goes to the More menu', async () => {
    const { deps } = await mount('#/more/theme');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(deps.router.route.value).toEqual({ tab: 'more' });
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/ui/router.test.ts src/ui/components/more`
Expected: FAIL: `#/more/theme` parses as Log; `./theme.vm` cannot be resolved; the More menu has no Theme line.

- [ ] **Step 3: Add the route** in `src/ui/router.ts`

`MorePage` becomes `'exercises' | 'exercise' | 'calendar' | 'bodyweight' | 'catalog' | 'theme'`, and `MORE_PLAIN` becomes `new Set<MorePage>(['exercises', 'calendar', 'bodyweight', 'catalog', 'theme'])`. `MORE_WITH_ID` is unchanged (the Theme page takes no id).

- [ ] **Step 4: Write `src/ui/components/more/theme.vm.ts`**

```ts
import { THEMES, themeIdOr, type ThemeId } from '../../theme';

export interface ThemeRow {
  id: ThemeId;
  name: string;
  /** "dark · default" for Slate & Amber, else "dark" or "light". */
  kind: string;
  current: boolean;
}

/** Spec 5 §6: one row per theme in the order of §3; an unknown current id reads as Slate & Amber. */
export function themeRows(current: string): ThemeRow[] {
  const id = themeIdOr(current);
  return THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.id === 'slate' ? `${t.kind} · default` : t.kind,
    current: t.id === id,
  }));
}
```

- [ ] **Step 5: Write `src/ui/components/more/ThemePage.tsx`**

```tsx
import type { JSX } from 'preact';
import { useApp } from '../../context';
import { applyTheme, currentTheme, THEME_META_KEY, type ThemeId } from '../../theme';
import { showToast } from '../../toast';
import { BackBar, useBusy } from '../shared';
import { themeRows } from './theme.vm';

/**
 * Spec 5 §6: the five themes as a radio group, each row painted in its own theme (`data-theme`).
 * A tap applies at once, then stores the choice in meta; a failed write keeps the theme for this run.
 */
export function ThemePage(): JSX.Element {
  const { data, router } = useApp();
  const { busy, run } = useBusy();
  const rows = themeRows(currentTheme.value);

  const choose = (id: ThemeId): void => {
    if (id === currentTheme.value) return;
    void run(async () => {
      applyTheme(id);
      currentTheme.value = id;
      try {
        await data.setMeta(THEME_META_KEY, id);
      } catch {
        showToast('Theme not saved on this device');
      }
    });
  };

  return (
    <section class="more-page">
      <BackBar title="Theme" onBack={() => router.navigate({ tab: 'more' })} />
      <div class="theme-list" role="radiogroup" aria-label="Theme">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={r.current}
            data-theme={r.id}
            class={`theme-row${r.current ? ' is-current' : ''}`}
            disabled={busy.value}
            onClick={() => choose(r.id)}
          >
            <span class="theme-row__swatches" aria-hidden="true">
              <span class="theme-row__swatch theme-row__swatch--bg" />
              <span class="theme-row__swatch theme-row__swatch--panel" />
              <span class="theme-row__swatch theme-row__swatch--accent" />
            </span>
            <span class="theme-row__text">
              <span class="theme-row__name">{r.name}</span>
              <span class="theme-row__kind">{r.kind}</span>
            </span>
            {r.current && <span class="theme-row__tick" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Add the fifth line and the route case** in `src/ui/components/more/MoreTab.tsx`

Imports: add `import { currentTheme, themeName } from '../../theme';` after the `router` import, and `import { ThemePage } from './ThemePage';` after the `ExercisesPage` import. Append `{ page: 'theme', label: 'Theme' }` to `MENU`. In `Menu`, the button's children become:

```tsx
          {m.label}
          {m.page === 'theme' && <span class="more-menu__value">{themeName(currentTheme.value)}</span>}
```

In `MoreTab`'s switch, after the `'catalog'` case:

```tsx
    case 'theme':
      return <ThemePage />;
```

and its doc comment becomes `/** Spec 4 §6, spec 5 §6: the menu of five lines and the switch to its pages (routes in spec 4 §3). */`.

- [ ] **Step 7: Style the line and the rows** in `src/ui/theme.css`

Append to the `.more-menu__item` rule:

```css
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
```

After the `.more-page__empty` rule, add:

```css
.more-menu__value { color: var(--muted); font-size: 15px; }

/* ---- .theme-list, .theme-row (more/ThemePage; spec 5 §6): each row carries data-theme, so its tokens are its own theme's ---- */
.theme-list { display: flex; flex-direction: column; gap: 8px; }
.theme-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 16px;
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--panel);
  color: var(--text);
  text-align: left;
  font-size: 17px;
  font-weight: 600;
}
.theme-row.is-current { border: 2px solid var(--accent); padding: 9px 15px; }
.theme-row__swatches { display: flex; gap: 4px; }
.theme-row__swatch { width: 14px; height: 24px; border: 1px solid var(--outline); border-radius: 4px; }
.theme-row__swatch--bg { background: var(--bg); }
.theme-row__swatch--panel { background: var(--panel-2); }
.theme-row__swatch--accent { background: var(--accent); }
.theme-row__text { flex: 1; display: flex; flex-direction: column; }
.theme-row__kind { color: var(--muted); font-size: 13px; font-weight: 400; }
.theme-row__tick { color: var(--accent); font-size: 20px; font-weight: 700; }
```

- [ ] **Step 8: Run the tests to make sure they pass**

Run: `npx vitest run src/ui/router.test.ts src/ui/components/more src/ui/theme.test.ts`
Expected: PASS (router 55, theme.vm 3, ThemePage 7, the other More files unchanged, theme 11).

- [ ] **Step 9: Run the whole suite and the build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; 92 test files, 1330 tests passed; the build writes `dist/` with `sw.js`.

- [ ] **Step 10: Commit**

```bash
git add src/ui/router.ts src/ui/router.test.ts src/ui/components/more/theme.vm.ts src/ui/components/more/theme.vm.test.ts src/ui/components/more/ThemePage.tsx src/ui/components/more/ThemePage.test.tsx src/ui/components/more/MoreTab.tsx src/ui/theme.css
git commit -m "Add the Theme page as a fifth line on More

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, final checks and the PR

Spec 5 §10 and §11: `CLAUDE.md`, the dated pointers in spec 4, then the PR with the device checklist of spec 5 §9.

**Files:**
- Modify: `CLAUDE.md` (Status, Read first, Core rules "UI (spec 4)", Repo layout `src/ui/`)
- Modify: `docs/superpowers/specs/2026-10-10-training-views-design.md` (header Status, U11, §3 "Device-local UI state", §3 "Routing" table, §6 first line, §8 Tokens, §13)

**Interfaces:** none (documentation).

- [ ] **Step 1: Update `CLAUDE.md`**

- **Status** (the paragraph starting `**Status:**`), append: ` Spec 5 (theme picker, 2026-10-18) adds five colour themes chosen per device on More → Theme (meta \`theme\`), applied before the app draws; implemented under \`src/ui/theme.ts\` and the token blocks of \`theme.css\`.`
- **Read first**, after the spec 4 bullet, add: `- [docs/superpowers/specs/2026-10-18-theme-picker-design.md](docs/superpowers/specs/2026-10-18-theme-picker-design.md): **spec 5, the theme picker.** Five themes per device, the token block per theme, the iOS status-bar strip, the contrast test. Plan: [2026-10-18-theme-picker](docs/superpowers/plans/2026-10-18-theme-picker.md), implemented.`
- **Core rules, "UI (spec 4)"**: `Device-local UI state (reference choice, Days chip, last route, the stopped rest counter)` becomes `Device-local UI state (reference choice, Days chip, last route, the stopped rest counter, the theme)`, and `Colours only as tokens in \`src/ui/theme.css\`.` becomes `Colours only as tokens in \`src/ui/theme.css\`, one block per theme (spec 5); every block declares every token, and a test checks completeness and contrast (4.5:1 text, 3:1 calendar dots).`
- **Repo layout, `src/ui/`**: `\`theme.css\` (tokens)` becomes `\`theme.css\` (token blocks per theme), \`theme.ts\` (theme list, apply, start)`, and `more/ (exercise list and history, calendar, bodyweight page and sheet, catalog list and edit page)` becomes `more/ (exercise list and history, calendar, bodyweight page and sheet, catalog list and edit page, theme page)`.

- [ ] **Step 2: Add the dated pointers to spec 4**

- **Header Status**, append: ` Amended on 2026-10-18 by spec 5 (theme picker; approved by the owner on 2026-10-18), marked in place.`
- **U11** row, decision cell, append: ` One block per theme in the same file since spec 5 (amended 2026-10-18, approved by the owner on 2026-10-18).`
- **§3 "Device-local UI state"**, after `` `lastRoute` `` add `, \`theme\` (the chosen theme id; spec 5 §5; amended 2026-10-18, approved by the owner on 2026-10-18)`.
- **§3 "Routing"** table, after the row of the other More screens, add the row `` | `#/more/theme` | Theme page (spec 5 §6; amended 2026-10-18) | ``.
- **§6**, the first line becomes: `A menu of five lines: **Exercises · Calendar · Bodyweight · Catalog · Theme** (Theme added by spec 5 §6; amended 2026-10-18, approved by the owner on 2026-10-18).`
- **§8 Tokens**, append to the bullet: ` Since spec 5 (amended 2026-10-18, approved by the owner on 2026-10-18), \`theme.css\` holds one block per theme (Slate & Amber on \`:root\`), each declaring every token plus \`--status-bar\`, \`--scrim\` and \`--shadow\`; a test checks completeness and contrast (spec 5 §8).`
- **§13**: `a light theme (the token block makes it a later addition);` becomes `a light theme (added by spec 5; amended 2026-10-18, approved by the owner on 2026-10-18);`.

- [ ] **Step 3: Final checks**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; 92 test files, 1330 tests passed; build passes.

Run: `git grep -n "color-mix" -- src/ui/theme.css`
Expected: ten lines, each a `--scrim` or `--shadow` declaration.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-10-training-views-design.md
git commit -m "Record spec 5 in CLAUDE.md and point spec 4 at it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open the PR against `main`**

```bash
git push -u origin feat/theme-picker
```

Open the PR with `gh pr create --base main --title "Theme picker (spec 5)"`. The body holds: a summary (five themes per device, More → Theme, the status-bar strip, the contrast test; no model change, nothing new in Dropbox); the test counts (92 files, 1330 tests); and the **device checklist of spec 5 §9** copied as a numbered list:

1. **Update** the installed iPhone app through the prompt; it opens in Slate & Amber, looking as before.
2. **More** shows the fifth line, "Theme · Slate & Amber". The page lists five rows, each in its own colours, with the tick on Slate & Amber.
3. **Each theme:** tap it; the whole app changes at once, the tick moves, the More line shows the new name. Visit Log, Days, a session page, Calendar, Bodyweight, Catalog and Sync in each.
4. **Status bar** on Daylight, Ultraviolet and Dune: the clock and battery are readable on the dark strip; on the Log tab, cards scrolled up stay under the strip.
5. **A sheet** (load or set sheet) on a light theme: the backdrop dims the page and the sheet stands out.
6. **Restart:** kill and reopen the app on a light theme; it opens in that theme (a brief dark empty screen before it is expected).
7. **PC Chrome:** pick a different theme there; the phone keeps its own.
8. **Gym:** one workout on a light theme; the rest counter, the active tab and the set chips are readable in gym light.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The owner merges. After the merge and before the owner updates the phone, compare the build inputs of the merge commit with the reviewed PR head (`src`, `public`, `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `.github/workflows/deploy.yml`), then walk the owner through the checklist one step at a time.
