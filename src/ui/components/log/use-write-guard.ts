import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

/** How long a guard waits at most for the refreshed row to show what its write added. */
export const HOLD_MS = 3000;

/** Add set's minimum hold after a successful add: sets are about a minute apart, so a
 *  second tap within this time is a double tap, even when the refreshed row already shows the set. */
export const ADD_SET_MIN_HOLD_MS = 800;

export interface WriteGuard {
  /** True while a write runs, and after it until the screen shows the record it added. */
  held(): boolean;
  /** Runs `write` unless held. `write` returns the id of the record it added (or undefined). */
  run(write: () => Promise<string | undefined>): Promise<void>;
}

export interface WriteGuardOptions {
  /** After a write that added a record, hold at least this long (ms), shown or not. Default 0. */
  minHoldMs?: number;
}

/**
 * The busy rule for a write button whose screen changes only when the refreshed row
 * arrives (Start on a card, Add set): the button ignores a tap while its write runs and also after
 * it, until `isShown(id)` says the screen's row holds the added record, or HOLD_MS passed. Without
 * the second part a quick second tap lands between the write and the refresh and adds again.
 * With `minHoldMs` the button also stays held that long after the add, because the refresh can land
 * a few ms after the tap, well before a double tap's second click.
 */
export function useWriteGuard(isShown: (id: string) => boolean, options: WriteGuardOptions = {}): WriteGuard {
  const minHoldMs = options.minHoldMs ?? 0;
  const busy = useSignal(false);
  const awaiting = useSignal<string | undefined>(undefined);
  /** Counts successful adds; each one restarts the minimum hold. */
  const added = useSignal(0);
  const cooling = useSignal(false);

  useEffect(() => {
    if (awaiting.value === undefined) return;
    const timer = setTimeout(() => (awaiting.value = undefined), HOLD_MS);
    return () => clearTimeout(timer);
  }, [awaiting.value]);

  useEffect(() => {
    if (added.value === 0 || minHoldMs <= 0) return;
    cooling.value = true;
    const timer = setTimeout(() => (cooling.value = false), minHoldMs);
    return () => clearTimeout(timer);
  }, [added.value]);

  const held = (): boolean => {
    if (busy.value) return true;
    if (cooling.value) return true;
    const id = awaiting.value;
    return id !== undefined && !isShown(id);
  };

  const run = async (write: () => Promise<string | undefined>): Promise<void> => {
    if (held()) return;
    busy.value = true;
    try {
      const id = await write();
      if (id !== undefined) {
        awaiting.value = id;
        // Held at once, not only when the effect runs after the next render.
        if (minHoldMs > 0) cooling.value = true;
        added.value = added.value + 1;
      }
    } finally {
      busy.value = false;
    }
  };

  return { held, run };
}
