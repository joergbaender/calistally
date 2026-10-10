import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createExercise, type NewExerciseFields } from '../../../model/catalog';
import { LOAD_TYPES, PATTERNS } from '../../../model/schema';
import type { Exercise, LoadType, Pattern } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { Button, Sheet } from '../shared';
import { exerciseSearchVm } from './exercise-search.vm';
import { quietOutcome, showHeldBack } from './outcome';

interface Draft {
  name: string;
  pattern: Pattern;
  metric: 'reps' | 'seconds';
  perSide: boolean;
  defaultLoadType: LoadType;
  family: string;
}

/**
 * Spec 4 §4 "Exercises": the catalog search behind "Other exercise…". Picking an entry hands its id
 * to `onPick` (the Log tab adds a block and makes it current). Create writes the catalog first and
 * then hands over the new id, so the catalog upload goes ahead of the session (spec 3 S12). Without
 * a readable catalog, Create is disabled and existing entries can still be picked.
 */
export function ExerciseSearch(p: { onPick(exerciseId: string): Promise<void>; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const query = useSignal('');
  const draft = useSignal<Draft | undefined>(undefined);
  const catalogOk = data.catalog.value !== undefined && !data.refusedRows.value.some((r) => r.path === EXERCISES_PATH);

  const pick = (id: string): void => {
    p.onClose();
    void p.onPick(id);
  };

  const busy = useSignal(false);

  /** One create at a time: a second tap during the catalog write would add a second block. */
  const create = async (d: Draft): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await createOnce(d);
    } finally {
      busy.value = false;
    }
  };

  const createOnce = async (d: Draft): Promise<void> => {
    const name = d.name.trim();
    if (name === '') return;
    const fields: NewExerciseFields = {
      pattern: d.pattern,
      metric: d.metric,
      perSide: d.perSide,
      defaultLoadType: d.defaultLoadType,
      ...(d.family.trim() !== '' ? { family: d.family.trim() } : {}),
    };
    const now = data.clock();
    const before = data.exercises.value;
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

  const d = draft.value;
  if (d !== undefined) {
    return <CreateForm draft={d} busy={busy.value} onChange={(next) => (draft.value = next)} onSubmit={() => void create(d)} onBack={() => (draft.value = undefined)} />;
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
            onClick={() => (draft.value = { name: typed, pattern: 'other', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: '' })}
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

/** The select's value as one of the allowed literals, else the previous value. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

function CreateForm(p: { draft: Draft; busy: boolean; onChange(d: Draft): void; onSubmit(): void; onBack(): void }): JSX.Element {
  const d = p.draft;
  const set = (patch: Partial<Draft>): void => p.onChange({ ...d, ...patch });
  return (
    <Sheet title="New exercise" onClose={p.onBack}>
      <label class="exform__field">
        <span>Name</span>
        <input type="text" autocomplete="off" aria-label="Name" value={d.name} onInput={(e) => set({ name: e.currentTarget.value })} />
      </label>
      <label class="exform__field">
        <span>Pattern</span>
        <select aria-label="Pattern" value={d.pattern} onChange={(e) => set({ pattern: oneOf(PATTERNS, e.currentTarget.value, d.pattern) })}>
          {PATTERNS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Metric</span>
        <select aria-label="Metric" value={d.metric} onChange={(e) => set({ metric: e.currentTarget.value === 'seconds' ? 'seconds' : 'reps' })}>
          <option value="reps">reps</option>
          <option value="seconds">seconds</option>
        </select>
      </label>
      <label class="exform__check">
        <input type="checkbox" checked={d.perSide} onChange={(e) => set({ perSide: e.currentTarget.checked })} />
        <span>Per side</span>
      </label>
      <label class="exform__field">
        <span>Default load</span>
        <select aria-label="Default load" value={d.defaultLoadType} onChange={(e) => set({ defaultLoadType: oneOf(LOAD_TYPES, e.currentTarget.value, d.defaultLoadType) })}>
          {LOAD_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Family</span>
        <input type="text" autocomplete="off" aria-label="Family" placeholder="optional" value={d.family} onInput={(e) => set({ family: e.currentTarget.value })} />
      </label>
      <Button kind="primary" disabled={d.name.trim() === '' || p.busy} onClick={p.onSubmit}>Create exercise</Button>
    </Sheet>
  );
}
