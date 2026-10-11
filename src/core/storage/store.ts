/**
 * The journal's storage.
 *
 * Journal data (entries, sync metadata) lives in IndexedDB, which has no 5 MB cap
 * and can be marked persistent. Small preferences stay in localStorage, where several
 * feature modules (and the theme bootstrap) read them synchronously.
 *
 * The feature modules expect a synchronous API (`store.get/set/rm/keys`). This store
 * keeps journal data in memory, loaded from IndexedDB before any module starts, and
 * writes changes back in small batched transactions. Other tabs are kept in step with
 * a BroadcastChannel.
 *
 * If IndexedDB is unavailable (some private modes), it falls back to localStorage for
 * everything, which is how versions before 2.0 worked.
 */
import { Idb } from './idb';

export const BULK_PREFIXES = ['daily:entry:', 'daily:sha:', 'daily:base:', 'daily:vault:', 'daily:trash:'];
export const isBulk = (k: string) => BULK_PREFIXES.some(p => k.startsWith(p));

export type ChangeSource = 'local' | 'remote';
export type ChangeListener = (key: string, value: string | null, source: ChangeSource) => void;

export interface StoreInfo {
  mode: 'indexeddb' | 'localStorage';
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
  migratedAt: string | null;
  migratedCount: number;
  lastError: string | null;
}

interface Options {
  idbFactory?: IDBFactory | null;
  local?: Storage | null;
  channelName?: string;
  dbName?: string;
  onError?: (message: string) => void;
}

