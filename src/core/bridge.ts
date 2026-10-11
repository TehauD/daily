/**
 * The contract between the typed core and the feature modules in src/legacy/.
 * The multi-file storage module publishes these on window.__dailyEntries.
 */

export interface Entry {
  id: string;
  date: string;
  title: string;
  slug: string;
  text: string;
  created?: string;
  updated?: string;
  savedAt?: string;
  project?: string;
  source?: string;
  repositoryKey?: string;
  repositoryPath?: string;
  contentFingerprint?: string;
  [k: string]: unknown;
}

export interface ParsedEntry { id?: string; date: string; title?: string; slug?: string; text: string; created?: string; [k: string]: unknown }

export interface EntriesBridge {
  all(): Entry[];
  get(date: string, id: string): Entry | null;
  findById(id: string): Entry | null;
  save(e: Partial<Entry>): Entry;
  remove(e: Entry): void;
  normalize(e: Partial<Entry>): Entry;
  /** Repository-relative path: YYYY/MM/DD/<slug>--<id>.md */
  relPath(e: Entry): string;
  /** Full Markdown file (frontmatter + body) for an entry. Deterministic. */
  serialize(e: Entry): string;
  parse(md: string, fallbackDate: string): ParsedEntry;
  current(): { date: string; id: string };
  /** Reload the editor from storage if it is showing this entry and isn't being edited. */
  refresh(id: string): void;
  select(date: string, id: string): void;
}

export function entries(): EntriesBridge | null {
  return (window as unknown as { __dailyEntries?: EntriesBridge }).__dailyEntries || null;
}

export function relayConfig(): Record<string, any> | null {
  return (window as unknown as { __relayConfig?: Record<string, any> }).__relayConfig || null;
}

export function entryKeyId(key: string): { date: string; id: string } | null {
  const m = /^daily:entry:v2:(\d{4}-\d{2}-\d{2}):([A-Za-z0-9_-]+)$/.exec(key);
  return m ? { date: m[1], id: m[2] } : null;
}
