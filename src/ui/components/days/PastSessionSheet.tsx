import { signal, useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createPastSession, EditError } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { sessionPath } from '../../../sync/paths';
import { useApp } from '../../context';
import type { WriteOutcome } from '../../data';
import { localDate } from '../../format';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { reportOutcome } from '../log/outcome';

/**
 * The id of the session this device created last. `data.create` returns before the store's change
 * refreshes the signals, so the session page treats "no row yet" for this id as loading, not missing.
 */
export const justCreated = signal<string | undefined>(undefined);

/** Spec 4 §5 "New past session": a date (default today, local) → createPastSession (no startedAt), write, open its page. */
export function PastSessionSheet(p: { onClose(): void }): JSX.Element {
  const { data, router } = useApp();
  const date = useSignal(localDate(data.clock()));
  const busy = useSignal(false);

  async function create(): Promise<void> {
    if (busy.value) return;
    let file: SessionFile;
    try {
      file = createPastSession(date.value, data.clock());
    } catch (e) {
      if (e instanceof EditError) {
        showToast('Pick a valid date.');
        return;
      }
      throw e;
    }
    const path = sessionPath(file.session.date, file.session.id);
    busy.value = true;
    let outcome: WriteOutcome;
    try {
      outcome = await data.create('session', path, file);
    } catch (e) {
      // An IndexedDB failure: nothing was saved; the sheet stays open for another try.
      showToast(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      busy.value = false;
    }
    // The shared toasts of spec 4 §9: a refusal named in plain words, the held-back note once per path.
    if (!reportOutcome(path, outcome)) return;
    justCreated.value = file.session.id;
    p.onClose();
    router.navigate({ tab: 'days', sessionId: file.session.id });
  }

  return (
    <Sheet title="Add past session" onClose={p.onClose}>
      <label class="past-session__field">
        <span class="past-session__label">Date</span>
        <input
          class="past-session__date"
          type="date"
          value={date.value}
          onInput={(e) => { date.value = e.currentTarget.value; }}
        />
      </label>
      <Button kind="primary" disabled={busy.value} onClick={() => { void create(); }}>Create</Button>
    </Sheet>
  );
}
