/**
 * Two-way sync between the browser journal and the journal folder the relay serves.
 *
 *  - Local edits are written to disk shortly after they happen (conditional on the
 *    file's etag, so an external edit is never overwritten).
 *  - External edits (another editor, Obsidian, a git pull) are picked up on a timer,
 *    on window focus, and on demand, then merged into the browser journal.
 *  - Both-changed cases merge line by line; real conflicts open the resolver.
 *  - Only one tab syncs at a time (Web Locks), and per-entry state is shared through
 *    the store, so several open tabs cooperate instead of competing.
 */
import type { DailyStore } from '../storage/store';
import { entries, relayConfig, type Entry } from '../bridge';
import { plan, type Action, type VaultFile, type VaultState, type LocalInfo } from './plan';
import { merge3 } from '../sync/diff3';
import { resolveConflicts } from '../sync/resolver';
import { escapeHtml, hash, normalizeText, toast } from '../util';

const STATE = 'daily:vault:state:';
const VAULT_ID = 'daily:vault:id';
const TRASH = 'daily:trash:';

export interface VaultStatus {
  enabled: boolean; path: string; files: number; lastSync: string | null; syncing: boolean;
  lastError: string | null; held: number; imported: number; written: number;
}

class HttpFail extends Error { constructor(public status: number, message: string, public body: any) { super(message); } }

async function api(method: string, url: string, body?: unknown): Promise<any> {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpFail(r.status, j?.error?.message || `Journal folder ${r.status}`, j);
  return j;
}

function dateFromPath(p: string): string {
  const m = /(?:^|\/)(\d{4})\/(\d{2})\/(\d{2})\//.exec(p) || /(\d{4})-(\d{2})-(\d{2})/.exec(p);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
}

