import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../model/seed';
import { buildSessions, type BuildResult } from './build';
import { isInside, sessionFilePath, toFiles, validateAll, writeOutput } from './output';
import { splitRows } from './rows';
import { gridOf } from './test-fixtures';

const OPTIONS = { year: 2030, stamp: '2030-10-07T00:00:00.000Z', bodyweightKg: 73 };
const result = (): BuildResult =>
  buildSessions(splitRows(gridOf({ A6: { date: '2030-06-05' }, B6: '6kg 15x', F6: { date: '2030-06-05' }, G6: 'Dips 10x', J6: '07.06.2030 Pullups 5x' })), {}, SEED, OPTIONS);

describe('toFiles', () => {
  it('lays the files out as spec 1 §4 does, with pretty JSON and a trailing newline', () => {
    const files = toFiles(result());
    expect(files.map((f) => f.path).slice(0, 2)).toEqual(['exercises.json', 'bodyweight.json']);
    expect(files.slice(2).every((f) => /^sessions\/2030\/2030-06-0[57]_[0-9a-f]{8}\.json$/.test(f.path))).toBe(true);
    const parsed = JSON.parse(files[2]!.content) as { schemaVersion: number; session: { id: string } };
    expect(parsed.schemaVersion).toBe(1);
    expect(files[2]!.content.endsWith('}\n')).toBe(true);
    expect(files[2]!.content).toContain('\n  "session": {');
  });

  it('two sessions on one date get two files', () => {
    const r = result();
    const same = r.sessions.filter((s) => s.date === '2030-06-05');
    expect(same).toHaveLength(2);
    expect(new Set(same.map(sessionFilePath)).size).toBe(2);
  });
});

describe('validateAll', () => {
  it('is empty for a built result', () => {
    expect(validateAll(result())).toEqual([]);
  });

  it('reports hard failures, soft failures and duplicate ids with the file in the path', () => {
    const r = result();
    const broken: BuildResult = {
      ...r,
      sessions: [
        { ...r.sessions[0]!, date: '2030-02-30' },
        { ...r.sessions[1]!, id: r.sessions[0]!.id, blocks: r.sessions[1]!.blocks.map((b) => ({ ...b, exerciseId: 'no-such-exercise' })) },
      ],
    };
    const issues = validateAll(broken);
    expect(issues.some((i) => i.level === 'hard' && i.path.endsWith('/session/date'))).toBe(true);
    expect(issues.some((i) => i.level === 'soft' && i.message.includes('no-such-exercise'))).toBe(true);
    expect(issues.some((i) => i.message.includes('duplicate session id'))).toBe(true);
    expect(issues.every((i) => i.path.startsWith('sessions/'))).toBe(true);
  });
});

describe('isInside', () => {
  it('detects a child path, the directory itself, and nothing else', () => {
    expect(isInside('/repo/migration-out', '/repo')).toBe(true);
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(isInside('/repo/../elsewhere', '/repo')).toBe(false);
    expect(isInside('/other/out', '/repo')).toBe(false);
  });
});

describe('writeOutput', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-out-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('clears only the managed paths and writes every file', async () => {
    await mkdir(path.join(dir, 'sessions', '2029'), { recursive: true });
    await writeFile(path.join(dir, 'sessions', '2029', 'stale.json'), '{}');
    await writeFile(path.join(dir, 'notes.txt'), 'keep me');
    await writeFile(path.join(dir, 'review.md'), 'old');
    const files = [...toFiles(result()), { path: 'review.md', content: 'new' }, { path: 'report.md', content: 'r' }];
    await writeOutput(dir, files);
    expect(await readFile(path.join(dir, 'notes.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(path.join(dir, 'review.md'), 'utf8')).toBe('new');
    expect(await readdir(path.join(dir, 'sessions'))).toEqual(['2030']);
    expect((await readdir(path.join(dir, 'sessions', '2030'))).length).toBe(3);
    expect(await readFile(path.join(dir, 'exercises.json'), 'utf8')).toBe(files[0]!.content);
  });

  it('creates a missing output directory', async () => {
    const fresh = path.join(dir, 'fresh', 'deeper');
    await writeOutput(fresh, [{ path: 'report.md', content: 'x' }]);
    expect(await readFile(path.join(fresh, 'report.md'), 'utf8')).toBe('x');
  });
});
