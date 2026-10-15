import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  addBodyweightEntry,
  deleteBodyweightEntry,
  emptyBodyweightFile,
  setBodyweightEntry,
  undeleteBodyweightEntry,
} from '../../../model/edit-bodyweight';
import type { BodyweightEntry, BodyweightFile } from '../../../model/types';
import { BODYWEIGHT_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import type { Data, WriteOutcome } from '../../data';
import { formatAmount, localDate } from '../../format';
import { showToast } from '../../toast';
import { quietWrite, reportWrite, showHeldBack } from '../log/outcome';
import { Button, NumberPad, Sheet, useBusy } from '../shared';
import { bodyweightChanges, bodyweightProblem } from './bodyweight.vm';

const UNDO_MS = 6000;

function editFile(data: Data, fn: (f: BodyweightFile) => BodyweightFile): Promise<WriteOutcome> {
  return data.edit('bodyweight', BODYWEIGHT_PATH, fn);
}

/**
 * Add or edit one bodyweight entry (spec 4 §6): kg through the NumberPad, the date (default
 * today) and a note; in edit mode also Delete with the 6 s Undo toast. Writes create
 * bodyweight.json when it does not exist yet, else edit it. Every write takes its time from
 * `data.clock()`; an edit sends only the fields changed against the values the sheet opened with
 * (so a field another device changed meanwhile is never written back), and nothing at all when none
 * changed.
 */
export function BodyweightSheet(p: { entry?: BodyweightEntry; onClose(): void }): JSX.Element {
  const { data } = useApp();
  // The entry as the sheet opened it: later refreshes of the row do not move the comparison base.
  const [opened] = useState(p.entry);
  const [kg, setKg] = useState<number | undefined>(opened?.kg);
  const [padOpen, setPadOpen] = useState(opened === undefined);
  // The clock, not `now` (which ticks once a minute here and not on resume): today's day.
  const [date, setDate] = useState(() => opened?.date ?? localDate(data.clock()));
  const [note, setNote] = useState(opened?.note ?? '');
  const [newId] = useState(() => crypto.randomUUID());
  /** One write at a time: a second tap on Save or Delete while a write is pending does nothing. */
  const { busy, run: guarded } = useBusy();

  const problem = bodyweightProblem({ kg, date, note }, opened);

  const save = (): Promise<void> => guarded(async () => {
    if (kg === undefined || problem !== undefined) return;
    if (opened !== undefined) {
      const changes = bodyweightChanges({ kg, date, note }, opened);
      if (Object.keys(changes).length === 0) {
        p.onClose();
        return;
      }
      if (await reportWrite(BODYWEIGHT_PATH, () => editFile(data, (f) => setBodyweightEntry(f, opened.id, changes, data.clock())))) p.onClose();
      return;
    }
    const input = { date, kg, note };
    const ok = await reportWrite(BODYWEIGHT_PATH, async () => {
      if (data.bodyweight.value === undefined) {
        const created = await data.create('bodyweight', BODYWEIGHT_PATH, addBodyweightEntry(emptyBodyweightFile(), input, data.clock(), newId).file);
        // The file appeared meanwhile (a pull, another tab): append to it instead.
        if (created.ok || created.reason !== 'changed') return created;
      }
      return editFile(data, (f) => addBodyweightEntry(f, input, data.clock(), newId).file);
    });
    if (ok) p.onClose();
  });

  const remove = (): Promise<void> => guarded(async () => {
    if (opened === undefined) return;
    const written = await quietWrite(BODYWEIGHT_PATH, () => editFile(data, (f) => deleteBodyweightEntry(f, opened.id, data.clock())));
    if (!written.ok) return;
    p.onClose();
    showToast(
      'Entry deleted',
      { label: 'Undo', run: () => void reportWrite(BODYWEIGHT_PATH, () => editFile(data, (f) => undeleteBodyweightEntry(f, opened.id, data.clock()))) },
      UNDO_MS,
    );
    if (written.heldBackNote) showHeldBack();
  });

  const title = opened === undefined ? 'Add entry' : 'Edit entry';
  if (padOpen) {
    // Every way out of the pad (its Cancel, a swipe down, Escape) goes back to the form once there is
    // one to go back to, so a typed note or date is never thrown away. The pad's Cancel is the only one (cancel={false}).
    const leavePad = (): void => (kg === undefined && opened === undefined ? p.onClose() : setPadOpen(false));
    return (
      <Sheet title={title} cancel={false} onClose={leavePad}>
        <p class="bw-sheet__label">Weight in kg</p>
        <NumberPad
          value={kg}
          submitLabel="Use"
          allowZero={false}
          zeroHint="More than 0 kg"
          onSubmit={(v) => { setKg(v); setPadOpen(false); }}
          onCancel={leavePad}
        />
      </Sheet>
    );
  }
  return (
    <Sheet title={title} onClose={p.onClose}>
      <button type="button" class="bw-sheet__kg" aria-label="Weight" onClick={() => setPadOpen(true)}>
        {kg === undefined ? 'kg' : `${formatAmount(kg)} kg`}
      </button>
      <label class="bw-sheet__field">
        <span>Date</span>
        <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
      </label>
      <label class="bw-sheet__field">
        <span>Note</span>
        <input type="text" value={note} autocomplete="off" onInput={(e) => setNote(e.currentTarget.value)} />
      </label>
      {problem !== undefined && <p class="bw-sheet__problem" role="alert">{problem}</p>}
      <div class="bw-sheet__actions">
        {opened !== undefined && <Button kind="danger" disabled={busy.value} onClick={() => void remove()}>Delete</Button>}
        <Button kind="primary" disabled={busy.value || problem !== undefined} onClick={() => void save()}>Save</Button>
      </div>
    </Sheet>
  );
}
