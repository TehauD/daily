/**
 * Line-based three-way merge (diff3).
 *
 * Given the common ancestor (`base`) and two descendants (`ours`, `theirs`), produce
 * the merged text. Regions changed on only one side are taken from that side;
 * regions changed identically on both sides are taken once; regions changed
 * differently on both sides become conflicts for the person to resolve.
 *
 * Like git, edits that touch adjacent lines on both sides are treated as a conflict,
 * because there's no safe way to tell whether they depend on each other.
 */

export type MergeChunk =
  | { kind: 'ok'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; base: string[]; theirs: string[] };

export interface MergeResult {
  clean: boolean;
  chunks: MergeChunk[];
  /** The merged text when clean; otherwise undefined. */
  text?: string;
  conflicts: number;
}

interface Hunk { oStart: number; oLen: number; xStart: number; xLen: number }

/** Split into lines, keeping the knowledge of a trailing newline in the last element. */
export function splitLines(text: string): string[] {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  return t === '' ? [] : t.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}

/** Longest common subsequence match pairs between a[aLo..aHi) and b[bLo..bHi). */
function lcsPairs(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number): Array<[number, number]> {
  const n = aHi - aLo;
  const m = bHi - bLo;
  if (n === 0 || m === 0) return [];
  // Large unmatched middles fall back to a single replacement hunk: still a correct
  // merge, just coarser, and it keeps memory bounded for pasted logs.
  if (n * m > 4_000_000) return [];
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[aLo + i] === b[bLo + j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[aLo + i] === b[bLo + j]) { pairs.push([aLo + i, bLo + j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Hunks where `x` differs from `o`. */
export function diffHunks(o: string[], x: string[]): Hunk[] {
  let pre = 0;
  while (pre < o.length && pre < x.length && o[pre] === x[pre]) pre++;
  let suf = 0;
  while (suf < o.length - pre && suf < x.length - pre && o[o.length - 1 - suf] === x[x.length - 1 - suf]) suf++;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  pairs.push(...lcsPairs(o, x, pre, o.length - suf, pre, x.length - suf));
  for (let k = suf; k > 0; k--) pairs.push([o.length - k, x.length - k]);
  pairs.push([o.length, x.length]); // sentinel
  const hunks: Hunk[] = [];
  let oi = 0;
  let xi = 0;
  for (const [po, px] of pairs) {
    if (po > oi || px > xi) hunks.push({ oStart: oi, oLen: po - oi, xStart: xi, xLen: px - xi });
    oi = po + 1;
    xi = px + 1;
  }
  return hunks;
}

function sideRange(hunks: Hunk[], regionStart: number, regionEnd: number): [number, number] {
  const first = hunks[0];
  const last = hunks[hunks.length - 1];
  const start = first.xStart - (first.oStart - regionStart);
  const end = last.xStart + last.xLen + (regionEnd - (last.oStart + last.oLen));
  return [start, end];
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function merge3(base: string, ours: string, theirs: string): MergeResult {
  const O = splitLines(base);
  const A = splitLines(ours);
  const B = splitLines(theirs);
  if (ours === theirs) return { clean: true, chunks: [{ kind: 'ok', lines: A }], text: ours, conflicts: 0 };
  if (ours === base) return { clean: true, chunks: [{ kind: 'ok', lines: B }], text: theirs, conflicts: 0 };
  if (theirs === base) return { clean: true, chunks: [{ kind: 'ok', lines: A }], text: ours, conflicts: 0 };

  type Tagged = Hunk & { side: 'a' | 'b' };
  const hunks: Tagged[] = [
    ...diffHunks(O, A).map(h => ({ ...h, side: 'a' as const })),
    ...diffHunks(O, B).map(h => ({ ...h, side: 'b' as const })),
  ].sort((p, q) => p.oStart - q.oStart || (p.side === q.side ? 0 : p.side === 'a' ? -1 : 1));

  const chunks: MergeChunk[] = [];
  const pushOk = (lines: string[]) => {
    if (!lines.length) return;
    const prev = chunks[chunks.length - 1];
    if (prev && prev.kind === 'ok') prev.lines.push(...lines);
    else chunks.push({ kind: 'ok', lines: [...lines] });
  };
  let oIdx = 0;
  let i = 0;
  let conflicts = 0;
  while (i < hunks.length) {
    const regionStart = hunks[i].oStart;
    let regionEnd = hunks[i].oStart + hunks[i].oLen;
    let j = i + 1;
    while (j < hunks.length && hunks[j].oStart <= regionEnd) {
      regionEnd = Math.max(regionEnd, hunks[j].oStart + hunks[j].oLen);
      j++;
    }
    pushOk(O.slice(oIdx, regionStart));
    const group = hunks.slice(i, j);
    const aH = group.filter(h => h.side === 'a');
    const bH = group.filter(h => h.side === 'b');
    if (!bH.length) {
      const [s, e] = sideRange(aH, regionStart, regionEnd);
      pushOk(A.slice(s, e));
    } else if (!aH.length) {
      const [s, e] = sideRange(bH, regionStart, regionEnd);
      pushOk(B.slice(s, e));
    } else {
      const [as, ae] = sideRange(aH, regionStart, regionEnd);
      const [bs, be] = sideRange(bH, regionStart, regionEnd);
      const aText = A.slice(as, ae);
      const bText = B.slice(bs, be);
      if (same(aText, bText)) pushOk(aText);
      else {
        chunks.push({ kind: 'conflict', ours: aText, base: O.slice(regionStart, regionEnd), theirs: bText });
        conflicts++;
      }
    }
    oIdx = regionEnd;
    i = j;
  }
  pushOk(O.slice(oIdx));
  const clean = conflicts === 0;
  return { clean, chunks, conflicts, text: clean ? joinLines(chunks.flatMap(c => (c.kind === 'ok' ? c.lines : []))) : undefined };
}

/** Build the final text from chunks once every conflict has a chosen resolution. */
export function applyResolutions(chunks: MergeChunk[], choices: Array<'ours' | 'theirs' | 'both' | string[]>): string {
  const out: string[] = [];
  let k = 0;
  for (const c of chunks) {
    if (c.kind === 'ok') { out.push(...c.lines); continue; }
    const choice = choices[k++];
    if (Array.isArray(choice)) out.push(...choice);
    else if (choice === 'theirs') out.push(...c.theirs);
    else if (choice === 'both') out.push(...c.ours, ...c.theirs);
    else out.push(...c.ours);
  }
  return joinLines(out);
}
