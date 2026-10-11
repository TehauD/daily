import { describe, expect, it } from 'vitest';
import { looksLikeEntry, plan, type LocalInfo, type VaultFile, type VaultState } from '../../src/core/vault/plan';

const rel = (id: string) => `2026/10/11/note--${id}.md`;
const local = (id: string, h = 'h-' + id, extra: Partial<LocalInfo> = {}): LocalInfo => ({ id, rel: rel(id), hash: h, empty: false, ...extra });
const file = (path: string, etag = 'e-' + path): VaultFile => ({ path, etag });
const state = (id: string, etag: string, hash = 'h-' + id, extra: Partial<VaultState> = {}): VaultState =>
  ({ path: rel(id), rel: rel(id), etag, hash, base: 'base', ...extra });

describe('vault plan', () => {
  it('writes new entries and skips blank ones', () => {
    const p = plan([local('a'), local('b', 'hb', { empty: true })], [], {}, { fresh: false });
    expect(p.actions).toEqual([{ type: 'write', id: 'a', path: rel('a'), ifMatch: null }]);
  });

  it('does nothing when both sides are unchanged', () => {
    const f = file(rel('a'));
    expect(plan([local('a')], [f], { a: state('a', f.etag) }, { fresh: false }).actions).toEqual([]);
  });

  it('writes local changes with the last known etag', () => {
    const f = file(rel('a'));
    expect(plan([local('a', 'changed')], [f], { a: state('a', f.etag) }, { fresh: false }).actions)
      .toEqual([{ type: 'write', id: 'a', path: rel('a'), ifMatch: f.etag }]);
  });

  it('pulls external edits and merges when both changed', () => {
    const f = file(rel('a'), 'new-etag');
    expect(plan([local('a')], [f], { a: state('a', 'old') }, { fresh: false }).actions).toEqual([{ type: 'pull', id: 'a', path: rel('a') }]);
    expect(plan([local('a', 'changed')], [f], { a: state('a', 'old') }, { fresh: false }).actions).toEqual([{ type: 'merge', id: 'a', path: rel('a') }]);
  });

  it('ignores a postponed conflict until the file changes again', () => {
    const f = file(rel('a'), 'deferred');
    expect(plan([local('a', 'changed')], [f], { a: state('a', 'old', 'h-a', { deferredEtag: 'deferred' }) }, { fresh: false }).actions)
      .toEqual([{ type: 'write', id: 'a', path: rel('a'), ifMatch: 'deferred' }]);
  });

  it('renames the file when the entry’s path changes', () => {
    const f = file(rel('a'));
    const l = local('a', 'h-a', { rel: '2026/10/11/renamed--a.md' });
    expect(plan([l], [f], { a: state('a', f.etag) }, { fresh: false }).actions)
      .toEqual([{ type: 'write', id: 'a', path: '2026/10/11/renamed--a.md', ifMatch: null, from: rel('a'), fromEtag: f.etag }]);
  });

  it('keeps hand-made file locations', () => {
    const f = file('2026/10/11/my-own-name.md');
    const s = state('a', f.etag, 'h-a', { path: f.path });
    expect(plan([local('a')], [f], { a: s }, { fresh: false }).actions).toEqual([]);
  });

  it('deletes locally when the file was removed, unless there are local edits', () => {
    expect(plan([local('a')], [], { a: state('a', 'x') }, { fresh: false }).actions).toEqual([{ type: 'deleteLocal', id: 'a', path: rel('a') }]);
    expect(plan([local('a', 'edited')], [], { a: state('a', 'x') }, { fresh: false }).actions)
      .toEqual([{ type: 'write', id: 'a', path: rel('a'), ifMatch: null }]);
  });

  it('holds a burst of external deletions for review', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const states = Object.fromEntries(ids.map(id => [id, state(id, 'x')]));
    const p = plan(ids.map(id => local(id)), [], states, { fresh: false });
    expect(p.actions).toEqual([]);
    expect(p.held).toHaveLength(6);
  });

  it('removes the file of an entry deleted here, but never a file edited since', () => {
    const f1 = file(rel('gone'));
    const f2 = file(rel('edited'), 'changed');
    const p = plan([], [f1, f2], { gone: state('gone', f1.etag), edited: state('edited', 'old') }, { fresh: false });
    expect(p.actions).toEqual([
      { type: 'deleteFile', id: 'gone', path: rel('gone'), etag: f1.etag },
      { type: 'forget', id: 'edited' },
    ]);
  });

  it('imports unknown journal files only', () => {
    const p = plan([], [file('2026/10/01/idea.md'), file('notes/readme.md'), file('2026-10-02.md')], {}, { fresh: false });
    expect(p.actions).toEqual([{ type: 'import', path: '2026/10/01/idea.md' }, { type: 'import', path: '2026-10-02.md' }]);
  });

  it('adopts existing files when pointed at a new folder', () => {
    const f = file(rel('a'));
    const p = plan([local('a'), local('b')], [f], { a: state('a', 'old') }, { fresh: true });
    expect(p.actions).toEqual([{ type: 'adopt', id: 'a', path: rel('a') }, { type: 'write', id: 'b', path: rel('b'), ifMatch: null }]);
  });

  it('recognizes journal file names', () => {
    expect(looksLikeEntry('2026/10/11/x.md')).toBe(true);
    expect(looksLikeEntry('journal/2026-10-11.md')).toBe(true);
    expect(looksLikeEntry('a/b--abc123.md')).toBe(true);
    expect(looksLikeEntry('README.md')).toBe(false);
  });
});
