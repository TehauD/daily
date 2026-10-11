/**
 * Boot sequence for The Daily.
 *
 *   1. Open storage (IndexedDB, migrating from localStorage on first run).
 *   2. Publish the core services the feature modules use: DailyStore, DailySync, DailyVault.
 *   3. Start the feature modules (src/legacy) in order.
 *   4. Start the journal-folder sync once the relay configuration is known.
 */
import { DailyStore } from './storage/store';
import { startModules } from './boot/modules';
import { createSync } from './sync';
import { createVault } from './vault/client';
import { installDemo, isHostedDemo, prepareDemo } from './demo';
import { installStorageStudio } from './studio';
import { toast } from './util';

declare const __DAILY_VERSION__: string;

type W = Window & Record<string, any>;
const w = window as unknown as W;

function isChromium(): boolean {
  const brands = (navigator as any).userAgentData?.brands as Array<{ brand: string }> | undefined;
  return !!brands?.some(b => /Chromium/i.test(b.brand));
}

async function boot(): Promise<void> {
  let store: DailyStore;
  try {
    store = await DailyStore.create({ onError: m => toast(m) });
  } catch (err) {
    console.error('[The Daily] storage failed to open; using browser storage instead', err);
    store = await DailyStore.create({ idbFactory: null, onError: m => toast(m) });
  }
  w.DailyStore = store;
  const sync = createSync(store);
  w.DailySync = sync;
  const vault = createVault(store);
  w.DailyVault = vault;
  w.__DAILY_VERSION__ = typeof __DAILY_VERSION__ === 'string' ? __DAILY_VERSION__ : 'dev';

  const demo = isHostedDemo();
  if (demo) prepareDemo();

  const report = startModules();
  if (report.failed.length) console.warn('[The Daily] some modules reported errors while starting:', report.failed.join(', '));
  if (demo) installDemo();
  installStorageStudio(store, sync, vault);

  const startVault = () => { void vault.start(); };
  if (w.__relayConfig) startVault(); else document.addEventListener('daily:relay', startVault, { once: true });

  window.addEventListener('pagehide', () => { void store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store.flush(); });

  // Chromium grants persistence silently to engaged sites; elsewhere it's a prompt, so it
  // is offered in Studio instead of being asked for unprompted.
  if (store.info.mode === 'indexeddb' && isChromium()) {
    setTimeout(() => {
      try {
        const n = typeof w.allEntries === 'function' ? w.allEntries().length : 0;
        if (n >= 3) void store.requestPersistence();
      } catch { /* ignore */ }
    }, 4000);
  }
  store.refreshInfo().then(() => { try { w.renderQuota?.(); } catch { /* ignore */ } });
}

boot().catch(err => {
  console.error('[The Daily] start-up failed', err);
  if (!w.DailyStore) {
    void DailyStore.create({ idbFactory: null }).then(s => { w.DailyStore = s; startModules(); });
  }
});
