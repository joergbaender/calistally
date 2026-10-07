import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, runMigration } from './cli';
import { writeWorkbook } from './test-fixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out.set(path.relative(dir, p).split(path.sep).join('/'), await readFile(p, 'utf8'));
    }
  };
  await walk(dir);
  return out;
}

describe('runMigration', () => {
  let dir: string;
  let xlsx: string;
  let decisions: string;
  let out: string;
  const quiet = (): void => {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-'));
    xlsx = path.join(dir, 'synthetic.xlsx');
    decisions = path.join(dir, 'decisions.json');
    out = path.join(dir, 'out');
    await writeWorkbook(xlsx, {
      B3: '20x 15x',
      A6: { date: '2030-02-01' }, B6: '6kg 15x 12x', C6: '35kg 16x 14x',
      F6: { date: '2030-02-03' }, G6: 'Dips 10x 8x', H6: '100 Diamonds',
      F7: '09.02.2030', G7: 'Rings Downs 15x Start with 1m Rest', J7: '15.07.2030 Burpees, Pyramide Pullups',
      L6: { date: '2030-01-30' }, M6: 'Bands 50kg 20x 60kg 15x x2',
    });
    await writeFile(decisions, '{}');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'notes.txt'), 'keep me');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses an output directory inside the repository before reading anything', async () => {
    const inside = path.join(repoRoot, 'migration-out', 'cli-test-must-not-exist');
    const code = await runMigration({ xlsx: path.join(dir, 'does-not-exist.xlsx'), decisions, out: inside, repoRoot, log: quiet });
    expect(code).toBe(EXIT.usage);
    await expect(access(inside)).rejects.toThrow();
  });

  it('writes every file, reports NOT FINAL while items are open, and leaves other files alone', async () => {
    const code = await runMigration({ xlsx, decisions, out, repoRoot, log: quiet });
    expect(code).toBe(EXIT.open);
    const files = await snapshot(out);
    expect(files.get('notes.txt')).toBe('keep me');
    expect([...files.keys()].filter((p) => p.startsWith('sessions/2030/'))).toHaveLength(6);
    expect(files.has('exercises.json')).toBe(true);
    expect(files.has('bodyweight.json')).toBe(true);
    expect(files.get('report.md')?.startsWith('# Migration report — NOT FINAL')).toBe(true);
    const review = files.get('review.md') ?? '';
    for (const key of ['A3', 'H6', 'J7']) expect(review).toContain(`### ${key}`);
    expect(review).toContain('4 open items');
  });

  it('is byte-identical on a rerun', async () => {
    const before = await snapshot(out);
    await runMigration({ xlsx, decisions, out, repoRoot, log: quiet });
    expect(await snapshot(out)).toEqual(before);
  });

  it('exits 0 and reports FINAL once every item is answered', async () => {
    await writeFile(decisions, JSON.stringify({ A3: { accept: true }, H6: { accept: true }, J7: { accept: true } }));
    const lines: string[] = [];
    const code = await runMigration({ xlsx, decisions, out, repoRoot, log: (l) => lines.push(l) });
    expect(code).toBe(EXIT.final);
    const files = await snapshot(out);
    expect(files.get('report.md')?.startsWith('# Migration report — FINAL')).toBe(true);
    expect(files.get('review.md')).toContain('0 open items');
    expect(lines.at(-1)).toContain('FINAL');
  });

  it('F5: lists a cell outside the column blocks in review.md', async () => {
    const own = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-outside-'));
    try {
      const book = path.join(own, 'synthetic.xlsx');
      const dec = path.join(own, 'decisions.json');
      await writeWorkbook(book, { A6: { date: '2030-02-01' }, B6: '6kg 15x', E6: '50x Pullups' });
      await writeFile(dec, '{}');
      const code = await runMigration({ xlsx: book, decisions: dec, out: path.join(own, 'out'), repoRoot, log: quiet });
      expect(code).toBe(EXIT.open);
      expect(await readFile(path.join(own, 'out', 'review.md'), 'utf8')).toContain('### E6 · outside-blocks');
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('D1: refuses an output folder whose sessions/ holds a session not written by the migration', async () => {
    const own = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-unsafe-'));
    try {
      const book = path.join(own, 'synthetic.xlsx');
      const dec = path.join(own, 'decisions.json');
      await writeWorkbook(book, { A6: { date: '2030-02-01' }, B6: '6kg 15x' });
      await writeFile(dec, '{}');
      const target = path.join(own, 'out');
      const appFile = path.join(target, 'sessions', '2030', 'x.json');
      const appContent = '{ "schemaVersion": 1, "session": { "source": "app" } }';
      await mkdir(path.dirname(appFile), { recursive: true });
      await writeFile(appFile, appContent);
      const lines: string[] = [];
      const code = await runMigration({ xlsx: book, decisions: dec, out: target, repoRoot, log: (l) => lines.push(l) });
      expect(code).toBe(EXIT.usage);
      expect(lines.join('\n')).toContain('sessions/2030/x.json');
      expect(await snapshot(target)).toEqual(new Map([['sessions/2030/x.json', appContent]]));
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('D1: refuses an output folder whose sessions/ holds a non-JSON file', async () => {
    const own = await mkdtemp(path.join(os.tmpdir(), 'calistally-cli-unsafe-'));
    try {
      const book = path.join(own, 'synthetic.xlsx');
      const dec = path.join(own, 'decisions.json');
      await writeWorkbook(book, { A6: { date: '2030-02-01' }, B6: '6kg 15x' });
      await writeFile(dec, '{}');
      const target = path.join(own, 'out');
      await mkdir(path.join(target, 'sessions'), { recursive: true });
      await writeFile(path.join(target, 'sessions', 'notes.txt'), 'mine');
      const code = await runMigration({ xlsx: book, decisions: dec, out: target, repoRoot, log: quiet });
      expect(code).toBe(EXIT.usage);
      expect(await snapshot(target)).toEqual(new Map([['sessions/notes.txt', 'mine']]));
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('rejects a malformed decisions file', async () => {
    await writeFile(decisions, '{"g9": {}}');
    await expect(runMigration({ xlsx, decisions, out, repoRoot, log: quiet })).rejects.toThrow(/cell address/);
  });
});
