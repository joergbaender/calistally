import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import type { NewExerciseFields } from '../../../model/catalog';
import { LOAD_TYPES, PATTERNS } from '../../../model/schema';
import type { LoadType, Pattern } from '../../../model/types';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface Draft {
  name: string;
  pattern: Pattern;
  metric: 'reps' | 'seconds';
  perSide: boolean;
  defaultLoadType: LoadType;
  family: string;
}

/** The select's value as one of the allowed literals, else the previous value. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

/**
 * Spec 4 §4 / §6: the short create form shared by the Log tab's search and the catalog's Create:
 * name (prefilled), pattern, metric (reps), per side (off), default load type (bodyweight) and an
 * optional family, in a sheet titled "New exercise". It only collects the fields; the caller writes
 * (and guards against a second tap while its write runs). `busy` disables Create exercise while the
 * caller's write runs.
 */
export function ExerciseForm(p: { initialName: string; busy?: boolean; onSave(name: string, fields: NewExerciseFields): void; onCancel(): void }): JSX.Element {
  const draft = useSignal<Draft>({ name: p.initialName, pattern: 'other', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight', family: '' });
  const d = draft.value;
  const set = (patch: Partial<Draft>): void => {
    draft.value = { ...draft.value, ...patch };
  };
  const name = d.name.trim();
  const submit = (): void => {
    if (name === '') return;
    const family = d.family.trim();
    p.onSave(name, {
      pattern: d.pattern,
      metric: d.metric,
      perSide: d.perSide,
      defaultLoadType: d.defaultLoadType,
      ...(family !== '' ? { family } : {}),
    });
  };
  return (
    <Sheet title="New exercise" onClose={p.onCancel}>
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
      <Button kind="primary" disabled={name === '' || p.busy === true} onClick={submit}>Create exercise</Button>
    </Sheet>
  );
}
