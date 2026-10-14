// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseForm } from './ExerciseForm';

describe('ExerciseForm', () => {
  it('prefills the name and hands the trimmed name and the chosen fields to onSave', () => {
    const onSave = vi.fn();
    render(<ExerciseForm initialName="Ring Rows" onSave={onSave} onCancel={vi.fn()} />);
    const form = screen.getByRole('dialog', { name: 'New exercise' });
    const name = within(form).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Ring Rows');
    fireEvent.input(name, { target: { value: '  Ring Dips ' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Pattern' }), { target: { value: 'push' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Metric' }), { target: { value: 'seconds' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Per side' }));
    fireEvent.change(within(form).getByRole('combobox', { name: 'Default load' }), { target: { value: 'added' } });
    fireEvent.input(within(form).getByRole('textbox', { name: 'Family' }), { target: { value: ' dip ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create exercise' }));
    expect(onSave).toHaveBeenCalledWith('Ring Dips', { pattern: 'push', metric: 'seconds', perSide: true, defaultLoadType: 'added', family: 'dip' });
  });

  it('defaults to other · reps · not per side · bodyweight without a family', () => {
    const onSave = vi.fn();
    render(<ExerciseForm initialName="Rows" onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create exercise' }));
    expect(onSave).toHaveBeenCalledWith('Rows', { pattern: 'other', metric: 'reps', perSide: false, defaultLoadType: 'bodyweight' });
  });

  it('disables Create for a blank name; Cancel calls onCancel', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ExerciseForm initialName="  " onSave={onSave} onCancel={onCancel} />);
    const create = screen.getByRole('button', { name: 'Create exercise' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Create exercise while the caller reports a write running', () => {
    const onSave = vi.fn();
    render(<ExerciseForm initialName="Rows" busy onSave={onSave} onCancel={vi.fn()} />);
    const create = screen.getByRole('button', { name: 'Create exercise' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onSave).not.toHaveBeenCalled();
  });
});
