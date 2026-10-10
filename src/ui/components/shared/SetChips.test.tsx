// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ladder, set } from '../../../model/test-fixtures';
import { formatAmount } from '../../format';
import { SetChips } from './SetChips';

const chips = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.setchips__chip'));

describe('SetChips', () => {
  it('renders the amounts (device locale) in the order given, marks last and marked, appends the proposed chip', () => {
    const sets = ladder([17, 16.5, 15]);
    const onTap = vi.fn();
    render(<SetChips sets={sets} variant="today" lastIndex={2} markIndex={1} proposed={14} onTap={onTap} />);
    expect(document.querySelector('.setchips')?.className).toBe('setchips setchips--today');
    const all = chips();
    expect(all.map((c) => c.textContent)).toEqual([17, 16.5, 15, 14].map(formatAmount));
    expect(all[2]?.classList.contains('is-last')).toBe(true);
    expect(all[1]?.classList.contains('is-marked')).toBe(true);
    expect(all[3]?.classList.contains('is-proposed')).toBe(true);
    expect(all[0]?.className).toBe('setchips__chip');
    fireEvent.click(screen.getByRole('button', { name: formatAmount(16.5) }));
    expect(onTap).toHaveBeenCalledWith(sets[1]);
  });

  it('reference variant without proposed or onTap renders plain chips; an aggregate set shows 100*', () => {
    render(<SetChips sets={[set({ reps: 100, aggregate: true })]} variant="reference" />);
    expect(document.querySelector('.setchips')?.className).toBe('setchips setchips--reference');
    expect(chips().map((c) => c.textContent)).toEqual([`${formatAmount(100)}*`]);
    expect(document.querySelector('.is-proposed')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
