import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { amountOf, liveSets, metricOf, proposedAmount, stepFor, stickyLoad } from '../../../model/derive';
import { addSet, deleteSet, findBlock, findSet, setSetFields, undeleteSet, type SetFields, type SetInput } from '../../../model/edit';
import type { Block, Exercise, WorkoutSet } from '../../../model/types';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { formatAmount, formatLoad } from '../../format';
import { showToast } from '../../toast';
import { Button, NumberPad, Sheet, Stepper } from '../shared';
import { LoadSheet, type Load } from './LoadSheet';
import { editSession, editSessionQuiet, showHeldBack } from './outcome';

/**
 * Spec 4 §4 "set sheet". Edit (`setId`, a tap on a today chip): stepper, load, note, Save
 * (`setSetFields`, only the fields that changed, never completedAt) and Delete with an Undo toast.
 * Create (`blockId` + `create`, the session page's late entries): the same fields and "Add set";
 * `timed` decides whether the new set carries `completedAt` (only the Log tab's sets are timed).
 */
export type SetSheetProps = { row: SessionRow; onClose(): void } & ({ setId: string } | { blockId: string; create: true; timed: boolean });

interface Target {
  block: Block;
  set: WorkoutSet | undefined; // undefined in create mode
  metric: 'reps' | 'seconds';
  exercise: Exercise | undefined;
}

function metricFor(block: Block, exercise: Exercise | undefined): 'reps' | 'seconds' {
  const first = liveSets(block)[0];
  if (first !== undefined) return metricOf(first);
  return exercise?.metric ?? 'reps';
}

export function SetSheet(p: SetSheetProps): JSX.Element {
  const { data } = useApp();
  const session = p.row.file.session;
  const catalog = data.exerciseById.value;
  let target: Target | undefined;
  if ('setId' in p) {
    const found = findSet(session, p.setId);
    if (found !== undefined && found.set.deletedAt === undefined) {
      target = { block: found.block, set: found.set, metric: metricOf(found.set), exercise: catalog.get(found.block.exerciseId) };
    }
  } else {
    const block = findBlock(session, p.blockId);
    if (block !== undefined && block.deletedAt === undefined) {
      const exercise = catalog.get(block.exerciseId);
      target = { block, set: undefined, metric: metricFor(block, exercise), exercise };
    }
  }
  if (target === undefined) {
    return (
      <Sheet title="Set" onClose={p.onClose}>
        <p class="setsheet__gone">This set is no longer there.</p>
      </Sheet>
    );
  }
  return <SetForm {...p} target={target} />;
}

