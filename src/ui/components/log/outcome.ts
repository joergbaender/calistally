import { EditError } from '../../../model/edit';
import type { SessionFile } from '../../../model/types';
import { BODYWEIGHT_PATH, EXERCISES_PATH } from '../../../sync/paths';
import type { Data, WriteOutcome } from '../../data';
import { noteHeldBack } from '../../held-back';
import { showToast, toast } from '../../toast';

export const HELD_BACK_TEXT = 'Saved here, not uploaded (app bug)';

/** A refusal in plain words: 'missing' (no ok row at the path) is not a read-only file. */
function refusalText(path: string, reason: Exclude<WriteOutcome, { ok: true }>['reason']): string {
  if (reason === 'changed') return 'Changed elsewhere, try again';
  if (reason === 'missing') {
    if (path === EXERCISES_PATH) return 'The exercise catalog is not here yet';
    if (path === BODYWEIGHT_PATH) return 'The bodyweight log is not here yet';
    return 'This session no longer exists';
  }
  return `This file is read-only (${reason})`;
}

/** A write's result for a caller that shows a toast of its own right after it (an Undo toast, or a
 *  second write): `heldBackNote` is true when this path's once-only held-back note is still owed. */
export type Written = { ok: false } | { ok: true; heldBackNote: boolean };

/** Spec 4 §9: refusals become a toast at once; a first held-back write is only reported back, so the
 *  caller can fold the note into its own toast with `showHeldBack` instead of having it replaced. */
export function quietOutcome(path: string, outcome: WriteOutcome): Written {
  if (outcome.ok) return { ok: true, heldBackNote: outcome.heldBack && noteHeldBack(path) };
  showToast(refusalText(path, outcome.reason));
  return { ok: false };
}

/** The held-back note. A toast already showing (an Undo, an error) keeps its action and time and
 *  carries the note after its own text, so neither message replaces the other. */
export function showHeldBack(): void {
  const current = toast.value;
  if (current === undefined) {
    showToast(HELD_BACK_TEXT);
    return;
  }
  if (current.text.includes(HELD_BACK_TEXT)) return;
  toast.value = { ...current, text: `${current.text} · ${HELD_BACK_TEXT}` };
}

/** Spec 4 §9: the toasts for a write's outcome. True when the write went through (held back or not). */
export function reportOutcome(path: string, outcome: WriteOutcome): boolean {
  const written = quietOutcome(path, outcome);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}

/** One session edit through Data.edit with the toasts of `quietOutcome`, and an EditError from `fn`
 *  shown as a toast with its message. */
export async function editSessionQuiet(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<Written> {
  try {
    return quietOutcome(path, await data.edit('session', path, fn));
  } catch (e) {
    if (e instanceof EditError) {
      showToast(e.message);
      return { ok: false };
    }
    throw e;
  }
}

/** One session edit through Data.edit: the outcome toasts of reportOutcome, and an EditError from
 *  `fn` shown as a toast with its message. True when the write went through. */
export async function editSession(data: Pick<Data, 'edit'>, path: string, fn: (file: SessionFile) => SessionFile): Promise<boolean> {
  const written = await editSessionQuiet(data, path, fn);
  if (written.ok && written.heldBackNote) showToast(HELD_BACK_TEXT);
  return written.ok;
}
