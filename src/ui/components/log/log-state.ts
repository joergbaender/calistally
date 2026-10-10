import { signal, type Signal } from '@preact/signals';
import type { LoadType } from '../../../model/types';

/** Spec 4 §4 "Current block": the block the owner last started or added a set to (in memory only).
 *  undefined → the last live block of today (logScreenVm's fallback). */
export const currentBlockId: Signal<string | undefined> = signal<string | undefined>(undefined);

/** The open session's reference choice, loaded from meta `reference:<sessionId>` when the open
 *  session changes: a session id, 'none', or undefined (not loaded yet or missing → re-propose). */
export const referenceId: Signal<string | 'none' | undefined> = signal<string | 'none' | undefined>(undefined);

/** The session id whose stored reference `referenceId` holds. A remount of the Log tab for the same
 *  session (a tab switch) shows the cards at once instead of reading the meta key again. */
export const referenceLoadedFor: Signal<string | undefined> = signal<string | undefined>(undefined);

/** What the owner set up for a block's next set and has not added yet: the typed value, the note
 *  and the load wait for Add set instead of being lost on a re-render or a tab switch. */
export interface EntryDraft {
  /** The stepper's value when the owner changed it, with the set number it was typed for. It counts
   *  only while the block's next set number is still that one (`typedValue`): a set added elsewhere
   *  (the session page, a pull) or a delete moves the number on and the proposal shows again. */
  typed?: { amount: number; setNumber: number };
  /** The pending set note. */
  note?: string;
  /** The load chosen on the load button; sticky for the block after Add set. */
  load?: { loadType: LoadType; loadKg: number };
}

/** A draft field set to undefined in a patch is removed. */
export type DraftPatch = { [K in keyof EntryDraft]?: EntryDraft[K] | undefined };

/** The entry area's drafts keyed by block id, in module state so a tab switch (which unmounts the
 *  Log tab) loses nothing. Keyed by block, so a note never carries over to another block. */
export const entryDraft: Signal<Map<string, EntryDraft>> = signal<Map<string, EntryDraft>>(new Map());

export function draftFor(blockId: string): EntryDraft {
  return entryDraft.value.get(blockId) ?? {};
}

/** The typed amount for `setNumber`, or undefined when nothing was typed for that set number. */
export function typedValue(draft: EntryDraft, setNumber: number): number | undefined {
  return draft.typed !== undefined && draft.typed.setNumber === setNumber ? draft.typed.amount : undefined;
}

export function setDraft(blockId: string, patch: DraftPatch): void {
  const next: EntryDraft = { ...draftFor(blockId) };
  for (const key of Object.keys(patch) as (keyof EntryDraft)[]) {
    if (patch[key] === undefined) delete next[key];
  }
  if (patch.typed !== undefined) next.typed = patch.typed;
  if (patch.note !== undefined) next.note = patch.note;
  if (patch.load !== undefined) next.load = patch.load;
  const map = new Map(entryDraft.value);
  if (Object.keys(next).length === 0) map.delete(blockId);
  else map.set(blockId, next);
  entryDraft.value = map;
}

export function clearDraft(blockId: string): void {
  if (!entryDraft.value.has(blockId)) return;
  const map = new Map(entryDraft.value);
  map.delete(blockId);
  entryDraft.value = map;
}
