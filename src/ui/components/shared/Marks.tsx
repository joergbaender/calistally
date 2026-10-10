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
