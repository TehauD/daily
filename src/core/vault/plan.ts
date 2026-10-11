/**
 * Reconciliation plan between the journal in the browser and the journal folder on disk.
 *
 * Pure function: it compares what was true at the last sync (per-entry state) with what
 * is true now on each side, and returns the actions to take. Keeping this separate from
 * the I/O makes the rules easy to test and reason about.
 */

export interface VaultFile { path: string; etag: string; mtime?: number }

export interface VaultState {
  /** Where the entry's file lives (it may be a file the person created by hand). */
  path: string;
  /** The app's own path for the entry when it was last written; a change means rename. */
  rel: string;
  /** File etag at the last sync. */
  etag: string;
  /** Hash of the entry's serialized Markdown at the last sync. */
  hash: string;
  /** Entry text at the last sync: the common ancestor for merges. */
  base: string;
  /** A conflict the person chose to postpone; ignored until the file changes again. */
  deferredEtag?: string;
}

export interface LocalInfo {
  id: string;
  /** The app's path for the entry now (YYYY/MM/DD/slug--id.md). */
  rel: string;
  /** Hash of the entry's serialized Markdown now. */
  hash: string;
  /** Blank notes are never written to disk. */
  empty: boolean;
}

export type Action =
  | { type: 'write'; id: string; path: string; ifMatch: string | null; from?: string; fromEtag?: string }
  | { type: 'pull'; id: string; path: string }
  | { type: 'merge'; id: string; path: string }
  | { type: 'adopt'; id: string; path: string }
  | { type: 'import'; path: string }
  | { type: 'deleteLocal'; id: string; path: string }
  | { type: 'deleteFile'; id: string; path: string; etag: string }
  | { type: 'forget'; id: string };

export interface Plan { actions: Action[]; held: Action[] }

/** Files the app treats as journal entries: dated folders or dated file names, or its own naming. */
export function looksLikeEntry(path: string): boolean {
  return /(^|\/)\d{4}\/\d{2}\/\d{2}\/[^/]+\.md$/i.test(path) || /(^|\/)\d{4}-\d{2}-\d{2}[^/]*\.md$/i.test(path) || /--[A-Za-z0-9_-]+\.md$/.test(path);
}

export function plan(local: LocalInfo[], files: VaultFile[], states: Record<string, VaultState>, opts: { fresh: boolean }): Plan {
  const actions: Action[] = [];
  const byPath = new Map(files.map(f => [f.path, f]));
  const st = opts.fresh ? {} : states;
  const claimed = new Set<string>();
  const localIds = new Set(local.map(l => l.id));

  for (const l of local) {
    const s = st[l.id];
    if (!s) {
      if (l.empty) continue;
      claimed.add(l.rel);
      actions.push(byPath.has(l.rel) ? { type: 'adopt', id: l.id, path: l.rel } : { type: 'write', id: l.id, path: l.rel, ifMatch: null });
      continue;
    }
    claimed.add(s.path);
    const f = byPath.get(s.path);
    const localChanged = l.hash !== s.hash;
    const renamed = l.rel !== s.rel;
    if (!f) {
      if (localChanged && !l.empty) { claimed.add(l.rel); actions.push({ type: 'write', id: l.id, path: renamed ? l.rel : s.path, ifMatch: null }); }
      else actions.push({ type: 'deleteLocal', id: l.id, path: s.path });
      continue;
    }
    const fileChanged = f.etag !== s.etag && f.etag !== s.deferredEtag;
    if (fileChanged && localChanged) { actions.push({ type: 'merge', id: l.id, path: s.path }); continue; }
    if (fileChanged) { actions.push({ type: 'pull', id: l.id, path: s.path }); continue; }
    if (renamed) {
      claimed.add(l.rel);
      actions.push({ type: 'write', id: l.id, path: l.rel, ifMatch: byPath.has(l.rel) ? (byPath.get(l.rel) as VaultFile).etag : null, from: s.path, fromEtag: f.etag });
      continue;
    }
    if (localChanged && !l.empty) actions.push({ type: 'write', id: l.id, path: s.path, ifMatch: f.etag });
  }

  // Entries removed from the browser while the folder wasn't being synced.
  for (const id of Object.keys(st)) {
    if (localIds.has(id)) continue;
    const s = st[id];
    const f = byPath.get(s.path);
    claimed.add(s.path);
    if (f && f.etag === s.etag) actions.push({ type: 'deleteFile', id, path: s.path, etag: f.etag });
    else actions.push({ type: 'forget', id });
  }

  for (const f of files) {
    if (!claimed.has(f.path) && looksLikeEntry(f.path)) actions.push({ type: 'import', path: f.path });
  }

  // Safety: a burst of "deleted on disk" usually means the folder moved or was swapped,
  // not that the person deleted many notes. Hold those for review instead of applying.
  const dels = actions.filter(a => a.type === 'deleteLocal');
  const limit = Math.max(3, Math.ceil(Object.keys(st).length * 0.25));
  if (dels.length > limit) {
    return { actions: actions.filter(a => a.type !== 'deleteLocal'), held: dels };
  }
  return { actions, held: [] };
}