function SetForm(p: SetSheetProps & { target: Target }): JSX.Element {
  const { data } = useApp();
  const { block, set, metric } = p.target;
  const path = p.row.path;
  const sticky = stickyLoad(block, undefined, p.target.exercise);

  // The values the sheet opened with, kept once. Save sends only what differs from them, so a field
  // another device changed while the sheet was open is never written back.
  const opened = useRef<{ amount: number | undefined; load: Load; note: string }>({
    amount: set === undefined ? proposedAmount(block, undefined) : amountOf(set),
    load: set === undefined ? { loadType: sticky.loadType, loadKg: sticky.loadKg } : { loadType: set.loadType, loadKg: set.loadKg },
    note: set?.note ?? '',
  });
  // Initialised once: a re-render from a pull never loses what was typed (spec 4 §8).
  const amount = useSignal<number | undefined>(opened.current.amount);
  const load = useSignal<Load>(opened.current.load);
  const loadChosen = useSignal(false);
  const note = useSignal(opened.current.note);
  const sub = useSignal<'load' | 'pad' | undefined>(undefined);
  const saveAfterLoad = useSignal(false);
  const busy = useSignal(false);

  const closeSub = (): void => {
    sub.value = undefined;
    saveAfterLoad.value = false;
  };

  /** One write at a time: a second tap while a write is pending does nothing (it would write twice,
   *  since Data.edit replays on the fresh row). */
  const guarded = async (write: () => Promise<void>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const saveEdit = (current: WorkoutSet, value: number): Promise<void> => guarded(async () => {
    const l = load.value;
    const text = note.value.trim();
    const was = opened.current;
    const fields: SetFields = {
      ...(value !== was.amount ? (metric === 'reps' ? { reps: value } : { seconds: value }) : {}),
      ...(l.loadType !== was.load.loadType || l.loadKg !== was.load.loadKg ? { loadType: l.loadType, loadKg: l.loadKg } : {}),
      ...(text !== was.note.trim() ? { note: text === '' ? null : text } : {}),
    };
    if (Object.keys(fields).length === 0) {
      p.onClose();
      return;
    }
    const now = data.clock();
    if (await editSession(data, path, (f) => setSetFields(f, current.id, fields, now))) p.onClose();
  });

  const saveNew = (value: number, l: Load): Promise<void> => guarded(async () => {
    if ('setId' in p) return;
    const now = data.clock();
    const text = note.value.trim();
    const input: SetInput = {
      ...(metric === 'reps' ? { reps: value } : { seconds: value }),
      loadType: l.loadType,
      loadKg: l.loadKg,
      ...(text !== '' ? { note: text } : {}),
      ...(p.timed ? { completedAt: now.toISOString() } : {}),
    };
    const blockId = block.id;
    if (await editSession(data, path, (f) => addSet(f, blockId, input, now).file)) p.onClose();
  });

  const onSave = (): void => {
    const value = amount.value;
    if (value === undefined) return;
    if (set !== undefined) {
      void saveEdit(set, value);
      return;
    }
    // Same rule as the entry area: a weight is required and nothing gives one yet.
    if (sticky.needsKg && !loadChosen.value) {
      saveAfterLoad.value = true;
      sub.value = 'load';
      return;
    }
    void saveNew(value, load.value);
  };

  const onDelete = (current: WorkoutSet): Promise<void> => guarded(async () => {
    const now = data.clock();
    const setId = current.id;
    const written = await editSessionQuiet(data, path, (f) => deleteSet(f, setId, now));
    if (!written.ok) return;
    p.onClose();
    showToast(
      `Set ${formatAmount(amountOf(current))} deleted`,
      { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteSet(f, setId, data.clock())) },
      6000,
    );
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  });

  if (sub.value === 'load') {
    return (
      <LoadSheet
        load={load.value}
        onSave={(l) => {
          load.value = l;
          loadChosen.value = true;
          const thenSave = saveAfterLoad.value;
          closeSub();
          if (thenSave && amount.value !== undefined) void saveNew(amount.value, l);
        }}
        onClose={closeSub}
      />
    );
  }
  if (sub.value === 'pad') {
    return (
      <Sheet title="Amount" onClose={closeSub}>
        <NumberPad
          value={amount.value}
          submitLabel="Use"
          allowZero={false}
          onSubmit={(v) => {
            amount.value = v;
            closeSub();
          }}
          onCancel={closeSub}
        />
      </Sheet>
    );
  }

  // Spec 4 §5: a migrated aggregate set takes a note or a Delete only (edit.ts refuses amount and load changes).
  const aggregate = set?.aggregate === true;
  return (
    <Sheet title={set === undefined ? 'New set' : 'Set'} onClose={p.onClose}>
      {aggregate && set !== undefined ? (
        <p class="setsheet__aggregate">{`${formatAmount(amountOf(set))} total, set count unknown`}</p>
      ) : (
        <>
          <Stepper value={amount.value} step={stepFor(metric)} min={1} onChange={(v) => (amount.value = v)} onOpenPad={() => (sub.value = 'pad')} />
          <div class="setsheet__row">
            <span class="setsheet__label">Load</span>
            <button type="button" class="setsheet__load" onClick={() => (sub.value = 'load')}>
              {formatLoad(load.value.loadType, load.value.loadKg)}
            </button>
          </div>
        </>
      )}
      <input
        class="setsheet__note"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="Note"
        aria-label="Note"
        value={note.value}
        onInput={(e) => (note.value = e.currentTarget.value)}
      />
      <div class="setsheet__actions">
        {set !== undefined && (
          <Button kind="danger" disabled={busy.value} onClick={() => void onDelete(set)}>Delete</Button>
        )}
        <Button kind="primary" disabled={amount.value === undefined || busy.value} onClick={onSave}>
          {set === undefined ? 'Add set' : 'Save'}
        </Button>
      </div>
    </Sheet>
  );
}
