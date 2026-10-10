// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { signal, type Signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';

/** Proves the toolchain: TSX compiles, happy-dom renders, signals re-render on change. */
function Counter({ count }: { count: Signal<number> }) {
  return (
    <button onClick={() => { count.value += 1; }}>
      clicked {count}
    </button>
  );
}

describe('toolchain smoke', () => {
  it('renders a Preact component under happy-dom and re-renders on a signal change', async () => {
    const count = signal(0);
    render(<Counter count={count} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('clicked 0');
    fireEvent.click(button);
    expect(count.value).toBe(1);
    await Promise.resolve();
    expect(button.textContent).toBe('clicked 1');
  });
});
