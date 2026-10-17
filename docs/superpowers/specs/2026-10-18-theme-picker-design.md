# Spec 5: Theme picker

- **Date:** 2026-10-18
- **Status:** approved by the owner on 2026-10-18, designed with the owner on 2026-10-17 and 2026-10-18 (the decisions in §2 are the owner's unless marked as the author's call; the author's calls were listed to the owner before the approval).
- **Scope:** a choice of five colour themes on each device, picked on a new page of the More tab. It covers the theme values, how `theme.css` holds them, how the app applies the stored theme at start, the iPhone status bar under a light theme, a contrast test for every theme, and the page itself. **No model change**: every file keeps the shape of spec 1 at `MODEL_VERSION` 1, and the choice never reaches Dropbox.

Builds on [spec 4](2026-10-10-training-views-design.md): U11 (colours are tokens), §3 (device-local UI state in the store's meta), §6 (the More tab), §8 (the token list and the literal-colour test) and §13 (which left "a light theme" out of scope; this spec adds it). Spec 3's rules stand: all reads and writes go through `src/sync/store.ts`, and the service worker update stays prompted.

---

## 1. Purpose and success

Nothing in the gym is broken. The owner wants to try how the app can look: cooler, more interesting, sometimes lighter. Slate & Amber, today's look, stays the default because the owner likes it. The picker is for trying things out, so switching must be instant and costless, and no theme may make the app hard to read in gym light on the iPhone.

Spec 5 is done when:

1. the More tab has a fifth line, **Theme**, opening a page that lists the five themes of §3, each row painted in its own colours;
2. a tap on a row recolours the whole app at once and the choice survives a restart of the installed app, per device;
3. on the iPhone, the clock and battery stay readable on every theme, including the three light ones;
4. the tests of §8 pass in Node, including a contrast test over every theme; the literal-colour test of spec 4 §8 still passes and no component contains a literal colour;
5. the owner has ticked the device checklist of §9 on the iPhone and in PC Chrome.

## 2. Decisions recorded (2026-10-17 and 2026-10-18)

| # | Decision | Alternative rejected |
|---|---|---|
| T1 | **Five themes:** Slate & Amber (today's, the default), Daylight, Berry Night, Ultraviolet, Dune (§3). All five use the colour slots the app has, plus the two of T5 and T6; no patterns, no coloured bars. | Lavender (too weak; Ultraviolet is its stronger form); Lilac Bold; Violet Bars (needs bar tokens); Coyote Night; Desert Pattern (a camo pattern behind the cards: three extra slots and a background rule, for a look the owner got from Dune alone) |
| T2 | **Per device.** The choice is a meta key, like the rest counter and the last route; the phone and the PC may differ. Signing out clears meta (`db.clearAll()`), so the theme falls back to Slate & Amber. | Synced through Dropbox: a new file kind or field, `MODEL_VERSION` 1 → 2 with upgrade steps for every kind, merge, paths and queue changes; and because a write re-stamps a file at the writer's `MODEL_VERSION` (`src/model/read.ts`), a device on the older build would find every file the newer one saved read-only until it updates. All that for a setting changed rarely. |
| T3 | **The stored theme is applied right after the store opens and before anything else** (§5). The app mounts only after the local data is loaded (`src/app/main.tsx`), so the app itself never shows in the wrong theme; on a cold start of a light theme the empty screen may be dark for a moment. | A synchronous copy in `localStorage` with a blocking script in the page (no dark moment, but it bends "device state lives in meta only", spec 4 §3, keeps two copies in step, and needs a separate script file because the page's CSP blocks inline scripts); hiding the app until the theme is read (the app is already hidden until then; the empty screen still needs a colour). Option 2 can be added later without redoing anything. |
| T4 | **Tokens per theme, one file.** `theme.css` keeps every colour. Slate & Amber stays on `:root` and also answers to `[data-theme="slate"]`; every other theme is one `[data-theme="<id>"]` block that declares **every** token (§4). | A second CSS file per theme (the literal-colour test and the token list would have to know them all) |
| T5 | **A status-bar strip token, `--status-bar`.** The installed iPhone app uses `black-translucent`: iOS draws the clock and battery in white over the page. `body::before` already paints a strip behind them; it takes `--status-bar`, equal to `--bg` on the dark themes (no visible change) and a dark shade of the theme's own hue on the light ones. The owner preferred it to the plain light top. | Switching `apple-mobile-web-app-status-bar-style` with the theme (unclear whether iOS honours a change while running or only at launch or install, and `default` changes the layout because the bar stops overlapping the page) |
| T6 | **A scrim and a shadow token, `--scrim` and `--shadow`** (author's call). Today the sheet backdrop and two shadows mix `--bg` (`color-mix(in srgb, var(--bg) 70% / 60%, transparent)`). On a light theme that gives a light veil and shadows that do not show. The dark themes keep exactly today's mixes; the light themes mix their `--text` colour at a lower share (§3). | Leaving the mixes as they are (sheets on the light themes barely separate from the page behind) |
| T7 | **What follows the theme:** `color-scheme` (in each block, so native checkboxes, the date picker and scrollbars match) and `<meta name="theme-color">` (set at start and on every change to the theme's `--status-bar`, read from the computed style, so no colour is written in code; author's call). **What does not:** the manifest's `background_color` and `theme_color`, and the icons; iOS fixes them at install, so following the theme there would mean reinstalling the app. | — |
| T8 | **Contrast is tested**, for every theme, from `theme.css` itself (§8): 4.5:1 where a colour is text, 3:1 for the calendar dots, nothing for the decorative borders (`--outline`, 1.2 to 1.7 against the three surfaces in every theme including today's). Daylight's and Dune's accents are darkened from the first mockups (4.7 and 4.8 → 5.6 and 5.8 on their background) because the rest counter and the active tab are accent text read in gym light; Ultraviolet's accent, ok and danger are darkened to pass on its strong lilac `--panel-2`. | AAA (7:1) for all text: today's grey text on `--panel-2` is 4.9 and would force a change to the theme the owner likes |
| T9 | **The picker is a fifth line on More**, "Theme", with the current theme's name on the right, opening `#/more/theme`: a list, one row per theme, each painted in its own theme with three swatches and its kind; the current row has a tick and an accent border. **A tap applies at once**: no preview step and no OK button, because switching back is one tap and nothing reaches a data file. | Tiles of mini screens in a grid of two (prettier, but smaller targets and harder to read); a line inside the Sync tab |
| T10 | **No randomize** in this version. The owner pictured freshly generated palettes; those need their own readability check before a palette is applied, or the owner could end up unable to find the way out. Picking one of five takes two taps. | A "Surprise me" row; a random theme at each start |
| T11 | **The ↑↓ marks stay in the text colour**, as today (author's call). | Colouring ↑ and ↓ per theme |

## 3. The themes

Ids are stable (they are what meta stores); names and order are as the page shows them. Values are final for the build; the owner may ask for tuning after the device check, and any change must pass §8.

| Token | Slate & Amber `slate` | Daylight `daylight` | Berry Night `berry` | Ultraviolet `ultraviolet` | Dune `dune` |
|---|---|---|---|---|---|
| kind (`color-scheme`) | dark | light | dark | light | light |
| `--bg` | `#111827` | `#f6f7f9` | `#1a1020` | `#f4e6ff` | `#e9dfc8` |
| `--panel` | `#1f2937` | `#ffffff` | `#291a30` | `#ffffff` | `#f6f0e2` |
| `--panel-2` | `#273449` | `#eceff4` | `#36223f` | `#ecd3ff` | `#e2d5b8` |
| `--text` | `#e5e7eb` | `#111827` | `#f5e9f2` | `#2b0a52` | `#2b2216` |
| `--muted` | `#9ca3af` | `#4b5563` | `#bba5bb` | `#6a2f99` | `#5e4f37` |
| `--accent` | `#f59e0b` | `#a14a08` | `#e879f9` | `#a01591` | `#6b4e24` |
| `--ok` | `#34d399` | `#047857` | `#5eead4` | `#04664a` | `#3f6212` |
| `--danger` | `#f87171` | `#b91c1c` | `#ff7a7a` | `#b01a1a` | `#b42318` |
| `--outline` | `#374151` | `#cfd5de` | `#4a3352` | `#dcb6f7` | `#c9b994` |
| `--on-accent` | `#111111` | `#ffffff` | `#1a1020` | `#ffffff` | `#ffffff` |
| `--chip-push` | `var(--accent)` | `var(--accent)` | `var(--accent)` | `var(--accent)` | `var(--accent)` |
| `--chip-pull` | `var(--ok)` | `var(--ok)` | `var(--ok)` | `var(--ok)` | `var(--ok)` |
| `--chip-legs` | `#60a5fa` | `#1d4ed8` | `#93c5fd` | `#1d4ed8` | `#1e4f7a` |
| `--chip-other` | `var(--muted)` | `var(--muted)` | `var(--muted)` | `var(--muted)` | `var(--muted)` |
| `--status-bar` | `var(--bg)` | `#1f2937` | `var(--bg)` | `#4a1477` | `#5a4426` |
| `--scrim` | `color-mix(in srgb, var(--bg) 70%, transparent)` | text-based, light share | as Slate | text-based, light share | text-based, light share |
| `--shadow` | `color-mix(in srgb, var(--bg) 60%, transparent)` | text-based, light share | as Slate | text-based, light share | text-based, light share |

Slate & Amber's values are exactly today's; with `--scrim` and `--shadow` equal to today's mixes, the default theme renders as it does now. For the light themes, `--scrim` and `--shadow` are `color-mix(in srgb, var(--text) N%, transparent)` with N chosen by the builder by eye in the dev server (a starting point: 35% for the scrim, 18% for the shadow) and shown to the owner at the device check.

Contrast as computed while designing (WCAG 2 relative luminance), lowest per theme over the pairs of §8: Slate & Amber 4.54 (danger on `--panel-2`), Daylight 4.76 (ok on `--panel-2`), Berry Night 5.71, Ultraviolet 5.09, Dune 4.52 (danger on `--panel-2`); white on `--status-bar` 9.2 to 18.4; every dot pair above 4.

## 4. `theme.css`

- The header comment changes from "the one token block" to "the token blocks, one per theme (spec 5)".
- `:root, [data-theme="slate"]` holds Slate & Amber, with `color-scheme: dark`. Each other theme is `[data-theme="<id>"] { color-scheme: …; --bg: …; … }` and **declares every token of §3**, including the ones that are only `var()` references. A custom property that refers to another resolves where it is declared, so a row painted in Berry Night inside a Dune page would otherwise inherit Dune's `--chip-push`, `--scrim` and so on.
- The selectors are plain attribute selectors, not `:root[...]`, so any element can carry `data-theme`; the Theme page uses this to paint each row in its own theme (§6).
- The three rules that mix `--bg` today use the new tokens: `.sheet__backdrop { background: var(--scrim) }`, and `box-shadow: 0 -8px 24px var(--shadow)` / `0 8px 24px var(--shadow)` on `.sheet` and the toast.
- `body::before` takes `background: var(--status-bar)`.
- No other rule changes. Components keep referencing tokens only.

## 5. Applying the theme

A small module, `src/ui/theme.ts` (author's call on the name), holds:

- the theme list: `id`, display `name` and `kind` (`'dark' | 'light'`) per theme, in the order of §3. **No colour values**: those live in `theme.css` only;
- `themeIdOr(value: unknown): ThemeId`: a known id, or `'slate'` for anything else (nothing stored, a value from a later version, a malformed value);
- `applyTheme(id, doc = document)`: sets `data-theme` on `<html>` (for every id, `slate` included) and then sets the `content` of `<meta name="theme-color">` to the computed value of `--status-bar` on `<html>`.

**At start** (`src/app/main.tsx`): right after the `Store` is created and before `engine.init()`, read `store.getMeta('theme')`, apply `themeIdOr(value)`, and keep the id in a signal the UI reads (builder's choice where; the plan uses a module signal `currentTheme` in `theme.ts`, as `toast.ts` does for the toast). A failed read applies Slate & Amber and does not stop the start. Nothing else in the start order changes.

**On a tap** (§6): apply the theme and update the signal first, so the change shows at once; then `setMeta('theme', id)`. If the meta write fails, the theme stays for this run and an error toast says "Theme not saved on this device" (author's call); there is no retry.

Other open tabs of the app on the same device (on the PC) pick the change up at their next start; meta changes are not broadcast (author's call).

`index.html` keeps `<meta name="theme-color" content="#111827">` as the value before the script runs (Slate & Amber's `--status-bar`); `apple-mobile-web-app-status-bar-style` stays `black-translucent`. The manifest and icons are unchanged (T7).

## 6. The Theme page

- **More menu:** a fifth line, **Theme**, after Catalog, with the current theme's name right-aligned in `--muted`. Spec 4 §6's "menu of four lines" becomes five (§11).
- **Route:** `#/more/theme`; `MorePage` gains `'theme'` (a page without an id). Back goes to `#/more` (`BackBar`, as the other More pages).
- **Rows**, in the order of §3, one per theme, as a radio group (`role="radiogroup"` on the list, `role="radio"` and `aria-checked` on each row; author's call): each row is a button at least 52 px high (the More menu's line height) carrying `data-theme="<id>"`, so its `--panel`, `--text`, `--muted`, `--outline` and `--accent` are that theme's. It shows three swatches (`--bg`, `--panel-2`, `--accent`, each with an `--outline` border), the name, and under it the kind in `--muted` ("dark · default" for Slate & Amber, "dark" or "light" for the others). The current row has a 2 px `--accent` border and a ✓ in `--accent`.
- **A tap** on a row that is not current applies and stores it (§5); a tap on the current row does nothing. The rows ignore taps while the write is in flight (the shared `useBusy`, as on every write control outside the Log tab).
- The page reads no data file and is available in every state of the app (not connected, read-only files, quarantine).
- A view model, `theme.vm.ts`, turns the theme list and the current id into the rows (name, kind text, current flag) and is tested in Node.

## 7. Error handling

| Case | Behaviour |
|---|---|
| Meta read fails at start | Slate & Amber; the start continues |
| Stored value unknown or malformed | Slate & Amber (`themeIdOr`); the stored value is left alone until the owner picks a theme |
| Meta write fails on a tap | The theme stays for this run; toast "Theme not saved on this device" (4 s, spec 4 §8) |
| Sign out | `db.clearAll()` clears meta and the page reloads; the app starts in Slate & Amber (T2) |

## 8. Testing

Tests come first and run in Node unless marked.

- **Contrast** (`src/ui/theme.test.ts`, new cases): parse `theme.css`, find the Slate & Amber block and the four `[data-theme]` blocks, resolve each token's `var()` references inside its own block, and compute WCAG 2 contrast ratios. For every theme:
  - **≥ 4.5:1** for `--text`, `--muted`, `--accent`, `--ok`, `--danger` each on `--bg`, `--panel` and `--panel-2`; `--on-accent` on `--accent` and on `--danger` (the Sync badge); `#ffffff` (the iOS status-bar text, a fixed value of the test, not a token) on `--status-bar`;
  - **≥ 3:1** for `--chip-push`, `--chip-pull`, `--chip-legs`, `--chip-other` each on `--bg`, `--panel` and `--panel-2`;
  - a failure names the theme, the pair and the ratio.
- **Token completeness:** every block of every theme declares every token of §3, plus `color-scheme`; the theme ids in `theme.css` are exactly the ids of the theme list in `theme.ts`.
- **Literal colours:** spec 4's test is unchanged and still passes; `theme.ts` and the Theme page contain no literal colour. That test skips only files whose names end in `theme.css` or `theme.test.ts`, so a new test under `src/ui` that needs a literal colour (for example the style `applyTheme` reads) lives in a file whose name ends in `theme.test.ts`.
- **`theme.ts`:** `themeIdOr` for every id, `undefined`, an unknown string, a number; `applyTheme` (happy-dom) sets `data-theme` and the `theme-color` meta from the computed `--status-bar` (the test supplies the style).
- **`theme.vm.ts`:** rows in order, kind texts, the current flag, an unknown current id read as Slate & Amber.
- **Router:** `#/more/theme` parses and prints; spec 4's route tests still pass.
- **Components** (happy-dom): the More menu shows the fifth line with the current name; a tap on a row applies the theme (`data-theme` on `<html>` changes), moves the tick and stores `theme` in meta; a tap on the current row writes nothing; a failing meta write keeps the theme and shows the toast.
- **Start:** the meta read and apply before `engine.init()`. If the start sequence is not reachable from a Node test as it stands, the builder keeps the read-and-apply step in a small function that is (author's call), and the start calls it.

## 9. Manual device checklist

The owner does every click; the author walks them through it one step at a time. Before step 1, the author compares the build inputs of the deployed build with the reviewed PR head (`src`, `public`, `index.html`, `package.json`, the lockfile, `vite.config.ts`, `tsconfig.json`, `.github/workflows/deploy.yml`), because the owner does not install unknown code.

1. **Update** the installed iPhone app through the prompt; it opens in Slate & Amber, looking as before.
2. **More** shows the fifth line, "Theme · Slate & Amber". The page lists five rows, each in its own colours, with the tick on Slate & Amber.
3. **Each theme:** tap it; the whole app changes at once, the tick moves, the More line shows the new name. Visit Log, Days, a session page, Calendar, Bodyweight, Catalog and Sync in each.
4. **Status bar** on Daylight, Ultraviolet and Dune: the clock and battery are readable on the dark strip; on the Log tab, cards scrolled up stay under the strip.
5. **A sheet** (load or set sheet) on a light theme: the backdrop dims the page and the sheet stands out.
6. **Restart:** kill and reopen the app on a light theme; it opens in that theme (a brief dark empty screen before it is expected, T3).
7. **PC Chrome:** pick a different theme there; the phone keeps its own.
8. **Gym:** one workout on a light theme; the rest counter, the active tab and the set chips are readable in gym light.

## 10. Deliverables

One plan (written with the writing-plans skill, with full code and tests), one branch, one PR against `main`; the owner merges. The plan covers, in order: the theme module and its tests; the `theme.css` blocks and new tokens with the contrast and completeness tests; the start; the route, the More line and the Theme page with their tests; `CLAUDE.md` (status, the theme rule next to "Colours only as tokens", the meta keys) and the spec 4 pointers of §11; the device checklist in the PR body.

## 11. Amendments to spec 4

Each is a short pointer in spec 4, dated and marked with the owner's approval of this spec:

- **U11 and §8:** the token block becomes one block per theme in the same file, with the added tokens `--status-bar`, `--scrim` and `--shadow` (spec 5 §3, §4).
- **§3 "Device-local UI state":** adds `theme` (the chosen theme id, spec 5 §5).
- **§3 "Routing":** adds `#/more/theme`.
- **§6:** the menu has five lines: Exercises · Calendar · Bodyweight · Catalog · Theme (spec 5 §6).
- **§13:** "a light theme" is no longer out of scope; see spec 5.

## 12. Out of scope

Generated or random palettes (T10; would need a runtime readability check first); syncing the theme between devices (T2); the manifest colours and the icons following the theme (T7); themes with patterns or coloured bars (T1); following the device's light or dark setting automatically; any model change.
