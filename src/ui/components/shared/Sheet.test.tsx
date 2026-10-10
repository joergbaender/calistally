// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('renders title and children as a modal dialog; Cancel and Escape close it', () => {
    const onClose = vi.fn();
    render(<Sheet title="Load" onClose={onClose}><p>body</p></Sheet>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Load')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a swipe down of more than 80 px on the title bar closes it; a shorter or upward swipe does not', () => {
    const onClose = vi.fn();
    render(<Sheet title="Load" onClose={onClose}><p>body</p></Sheet>);
    const head = screen.getByRole('heading', { name: 'Load' }).parentElement as HTMLElement;
    const swipe = (from: number, to: number): void => {
      fireEvent.touchStart(head, { touches: [{ clientX: 50, clientY: from }] });
      fireEvent.touchEnd(head, { changedTouches: [{ clientX: 50, clientY: to }] });
    };
    swipe(100, 160);
    swipe(300, 100);
    expect(onClose).not.toHaveBeenCalled();
    swipe(100, 181);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the dialog on mount so Escape works without an inner focus', () => {
    render(<Sheet title="Load" onClose={() => {}}><p>body</p></Sheet>);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});
