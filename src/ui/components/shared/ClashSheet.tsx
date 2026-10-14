import type { JSX } from 'preact';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * Spec 1 §3 / spec 4 §6: "An exercise named “X” exists". Offers the existing entry (Use it) instead
 * of saving a name twice; the sheet's Cancel (or a swipe down, or Escape) goes back to the form with
 * what was typed. Used by the rename on the edit page and by Create in the catalog and in the exercise
 * search (the Log tab and the session page).
 */
export function ClashSheet(p: { name: string; detail: string; busy: boolean; onUse(): void; onCancel(): void }): JSX.Element {
  return (
    <Sheet title={`An exercise named “${p.name}” exists`} onClose={p.onCancel}>
      <p class="clash__detail">{p.detail}</p>
      <Button kind="primary" disabled={p.busy} onClick={p.onUse}>Use it</Button>
    </Sheet>
  );
}
