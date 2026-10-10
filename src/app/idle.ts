/** Timer functions the race needs; the default wraps the globals (a bare `setTimeout` as a method would lose its `this`). */
export interface IdleTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const REAL_TIMERS: IdleTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Spec 4 §7: wait for the engine to go idle, but at most `ms`; says which came first. */
export function raceIdle(whenIdle: () => Promise<void>, ms: number, timers: IdleTimers = REAL_TIMERS): Promise<'idle' | 'timeout'> {
  return new Promise<'idle' | 'timeout'>((resolve) => {
    let settled = false;
    const id = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, ms);
    whenIdle().then(
      () => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(id);
        resolve('idle');
      },
      () => {
        // A failed drain still means the engine stopped: treat it as idle.
        if (settled) return;
        settled = true;
        timers.clearTimeout(id);
        resolve('idle');
      },
    );
  });
}
