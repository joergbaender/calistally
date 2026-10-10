// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, toast } from '../../toast';
import { ToastHost } from './ToastHost';

describe('ToastHost', () => {
  beforeEach(() => { vi.useFakeTimers(); dismissToast(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing without a toast, then the text and the action, which runs and dismisses', () => {
    render(<ToastHost />);
    expect(document.querySelector('.toast')).toBeNull();
    const run = vi.fn();
    act(() => { showToast('Set 14 deleted', { label: 'Undo', run }, 6000); });
    expect(screen.getByText('Set 14 deleted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(toast.value).toBeUndefined();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('auto-dismisses after ms', () => {
    render(<ToastHost />);
    act(() => { showToast('Saved here, not uploaded (app bug)'); });
    expect(screen.getByText('Saved here, not uploaded (app bug)')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    act(() => { vi.advanceTimersByTime(3999); });
    expect(toast.value).toBeDefined();
    act(() => { vi.advanceTimersByTime(1); });
    expect(toast.value).toBeUndefined();
    expect(document.querySelector('.toast')).toBeNull();
  });
});
