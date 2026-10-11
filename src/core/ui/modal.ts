/** Accessible modal dialogs for the core (focus trap, Escape, restored focus). */

export interface ModalOptions {
  title: string;
  description?: string;
  body: HTMLElement | string;
  wide?: boolean;
  actions: Array<{ label: string; value: string; primary?: boolean; danger?: boolean; disabled?: boolean }>;
  /** Value returned when the person presses Escape or clicks outside. */
  cancelValue?: string;
  onRender?: (root: HTMLElement, setDisabled: (value: string, disabled: boolean) => void) => void;
}

let seq = 0;

export function openModal(opts: ModalOptions): Promise<string> {
  return new Promise(resolve => {
    const id = 'dm-' + ++seq;
    const back = document.createElement('div');
    back.className = 'dm-back';
    back.innerHTML =
      `<div class="dm${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t"${opts.description ? ` aria-describedby="${id}-d"` : ''}>` +
      `<div class="dm-head"><h2 id="${id}-t"></h2>${opts.description ? `<p id="${id}-d"></p>` : ''}</div>` +
      `<div class="dm-body"></div><div class="dm-foot"></div></div>`;
    (back.querySelector('h2') as HTMLElement).textContent = opts.title;
    if (opts.description) (back.querySelector('.dm-head p') as HTMLElement).textContent = opts.description;
    const body = back.querySelector('.dm-body') as HTMLElement;
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else body.appendChild(opts.body);
    const foot = back.querySelector('.dm-foot') as HTMLElement;
    const buttons = new Map<string, HTMLButtonElement>();
    for (const a of opts.actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.disabled = !!a.disabled;
      b.addEventListener('click', () => close(a.value));
      foot.appendChild(b);
      buttons.set(a.value, b);
    }
    const prev = document.activeElement as HTMLElement | null;
    const cancel = opts.cancelValue ?? 'cancel';
    function focusables(): HTMLElement[] {
      return Array.from(back.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
        .filter(el => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancel); return; }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    function close(value: string) {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      try { prev?.focus(); } catch { /* ignore */ }
      resolve(value);
    }
    back.addEventListener('mousedown', e => { if (e.target === back) close(cancel); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    opts.onRender?.(back, (value, disabled) => { const b = buttons.get(value); if (b) b.disabled = disabled; });
    setTimeout(() => {
      const primary = Array.from(buttons.values()).reverse().find(b => b.classList.contains('primary') && !b.disabled);
      (body.querySelector<HTMLElement>('[autofocus]') || primary || focusables()[0])?.focus();
    }, 20);
  });
}
