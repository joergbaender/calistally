import { describe, expect, it } from 'vitest';
import { block, exercise, ladder, session, set, T0, timedSet } from '../model/test-fixtures';
import { blockFlags } from './soft-flags';

const PULL = exercise();
const PLANK = exercise({ id: 'plank', name: 'Plank', metric: 'seconds' });
const OLD = exercise({ id: 'old-hang', name: 'Old hang', metric: 'seconds', deletedAt: T0 });
const catalog = [PULL, PLANK, OLD];

describe('blockFlags', () => {
  it('is empty for a session that matches the catalog, a tombstoned exercise included', () => {
    const s = session([block(ladder([5])), block([timedSet()], { exerciseId: 'old-hang', order: 1 })]);
    expect(blockFlags(s, catalog).size).toBe(0);
  });

  it('flags an unknown exercise and a metric mismatch on the block that has it', () => {
    const unknown = block(ladder([5]), { exerciseId: 'nope' });
    const fine = block(ladder([5]), { order: 1 });
    const mismatch = block([set()], { exerciseId: 'plank', order: 2 });
    const flags = blockFlags(session([unknown, fine, mismatch]), catalog);
    expect([...flags.entries()]).toEqual([
      [unknown.id, ['unknown exercise']],
      [mismatch.id, ['metric mismatch']],
    ]);
  });

  it('names a metric mismatch once for a block with several mismatched sets', () => {
    const mismatch = block([set({ order: 0 }), set({ order: 1 }), timedSet({ order: 2 })], { exerciseId: 'plank' });
    expect(blockFlags(session([mismatch]), catalog).get(mismatch.id)).toEqual(['metric mismatch']);
  });

  it("maps the issue pointer's array index to the block at that index, not to its canonical position", () => {
    // File order: the mismatched plank block first with the highest order, then a fine pull-ups block.
    const mismatch = block([set()], { exerciseId: 'plank', order: 5 });
    const deleted = block(ladder([5]), { exerciseId: 'nope', order: 0, deletedAt: T0 });
    const fine = block(ladder([5]), { order: 1 });
    const flags = blockFlags(session([mismatch, deleted, fine]), catalog);
    expect([...flags.keys()]).toEqual([mismatch.id]);
  });

  it('flags nothing on a deleted session', () => {
    const s = session([block(ladder([5]), { exerciseId: 'nope' })], { deletedAt: T0 });
    expect(blockFlags(s, catalog).size).toBe(0);
  });
});