function safeLocal(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export class DailyStore {
  private mem = new Map<string, string>();
  private pending = new Map<string, string | null>();
  private scheduled = false;
  private flushing: Promise<void> = Promise.resolve();
  private listeners = new Set<ChangeListener>();
  private channel: BroadcastChannel | null = null;
  private errorShown = false;
  readonly info: StoreInfo = { mode: 'localStorage', persisted: null, usage: null, quota: null, migratedAt: null, migratedCount: 0, lastError: null };

  private constructor(private db: Idb | null, private local: Storage | null, private onError: (m: string) => void) {}

  static async create(opts: Options = {}): Promise<DailyStore> {
    const local = opts.local === undefined ? safeLocal() : opts.local;
    const onError = opts.onError || (() => {});
    let db: Idb | null = null;
    const factory = opts.idbFactory === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : opts.idbFactory;
    if (factory) {
      try { db = await Idb.open(factory, opts.dbName); } catch { db = null; }
    }
    const s = new DailyStore(db, local, onError);
    if (db) {
      s.info.mode = 'indexeddb';
      for (const row of await db.all()) s.mem.set(row.k, row.v);
      await s.migrateFromLocalStorage();
      s.openChannel(opts.channelName || 'the-daily-store');
    }
    return s;
  }

  // ---------------------------------------------------------------- legacy-compatible API
  get(k: string): string | null {
    if (this.db && isBulk(k)) return this.mem.has(k) ? (this.mem.get(k) as string) : null;
    try { return this.local ? this.local.getItem(k) : null; } catch { return null; }
  }

  set(k: string, v: string): boolean {
    v = String(v);
    if (this.db && isBulk(k)) {
      if (this.mem.get(k) === v) return true;
      this.mem.set(k, v);
      this.queue(k, v);
      this.emit(k, v, 'local');
      return true;
    }
    try {
      this.local?.setItem(k, v);
      this.emit(k, v, 'local');
      return true;
    } catch (e) {
      this.reportError(e);
      return false;
    }
  }

  rm(k: string): void {
    if (this.db && isBulk(k)) {
      if (!this.mem.has(k)) return;
      this.mem.delete(k);
      this.queue(k, null);
      this.emit(k, null, 'local');
      return;
    }
    try { this.local?.removeItem(k); this.emit(k, null, 'local'); } catch { /* ignore */ }
  }

  keys(): string[] {
    const out = new Set<string>();
    if (this.db) this.mem.forEach((_, k) => out.add(k));
    try {
      if (this.local) {
        for (let i = 0; i < this.local.length; i++) {
          const k = this.local.key(i);
          if (k !== null && !(this.db && isBulk(k))) out.add(k);
        }
      }
    } catch { /* ignore */ }
    return [...out];
  }

  // ---------------------------------------------------------------- events, durability
  on(fn: ChangeListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Resolves once every change made so far is committed to IndexedDB. */
  flush(): Promise<void> {
    if (this.pending.size) this.runFlush();
    return this.flushing;
  }

  /** Ask the browser not to evict the journal under storage pressure. */
  async requestPersistence(): Promise<boolean | null> {
    try {
      const sm = navigator.storage;
      if (!sm?.persisted) return null;
      if (await sm.persisted()) { this.info.persisted = true; return true; }
      this.info.persisted = sm.persist ? await sm.persist() : false;
      return this.info.persisted;
    } catch { return null; }
  }

  async refreshInfo(): Promise<StoreInfo> {
    try {
      const sm = navigator.storage;
      if (sm?.estimate) { const e = await sm.estimate(); this.info.usage = e.usage ?? null; this.info.quota = e.quota ?? null; }
      if (sm?.persisted) this.info.persisted = await sm.persisted();
    } catch { /* ignore */ }
    return this.info;
  }

  /** The copy of journal data taken from localStorage at upgrade time, if any. */
  async legacyBackup(): Promise<Record<string, string> | null> {
    return this.db ? ((await this.db.getMeta<Record<string, string>>('legacyBackup')) ?? null) : null;
  }

  async clearLegacyBackup(): Promise<void> { if (this.db) await this.db.setMeta('legacyBackup', null); }

  // ---------------------------------------------------------------- internals
  private emit(k: string, v: string | null, source: ChangeSource) {
    this.listeners.forEach(fn => { try { fn(k, v, source); } catch (e) { console.error(e); } });
  }

  private queue(k: string, v: string | null) {
    this.pending.set(k, v);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.runFlush(); });
  }

  private runFlush() {
    if (!this.db || !this.pending.size) return;
    const batch = new Map(this.pending);
    this.pending.clear();
    const db = this.db;
    this.flushing = this.flushing.then(() => db.write(batch)).then(() => {
      this.info.lastError = null;
      this.channel?.postMessage({ changes: [...batch.entries()] });
    }, err => {
      // Keep the batch so the next change retries it; nothing in memory is lost.
      batch.forEach((v, k) => { if (!this.pending.has(k)) this.pending.set(k, v); });
      this.reportError(err);
    });
  }

  private reportError(err: unknown) {
    const e = err as { name?: string; message?: string };
    const quota = e?.name === 'QuotaExceededError';
    this.info.lastError = quota ? 'quota' : String(e?.message || err);
    if (this.errorShown) return;
    this.errorShown = true;
    setTimeout(() => { this.errorShown = false; }, 8000);
    this.onError(quota
      ? 'Browser storage is full. Export a backup (Studio → Backup & export) and free up space.'
      : 'Couldn’t save to browser storage: ' + (e?.message || 'unknown error'));
  }

  private openChannel(name: string) {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(name);
      this.channel.onmessage = ev => {
        const changes = (ev.data && ev.data.changes) as Array<[string, string | null]> | undefined;
        if (!Array.isArray(changes)) return;
        for (const [k, v] of changes) {
          if (typeof k !== 'string' || !isBulk(k)) continue;
          if (v === null) this.mem.delete(k); else this.mem.set(k, String(v));
          this.emit(k, v, 'remote');
        }
      };
    } catch { this.channel = null; }
  }

  /**
   * One-time upgrade from the localStorage layout used before 2.0. Journal keys are copied
   * into IndexedDB and verified, a backup of the original values is kept in the database,
   * and only then are they removed from localStorage to free its 5 MB for preferences.
   */
  private async migrateFromLocalStorage() {
    const db = this.db;
    const local = this.local;
    if (!db || !local) return;
    const migratedAt = await db.getMeta<string>('migratedAt');
    this.info.migratedAt = migratedAt ?? null;
    this.info.migratedCount = (await db.getMeta<number>('migratedCount')) ?? 0;
    const found: Record<string, string> = {};
    try {
      for (let i = 0; i < local.length; i++) {
        const k = local.key(i);
        if (k && isBulk(k)) { const v = local.getItem(k); if (v !== null) found[k] = v; }
      }
    } catch { return; }
    const keys = Object.keys(found);
    if (!keys.length) {
      if (!migratedAt) { await db.setMeta('migratedAt', 'fresh'); this.info.migratedAt = 'fresh'; }
      return;
    }
    // IndexedDB wins for keys it already has (it is newer once migration has happened).
    const changes = new Map<string, string | null>();
    for (const k of keys) if (!this.mem.has(k)) { changes.set(k, found[k]); this.mem.set(k, found[k]); }
    await db.write(changes);
    const check = new Map((await db.all()).map(r => [r.k, r.v]));
    const verified = keys.every(k => check.has(k));
    if (!verified) return; // leave localStorage untouched; try again next start
    const prior = (await db.getMeta<Record<string, string>>('legacyBackup')) || {};
    await db.setMeta('legacyBackup', Object.assign(prior, found));
    const at = new Date().toISOString();
    await db.setMeta('migratedAt', at);
    await db.setMeta('migratedCount', this.info.migratedCount + changes.size);
    this.info.migratedAt = at;
    this.info.migratedCount += changes.size;
    for (const k of keys) { try { local.removeItem(k); } catch { /* ignore */ } }
  }
}
