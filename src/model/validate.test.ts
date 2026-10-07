import { describe, expect, it } from 'vitest';
import { checkCatalogRules, isCalendarDate, validateFile, validateForWrite } from './validate';
import {
  T0, block, bodyweight, bodyweightFile, exercise, exercisesFile, ladder, session, sessionFile, set, timedSet, uuid,
} from './test-fixtures';

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('isCalendarDate', () => {
  it.each(['2030-01-01', '2032-02-29', '2031-12-31'])('accepts %s', (d) => expect(isCalendarDate(d)).toBe(true));
  it.each(['2031-02-29', '2030-02-30', '2030-13-01', '2030-00-10', '2030-1-1', 'x'])('rejects %s', (d) =>
    expect(isCalendarDate(d)).toBe(false),
  );
});

describe('validateFile: schema level', () => {
  it('accepts valid files of every kind', () => {
    expect(validateFile('exercises', exercisesFile([exercise()])).ok).toBe(true);
    expect(validateFile('bodyweight', bodyweightFile([bodyweight()])).ok).toBe(true);
    expect(validateFile('session', sessionFile(session([block(ladder([17, 16]))]))).ok).toBe(true);
  });

  it('reports schema failures with level and path, and does not run hard rules', () => {
    const r = validateFile('exercises', exercisesFile([exercise({ name: '' })]));
    expect(r.ok).toBe(false);
    expect(r.issues.every((i) => i.level === 'schema')).toBe(true);
    expect(r.issues[0]?.path).toBe('/exercises/0/name');
  });

  it('lenient mode ignores unknown properties, strict mode rejects them', () => {
    const file = { ...sessionFile(), future: 1 };
    expect(validateFile('session', file, 'lenient').ok).toBe(true);
    expect(validateFile('session', file, 'strict').ok).toBe(false);
  });
});

describe('validateFile: hard rules', () => {
  const hardPaths = (kind: 'exercises' | 'bodyweight' | 'session', file: unknown) => {
    const r = validateFile(kind, file);
    expect(r.issues.every((i) => i.level === 'hard')).toBe(true);
    return paths(r.issues);
  };

  it('rejects an impossible session date', () => {
    expect(hardPaths('session', sessionFile(session([], { date: '2030-02-30' })))).toEqual(['/session/date']);
  });

  it('rejects an impossible bodyweight date', () => {
    expect(hardPaths('bodyweight', bodyweightFile([bodyweight({ date: '2030-02-30' })]))).toEqual(['/entries/0/date']);
  });

  it('rejects a block that mixes reps and seconds, ignoring deleted sets', () => {
    const mixed = block([set({ order: 0 }), timedSet({ order: 1 })]);
    expect(hardPaths('session', sessionFile(session([mixed])))).toEqual(['/session/blocks/0/sets']);
    const ok = block([set({ order: 0 }), timedSet({ order: 1, deletedAt: T0 })]);
    expect(validateFile('session', sessionFile(session([ok]))).ok).toBe(true);
  });

  it.each([
    ['bodyweight with kg', set({ loadType: 'bodyweight', loadKg: 5 })],
    ['added with 0 kg', set({ loadType: 'added', loadKg: 0 })],
    ['assist with 0 kg', set({ loadType: 'assist', loadKg: 0 })],
  ])('rejects %s', (_label, s) => {
    expect(hardPaths('session', sessionFile(session([block([s])])))).toEqual(['/session/blocks/0/sets/0/loadKg']);
  });

  it('accepts external and band with 0 kg', () => {
    const b = block([set({ loadType: 'external', loadKg: 0, order: 0 }), set({ loadType: 'band', loadKg: 0, order: 1 })]);
    expect(validateFile('session', sessionFile(session([b]))).ok).toBe(true);
  });

  it('rejects restSec on a set with completedAt', () => {
    const s = set({ completedAt: T0, restSec: 60 });
    expect(hardPaths('session', sessionFile(session([block([s])])))).toEqual(['/session/blocks/0/sets/0/restSec']);
  });

  it('rejects aggregate and dateUncertain outside migrated sessions', () => {
    const s = session([block([set({ aggregate: true })])], { dateUncertain: true, source: 'app' });
    expect(hardPaths('session', sessionFile(s))).toEqual(['/session/dateUncertain', '/session/blocks/0/sets/0/aggregate']);
    const m = session([block([set({ aggregate: true })])], { dateUncertain: true, source: 'migrated' });
    expect(validateFile('session', sessionFile(m)).ok).toBe(true);
  });

  it('rejects duplicate ids anywhere in a session file', () => {
    const id = uuid();
    const s = session([block([set({ id, order: 0 })], { order: 0 }), block([set({ id, order: 0 })], { order: 1 })]);
    expect(hardPaths('session', sessionFile(s))).toEqual(['/session/blocks/1/sets/0/id']);
  });

  it('rejects duplicate exercise ids', () => {
    expect(hardPaths('exercises', exercisesFile([exercise(), exercise()]))).toEqual(['/exercises/1/id']);
  });
});

describe('validateForWrite', () => {
  it('validates the JSON form, so explicit undefined keys are fine and Infinity is not', () => {
    const fine = sessionFile(session([block([{ ...set(), note: undefined } as never])]));
    expect(validateForWrite('session', fine).ok).toBe(true);
    const bad = sessionFile(session([block([set({ order: Number.POSITIVE_INFINITY })])]));
    expect(validateForWrite('session', bad).ok).toBe(false);
  });
});

describe('checkCatalogRules (soft)', () => {
  const catalog = [exercise(), exercise({ id: 'plank', name: 'Plank', metric: 'seconds', deletedAt: T0 })];

  it('passes a session that matches the catalog, including a tombstoned exercise', () => {
    const s = session([block(ladder([5]), { exerciseId: 'pull-ups' }), block([timedSet()], { exerciseId: 'plank', order: 1 })]);
    expect(checkCatalogRules(s, catalog)).toEqual([]);
  });

  it('flags an unknown exercise and a metric mismatch at soft level', () => {
    const s = session([block(ladder([5]), { exerciseId: 'nope' }), block([set()], { exerciseId: 'plank', order: 1 })]);
    const issues = checkCatalogRules(s, catalog);
    expect(issues.every((i) => i.level === 'soft')).toBe(true);
    expect(paths(issues)).toEqual(['/session/blocks/0/exerciseId', '/session/blocks/1/sets/0/reps']);
  });

  it('ignores deleted blocks and deleted sets', () => {
    const s = session([
      block(ladder([5]), { exerciseId: 'nope', deletedAt: T0 }),
      block([set({ deletedAt: T0 })], { exerciseId: 'plank', order: 1 }),
    ]);
    expect(checkCatalogRules(s, catalog)).toEqual([]);
  });
});
