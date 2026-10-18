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
