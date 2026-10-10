import type { ComponentChildren, JSX } from 'preact';

/** A page header with a back button, the title and an optional right slot. */
export function BackBar(p: { title: string; onBack(): void; right?: ComponentChildren }): JSX.Element {
  return (
    <header class="backbar">
      <button type="button" class="backbar__back" aria-label="Back" onClick={() => p.onBack()}>‹</button>
      <h1 class="backbar__title">{p.title}</h1>
      <div class="backbar__right">{p.right}</div>
    </header>
  );
}
