import { describe, expect, it } from 'vitest';
import { BODYWEIGHT_PATH, EXERCISES_PATH, classifyPath, queueRank, sessionPath } from './paths';

describe('sessionPath', () => {
  it('builds the year folder, the date and the first 8 characters of the id', () => {
    expect(sessionPath('2030-03-04', 'ab12cd34-0000-4000-8000-000000000001')).toBe('/sessions/2030/2030-03-04_ab12cd34.json');
  });
});

describe('classifyPath', () => {
  it('recognises the three data kinds', () => {
    expect(classifyPath(EXERCISES_PATH)).toEqual({ kind: 'data', fileKind: 'exercises' });
    expect(classifyPath(BODYWEIGHT_PATH)).toEqual({ kind: 'data', fileKind: 'bodyweight' });
    expect(classifyPath('/sessions/2030/2030-03-04_ab12cd34.json')).toEqual({ kind: 'data', fileKind: 'session' });
  });

  it('lists a stray json in the root or under sessions as unexpected', () => {
    expect(classifyPath('/exercises (conflicted copy).json')).toEqual({ kind: 'unexpected' });
    expect(classifyPath('/sessions/2030/notes.json')).toEqual({ kind: 'unexpected' });
    expect(classifyPath('/sessions/2031/2030-03-04_ab12cd34.json')).toEqual({ kind: 'unexpected' });
    expect(classifyPath('/sessions/2030/2030-03-04_AB12CD34.json')).toEqual({ kind: 'unexpected' });
  });

  it('ignores everything else', () => {
    expect(classifyPath('/sessions')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/sessions/2030')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/export/sets.csv')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/review.md')).toEqual({ kind: 'ignored' });
    expect(classifyPath('/export/old.json')).toEqual({ kind: 'ignored' });
  });
});

describe('queueRank', () => {
  it('puts the catalog ahead of bodyweight ahead of sessions', () => {
    expect([queueRank('session'), queueRank('bodyweight'), queueRank('exercises')]).toEqual([2, 1, 0]);
  });
});
