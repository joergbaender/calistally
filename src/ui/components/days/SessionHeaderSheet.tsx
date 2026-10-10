import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { setSessionFields, type SessionFields } from '../../../model/edit';
import { SESSION_LABELS } from '../../../model/schema';
import type { SessionLabel } from '../../../model/types';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { formatLabel } from '../../format';
import { showToast } from '../../toast';
import { Button, Sheet } from '../shared';
import { editSessionQuiet, HELD_BACK_TEXT, showHeldBack } from '../log/outcome';
import { notesChanged } from './session-page.vm';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function labelOf(value: string): SessionLabel | undefined {
  return SESSION_LABELS.find((l) => l === value);
}

/**
 * Spec 4 §5 header: date, the "date is exact" switch (only on a `dateUncertain` session), label and
 * notes. Save writes only the fields the owner changed, compared with the values the sheet opened
 * with (never with the refreshed row, so a field another device changed meanwhile is not written
 * back), through `setSessionFields`, which touches the session record only. The file
 * keeps its name when the date changes (spec 1 D12); a toast says so.
 */
export function SessionHeaderSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const s = p.row.file.session;
  const path = p.row.path;
  // The session as the sheet opened: the baseline of every comparison.
  const opened = useRef({ date: s.date, label: s.label, notes: s.notes });
  // Initialised once: a re-render from a pull never loses what was typed (spec 4 §8).
  const date = useSignal(s.date);
  const exact = useSignal(false);
  const label = useSignal<string>(s.label ?? '');
  const notes = useSignal(s.notes ?? '');
  /** Notes go into the write only when the owner typed in them (a migrated note keeps its whitespace). */
  const notesEdited = useSignal(false);
  const busy = useSignal(false);

  const save = async (): Promise<void> => {
    if (busy.value) return;
    const d = date.value.trim();
    if (!DATE_RE.test(d)) {
      showToast('Enter a date');
      return;
    }
    const nextLabel = labelOf(label.value);
    const text = notes.value;
    const was = opened.current;
    const fields: SessionFields = {
      ...(d !== was.date ? { date: d } : {}),
      ...(s.dateUncertain === true && exact.value ? { dateExact: true as const } : {}),
      ...(nextLabel !== was.label ? { label: nextLabel ?? null } : {}),
      // setSessionFields trims and removes a blank text.
      ...(notesEdited.value && notesChanged(was.notes, text) ? { notes: text } : {}),
    };
    if (Object.keys(fields).length === 0) {
      p.onClose();
      return;
    }
    busy.value = true;
    try {
      const now = data.clock();
      const written = await editSessionQuiet(data, path, (f) => setSessionFields(f, fields, now));
      if (!written.ok) return;
      p.onClose();
      if (fields.date !== undefined) {
        showToast('The file keeps its old name');
        if (written.heldBackNote) showHeldBack();
      } else if (written.heldBackNote) {
        showToast(HELD_BACK_TEXT);
      }
    } finally {
      busy.value = false;
    }
  };

  return (
    <Sheet title="Session" onClose={p.onClose}>
      <label class="sessionsheet__field">
        <span>Date</span>
        <input type="date" aria-label="Date" value={date.value} onInput={(e) => (date.value = e.currentTarget.value)} />
      </label>
      {s.dateUncertain === true && (
        <label class="sessionsheet__switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Date is exact"
            checked={exact.value}
            onChange={(e) => (exact.value = e.currentTarget.checked)}
          />
          <span>Date is exact</span>
        </label>
      )}
      <label class="sessionsheet__field">
        <span>Label</span>
        <select aria-label="Label" value={label.value} onChange={(e) => (label.value = e.currentTarget.value)}>
          <option value="">none</option>
          {SESSION_LABELS.map((l) => <option key={l} value={l}>{formatLabel(l)}</option>)}
        </select>
      </label>
      <label class="sessionsheet__field">
        <span>Notes</span>
        <textarea
          aria-label="Notes"
          rows={4}
          value={notes.value}
          onInput={(e) => {
            notes.value = e.currentTarget.value;
            notesEdited.value = true;
          }}
        />
      </label>
      <Button kind="primary" disabled={busy.value} onClick={() => void save()}>Save</Button>
    </Sheet>
  );
}
