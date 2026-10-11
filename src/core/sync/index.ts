/**
 * Repository sync policy: the last-synced text of each entry is kept as the common
 * ancestor, so pulls and pushes can tell "they changed it", "I changed it" and "we both
 * did" apart. Both-changed cases are merged line by line; only real conflicts reach the
 * resolver. Deletions can be carried to the repository, and deletions made in the
 * repository are offered for review instead of being applied silently.
 */
import type { DailyStore } from '../storage/store';
import { entries, type Entry } from '../bridge';
import { merge3 } from './diff3';
import { resolveConflicts } from './resolver';
import { openModal } from '../ui/modal';
import { escapeHtml, normalizeText, toast } from '../util';

export interface QueuedConflict {
  id: string; date: string; title: string; provider: string; path: string; remoteSha: string;
  base: string; local: string; remote: string;
}

const baseKey = (id: string) => 'daily:base:' + id;

type G = Record<string, any>;
const g = () => window as unknown as G;

export function createSync(store: DailyStore) {
  const queue: QueuedConflict[] = [];
  let resolving = false;

  function getBase(id: string): string | null { return store.get(baseKey(id)); }
  function setBase(id: string, text: string) { store.set(baseKey(id), String(text ?? '')); }

  function merge(base: string, local: string, remote: string) {
    const r = merge3(normalizeText(base), normalizeText(local), normalizeText(remote));
    return { clean: r.clean, text: r.text, chunks: r.chunks, conflicts: r.conflicts };
  }

  /** Put new text into an entry (and the editor, when it's the open note). */
  function applyText(e: Entry, text: string): Entry {
    const b = entries();
    if (!b || normalizeText(text) === normalizeText(e.text)) return e;
    const now = new Date().toISOString();
    const next = b.save({ ...e, text, updated: now, savedAt: now });
    const cur = b.current();
    if (cur.id === e.id && typeof g().setEntryText === 'function') {
      g().setEntryText(text);
      try { g().flush?.(); } catch { /* ignore */ }
    }
    return next;
  }

  function afterPush(e: Entry, markdown: string) {
    const b = entries();
    if (!b || !e?.id) return;
    try { setBase(e.id, b.parse(markdown, e.date).text); } catch { setBase(e.id, e.text); }
  }

  /**
   * A push found that the repository copy changed. Merge it with the local copy; ask only
   * if they conflict. Resolves with the text to push, or null to cancel.
   */
  async function resolveRemoteChange(opts: { provider: string; entry: Entry; fetchRemote: () => Promise<string> }): Promise<{ text: string } | null> {
    const b = entries();
    const e = opts.entry;
    let remoteText = '';
    try { remoteText = b ? b.parse(await opts.fetchRemote(), e.date).text : ''; }
    catch (err) {
      const ok = await openModal({
        title: 'The repository copy changed', description: `“${e.title}” changed in ${opts.provider} since your last sync, and it couldn’t be read to merge (${(err as Error).message}).`,
        body: '<p class="dm-note">Overwrite the repository copy with yours, or cancel and Pull first.</p>',
        actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Overwrite', value: 'ok', danger: true }],
      });
      return ok === 'ok' ? { text: e.text } : null;
    }
    if (normalizeText(remoteText) === normalizeText(e.text)) return { text: e.text };
    const base = getBase(e.id);
    const m = merge(base ?? '', e.text, remoteText);
    if (m.clean && base !== null) {
      toast(`Merged the ${opts.provider} changes into “${e.title}”.`);
      return { text: m.text as string };
    }
    const text = await resolveConflicts({ title: e.title, otherLabel: opts.provider, chunks: m.chunks });
    return text === null ? null : { text };
  }

  function queueConflict(c: QueuedConflict) {
    const i = queue.findIndex(x => x.id === c.id);
    if (i >= 0) queue[i] = c; else queue.push(c);
  }

  async function openConflicts() {
    if (resolving) return;
    resolving = true;
    try {
      while (queue.length) {
        const c = queue[0];
        const b = entries();
        const e = b?.findById(c.id);
        if (!b || !e) { queue.shift(); continue; }
        const m = merge(c.base, e.text, c.remote);
        const text = m.clean ? (m.text as string) : await resolveConflicts({ title: e.title, otherLabel: c.provider, chunks: m.chunks });
        queue.shift();
        if (text === null) { toast(`Kept your version of “${e.title}”. Pull again to revisit.`); continue; }
        applyText(e, text);
        // The repository version is now incorporated: it becomes the common ancestor, and
        // its revision is recorded so the next push doesn't report a remote change.
        setBase(c.id, c.remote);
        const shaKey = g().__dailyShaKey as ((p: string, id: string) => string) | undefined;
        if (shaKey && c.remoteSha) store.set(shaKey(/azure/i.test(c.provider) ? 'azure' : 'github', c.id), c.remoteSha);
        toast(`“${e.title}” combined. Push to publish the result.`);
      }
    } finally { resolving = false; }
  }

  // ------------------------------------------------------------------- deletion
  function remoteTargets(e: Entry): string[] {
    const P = g().DailyProvider;
    const out: string[] = [];
    const ready = (p: string) => (p === 'github' ? g().ghReady?.() : g().azReady?.());
    const active = P?.active?.() || (g().ghReady?.() ? 'github' : 'ado');
    const known = (p: string) => !!(e.repositoryKey?.startsWith(p === 'github' ? 'github:' : 'azure-devops:') || store.get((g().__dailyShaKey?.(p === 'github' ? 'github' : 'azure', e.id)) || ''));
    if (ready(active) && known(active)) out.push(active);
    const mirror = P?.mirrorTarget?.();
    if (mirror && ready(mirror) && known(mirror)) out.push(mirror);
    return out;
  }

  async function confirmDelete(e: Entry): Promise<{ remote: boolean; targets: string[] } | null> {
    const targets = remoteTargets(e);
    const names = targets.map(t => (t === 'github' ? 'GitHub' : 'Azure DevOps'));
    const body = document.createElement('div');
    body.innerHTML = `<p class="dm-note">It will be removed from this browser${g().DailyVault?.enabled?.() ? ' and moved to the trash in your journal folder' : ''}.</p>` +
      (names.length ? `<label class="dm-check"><input type="checkbox" id="dmDelRemote"> Also delete it from ${escapeHtml(names.join(' and '))}</label>` +
        `<p class="dm-note">The repository keeps its history, so a deleted file can always be restored from there.</p>` : '');
    const r = await openModal({
      title: `Delete “${e.title || 'Untitled note'}”?`, body,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Delete', value: 'delete', danger: true }],
    });
    if (r !== 'delete') return null;
    // Targets are decided now: once the note is removed, its sync metadata is gone too.
    return { remote: !!(body.querySelector('#dmDelRemote') as HTMLInputElement | null)?.checked, targets };
  }

  async function relayJSON(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || 'Relay ' + r.status);
    return j;
  }

  async function deleteRemote(e: Entry, chosen?: string[]) {
    const b = entries();
    if (!b) return;
    const rel = b.relPath(e);
    const targets = chosen ?? remoteTargets(e);
    for (const p of targets) {
      const name = p === 'github' ? 'GitHub' : 'Azure DevOps';
      const cfg = p === 'github' ? g().getGH?.() : g().getAZ?.();
      if (cfg?.relay) {
        await relayJSON('/api/repositories/delete', { provider: p, path: rel, message: `Delete journal ${e.date} - ${e.title}`, mode: g().DailyProvider?.publishMode?.() || 'commit' });
      } else if (p === 'github') {
        const path = [String(cfg.path || '').replace(/^\/+|\/+$/g, ''), rel].filter(Boolean).join('/');
        const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
        const h = g().ghH(cfg.token);
        const cur = await fetch(api + '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now(), { headers: h, cache: 'no-store' });
        if (cur.status === 404) continue;
        if (!cur.ok) throw new Error(`GitHub ${cur.status}`);
        const sha = (await cur.json()).sha;
        const r = await fetch(api, { method: 'DELETE', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Delete journal ${e.date} - ${e.title}`, sha, branch: cfg.branch }) });
        if (!r.ok) throw new Error(`GitHub ${r.status}`);
      } else {
        const base = `https://dev.azure.com/${cfg.org}/${cfg.project}/_apis/git/repositories/${cfg.repo}`;
        const H = { Authorization: 'Basic ' + btoa(':' + cfg.token), 'Content-Type': 'application/json' };
        const refs = await (await fetch(`${base}/refs?filter=heads/${cfg.branch}&api-version=7.1`, { headers: H })).json();
        const oldId = refs.value?.[0]?.objectId;
        if (!oldId) throw new Error(`Azure DevOps branch ${cfg.branch} not found`);
        const path = '/' + [String(cfg.path || '').replace(/^\/+|\/+$/g, ''), rel].filter(Boolean).join('/');
        const r = await fetch(`${base}/pushes?api-version=7.1`, { method: 'POST', headers: H, body: JSON.stringify({ refUpdates: [{ name: 'refs/heads/' + cfg.branch, oldObjectId: oldId }], commits: [{ comment: `Delete journal ${e.date} - ${e.title}`, changes: [{ changeType: 'delete', item: { path } }] }] }) });
        if (!r.ok && r.status !== 404) throw new Error(`Azure DevOps ${r.status}`);
      }
      toast(`Deleted from ${name}.`);
    }
  }

  async function reviewRemoteDeletions(provider: string, gone: Entry[]) {
    const b = entries();
    if (!b || !gone.length) return;
    const list = gone.slice(0, 12).map(e => `<li><b>${escapeHtml(e.date)}</b> · ${escapeHtml(e.title || 'Untitled note')}</li>`).join('') +
      (gone.length > 12 ? `<li>…and ${gone.length - 12} more</li>` : '');
    const r = await openModal({
      title: gone.length === 1 ? `A note was deleted in ${provider}` : `${gone.length} notes were deleted in ${provider}`,
      description: `They’re still in this browser. Remove them here too, or keep them as local notes (pushing again would re-create them).`,
      body: `<ul class="dm-list">${list}</ul>`,
      actions: [{ label: 'Keep them', value: 'keep' }, { label: 'Remove from this browser', value: 'remove', danger: true }],
      cancelValue: 'later',
    });
    if (r === 'remove') {
      gone.forEach(e => { b.remove(e); forget(e.id); });
      try { g().renderDayNotes?.(); g().renderRibbon?.(); } catch { /* ignore */ }
      toast(`Removed ${gone.length} note${gone.length === 1 ? '' : 's'}.`);
    } else if (r === 'keep') {
      gone.forEach(e => b.save({ ...e, repositoryKey: undefined, repositoryPath: undefined, repositorySha: undefined, contentFingerprint: undefined, source: 'local' }));
    }
  }

  function forget(id: string) { store.rm(baseKey(id)); }

  // ------------------------------------------------------------------- external edits
  let banner: HTMLElement | null = null;
  function notifyExternalChange(e: Entry, where = 'elsewhere') {
    banner?.remove();
    const host = document.getElementById('entry')?.closest('.writer') || document.getElementById('entry');
    if (!host || !host.parentElement) return;
    banner = document.createElement('div');
    banner.className = 'dm-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `<span>This note was changed ${escapeHtml(where)} while you were editing.</span><button type="button" class="btn" data-a="load">Load that version</button><button type="button" class="btn" data-a="keep">Keep mine</button>`;
    banner.addEventListener('click', ev => {
      const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'load') { const b = entries(); const fresh = b?.findById(e.id); if (fresh) g().setEntryText?.(fresh.text || ''); }
      else { try { g().flush?.(); } catch { /* ignore */ } }
      banner?.remove(); banner = null;
    });
    host.parentElement.insertBefore(banner, host);
  }

  // Keep open tabs in step: when another tab changes the note that's open here, reload it.
  store.on((key, _v, source) => {
    if (source !== 'remote') return;
    const m = /^daily:entry:v2:\d{4}-\d{2}-\d{2}:([A-Za-z0-9_-]+)$/.exec(key);
    if (!m) return;
    const b = entries();
    if (!b) return;
    if (b.current().id === m[1]) {
      const busy = ['entry', 'source', 'entryTitle'].some(id => document.getElementById(id) === document.activeElement);
      const e = b.findById(m[1]);
      if (e && busy) notifyExternalChange(e, 'in another tab'); else b.refresh(m[1]);
    }
    try { g().renderDayNotes?.(); g().renderRibbon?.(); } catch { /* ignore */ }
  });

  return {
    getBase, setBase, merge, applyText, afterPush, resolveRemoteChange, queueConflict, openConflicts,
    confirmDelete, deleteRemote, reviewRemoteDeletions, forget, notifyExternalChange,
    pendingConflicts: () => queue.length,
  };
}

export type DailySync = ReturnType<typeof createSync>;
