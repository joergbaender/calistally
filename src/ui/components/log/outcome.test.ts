import { afterEach, describe, expect, it } from 'vitest';
import { EditError } from '../../../model/edit';
import { sessionFile } from '../../../model/test-fixtures';
import type { SessionFile } from '../../../model/types';
import type { WriteOutcome } from '../../data';
import { dismissToast, showToast, toast } from '../../toast';
import { editSession, editSessionQuiet, HELD_BACK_TEXT, quietOutcome, reportOutcome, showHeldBack } from './outcome';

afterEach(() => dismissToast());

describe('quietOutcome', () => {
  it('owes the held-back note the first time per path and shows nothing itself', () => {
    expect(quietOutcome('/quiet.json', { ok: true, heldBack: true })).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    expect(quietOutcome('/quiet.json', { ok: true, heldBack: true })).toEqual({ ok: true, heldBackNote: false });
    expect(quietOutcome('/quiet-ok.json', { ok: true, heldBack: false })).toEqual({ ok: true, heldBackNote: false });
  });

  it('still names a refusal', () => {
    expect(quietOutcome('/q.json', { ok: false, reason: 'changed' })).toEqual({ ok: false });
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
  });
});

describe('showHeldBack', () => {
  it('shows the note alone when no toast is showing', () => {
    showHeldBack();
    expect(toast.value).toEqual({ text: HELD_BACK_TEXT, ms: 4000 });
  });

  it('folds the note into the toast showing, keeping its action and time', () => {
    const run = (): void => {};
    showToast('Set 8 deleted', { label: 'Undo', run }, 6000);
    showHeldBack();
    expect(toast.value).toEqual({ text: `Set 8 deleted · ${HELD_BACK_TEXT}`, action: { label: 'Undo', run }, ms: 6000 });
    showHeldBack();
    expect(toast.value?.text).toBe(`Set 8 deleted · ${HELD_BACK_TEXT}`);
  });
});

describe('editSessionQuiet', () => {
  const fakeData = (outcome: WriteOutcome) => ({
    edit<F>(_kind: string, _path: string, fn: (file: F) => F): Promise<WriteOutcome> {
      fn(sessionFile() as F);
      return Promise.resolve(outcome);
    },
  });

  it('returns the owed note; an EditError becomes a toast', async () => {
    expect(await editSessionQuiet(fakeData({ ok: true, heldBack: true }), '/eq.json', (f: SessionFile) => f)).toEqual({ ok: true, heldBackNote: true });
    expect(toast.value).toBeUndefined();
    const failed = await editSessionQuiet(fakeData({ ok: true, heldBack: false }), '/eq.json', () => {
      throw new EditError('reps must be more than 0, got 0');
    });
    expect(failed).toEqual({ ok: false });
    expect(toast.value?.text).toBe('reps must be more than 0, got 0');
  });
});

describe('reportOutcome', () => {
  it('is quiet on a plain ok', () => {
    expect(reportOutcome('/a.json', { ok: true, heldBack: false })).toBe(true);
    expect(toast.value).toBeUndefined();
  });

  it('shows the held-back toast once per path', () => {
    expect(reportOutcome('/held.json', { ok: true, heldBack: true })).toBe(true);
    expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)');
    dismissToast();
    expect(reportOutcome('/held.json', { ok: true, heldBack: true })).toBe(true);
    expect(toast.value).toBeUndefined();
  });

  it('names a changed row and a refused row', () => {
    expect(reportOutcome('/b.json', { ok: false, reason: 'changed' })).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
    expect(reportOutcome('/b.json', { ok: false, reason: 'quarantined' })).toBe(false);
    expect(toast.value?.text).toBe('This file is read-only (quarantined)');
  });

  it("says a 'missing' session no longer exists instead of calling it read-only", () => {
    expect(reportOutcome('/sessions/2030/2030-03-07_00000000.json', { ok: false, reason: 'missing' })).toBe(false);
    expect(toast.value?.text).toBe('This session no longer exists');
    expect(reportOutcome('/exercises.json', { ok: false, reason: 'missing' })).toBe(false);
    expect(toast.value?.text).toBe('The exercise catalog is not here yet');
  });
});

describe('editSession', () => {
  /** A stand-in for Data.edit that applies fn to one file and returns the given outcome. */
  const fakeData = (outcome: WriteOutcome) => ({
    edit<F>(_kind: string, _path: string, fn: (file: F) => F): Promise<WriteOutcome> {
      fn(sessionFile() as F);
      return Promise.resolve(outcome);
    },
  });

  it('true on ok, false with the outcome toast otherwise', async () => {
    expect(await editSession(fakeData({ ok: true, heldBack: false }), '/s.json', (f: SessionFile) => f)).toBe(true);
    expect(await editSession(fakeData({ ok: false, reason: 'changed' }), '/s.json', (f: SessionFile) => f)).toBe(false);
    expect(toast.value?.text).toBe('Changed elsewhere, try again');
  });

  it('an EditError becomes a toast with its message', async () => {
    const result = await editSession(fakeData({ ok: true, heldBack: false }), '/s.json', () => {
      throw new EditError('reps must be more than 0, got 0');
    });
    expect(result).toBe(false);
    expect(toast.value?.text).toBe('reps must be more than 0, got 0');
  });

  it('any other error propagates', async () => {
    await expect(editSession(fakeData({ ok: true, heldBack: false }), '/s.json', () => {
      throw new TypeError('bug');
    })).rejects.toThrow('bug');
  });
});
