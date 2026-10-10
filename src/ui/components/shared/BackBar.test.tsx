// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { BackBar } from './BackBar';

describe('BackBar', () => {
  it('renders the back button, the title and the right slot', () => {
    const onBack = vi.fn();
    render(<BackBar title="Session" onBack={onBack} right={<span>right</span>} />);
    expect(screen.getByRole('heading').textContent).toBe('Session');
    expect(screen.getByText('right')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
