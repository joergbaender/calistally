import type { JSX } from 'preact';

/** Plan 4a: the More tab is a menu placeholder; its screens come with plan 4b. */
export function MoreTab(): JSX.Element {
  return (
    <section class="placeholder">
      <h2>More</h2>
      <p>Exercises, calendar, bodyweight and catalog come with plan 4b.</p>
    </section>
  );
}
