// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../format';
import { NumberPad } from './NumberPad';

const tap = (name: string): boolean => fireEvent.click(screen.getByRole('button', { name }));
const display = (): HTMLInputElement => screen.getByRole('textbox') as HTMLInputElement;
const submit = (label = 'Add'): HTMLButtonElement => screen.getByRole('button', { name: label }) as HTMLButtonElement;

describe('NumberPad', () => {
  it('opens empty with the current value as a placeholder; digits and one decimal point start a fresh number', () => {
    const onSubmit = vi.fn();
    render(<NumberPad value={16} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    const field = display();
    expect(field.value).toBe('');
    expect(field.placeholder).toBe(formatAmount(16));
    expect(field.readOnly).toBe(true);
    expect(field.getAttribute('inputmode')).toBe('decimal');
    tap('1');
    tap('6');
    tap('.');
    tap('.');
    tap('5');
    expect(field.value).toBe('16.5');
    for (const d of ['0', '1', '2', '3', '4', '6', '7', '8', '9']) expect(screen.getByRole('button', { name: d })).toBeTruthy();
    tap('Add');
    expect(onSubmit).toHaveBeenCalledWith(16.5);
  });

  it('a jump replaces the value: 8 shown, 3 0 submits 30; 11.5 shown, 1 4 submits 14', () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<NumberPad value={8} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    tap('3');
    tap('0');
    tap('Add');
    expect(onSubmit).toHaveBeenLastCalledWith(30);
    unmount();
    render(<NumberPad value={11.5} submitLabel="Use" allowZero={false} onSubmit={onSubmit} onCancel={() => {}} />);
    tap('1');
    tap('4');
    tap('Use');
    expect(onSubmit).toHaveBeenLastCalledWith(14);
  });

  it('the submit button carries the given label', () => {
    render(<NumberPad value={undefined} submitLabel="Use" allowZero={false} onSubmit={() => {}} onCancel={() => {}} />);
    expect(submit('Use')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('disables the submit when empty or 0, backspace deletes, Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<NumberPad value={undefined} submitLabel="Add" allowZero={false} onSubmit={onSubmit} onCancel={onCancel} />);
    expect(display().value).toBe('');
    expect(display().placeholder).toBe('');
    expect(submit().disabled).toBe(true);
    tap('0');
    expect(submit().disabled).toBe(true);
    tap('Backspace');
    tap('3');
    expect(submit().disabled).toBe(false);
    tap('Backspace');
    expect(display().value).toBe('');
    expect(submit().disabled).toBe(true);
    tap('Cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('allowZero accepts 0 (external or band at 0 kg, spec 1 §3); empty stays disabled', () => {
    const onSubmit = vi.fn();
    render(<NumberPad value={undefined} submitLabel="Use" allowZero onSubmit={onSubmit} onCancel={() => {}} />);
    expect(submit('Use').disabled).toBe(true);
    tap('0');
    expect(submit('Use').disabled).toBe(false);
    tap('Use');
    expect(onSubmit).toHaveBeenCalledWith(0);
  });
});
