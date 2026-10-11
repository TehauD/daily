/**
 * Feature modules ship inert (<script type="text/x-daily-module">) so storage can load
 * first. This starts them in document order with normal classic-script semantics
 * (shared globals, synchronous execution), then replays DOMContentLoaded / load for
 * modules that wait for those events if they already fired.
 */

const MODULE_TYPE = 'text/x-daily-module';

let domReady = typeof document !== 'undefined' && document.readyState !== 'loading';
let loaded = typeof document !== 'undefined' && document.readyState === 'complete';
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { domReady = true; }, { once: true });
  window.addEventListener('load', () => { loaded = true; }, { once: true });
}

export interface StartReport { started: string[]; failed: string[] }

export function startModules(root: ParentNode = document): StartReport {
  const report: StartReport = { started: [], failed: [] };
  const nodes = Array.from(root.querySelectorAll(`script[type="${MODULE_TYPE}"]`)) as HTMLScriptElement[];
  for (const node of nodes) {
    const id = node.id || '(anonymous)';
    let failed = false;
    const onError = (ev: ErrorEvent) => { failed = true; void ev; };
    window.addEventListener('error', onError);
    const s = document.createElement('script');
    if (node.id) s.id = node.id;
    s.textContent = node.textContent || '';
    node.replaceWith(s); // inline classic scripts run synchronously on insertion
    window.removeEventListener('error', onError);
    (failed ? report.failed : report.started).push(id);
  }
  if (domReady) document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  if (loaded) window.dispatchEvent(new Event('load'));
  return report;
}
