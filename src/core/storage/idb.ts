/** Minimal promise wrapper around IndexedDB: one database, a key/value store and a meta store. */

export const DB_NAME = 'the-daily';
export const DB_VERSION = 1;

export interface KV { k: string; v: string }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

export class Idb {
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<Idb> {
    const r = factory.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab'));
    });
    return new Idb(db);
  }

  async all(): Promise<KV[]> {
    const tx = this.db.transaction('kv', 'readonly');
    const rows = await req(tx.objectStore('kv').getAll() as IDBRequest<KV[]>);
    return rows;
  }

  async getMeta<T = unknown>(k: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta', 'readonly');
    const row = await req(tx.objectStore('meta').get(k) as IDBRequest<{ k: string; v: T } | undefined>);
    return row?.v;
  }

  async setMeta(k: string, v: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ k, v });
    await done(tx);
  }

  /** Apply puts (string value) and deletes (null) in one transaction. */
  async write(changes: Map<string, string | null>): Promise<void> {
    if (!changes.size) return;
    const tx = this.db.transaction('kv', 'readwrite');
    const s = tx.objectStore('kv');
    changes.forEach((v, k) => { if (v === null) s.delete(k); else s.put({ k, v }); });
    await done(tx);
  }

  close(): void { this.db.close(); }
}
