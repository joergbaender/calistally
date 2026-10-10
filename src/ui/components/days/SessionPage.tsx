import type { JSX } from 'preact';

/** Stub: the session page (spec 4 §5) replaces it in task 11. */
export function SessionPage(p: { sessionId: string }): JSX.Element {
  return (
    <section class="placeholder">
      <h2>Session</h2>
      <p>{p.sessionId}</p>
    </section>
  );
}
