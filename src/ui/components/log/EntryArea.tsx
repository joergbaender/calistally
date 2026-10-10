import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { addSet, findSet, type SetInput } from '../../../model/edit';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { formatAmount, formatLoad } from '../../format';
import { Button, NumberPad, Sheet, Stepper } from '../shared';
import { LoadSheet, type Load } from './LoadSheet';
import type { CurrentVm } from './log-screen.vm';
import { currentBlockId, draftFor, setDraft, typedValue } from './log-state';
import { NoteSheet } from './NoteSheet';
import { editSession } from './outcome';
import { ADD_SET_MIN_HOLD_MS, useWriteGuard } from './use-write-guard';

/**
 * Spec 4 §4 "Entry area": pinned above the tab bar while a current block exists. The stepper shows
 * the proposal unless the owner changed it; the typed value, the set note and a load chosen on the
 * load button live in the block's draft (`log-state.ts`), so a tab switch loses none of them. After
 * Add set the value and the note go; the chosen load stays for the block. A typed value counts only
 * for the set number it was typed for, so a set added elsewhere brings the proposal back.
 */
export function EntryArea(p: { row: SessionRow; current: CurrentVm }): JSX.Element {
  const { data } = useApp();
  const c = p.current;
  const path = p.row.path;
  const draft = draftFor(c.blockId);

  const sheet = useSignal<'load' | 'note' | 'pad' | undefined>(undefined);
  /** The amount to add once the load sheet saves (a weight was required first). */
  const addAfterLoad = useSignal<number | undefined>(undefined);
  // Add is held while a write runs and until the screen shows its set: a second tap before the
  // set number moves on would add a further set at a proposal the owner never saw. The refresh can
  // land a few ms after the tap, so Add also stays held for a minimum time (a double tap).
  const guard = useWriteGuard((setId) => findSet(p.row.file.session, setId) !== undefined, { minHoldMs: ADD_SET_MIN_HOLD_MS });

  const value = typedValue(draft, c.setNumber) ?? c.proposed;
  const override = draft.load;
  const load: Load = override ?? { loadType: c.load.loadType, loadKg: c.load.loadKg };
  const loadText = override === undefined ? c.loadText : formatLoad(override.loadType, override.loadKg);
  const hasNote = (draft.note ?? '').trim() !== '';

  const add = (amount: number, setLoad: Load): Promise<void> => guard.run(() => addOnce(amount, setLoad));

  /** Writes one set; the id of the set written, or undefined when nothing was written. */
  const addOnce = async (amount: number, setLoad: Load): Promise<string | undefined> => {
    const now = data.clock();
    const blockId = c.blockId;
    const text = (draftFor(blockId).note ?? '').trim();
    const input: SetInput = {
      ...(c.metric === 'reps' ? { reps: amount } : { seconds: amount }),
      loadType: setLoad.loadType,
      loadKg: setLoad.loadKg,
      ...(text !== '' ? { note: text } : {}),
      completedAt: now.toISOString(),
    };
    let added: string | undefined;
    const ok = await editSession(data, path, (f) => {
      const result = addSet(f, blockId, input, now);
      added = result.setId; // a replay on the fresh row makes a new id; the last one is the one written
      return result.file;
    });
    if (!ok) return undefined;
    currentBlockId.value = blockId;
    // The stepper goes back to the proposal and the note is used up; the chosen load stays sticky.
    setDraft(blockId, { typed: undefined, note: undefined });
    return added;
  };

  /** "Add set" and the pad's Add: a weight is required (spec 1 §5) and nothing gives one yet → the
   *  load sheet first, before the block's first write. */
  const requestAdd = (amount: number | undefined): void => {
    if (amount === undefined || guard.held()) return;
    if (override === undefined && c.load.needsKg && c.setNumber === 1) {
      addAfterLoad.value = amount;
      sheet.value = 'load';
      return;
    }
    void add(amount, load);
  };

  const closeSheet = (): void => {
    sheet.value = undefined;
    addAfterLoad.value = undefined;
  };

  const saveLoad = (next: Load): void => {
    setDraft(c.blockId, { load: next });
    const thenAdd = addAfterLoad.value;
    closeSheet();
    if (thenAdd !== undefined) void add(thenAdd, next);
  };

  const blockId = c.blockId;
  return (
    <>
      <div class="entry-spacer" aria-hidden="true" />
      <section class="entry" aria-label="Entry">
        <div class="entry__inner">
          <div class="entry__top">
            {/* Only the name truncates: the set number is the owner's place in the ladder (spec 4 §1). */}
            <span class="entry__what">
              <b class="entry__name">{c.name}</b>{' '}
              <span class="entry__set">· set {c.setNumber}</span>
            </span>
            <button type="button" class="entry__load" onClick={() => (sheet.value = 'load')}>{loadText}</button>
            <button type="button" class={`entry__note${hasNote ? ' is-set' : ''}`} onClick={() => (sheet.value = 'note')}>note</button>
          </div>
          <Stepper
            value={value}
            step={c.step}
            min={1}
            onChange={(v) => setDraft(blockId, { typed: v === undefined ? undefined : { amount: v, setNumber: c.setNumber } })}
            onOpenPad={() => (sheet.value = 'pad')}
          />
          <Button kind="primary" disabled={value === undefined || guard.held()} onClick={() => requestAdd(value)}>
            {value === undefined ? 'Add set' : `Add set · ${formatAmount(value)}`}
          </Button>
        </div>
      </section>

      {sheet.value === 'load' && <LoadSheet load={load} onSave={saveLoad} onClose={closeSheet} />}
      {sheet.value === 'note' && (
        <NoteSheet
          title="Set note"
          value={draft.note ?? ''}
          onSave={(text) => {
            setDraft(blockId, { note: text.trim() === '' ? undefined : text });
            closeSheet();
          }}
          onClose={closeSheet}
        />
      )}
      {sheet.value === 'pad' && (
        <Sheet title="Amount" cancel={false} onClose={closeSheet}>
          <NumberPad
            value={value}
            submitLabel="Add"
            allowZero={false}
            onSubmit={(v) => {
              // Kept as the stepper's value too, so a cancelled load sheet does not lose it.
              setDraft(blockId, { typed: { amount: v, setNumber: c.setNumber } });
              closeSheet();
              requestAdd(v);
            }}
            onCancel={closeSheet}
          />
        </Sheet>
      )}
    </>
  );
}
