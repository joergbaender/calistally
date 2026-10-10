import { afterEach, describe, expect, it } from 'vitest';
import { clearDraft, draftFor, entryDraft, setDraft, typedValue } from './log-state';

afterEach(() => {
  entryDraft.value = new Map();
});

describe('entry drafts', () => {
  it('a block without a draft reads as empty', () => {
    expect(draftFor('a')).toEqual({});
  });

  it('setDraft merges a patch; undefined removes a field; drafts are per block', () => {
    setDraft('a', { typed: { amount: 12, setNumber: 2 }, note: 'slow' });
    setDraft('a', { load: { loadType: 'added', loadKg: 10 } });
    setDraft('b', { note: 'other' });
    expect(draftFor('a')).toEqual({ typed: { amount: 12, setNumber: 2 }, note: 'slow', load: { loadType: 'added', loadKg: 10 } });
    setDraft('a', { typed: undefined, note: undefined });
    expect(draftFor('a')).toEqual({ load: { loadType: 'added', loadKg: 10 } });
    expect(draftFor('b')).toEqual({ note: 'other' });
  });

  it('every change replaces the map (the signal notifies), and an emptied draft leaves it', () => {
    const before = entryDraft.value;
    setDraft('a', { typed: { amount: 3, setNumber: 1 } });
    expect(entryDraft.value).not.toBe(before);
    setDraft('a', { typed: undefined });
    expect(entryDraft.value.has('a')).toBe(false);
  });

  it('typedValue gives the typed amount only for the set number it was typed for', () => {
    setDraft('a', { typed: { amount: 15, setNumber: 3 } });
    expect(typedValue(draftFor('a'), 3)).toBe(15);
    expect(typedValue(draftFor('a'), 4)).toBeUndefined();
    expect(typedValue(draftFor('a'), 2)).toBeUndefined();
    expect(typedValue(draftFor('b'), 3)).toBeUndefined();
  });

  it('clearDraft drops the whole draft of one block', () => {
    setDraft('a', { typed: { amount: 3, setNumber: 1 }, load: { loadType: 'band', loadKg: 0 } });
    setDraft('b', { typed: { amount: 4, setNumber: 1 } });
    clearDraft('a');
    expect(entryDraft.value.has('a')).toBe(false);
    expect(draftFor('b')).toEqual({ typed: { amount: 4, setNumber: 1 } });
  });
});
