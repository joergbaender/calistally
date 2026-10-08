import type { Engine } from '../sync/engine';
import type { SwUpdate } from './sw-update';

export const PERIODIC_DRAIN_MS = 5 * 60 * 1000;

/** The browser events that run the engine (spec 3 §7) and the update checks (spec 3 §8). */
export function attachTriggers(engine: Engine, sw: SwUpdate, win: Window = window): () => void {
  const onVisible = () => {
    if (win.document.visibilityState === 'visible') {
      void engine.drain();
      void sw.check();
    }
  };
  const onOnline = () => { void engine.wentOnline(); };
  win.document.addEventListener('visibilitychange', onVisible);
  win.addEventListener('online', onOnline);
  const timer = win.setInterval(() => {
    if (win.document.visibilityState === 'visible') void engine.drain();
  }, PERIODIC_DRAIN_MS);
  return () => {
    win.document.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('online', onOnline);
    win.clearInterval(timer);
  };
}
