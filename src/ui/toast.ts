import { signal, type Signal } from '@preact/signals';

/** Spec 4 §4, §9: one toast at a time; a new one replaces the current. */
export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
  ms: number;
}

export const toast: Signal<Toast | undefined> = signal<Toast | undefined>(undefined);

/** Default 4000 ms; undo callers pass 6000. */
export function showToast(text: string, action?: { label: string; run: () => void }, ms = 4000): void {
  toast.value = { text, ms, ...(action !== undefined ? { action } : {}) };
}

export function dismissToast(): void {
  toast.value = undefined;
}
