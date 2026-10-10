import { useSignal, type Signal } from '@preact/signals';

/**
 * One write at a time (spec 4 §8): `run` ignores a call while an earlier one is pending, sets `busy`
 * synchronously before the first await and clears it when the work settles, even after a rejection.
 * Bind a control's `disabled` to `busy.value`.
 */
export function useBusy(): { busy: Signal<boolean>; run(work: () => Promise<unknown>): Promise<void> } {
  const busy = useSignal(false);
  const run = async (work: () => Promise<unknown>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await work();
    } finally {
      busy.value = false;
    }
  };
  return { busy, run };
}
