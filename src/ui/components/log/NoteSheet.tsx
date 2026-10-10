import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { Button, Sheet } from '../shared';

/** A one-line text sheet (a set note, a block note); Save hands back the text as typed (edit.ts trims it). */
export function NoteSheet(p: { title: string; value: string; onSave(text: string): void; onClose(): void }): JSX.Element {
  const draft = useSignal(p.value);
  return (
    <Sheet title={p.title} onClose={p.onClose}>
      <input
        class="notesheet__input"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        aria-label="Note"
        value={draft.value}
        onInput={(e) => (draft.value = e.currentTarget.value)}
      />
      <Button kind="primary" onClick={() => p.onSave(draft.value)}>Save</Button>
    </Sheet>
  );
}
