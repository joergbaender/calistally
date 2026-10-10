// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../format';
import { Stepper } from './Stepper';

describe('Stepper', () => {
  it('steps by step, never below min, and the value button opens the pad', () => {
    const onChange = vi.fn();
    const onOpenPad = vi.fn();
    render(<Stepper value={2} step={1} min={1} onChange={onChange} onOpenPad={onOpenPad} />);
    const value = screen.getByRole('button', { name: 'Edit value' });
    expect(value.textContent).toBe(formatAmount(2));
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(value);
    expect(onOpenPad).toHaveBeenCalledTimes(1);
  });

  it('shows – for undefined, + and − give min, − stays at min', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper value={undefined} step={5} min={1} onChange={onChange} onOpenPad={() => {}} />);
    expect(screen.getByRole('button', { name: 'Edit value' }).textContent).toBe('–');
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    rerender(<Stepper value={3} step={5} min={1} onChange={onChange} onOpenPad={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
