import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { deleteBlock, findBlock, moveBlock, setBlockNote, undeleteBlock } from '../../../model/edit';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { showToast } from '../../toast';
import { Button, Sheet, useBusy } from '../shared';
import { clearDraft, currentBlockId } from './log-state';
import { editSession, editSessionQuiet, showHeldBack } from './outcome';

/**
 * Spec 4 §4: a card's exercise name opens this sheet: block note, "Make current", "Delete block" (Undo toast).
 * Spec 4 §5: the session page passes `move` and gets "Move up" / "Move down" (`moveBlock`) in place of
 * "Make current"; a direction the block cannot go is disabled.
 */
export function BlockSheet(p: { row: SessionRow; blockId: string; name: string; move?: { up: boolean; down: boolean }; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const path = p.row.path;
  const blockId = p.blockId;
  const block = findBlock(p.row.file.session, blockId);
  // Initialised once: a re-render from a pull never loses what was typed (spec 4 §8).
  const note = useSignal(block?.note ?? '');
  // The note as the sheet opened with it: a note another device wrote meanwhile is never written
  // back over when the owner did not change it here.
  const openedNote = useRef(block?.note ?? '');
  /** One write at a time: a second tap while the first is pending would move the
   *  block twice, write the note twice or re-stamp the tombstone. */
  const { busy, run: guarded } = useBusy();

  const move = (direction: 'up' | 'down'): Promise<void> =>
    guarded(async () => {
      const now = data.clock();
      if (await editSession(data, path, (f) => moveBlock(f, blockId, direction, now))) p.onClose();
    });

  const saveNote = (): Promise<void> =>
    guarded(async () => {
      const text = note.value;
      // setBlockNote trims and drops a blank note; an unchanged note writes nothing (no updatedAt bump).
      if (text.trim() === openedNote.current.trim()) {
        p.onClose();
        return;
      }
      const now = data.clock();
      if (await editSession(data, path, (f) => setBlockNote(f, blockId, text, now))) p.onClose();
    });

  const makeCurrent = (): void => {
    currentBlockId.value = blockId;
    p.onClose();
  };

  const remove = (): Promise<void> => guarded(removeOnce);

  const removeOnce = async (): Promise<void> => {
    const now = data.clock();
    const written = await editSessionQuiet(data, path, (f) => deleteBlock(f, blockId, now));
    if (!written.ok) return;
    if (currentBlockId.value === blockId) currentBlockId.value = undefined;
    clearDraft(blockId);
    p.onClose();
    showToast(
      `${p.name} deleted`,
      { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteBlock(f, blockId, data.clock())) },
      6000,
    );
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  };

  return (
    <Sheet title={p.name} onClose={p.onClose}>
      {block === undefined || block.deletedAt !== undefined ? (
        <p class="blocksheet__gone">This block is no longer there.</p>
      ) : (
        <>
          <input
            class="blocksheet__note"
            type="text"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="Block note"
            aria-label="Block note"
            value={note.value}
            onInput={(e) => (note.value = e.currentTarget.value)}
          />
          <Button disabled={busy.value} onClick={() => void saveNote()}>Save note</Button>
          {p.move === undefined ? (
            <Button onClick={makeCurrent}>Make current</Button>
          ) : (
            <>
              <Button disabled={!p.move.up || busy.value} onClick={() => void move('up')}>Move up</Button>
              <Button disabled={!p.move.down || busy.value} onClick={() => void move('down')}>Move down</Button>
            </>
          )}
          <Button kind="danger" disabled={busy.value} onClick={() => void remove()}>Delete block</Button>
        </>
      )}
    </Sheet>
  );
}
