import { registerSW } from 'virtual:pwa-register';
import { raceIdle } from './idle';

/** The one-tap update (spec 3 §8, spec 4 §7): prompt mode, reload only when the engine is idle. */
export interface SwUpdate {
  /** A new build is installed and waiting. */
  updateAvailable: boolean;
  /** Ask the browser to look for a new service worker now. */
  check(): Promise<void>;
  /**
   * Activate the waiting build and reload once `whenIdle` resolves, at most 10 s later:
   * 'reloading' when the reload was requested, 'busy' when the engine did not go idle in time.
   */
  apply(whenIdle: () => Promise<void>): Promise<'reloading' | 'busy'>;
}

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const IDLE_WAIT_MS = 10_000;

export function setupSwUpdate(onChange: () => void): SwUpdate {
  let registration: ServiceWorkerRegistration | undefined;
  const state: SwUpdate = {
    updateAvailable: false,
    async check() {
      try {
        await registration?.update();
      } catch {
        // offline or the worker is gone; the next check will try again
      }
    },
    async apply(whenIdle) {
      if (await raceIdle(whenIdle, IDLE_WAIT_MS) === 'timeout') return 'busy';
      await updateSW(true);
      return 'reloading';
    },
  };
  const updateSW = registerSW({
    onNeedRefresh() {
      state.updateAvailable = true;
      onChange();
    },
    onRegisteredSW(_url, r) {
      registration = r;
      if (r) setInterval(() => { void r.update(); }, UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(error: unknown) {
      console.warn('service worker registration failed', error);
    },
  });
  return state;
}
