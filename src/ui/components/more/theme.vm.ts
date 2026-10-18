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
