/** The conflict resolver: choose, difference by difference, what to keep. */
import { applyResolutions, type MergeChunk } from './diff3';
import { openModal } from '../ui/modal';
import { escapeHtml } from '../util';

type Choice = 'ours' | 'theirs' | 'both' | undefined;

export interface ResolveRequest {
  title: string;
  /** Where the other version came from, e.g. "GitHub" or "your journal folder". */
  otherLabel: string;
  chunks: MergeChunk[];
}

function linesHtml(lines: string[]): string {
  return lines.length ? escapeHtml(lines.join('\n')) : '<span class="dm-empty">(nothing)</span>';
}

function contextHtml(lines: string[]): string {
  if (!lines.length) return '';
  if (lines.length <= 4) return `<pre class="rs-ctx">${escapeHtml(lines.join('\n'))}</pre>`;
  const head = lines.slice(0, 2).join('\n');
  const tail = lines.slice(-2).join('\n');
  return `<pre class="rs-ctx">${escapeHtml(head)}\n<span class="rs-gap">· · · ${lines.length - 4} unchanged lines · · ·</span>\n${escapeHtml(tail)}</pre>`;
}

/** Resolves with the final text, or null if the person cancels. */
export async function resolveConflicts(req: ResolveRequest): Promise<string | null> {
  const conflicts = req.chunks.filter(c => c.kind === 'conflict');
  const choices: Choice[] = conflicts.map(() => undefined);
  const root = document.createElement('div');
  root.className = 'rs';
  let k = 0;
  const parts: string[] = [
    `<div class="rs-bulk" role="group" aria-label="Choose for every difference">` +
    `<button type="button" class="btn" data-all="ours">Keep all mine</button>` +
    `<button type="button" class="btn" data-all="theirs">Keep all from ${escapeHtml(req.otherLabel)}</button>` +
    `<span class="rs-count" aria-live="polite"></span></div>`,
  ];
  for (const c of req.chunks) {
    if (c.kind === 'ok') { parts.push(contextHtml(c.lines)); continue; }
    const i = k++;
    parts.push(
      `<section class="rs-c" data-i="${i}" aria-label="Difference ${i + 1} of ${conflicts.length}">` +
      `<div class="rs-cols"><div class="rs-side"><h3>Yours</h3><pre>${linesHtml(c.ours)}</pre></div>` +
      `<div class="rs-side"><h3>${escapeHtml(req.otherLabel)}</h3><pre>${linesHtml(c.theirs)}</pre></div></div>` +
      `<div class="rs-pick" role="radiogroup" aria-label="What to keep for difference ${i + 1}">` +
      `<button type="button" role="radio" aria-checked="false" data-v="ours">Keep mine</button>` +
      `<button type="button" role="radio" aria-checked="false" data-v="theirs">Keep theirs</button>` +
      `<button type="button" role="radio" aria-checked="false" data-v="both">Keep both</button></div></section>`,
    );
  }
  parts.push(`<details class="rs-edit"><summary>Edit the result by hand</summary><textarea class="f" rows="10" aria-label="Merged text"></textarea>` +
    `<p class="dm-note">Undecided differences appear between &lt;&lt;&lt;&lt;&lt;&lt;&lt; and &gt;&gt;&gt;&gt;&gt;&gt;&gt; markers. Editing here replaces the choices above.</p></details>`);
  root.innerHTML = parts.join('');
  const ta = root.querySelector('textarea') as HTMLTextAreaElement;
  const edit = root.querySelector('.rs-edit') as HTMLDetailsElement;
  let manual = false;

  function preview(): string {
    let j = 0;
    const out: string[] = [];
    for (const c of req.chunks) {
      if (c.kind === 'ok') { out.push(...c.lines); continue; }
      const ch = choices[j++];
      if (ch === 'ours') out.push(...c.ours);
      else if (ch === 'theirs') out.push(...c.theirs);
      else if (ch === 'both') out.push(...c.ours, ...c.theirs);
      else out.push('<<<<<<< mine', ...c.ours, '=======', ...c.theirs, '>>>>>>> ' + req.otherLabel);
    }
    return out.join('\n');
  }

  let setDisabled: (v: string, d: boolean) => void = () => {};
  function sync() {
    root.querySelectorAll<HTMLElement>('.rs-c').forEach(sec => {
      const i = Number(sec.dataset.i);
      sec.classList.toggle('done', !!choices[i]);
      sec.querySelectorAll<HTMLButtonElement>('[data-v]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === choices[i])));
    });
    const left = choices.filter(c => !c).length;
    (root.querySelector('.rs-count') as HTMLElement).textContent = manual ? 'Using your edited text' : left ? `${left} of ${choices.length} left to decide` : 'All decided';
    if (!manual) ta.value = preview();
    setDisabled('apply', !manual && left > 0);
  }
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const all = t.closest<HTMLElement>('[data-all]');
    if (all) { choices.fill(all.dataset.all as Choice); manual = false; sync(); return; }
    const v = t.closest<HTMLElement>('[data-v]');
    if (v) {
      const sec = v.closest<HTMLElement>('.rs-c');
      if (sec) { choices[Number(sec.dataset.i)] = v.dataset.v as Choice; manual = false; sync(); }
    }
  });
  ta.addEventListener('input', () => { manual = true; sync(); });
  edit.addEventListener('toggle', () => { if (edit.open) ta.focus(); });

  const n = conflicts.length;
  const result = await openModal({
    title: `Combine the two versions of “${req.title}”`,
    description: `This note changed both here and in ${req.otherLabel} since they were last in step. Everything else merged automatically; ` +
      (n === 1 ? 'one difference needs a decision.' : `${n} differences need a decision.`),
    body: root,
    wide: true,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Use this version', value: 'apply', primary: true, disabled: true }],
    onRender: (_r, sd) => { setDisabled = sd; sync(); },
  });
  if (result !== 'apply') return null;
  return manual ? ta.value : applyResolutions(req.chunks, choices.map(c => c || 'ours'));
}
