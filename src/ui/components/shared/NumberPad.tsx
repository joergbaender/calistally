import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { formatAmount } from '../../format';
import { Button } from './Button';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Parses the typed text; undefined when it is empty or not a number above 0 (at least 0 with `allowZero`). */
function parse(text: string, allowZero: boolean): number | undefined {
  if (text === '' || text === '.') return undefined;
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 || (allowZero && n === 0) ? n : undefined;
}

/**
 * Spec 4 §4 (U8): digits, '.', backspace and the submit button, for decimals (16.5) and jumps (30).
 * It opens empty with the current value as a placeholder, so the first key starts a fresh number
 * (no backspacing over the old value first). `submitLabel` names what the button does where the
 * pad is used
 * ("Add" adds the set, "Use" only sets the value); `allowZero` accepts 0 (a 0 kg external or band load).
 */
export function NumberPad(p: {
  value: number | undefined;
  submitLabel: string;
  allowZero: boolean;
  onSubmit(v: number): void;
  onCancel(): void;
}): JSX.Element {
  const [text, setText] = useState('');
  const parsed = parse(text, p.allowZero);
  const type = (ch: string): void => {
    if (ch === '.' && text.includes('.')) return;
    setText(text + ch);
  };
  const key = (label: string, onClick: () => void): JSX.Element => (
    <button type="button" class="numpad__key" aria-label={label} onClick={onClick}>{label}</button>
  );
  return (
    <div class="numpad">
      <input
        class="numpad__display"
        type="text"
        inputMode="decimal"
        readOnly
        value={text}
        placeholder={p.value === undefined ? '' : formatAmount(p.value)}
        aria-label="Value"
      />
      <div class="numpad__keys">
        {DIGITS.map((d) => key(d, () => type(d)))}
        {key('.', () => type('.'))}
        {key('0', () => type('0'))}
        <button type="button" class="numpad__key" aria-label="Backspace" onClick={() => setText(text.slice(0, -1))}>⌫</button>
      </div>
      <div class="numpad__actions">
        <Button kind="secondary" onClick={p.onCancel}>Cancel</Button>
        <Button kind="primary" disabled={parsed === undefined} onClick={() => { if (parsed !== undefined) p.onSubmit(parsed); }}>{p.submitLabel}</Button>
      </div>
    </div>
  );
}
