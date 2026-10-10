// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercise, session } from '../../../model/test-fixtures';
import type { FileKind } from '../../../model/types';
import type { FileOf, WriteOutcome } from '../../data';
import { renderIn, setup } from '../../test-harness';
import { dismissToast, toast } from '../../toast';
import { currentBlockId, referenceId } from './log-state';
import { LogTab } from './LogTab';

// A file of its own: the once-per-path held-back note (src/ui/held-back.ts) is module state, and
// ExerciseSearch.test.tsx already uses up the note for exercises.json.

const NOW = new Date('2030-03-07T10:30:00.000Z');
const PUSH = exercise({ id: 'push-ups', name: 'Push-ups', pattern: 'push' });

afterEach(() => {
  currentBlockId.value = undefined;
  referenceId.value = undefined;
  dismissToast();
  vi.restoreAllMocks();
});

describe('ExerciseSearch (held-back catalog)', () => {
  it('a held-back catalog write shows its note when the session write is quiet', async () => {
    const today = session([], { date: '2030-03-07', startedAt: '2030-03-07T10:00:00.000Z' });
    const { data, deps } = await setup({ now: NOW, sessions: [today], exercises: [PUSH], meta: { [`reference:${today.id}`]: 'none' } });
    const edit = data.edit.bind(data);
    vi.spyOn(data, 'edit').mockImplementation(async <K extends FileKind>(kind: K, path: string, fn: (file: FileOf<K>) => FileOf<K>): Promise<WriteOutcome> => {
      const r = await edit(kind, path, fn);
      return r.ok && kind === 'exercises' ? { ok: true, heldBack: true } : r;
    });
    renderIn(deps, <LogTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Other exercise…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Other exercise…' }));
    const sheet = screen.getByRole('dialog', { name: 'Exercise' });
    fireEvent.input(within(sheet).getByRole('textbox', { name: 'Search exercises' }), { target: { value: 'Ring Rows' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create “Ring Rows”' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New exercise' })).getByRole('button', { name: 'Create exercise' }));

    await waitFor(() => expect(currentBlockId.value).toBeDefined());
    await waitFor(() => expect(toast.value?.text).toBe('Saved here, not uploaded (app bug)'));
  });
});
