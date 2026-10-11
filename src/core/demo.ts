/**
 * The hosted demo (e.g. thedaily.azurewebsites.net): the same single page, tuned so a
 * visitor can start writing immediately. No introduction dialog; a slim, dismissible
 * note explains that everything stays in their browser.
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/i;
const DISMISSED = 'daily:demoNoteDismissed';
export const REPO_URL = 'https://github.com/TehauD/daily';

export function isHostedDemo(loc: Location = location): boolean {
  if (!/^https?:$/.test(loc.protocol)) return false;
  const h = loc.hostname;
  return !(LOCAL_HOST.test(h) || h.endsWith('.localhost') || h.endsWith('.local'));
}

function ls(): Storage | null { try { return localStorage; } catch { return null; } }

/** Before the feature modules start: skip the first-run dialog. */
export function prepareDemo(): void {
  document.documentElement.dataset.demo = '1';
  const s = ls();
  try { if (s && !s.getItem('daily:introSeen')) s.setItem('daily:introSeen', 'demo'); } catch { /* ignore */ }
}

/** After the modules start: the note above the editor and focus in the editor. */
export function installDemo(): void {
  const s = ls();
  const host = document.querySelector('.wrap .prompt')?.parentElement || document.querySelector('.wrap');
  const anchor = document.getElementById('multiFileBar') || document.querySelector('.wrap .prompt');
  if (host && anchor && !(s && s.getItem(DISMISSED))) {
    const note = document.createElement('div');
    note.className = 'demo-note';
    note.setAttribute('role', 'note');
    note.innerHTML =
      '<span class="demo-dot" aria-hidden="true"></span>' +
      '<span class="demo-txt"><b>Try it right here.</b> Notes are saved in this browser only; nothing is uploaded.</span>' +
      '<span class="demo-acts"><button type="button" data-a="tour">Take the tour</button>' +
      `<a href="${REPO_URL}" target="_blank" rel="noopener">Run it yourself ↗</a>` +
      '<button type="button" class="demo-x" data-a="close" aria-label="Dismiss">✕</button></span>';
    note.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'tour') { try { (window as any).openAbout?.(); } catch { /* ignore */ } }
      if (a === 'close') { note.remove(); try { s?.setItem(DISMISSED, '1'); } catch { /* ignore */ } }
    });
    anchor.parentElement?.insertBefore(note, anchor);
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (!coarse) setTimeout(() => { const ed = document.getElementById('entry'); if (ed && !document.querySelector('.mback.open')) ed.focus(); }, 80);
}
