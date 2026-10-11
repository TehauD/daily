import { describe, expect, it } from 'vitest';
import { applyResolutions, diffHunks, merge3, splitLines } from '../../src/core/sync/diff3';

const L = (...xs: string[]) => xs.join('\n');

describe('merge3', () => {
  it('returns the other side when one side is unchanged', () => {
    const base = L('a', 'b', 'c');
    expect(merge3(base, base, L('a', 'B', 'c')).text).toBe(L('a', 'B', 'c'));
    expect(merge3(base, L('a', 'b', 'c', 'd'), base).text).toBe(L('a', 'b', 'c', 'd'));
  });

  it('merges edits in different places', () => {
    const base = L('title', '', 'one', 'two', 'three', '', 'four', 'five');
    const ours = L('TITLE', '', 'one', 'two', 'three', '', 'four', 'five');
    const theirs = L('title', '', 'one', 'two', 'three', '', 'four', 'five', 'six');
    const r = merge3(base, ours, theirs);
    expect(r.clean).toBe(true);
    expect(r.text).toBe(L('TITLE', '', 'one', 'two', 'three', '', 'four', 'five', 'six'));
  });

  it('takes an identical change from both sides once', () => {
    const r = merge3(L('a', 'b', 'c'), L('a', 'X', 'c'), L('a', 'X', 'c'));
    expect(r).toMatchObject({ clean: true, text: L('a', 'X', 'c') });
  });

  it('reports a conflict when both sides change the same line differently', () => {
    const r = merge3(L('a', 'b', 'c'), L('a', 'mine', 'c'), L('a', 'theirs', 'c'));
    expect(r.clean).toBe(false);
    expect(r.conflicts).toBe(1);
    expect(r.chunks).toEqual([
      { kind: 'ok', lines: ['a'] },
      { kind: 'conflict', ours: ['mine'], base: ['b'], theirs: ['theirs'] },
      { kind: 'ok', lines: ['c'] },
    ]);
  });

  it('treats insertions at the same point as a conflict', () => {
    const r = merge3(L('a', 'z'), L('a', 'm', 'z'), L('a', 't', 'z'));
    expect(r.conflicts).toBe(1);
  });

  it('handles deletion on one side and an edit elsewhere on the other', () => {
    const base = L('1', '2', '3', '4', '5', '6');
    const r = merge3(base, L('1', '3', '4', '5', '6'), L('1', '2', '3', '4', '5', 'six'));
    expect(r).toMatchObject({ clean: true, text: L('1', '3', '4', '5', 'six') });
  });

  it('handles empty bases and texts', () => {
    expect(merge3('', 'new', '').text).toBe('new');
    expect(merge3('', '', 'new').text).toBe('new');
    expect(merge3('', 'a', 'b').clean).toBe(false);
    expect(splitLines('')).toEqual([]);
  });

  it('applies chosen resolutions', () => {
    const r = merge3(L('h', 'x', 'm', 'y', 't'), L('h', 'X1', 'm', 'Y1', 't'), L('h', 'X2', 'm', 'Y2', 't'));
    expect(r.conflicts).toBe(2);
    expect(applyResolutions(r.chunks, ['ours', 'theirs'])).toBe(L('h', 'X1', 'm', 'Y2', 't'));
    expect(applyResolutions(r.chunks, ['both', ['custom']])).toBe(L('h', 'X1', 'X2', 'm', 'custom', 't'));
  });

  it('keeps working on very large inputs', () => {
    const base = Array.from({ length: 3000 }, (_, i) => 'line ' + i);
    const ours = [...base]; ours[10] = 'ours';
    const theirs = [...base]; theirs[2900] = 'theirs';
    const r = merge3(base.join('\n'), ours.join('\n'), theirs.join('\n'));
    expect(r.clean).toBe(true);
    expect(r.text?.split('\n')[10]).toBe('ours');
    expect(r.text?.split('\n')[2900]).toBe('theirs');
  });

  it('is correct on randomized one-sided and disjoint edits', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let round = 0; round < 300; round++) {
      const n = 8 + rnd(30);
      const base = Array.from({ length: n }, (_, i) => `b${i}`);
      const cut = 2 + rnd(n - 4);
      // ours edits only lines before `cut - 1`, theirs only lines after `cut + 1`: always disjoint
      const ours = base.map((l, i) => (i < cut - 1 && rnd(3) === 0 ? `o${i}` : l));
      const theirs = base.map((l, i) => (i > cut + 1 && rnd(3) === 0 ? `t${i}` : l));
      const r = merge3(base.join('\n'), ours.join('\n'), theirs.join('\n'));
      const want = base.map((l, i) => (ours[i] !== l ? ours[i] : theirs[i]));
      expect(r.clean).toBe(true);
      expect(r.text).toBe(want.join('\n'));
      expect(merge3(base.join('\n'), ours.join('\n'), base.join('\n')).text).toBe(ours.join('\n'));
    }
  });
});

describe('diffHunks', () => {
  it('finds the changed ranges', () => {
    expect(diffHunks(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ oStart: 1, oLen: 1, xStart: 1, xLen: 1 }]);
    expect(diffHunks(['a'], ['a', 'b'])).toEqual([{ oStart: 1, oLen: 0, xStart: 1, xLen: 1 }]);
    expect(diffHunks(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});
