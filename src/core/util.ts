/** Small shared helpers for the core. */

/** 53-bit string hash (cyrb53). Fast and well distributed; not cryptographic. */
export function hash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Text normalized for "did the content really change?" comparisons. */
export function normalizeText(text: string): string {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function toast(message: string): void {
  const w = window as unknown as { toast?: (m: string) => void };
  try { w.toast?.(escapeHtml(message)); } catch { /* the UI isn't ready yet */ }
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { flush(): void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: Parameters<T> | undefined;
  const run = () => { t = undefined; const a = pending; pending = undefined; if (a) fn(...a); };
  const d = ((...args: Parameters<T>) => { pending = args; if (t) clearTimeout(t); t = setTimeout(run, ms); }) as T & { flush(): void };
  d.flush = () => { if (t) { clearTimeout(t); run(); } };
  return d;
}
