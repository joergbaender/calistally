import type { JSX } from 'preact';
import { formatAmount } from '../../format';

/** Spec 4 §4 (U8): − and + step the value, never below min; + from an empty value gives min; the number opens the pad. */
export function Stepper(p: {
  value: number | undefined;
  step: number;
  min: number;
  onChange(v: number | undefined): void;
  onOpenPad(): void;
}): JSX.Element {
  const dec = (): void => {
    p.onChange(p.value === undefined ? p.min : Math.max(p.min, p.value - p.step));
  };
  const inc = (): void => {
    p.onChange(p.value === undefined ? p.min : p.value + p.step);
  };
  return (
    <div class="stepper">
      <button type="button" class="stepper__btn" aria-label="Decrease" onClick={dec}>−</button>
      <button type="button" class="stepper__value" aria-label="Edit value" onClick={() => p.onOpenPad()}>
        {p.value === undefined ? '–' : formatAmount(p.value)}
      </button>
      <button type="button" class="stepper__btn" aria-label="Increase" onClick={inc}>+</button>
    </div>
  );
}
