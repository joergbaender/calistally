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
