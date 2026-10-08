import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';

describe('Db', () => {
  it('creates the four stores and round-trips rows', async () => {
    const db = await openDb(new IDBFactory());
    await db.put('files', { path: '/a.json', kind: 'session' });
    expect(await db.get('files', '/a.json')).toEqual({ path: '/a.json', kind: 'session' });
    expect(await db.getAll('files')).toHaveLength(1);
    await db.delete('files', '/a.json');
    expect(await db.get('files', '/a.json')).toBeUndefined();
    db.close();
  });

  it('stores key/value rows for auth and meta', async () => {
    const db = await openDb(new IDBFactory());
    await db.setValue('meta', 'cursor', 'abc');
    expect(await db.getValue<string>('meta', 'cursor')).toBe('abc');
    expect(await db.getValue('meta', 'missing')).toBeUndefined();
    db.close();
  });

  it('commits a multi-store transaction as a whole and rolls back on a thrown error', async () => {
    const db = await openDb(new IDBFactory());
    await db.tx(['files', 'queue'], 'readwrite', async (t) => {
      await t.put('files', { path: '/x.json' });
      await t.put('queue', { path: '/x.json' });
    });
    expect(await db.getAll('queue')).toHaveLength(1);
    await expect(
      db.tx(['files', 'queue'], 'readwrite', async (t) => {
        await t.put('files', { path: '/y.json' });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await db.get('files', '/y.json')).toBeUndefined();
    db.close();
  });

  it('clearAll empties every store', async () => {
    const db = await openDb(new IDBFactory());
    await db.put('files', { path: '/a.json' });
    await db.setValue('auth', 'tokens', { x: 1 });
    await db.clearAll();
    expect(await db.getAll('files')).toHaveLength(0);
    expect(await db.getValue('auth', 'tokens')).toBeUndefined();
    db.close();
  });
});
