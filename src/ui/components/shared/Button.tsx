import type { ComponentChildren, JSX } from 'preact';

/** Spec 4 §8: a 44 px touch target; kind maps to btn--primary / btn--secondary / btn--danger. */
export function Button(p: {
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  onClick(): void;
  children: ComponentChildren;
  ariaLabel?: string;
}): JSX.Element {
  const kind = p.kind ?? 'secondary';
  return (
    <button
      type="button"
      class={`btn btn--${kind}`}
      disabled={p.disabled ?? false}
      aria-label={p.ariaLabel}
      onClick={() => p.onClick()}
    >
      {p.children}
    </button>
  );
}
