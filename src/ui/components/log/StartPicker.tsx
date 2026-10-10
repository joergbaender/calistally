import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { EditError, startSession } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { sessionPath } from '../../../sync/paths';
import { useApp } from '../../context';
import { formatTime, localDate } from '../../format';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { currentBlockId, entryDraft, referenceId, referenceLoadedFor } from './log-state';
import { reportOutcome } from './outcome';
import { startPickerVm } from './start-picker.vm';

/** Spec 4 §4 "Start": the one button of the Log tab without an open session. */
export function StartPicker(): JSX.Element {
  const picking = useSignal(false);
  return (
    <section class="log-start">
      <Button kind="primary" onClick={() => (picking.value = true)}>Start session</Button>
      {picking.value && <PickerSheet mode="start" onClose={() => (picking.value = false)} />}
    </section>
  );
}

/**
 * The "Train against" sheet. `start` writes a new session file and then stores the choice;
 * `change` (the header's "vs … ▾") stores the choice for `sessionId` only.
 */
export function PickerSheet(p: { mode: 'start' | 'change'; sessionId?: string; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const vm = startPickerVm(data.liveSessions.value, data.exerciseById.value, p.mode === 'change' ? p.sessionId : undefined);

  const start = async (choice: string): Promise<void> => {
    const open = data.openSession.value?.file.session;
    if (open?.startedAt !== undefined && !window.confirm(`A session from ${formatTime(open.startedAt)} is still open. Start a new one anyway?`)) {
      p.onClose();
      return;
    }
    const now = data.clock();
    let file: SessionFile;
    try {
      file = startSession(now, localDate(now));
    } catch (e) {
      if (e instanceof EditError) {
        showToast(e.message);
        return;
      }
      throw e;
    }
    const path = sessionPath(file.session.date, file.session.id);
    // The choice is stored before the file exists, so the Log tab's read of it (when the new
    // session's row arrives) never finds it missing and never shows the proposal first.
    await data.setMeta(`reference:${file.session.id}`, choice);
    if (!reportOutcome(path, await data.create('session', path, file))) return;
    referenceId.value = choice;
    referenceLoadedFor.value = file.session.id;
    currentBlockId.value = undefined;
    entryDraft.value = new Map();
    p.onClose();
  };

  const change = async (choice: string): Promise<void> => {
    if (p.sessionId !== undefined) {
      await data.setMeta(`reference:${p.sessionId}`, choice);
      referenceId.value = choice;
    }
    p.onClose();
  };

  // Busy while a start runs: a second tap would write a second session file (an
  // empty one closed at once by the other, left on the Days list and in Dropbox).
  const busy = useSignal(false);
  const choose = async (choice: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await (p.mode === 'start' ? start(choice) : change(choice));
    } finally {
      busy.value = false;
    }
  };

  return (
    <Sheet title="Train against" onClose={p.onClose}>
      <ul class="picker">
        {vm.rows.map((r) => (
          <li key={r.sessionId}>
            <button
              type="button"
              class={`picker__row${r.proposed ? ' is-proposed' : ''}`}
              disabled={busy.value}
              onClick={() => void choose(r.sessionId)}
            >
              <span class="picker__head">
                <span class="picker__title">{r.title}</span>
                {r.label !== undefined && <span class="picker__label">{r.label}</span>}
                {r.proposed && <span class="picker__tag">proposed</span>}
              </span>
              <span class="picker__exercises">{r.exercises}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" class="picker__row picker__none" disabled={busy.value} onClick={() => void choose('none')}>
            No reference
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
