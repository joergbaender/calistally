// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('maps kind to a class, defaults to secondary, honours disabled and ariaLabel', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button kind="primary" onClick={onClick}>Add</Button>
        <Button onClick={onClick}>Plain</Button>
        <Button kind="danger" disabled onClick={onClick} ariaLabel="Delete set">x</Button>
      </>,
    );
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add.className).toBe('btn btn--primary');
    expect(screen.getByRole('button', { name: 'Plain' }).className).toBe('btn btn--secondary');
    const del = screen.getByRole('button', { name: 'Delete set' });
    expect(del.className).toBe('btn btn--danger');
    expect((del as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
