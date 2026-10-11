/** Studio → Backup & export: where the journal is stored, how safe it is, and the journal folder. */
import type { DailyStore } from './storage/store';
import type { DailySync } from './sync';
import type { DailyVault } from './vault/client';
import { escapeHtml, toast } from './util';

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(1) + ' GB';
}

function ago(iso: string | null): string {
  if (!iso) return 'not yet';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return 'just now';
  if (s < 90) return s + ' seconds ago';
  const m = Math.round(s / 60);
  return m < 90 ? m + ' minutes ago' : new Date(iso).toLocaleString();
}

function row(label: string, desc: string, control: string): string {
  return `<div class="st-row"><div class="lb"><b>${escapeHtml(label)}</b>${desc ? `<small>${escapeHtml(desc)}</small>` : ''}</div><div class="ct">${control}</div></div>`;
}

export function installStorageStudio(store: DailyStore, sync: DailySync, vault: DailyVault): void {
  let card: HTMLElement | null = null;

  async function render() {
    const sec = document.querySelector('#studioModal .studio-section[data-s="data"]');
    if (!sec) return;
    if (!card || !sec.contains(card)) {
      card = document.createElement('div');
      card.className = 'studio-card core-storage';
      const after = sec.querySelector(':scope > p.intro') || sec.querySelector('h4');
      after?.insertAdjacentElement('afterend', card);
      card.addEventListener('click', onClick);
    }
    const info = await store.refreshInfo();
    const v = vault.status();
    const backup = await store.legacyBackup();
    const backupCount = backup ? Object.keys(backup).filter(k => k.startsWith('daily:entry:')).length : 0;
    const idb = info.mode === 'indexeddb';
    const conflicts = sync.pendingConflicts();
    card.innerHTML = '<h5>Where your journal lives</h5>' +
      row('This browser', idb ? 'A database in this browser profile (IndexedDB).' : 'IndexedDB isn’t available here, so the 5 MB browser storage is used.',
        `<span class="cap ${idb ? 'on' : 'off'}"><i>${idb ? '✓' : '!'}</i>${idb ? 'Database' : 'Limited storage'}</span><span class="core-dim">${fmtBytes(info.usage)}${info.quota ? ' of ' + fmtBytes(info.quota) : ''} used</span>`) +
      row('Protection', 'Browsers can clear site data when the disk is low unless the site is marked persistent.',
        info.persisted ? '<span class="cap on"><i>✓</i>Protected</span>' : '<span class="cap off"><i>○</i>Not protected</span><button class="btn" type="button" data-core="persist">Protect my journal</button>') +
      row('Journal folder', v.enabled ? 'Every note is also a Markdown file on this computer, kept in step both ways.' : 'Run the relay (python relay.py) to keep every note as a Markdown file on this computer.',
        v.enabled
          ? `<code class="core-path" title="${escapeHtml(v.path)}">${escapeHtml(v.path)}</code><span class="core-dim">${v.files} files · synced ${escapeHtml(ago(v.lastSync))}${v.syncing ? ' · syncing…' : ''}</span><button class="btn" type="button" data-core="vault">Sync now</button>` +
            (v.lastError ? `<span class="core-err">${escapeHtml(v.lastError)}</span>` : '') + (v.held ? `<span class="core-err">${v.held} notes are missing from the folder and were kept here.</span>` : '')
          : '<span class="cap off"><i>○</i>Off</span>') +
      (conflicts ? row('Needs review', 'Notes that changed both here and in the repository.', `<button class="btn primary" type="button" data-core="conflicts">Review ${conflicts}</button>`) : '') +
      (backupCount || backup ? row('Pre-2.0 copy', 'The journal as it was in browser storage before this version moved it to the database.',
        `<span class="core-dim">${backupCount} entries</span><button class="btn" type="button" data-core="dl-backup">Download</button><button class="btn" type="button" data-core="rm-backup">Delete</button>`) : '');
  }

  async function onClick(e: Event) {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-core]')?.dataset.core;
    if (!a) return;
    if (a === 'persist') {
      const ok = await store.requestPersistence();
      toast(ok ? 'Your journal is now protected from automatic clean-up.' : 'The browser declined for now. Installing the site as an app, or using it often, usually changes that.');
    } else if (a === 'vault') {
      await vault.syncNow();
    } else if (a === 'conflicts') {
      await sync.openConflicts();
    } else if (a === 'dl-backup') {
      const b = await store.legacyBackup();
      if (b) {
        const blob = new Blob([JSON.stringify({ type: 'the-daily-pre-2.0-storage', exportedAt: new Date().toISOString(), keys: b }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement('a'), { href: url, download: 'the-daily-pre-2.0-copy.json' });
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } else if (a === 'rm-backup') {
      if (confirm('Delete the pre-2.0 copy? Your journal itself is not affected.')) { await store.clearLegacyBackup(); toast('Deleted the pre-2.0 copy.'); }
    }
    void render();
  }

  // Render whenever the Backup & export section is shown, and keep it live while visible.
  document.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('[data-s="data"]')) setTimeout(() => void render(), 0);
  });
  vault.onChange(() => {
    const sec = document.querySelector('#studioModal .studio-section[data-s="data"].on');
    if (sec) void render();
  });
  const sec = document.querySelector('#studioModal .studio-section[data-s="data"]');
  if (sec) void render();
}
