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
