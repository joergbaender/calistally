import { beforeEach, describe, expect, it } from 'vitest';
import { dismissToast, showToast, toast } from './toast';

describe('toast', () => {
  beforeEach(() => dismissToast());

  it('showToast sets the signal with the default 4000 ms', () => {
    showToast('Saved');
    expect(toast.value).toEqual({ text: 'Saved', ms: 4000 });
  });

  it('carries an action and a custom duration', () => {
    const run = () => undefined;
    showToast('Set deleted', { label: 'Undo', run }, 6000);
    expect(toast.value).toEqual({ text: 'Set deleted', action: { label: 'Undo', run }, ms: 6000 });
  });

  it('dismissToast clears it', () => {
    showToast('Saved');
    dismissToast();
    expect(toast.value).toBeUndefined();
  });

  it('a second showToast replaces the first', () => {
    showToast('first');
    showToast('second');
    expect(toast.value?.text).toBe('second');
  });
});
