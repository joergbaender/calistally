/** A small promise wrapper over IndexedDB (spec 3 §5). No library: the app needs five operations. */

export const DB_NAME = 'calistally';
export const DB_VERSION = 1;

export type StoreName = 'files' | 'queue' | 'auth' | 'meta';

/** `auth` and `meta` are key/value stores; `files` and `queue` are keyed by `path`. */
export interface KeyValueRow { key: string; value: unknown }

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** One transaction; every call must be awaited before the next non-IndexedDB await, or the
 *  transaction auto-commits (that is how IndexedDB works, in browsers and in fake-indexeddb). */
export class Tx {
  constructor(private readonly tx: IDBTransaction) {}

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return request(this.tx.objectStore(store).get(key)) as Promise<T | undefined>;
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return request(this.tx.objectStore(store).getAll()) as Promise<T[]>;
  }

  async put(store: StoreName, value: object): Promise<void> {
    await request(this.tx.objectStore(store).put(value));
  }

  async delete(store: StoreName, key: string): Promise<void> {
    await request(this.tx.objectStore(store).delete(key));
  }

  async clear(store: StoreName): Promise<void> {
    await request(this.tx.objectStore(store).clear());
  }
}

export class Db {
  constructor(private readonly idb: IDBDatabase) {}

  /** Runs `body` inside one transaction over `stores`; resolves when the transaction completed. */
  tx<R>(stores: StoreName[], mode: IDBTransactionMode, body: (t: Tx) => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const tx = this.idb.transaction(stores, mode);
      let result: R;
      let failed: unknown;
      tx.oncomplete = () => (failed === undefined ? resolve(result) : reject(failed));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(failed ?? tx.error ?? new Error('IndexedDB transaction aborted'));
      body(new Tx(tx)).then(
        (r) => { result = r; },
        (e: unknown) => { failed = e; tx.abort(); },
      );
    });
  }

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return this.tx([store], 'readonly', (t) => t.get<T>(store, key));
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return this.tx([store], 'readonly', (t) => t.getAll<T>(store));
  }

  put(store: StoreName, value: object): Promise<void> {
    return this.tx([store], 'readwrite', (t) => t.put(store, value));
  }

  delete(store: StoreName, key: string): Promise<void> {
    return this.tx([store], 'readwrite', (t) => t.delete(store, key));
  }

  /** Key/value convenience for `auth` and `meta`. */
  async getValue<T>(store: 'auth' | 'meta', key: string): Promise<T | undefined> {
    const row = await this.get<KeyValueRow>(store, key);
    return row === undefined ? undefined : (row.value as T);
  }

  setValue(store: 'auth' | 'meta', key: string, value: unknown): Promise<void> {
    return this.put(store, { key, value } satisfies KeyValueRow);
  }

  clearAll(): Promise<void> {
    const stores: StoreName[] = ['files', 'queue', 'auth', 'meta'];
    return this.tx(stores, 'readwrite', async (t) => {
      for (const s of stores) await t.clear(s);
    });
  }

  close(): void {
    this.idb.close();
  }
}

/** Opens (and on first use creates) the database. Pass a fake `IDBFactory` in tests. */
export function openDb(factory: IDBFactory = indexedDB, name: string = DB_NAME): Promise<Db> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('auth')) db.createObjectStore('auth', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(new Db(open.result));
    open.onerror = () => reject(open.error ?? new Error('could not open IndexedDB'));
    open.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}
