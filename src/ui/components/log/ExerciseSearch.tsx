import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createExercise, findByName, type NewExerciseFields } from '../../../model/catalog';
import type { Exercise } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { Button, ClashSheet, ExerciseForm, Sheet, useBusy } from '../shared';
import { createClash } from '../shared/create-clash';
import { exerciseSearchVm } from './exercise-search.vm';
import { quietOutcome, showHeldBack } from './outcome';

/**
 * Spec 4 §4 "Exercises": the catalog search behind "Other exercise…". Picking an entry hands its id
 * to `onPick` (the Log tab adds a block and makes it current). Create writes the catalog first and
 * then hands over the new id, so the catalog upload goes ahead of the session (spec 3 S12). Without
 * a readable catalog, Create is disabled and existing entries can still be picked.
 */
export function ExerciseSearch(p: { onPick(exerciseId: string): Promise<void>; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const query = useSignal('');
  /** The name the create form opened with; undefined while the search shows. */
  const formName = useSignal<string | undefined>(undefined);
  const catalogOk = data.catalog.value !== undefined && !data.refusedRows.value.some((r) => r.path === EXERCISES_PATH);

  const pick = (id: string): void => {
    p.onClose();
    void p.onPick(id);
  };

  const { busy, run } = useBusy();
  /** A Create that would reuse an entry with another metric or per side, waiting for the owner. */
  const clash = useSignal<{ name: string; fields: NewExerciseFields; existing: Exercise; detail: string } | undefined>(undefined);

  const createOnce = async (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => {
    const now = data.clock();
    const before = data.exercises.value;
    // An archived or deleted entry of that name comes back with its own metric and per side (spec 1
    // §3); when the form asked for others, the owner decides first (spec 4 §4 "Exercises").
    const existing = findByName(before, name);
    if (existing !== undefined && !confirmed) {
      const detail = createClash(existing, fields, { askOnRevive: false });
      if (detail !== undefined) {
        clash.value = { name, fields, existing, detail };
        return;
      }
    }
    const preview = createExercise(name, fields, before, now);
    // An existing live entry needs no write; one that was archived or deleted is revived by the write.
    if (preview.existing && preview.catalog.every((e, i) => e === before[i])) {
      pick(preview.exercise.id);
      return;
    }
    let made: Exercise | undefined;
    const outcome = await data.edit('exercises', EXERCISES_PATH, (f) => {
      const result = createExercise(name, fields, f.exercises, now);
      made = result.exercise;
      return { ...f, exercises: result.catalog };
    });
    const written = quietOutcome(EXERCISES_PATH, outcome);
    if (!written.ok || made === undefined) return;
    p.onClose();
    await p.onPick(made.id);
    // Shown after the block's write, so a toast of that write cannot replace it; it joins that toast.
    if (written.heldBackNote) showHeldBack();
  };

  /** One create at a time: a second tap during the catalog write would add a second block. */
  const create = (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => run(() => createOnce(name, fields, confirmed));

  if (formName.value !== undefined) {
    const pending = clash.value;
    // The clash sheet sits over the form, so Cancel returns to the form with what was typed.
    return (
      <>
        <ExerciseForm
          initialName={formName.value}
          busy={busy.value}
          onSave={(name, fields) => void create(name, fields, false)}
          onCancel={() => (formName.value = undefined)}
        />
        {pending !== undefined && (
          <ClashSheet
            name={pending.existing.name}
            detail={pending.detail}
            busy={busy.value}
            onUse={() => void create(pending.name, pending.fields, true)}
            onCancel={() => (clash.value = undefined)}
          />
        )}
      </>
    );
  }

  const vm = exerciseSearchVm(data.exercises.value, query.value);
  const typed = query.value.trim().replace(/\s+/g, ' ');
  return (
    <Sheet title="Exercise" onClose={p.onClose}>
      <input
        class="exsearch__input"
        type="text"
        autocomplete="off"
        enterkeyhint="search"
        placeholder="Search"
        aria-label="Search exercises"
        value={query.value}
        onInput={(e) => (query.value = e.currentTarget.value)}
      />
      <EntryList entries={vm.live} onPick={pick} />
      {vm.archived.length > 0 && (
        <details class="exsearch__archived">
          <summary>Archived ({vm.archived.length})</summary>
          <EntryList entries={vm.archived} onPick={pick} />
        </details>
      )}
      {vm.canCreate && (
        <div class="exsearch__create">
          <Button
            kind="primary"
            disabled={!catalogOk}
            onClick={() => (formName.value = typed)}
          >
            {`Create “${typed}”`}
          </Button>
          {!catalogOk && <span class="exsearch__reason">catalog not available</span>}
        </div>
      )}
    </Sheet>
  );
}

/** Entries grouped by family (the order exerciseSearchVm gives), a heading per family. */
function EntryList(p: { entries: readonly Exercise[]; onPick(id: string): void }): JSX.Element {
  const rows: JSX.Element[] = [];
  let family: string | undefined | null = null;
  for (const e of p.entries) {
    if (e.family !== family) {
      family = e.family;
      rows.push(<li key={`family:${family ?? ''}`} class="exsearch__family">{family ?? 'Other'}</li>);
    }
    rows.push(
      <li key={e.id}>
        <button type="button" class="exsearch__entry" onClick={() => p.onPick(e.id)}>{e.name}</button>
      </li>,
    );
  }
  return <ul class="exsearch__list">{rows}</ul>;
}
