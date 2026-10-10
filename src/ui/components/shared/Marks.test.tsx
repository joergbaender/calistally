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
