import { registerSW } from 'virtual:pwa-register';

/** The one-tap update (spec 3 §8): prompt mode, reload only when the engine is idle. */
export interface SwUpdate {
  /** A new build is installed and waiting. */
  updateAvailable: boolean;
  /** Ask the browser to look for a new service worker now. */
  check(): Promise<void>;
  /** Activate the waiting build and reload, after `whenIdle` resolves (at most 10 s). */
  apply(whenIdle: () => Promise<void>): Promise<void>;
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
      await Promise.race([whenIdle(), new Promise((r) => setTimeout(r, IDLE_WAIT_MS))]);
      await updateSW(true);
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
