import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { LOAD_TYPES } from '../../../model/schema';
import type { LoadType } from '../../../model/types';
import { Button, NumberPad, Sheet } from '../shared';

export interface Load {
  loadType: LoadType;
  loadKg: number;
}

/** Spec 4 §4 "Sticky load": the five load types and a kg pad (hidden for bodyweight, which carries 0 kg).
 *  The pad's Use saves a weighted load; bodyweight saves with its own button. */
export function LoadSheet(p: { load: Load; onSave(load: Load): void; onClose(): void }): JSX.Element {
  const type = useSignal<LoadType>(p.load.loadType);
  return (
    <Sheet title="Load" cancel={type.value === 'bodyweight'} onClose={p.onClose}>
      <div class="loadsheet__types" role="group" aria-label="Load type">
        {LOAD_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            class={`loadsheet__type${t === type.value ? ' is-active' : ''}`}
            aria-pressed={t === type.value}
            onClick={() => (type.value = t)}
          >
            {t}
          </button>
        ))}
      </div>
      {type.value === 'bodyweight' ? (
        <Button kind="primary" onClick={() => p.onSave({ loadType: 'bodyweight', loadKg: 0 })}>Save</Button>
      ) : (
        <>
          <div class="loadsheet__caption">kg</div>
          {/* Spec 1 §3: external and band may carry 0 kg; added and assist need a weight. "Use" sets
              the load only: the caller decides whether a set is written. */}
          <NumberPad
            value={p.load.loadKg > 0 ? p.load.loadKg : undefined}
            submitLabel="Use"
            allowZero={type.value === 'external' || type.value === 'band'}
            onSubmit={(kg) => p.onSave({ loadType: type.value, loadKg: kg })}
            onCancel={p.onClose}
          />
        </>
      )}
    </Sheet>
  );
}
