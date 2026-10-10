import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Button } from './Button';

/** A downward swipe on the title bar longer than this closes the sheet (spec 4 §8). */
export const SWIPE_CLOSE_PX = 80;

/**
 * Spec 4 §8: a bottom sheet with a title, the content and a Cancel button. It slides up (theme.css),
 * closes on a swipe down on its title bar, on Cancel and on Escape (the dialog takes focus on mount).
 * A tap on the backdrop does nothing: a stray tap must never discard a half-entered load or note.
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
    <div class="sheet__backdrop">
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