export function createVault(store: DailyStore) {
  const status: VaultStatus = { enabled: false, path: '', files: 0, lastSync: null, syncing: false, lastError: null, held: 0, imported: 0, written: 0 };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(f => { try { f(); } catch { /* ignore */ } });
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;
  let suppress = 0; // ignore store events we cause ourselves
  let markStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const startedOrTimeout = () => Promise.race([started, new Promise<void>(r => setTimeout(r, 5000))]);

  const getState = (id: string): VaultState | null => { try { return JSON.parse(store.get(STATE + id) || 'null'); } catch { return null; } };
  const setState = (id: string, s: VaultState | null) => { suppress++; try { if (s) store.set(STATE + id, JSON.stringify(s)); else store.rm(STATE + id); } finally { suppress--; } };
  const allStates = (): Record<string, VaultState> => {
    const out: Record<string, VaultState> = {};
    for (const k of store.keys()) if (k.startsWith(STATE)) { const s = getState(k.slice(STATE.length)); if (s) out[k.slice(STATE.length)] = s; }
    return out;
  };

  function localInfo(e: Entry): LocalInfo {
    const b = entries()!;
    return { id: e.id, rel: b.relPath(e), hash: hash(b.serialize(e)), empty: !normalizeText(e.text) };
  }

  function saveLocal(e: Entry): Entry {
    const b = entries()!;
    suppress++;
    try { return b.save(e); } finally { suppress--; }
  }

  async function readFile(path: string): Promise<{ content: string; etag: string }> {
    return api('GET', '/api/vault/file?path=' + encodeURIComponent(path));
  }

  async function writeEntry(e: Entry, path: string, ifMatch: string | null, prior?: VaultState | null): Promise<void> {
    const b = entries()!;
    const content = b.serialize(e);
    try {
      const r = await api('PUT', '/api/vault/file', { path, content, ifMatch });
      setState(e.id, { path, rel: b.relPath(e), etag: r.etag, hash: hash(content), base: e.text });
      status.written++;
    } catch (err) {
      if (err instanceof HttpFail && err.status === 409 && typeof err.body?.content === 'string') {
        await mergeWith(e, path, err.body.content, err.body.etag, prior?.base ?? null);
        return;
      }
      throw err;
    }
  }

  /** Both sides changed: merge the file's text into the entry and write the result back. */
  async function mergeWith(e: Entry, path: string, content: string, etag: string, base: string | null): Promise<void> {
    const b = entries()!;
    const parsed = b.parse(content, dateFromPath(path));
    if (normalizeText(parsed.text) === normalizeText(e.text)) {
      setState(e.id, { path, rel: b.relPath(e), etag, hash: hash(b.serialize(e)), base: e.text });
      return;
    }
    const m = merge3(normalizeText(base ?? ''), normalizeText(e.text), normalizeText(parsed.text));
    let text: string | null = m.clean && base !== null ? (m.text as string) : null;
    if (text === null) {
      text = await resolveConflicts({ title: e.title || 'Untitled note', otherLabel: 'your journal folder', chunks: m.chunks });
      if (text === null) {
        const s = getState(e.id);
        if (s) setState(e.id, { ...s, deferredEtag: etag });
        toast(`Kept both versions of “${e.title}” for now. It will ask again when either changes.`);
        return;
      }
    } else {
      toast(`Merged changes from your journal folder into “${e.title}”.`);
    }
    const now = new Date().toISOString();
    const next = saveLocal({ ...e, text, updated: now, savedAt: now });
    entries()!.refresh(e.id);
    await writeEntry(next, path, etag, { path, rel: b.relPath(next), etag, hash: '', base: parsed.text });
  }

  async function pullFile(e: Entry, path: string): Promise<void> {
    const b = entries()!;
    const f = await readFile(path);
    const parsed = b.parse(f.content, dateFromPath(path));
    const now = new Date().toISOString();
    let next: Entry = { ...e, text: parsed.text, title: (parsed.title as string) || e.title, updated: now, savedAt: now };
    if (parsed.date && parsed.date !== e.date) { suppress++; try { b.remove(e); } finally { suppress--; } next = { ...next, date: parsed.date }; }
    next = saveLocal(next);
    setState(e.id, { path, rel: b.relPath(next), etag: f.etag, hash: hash(b.serialize(next)), base: next.text });
    b.refresh(e.id);
  }

  async function importFile(path: string): Promise<void> {
    const b = entries()!;
    const f = await readFile(path);
    const parsed = b.parse(f.content, dateFromPath(path));
    const existing = parsed.id ? b.findById(String(parsed.id)) : null;
    if (existing) { await adopt(existing, path, f); return; }
    if (!normalizeText(parsed.text)) return;
    const now = new Date().toISOString();
    const e = saveLocal({
      id: (parsed.id as string) || 'file-' + hash(path), date: parsed.date || dateFromPath(path), title: (parsed.title as string) || '',
      slug: (parsed.slug as string) || '', text: parsed.text, created: (parsed.created as string) || now, updated: now, savedAt: now, source: 'local',
    });
    setState(e.id, { path, rel: b.relPath(e), etag: f.etag, hash: hash(b.serialize(e)), base: e.text });
    status.imported++;
  }

  async function adopt(e: Entry, path: string, file?: { content: string; etag: string }): Promise<void> {
    const b = entries()!;
    const f = file || await readFile(path);
    const parsed = b.parse(f.content, dateFromPath(path));
    if (normalizeText(parsed.text) === normalizeText(e.text)) {
      setState(e.id, { path, rel: b.relPath(e), etag: f.etag, hash: hash(b.serialize(e)), base: e.text });
      return;
    }
    await mergeWith(e, path, f.content, f.etag, null);
  }

  async function deleteLocal(e: Entry, path: string): Promise<void> {
    const b = entries()!;
    store.set(TRASH + e.id, JSON.stringify({ ...e, deletedAt: new Date().toISOString(), deletedFrom: path }));
    suppress++;
    try { b.remove(e); } finally { suppress--; }
    setState(e.id, null);
    try { (window as any).DailySync?.forget?.(e.id); } catch { /* ignore */ }
    toast(`“${e.title || 'Untitled note'}” was deleted from your journal folder, so it was removed here too.`);
    const t = document.getElementById('toast');
    if (t) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'toast-act'; btn.textContent = 'Undo';
      btn.onclick = () => { void undoDelete(e.id); };
      t.appendChild(btn);
    }
  }

  async function undoDelete(id: string): Promise<void> {
    const raw = store.get(TRASH + id);
    if (!raw) return;
    const e = JSON.parse(raw) as Entry & { deletedAt?: string; deletedFrom?: string };
    delete e.deletedAt; delete e.deletedFrom;
    const saved = saveLocal(e);
    store.rm(TRASH + id);
    await writeEntry(saved, entries()!.relPath(saved), null).catch(() => {});
    entries()!.select(saved.date, saved.id);
    toast(`Restored “${saved.title || 'Untitled note'}”.`);
  }

  async function execute(a: Action): Promise<void> {
    const b = entries()!;
    const e = 'id' in a ? b.findById(a.id) : null;
    switch (a.type) {
      case 'write': {
        if (!e) return;
        await writeEntry(e, a.path, a.ifMatch, getState(a.id));
        if (a.from && a.from !== a.path) await api('POST', '/api/vault/delete', { path: a.from, ifMatch: a.fromEtag ?? '*' }).catch(() => {});
        return;
      }
      case 'pull': if (e) await pullFile(e, a.path); return;
      case 'merge': {
        if (!e) return;
        const f = await readFile(a.path);
        await mergeWith(e, a.path, f.content, f.etag, getState(a.id)?.base ?? null);
        return;
      }
      case 'adopt': if (e) await adopt(e, a.path); return;
      case 'import': await importFile(a.path); return;
      case 'deleteLocal': if (e) await deleteLocal(e, a.path); return;
      case 'deleteFile': await api('POST', '/api/vault/delete', { path: a.path, ifMatch: a.etag }).catch(() => {}); setState(a.id, null); return;
      case 'forget': setState(a.id, null); return;
    }
  }

  async function withLock(fn: () => Promise<void>): Promise<void> {
    const locks = (navigator as any).locks;
    if (locks?.request) await locks.request('the-daily-vault', fn); else await fn();
  }

  /** Full reconciliation with the folder. */
  async function syncNow(): Promise<void> {
    if (!status.enabled) await startedOrTimeout(); // a request made during start-up waits for it
    if (!status.enabled || !entries()) return;
    // A request made during a sync gets its own pass afterwards, so it sees the latest files.
    if (running) return running.then(() => syncNow());
    running = withLock(async () => {
      status.syncing = true; notify();
      try {
        await store.flush();
        const list = await api('GET', '/api/vault/list') as { id: string; files: VaultFile[] };
        const knownId = store.get(VAULT_ID);
        const fresh = knownId !== list.id;
        if (fresh) {
          for (const k of store.keys()) if (k.startsWith(STATE)) { suppress++; try { store.rm(k); } finally { suppress--; } }
          store.set(VAULT_ID, list.id);
        }
        const b = entries()!;
        const p = plan(b.all().map(localInfo), list.files, allStates(), { fresh });
        for (const a of p.actions) {
          try { await execute(a); } catch (err) { status.lastError = (err as Error).message; }
        }
        status.held = p.held.length;
        if (p.held.length) {
          toast(`${p.held.length} notes are missing from your journal folder. They were kept here; check the folder (Studio → Backup & export).`);
        }
        status.files = list.files.length;
        status.lastSync = new Date().toISOString();
        if (!p.actions.some(a => a.type === 'write' || a.type === 'deleteFile')) status.lastError = status.lastError && p.actions.length ? status.lastError : null;
        try { (window as any).renderRibbon?.(); } catch { /* ignore */ }
      } catch (err) {
        status.lastError = (err as Error).message;
      } finally {
        status.syncing = false; notify();
      }
    }).finally(() => { running = null; });
    return running;
  }

  /** Write (or delete) just the entries that changed locally, without listing the folder. */
  async function flushDirty(): Promise<void> {
    if (!status.enabled || !dirty.size) return;
    const ids = [...dirty];
    dirty.clear();
    await withLock(async () => {
      const b = entries();
      if (!b) return;
      for (const id of ids) {
        const e = b.findById(id);
        const s = getState(id);
        try {
          if (!e) {
            if (s) { await api('POST', '/api/vault/delete', { path: s.path, ifMatch: s.etag }).catch(() => {}); setState(id, null); }
            continue;
          }
          const info = localInfo(e);
          if (info.empty && !s) continue;
          if (s && s.hash === info.hash && s.rel === info.rel) continue;
          if (s && s.rel !== info.rel) {
            await writeEntry(e, info.rel, null, s);
            await api('POST', '/api/vault/delete', { path: s.path, ifMatch: s.etag }).catch(() => {});
          } else {
            await writeEntry(e, s ? s.path : info.rel, s ? s.etag : null, s);
          }
          status.lastError = null;
        } catch (err) {
          status.lastError = (err as Error).message;
          dirty.add(id);
        }
      }
    });
    notify();
  }

  store.on((key, _v, source) => {
    if (suppress || source !== 'local' || !status.enabled) return;
    const m = /^daily:entry:v2:\d{4}-\d{2}-\d{2}:([A-Za-z0-9_-]+)$/.exec(key);
    if (!m) return;
    dirty.add(m[1]);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flushDirty(); }, 900);
  });

  async function start(): Promise<void> {
    const cfg = relayConfig();
    if (!cfg?.vault?.enabled) { status.enabled = false; notify(); markStarted(); return; }
    try {
      const v = await api('GET', '/api/vault');
      status.enabled = !!v.enabled;
      status.path = v.path || '';
    } catch (err) { status.enabled = false; status.lastError = (err as Error).message; }
    notify();
    markStarted();
    if (!status.enabled) return;
    await syncNow();
    poll = setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, 20000);
    window.addEventListener('focus', () => { void syncNow(); });
    window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); void flushDirty(); } });
  }

  return {
    start, syncNow, flushDirty, undoDelete, status: () => ({ ...status }), enabled: () => status.enabled,
    onChange: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); },
    stop: () => { if (poll) clearInterval(poll); },
    describe: () => status.enabled ? escapeHtml(status.path) : '',
  };
}

export type DailyVault = ReturnType<typeof createVault>;
