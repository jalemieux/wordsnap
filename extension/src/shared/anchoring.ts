// Pure text functions for locating model quotes in the draft and carrying spans across edits.
// No DOM, no chrome.*; fully unit-testable.
import type { Span, TextSnapshot } from './types';

/* ---------- normalization ---------- */

const QUOTE_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...',
};

function isSpace(c: string): boolean {
  return /\s/.test(c) || c === ' ' || c === '​';
}

interface Normalized {
  text: string;
  /** normalized index -> original index of the character it came from */
  map: number[];
}

/** Collapses whitespace runs to one space, straightens quotes and dashes, optionally lowercases. Keeps an index map back to the original. */
export function normalizeText(input: string, lower = false): Normalized {
  let out = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (isSpace(c)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      map.push(i);
      pendingSpace = false;
    }
    const rep = QUOTE_MAP[c] ?? c;
    for (const rc of rep) {
      out += lower ? rc.toLowerCase() : rc;
      map.push(i);
    }
  }
  return { text: out, map };
}

/* ---------- quote location ---------- */

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

function pickNearest(candidates: Span[], hint?: number): Span | null {
  if (candidates.length === 0) return null;
  if (hint === undefined) return candidates[0]!;
  let best = candidates[0]!;
  let bestD = Math.abs(best.start - hint);
  for (const c of candidates) {
    const d = Math.abs(c.start - hint);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * Find `quote` in `text`. Exact match first, then whitespace/quote/dash-normalized, then case-insensitive normalized.
 * With several matches, the one nearest `hint` wins. Returns null when the quote is not in the text.
 */
export function locateQuote(text: string, quote: string, hint?: number): Span | null {
  const q = quote.trim();
  if (!q) return null;

  const exact = allIndexes(text, q).map((s) => ({ start: s, end: s + q.length }));
  if (exact.length) return pickNearest(exact, hint);

  for (const lower of [false, true]) {
    const nt = normalizeText(text, lower);
    const nq = normalizeText(q, lower);
    if (!nq.text) return null;
    const hits = allIndexes(nt.text, nq.text).map((s) => {
      const e = s + nq.text.length - 1;
      return { start: nt.map[s]!, end: nt.map[e]! + 1 };
    });
    if (hits.length) return pickNearest(hits, hint);
  }
  return null;
}

/* ---------- diff ---------- */

export type EditOp = { op: 'eq' | 'del' | 'ins'; oldStart: number; oldEnd: number; newStart: number; newEnd: number };

const MYERS_MAX_D = 2000;
const MYERS_MAX_AREA = 4_000_000;

/** Character diff as a list of runs. Common prefix/suffix trimmed, Myers in the middle, single replacement as fallback. */
export function diffText(oldText: string, newText: string): EditOp[] {
  let p = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (p < minLen && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < minLen - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;

  const ops: EditOp[] = [];
  if (p) ops.push({ op: 'eq', oldStart: 0, oldEnd: p, newStart: 0, newEnd: p });

  const oldMid = oldText.slice(p, oldText.length - s);
  const newMid = newText.slice(p, newText.length - s);

  if (oldMid.length || newMid.length) {
    const mid = myers(oldMid, newMid);
    if (mid) {
      for (const o of mid) {
        ops.push({ op: o.op, oldStart: o.oldStart + p, oldEnd: o.oldEnd + p, newStart: o.newStart + p, newEnd: o.newEnd + p });
      }
    } else {
      if (oldMid.length) ops.push({ op: 'del', oldStart: p, oldEnd: p + oldMid.length, newStart: p, newEnd: p });
      if (newMid.length) ops.push({ op: 'ins', oldStart: p + oldMid.length, oldEnd: p + oldMid.length, newStart: p, newEnd: p + newMid.length });
    }
  }
  if (s) {
    ops.push({ op: 'eq', oldStart: oldText.length - s, oldEnd: oldText.length, newStart: newText.length - s, newEnd: newText.length });
  }
  return mergeOps(ops);
}

function mergeOps(ops: EditOp[]): EditOp[] {
  const out: EditOp[] = [];
  for (const o of ops) {
    const last = out[out.length - 1];
    if (last && last.op === o.op && last.oldEnd === o.oldStart && last.newEnd === o.newStart) {
      last.oldEnd = o.oldEnd;
      last.newEnd = o.newEnd;
    } else {
      out.push({ ...o });
    }
  }
  return out;
}

/** Myers O(ND) on characters. Returns null when the inputs are too large or too different to be worth it. */
function myers(a: string, b: string): EditOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > MYERS_MAX_AREA) return null;
  const max = Math.min(n + m, MYERS_MAX_D);
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return null;

  // backtrack
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!)) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ op: 'eq', oldStart: x - 1, oldEnd: x, newStart: y - 1, newEnd: y });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ op: 'ins', oldStart: x, oldEnd: x, newStart: y - 1, newEnd: y });
        y--;
      } else {
        ops.push({ op: 'del', oldStart: x - 1, oldEnd: x, newStart: y, newEnd: y });
        x--;
      }
    }
  }
  ops.reverse();
  return mergeOps(ops);
}

/* ---------- span shifting ---------- */

export interface ShiftedSpan {
  span: Span | null;
  changed: boolean;
}

function mapPos(ops: EditOp[], pos: number, side: 'start' | 'end', oldLen: number, newLen: number): number {
  if (pos >= oldLen) return newLen - (oldLen - pos);
  for (const o of ops) {
    if (o.op === 'ins') {
      if (o.oldStart === pos) {
        // insertion exactly at this position: starts skip over it, ends stay before it
        return side === 'start' ? o.newEnd : o.newStart;
      }
      continue;
    }
    if (pos >= o.oldStart && pos < o.oldEnd) {
      return o.op === 'eq' ? o.newStart + (pos - o.oldStart) : o.newStart;
    }
  }
  return newLen;
}

/** Carry spans from oldText to newText. `changed` is true when any character inside the span was inserted, deleted or replaced. */
export function shiftSpans(oldText: string, newText: string, spans: Span[]): ShiftedSpan[] {
  if (oldText === newText) return spans.map((s) => ({ span: { ...s }, changed: false }));
  const ops = diffText(oldText, newText);
  return spans.map((s) => {
    let changed = false;
    for (const o of ops) {
      if (o.op === 'del' && o.oldStart < s.end && o.oldEnd > s.start) changed = true;
      if (o.op === 'ins' && o.oldStart > s.start && o.oldStart < s.end) changed = true;
    }
    let start = mapPos(ops, s.start, 'start', oldText.length, newText.length);
    let end = mapPos(ops, s.end, 'end', oldText.length, newText.length);
    if (end < start) end = start;
    if (start === end) {
      // the whole span was deleted
      return { span: null, changed: true };
    }
    // a start may land after an insertion that swallowed the original start
    if (start > end) start = end;
    return { span: { start, end }, changed };
  });
}

/* ---------- snapshots ---------- */

/** Indexes of paragraphs in `next` whose text does not appear verbatim in `prev`. */
export function changedParagraphs(prev: TextSnapshot | null, next: TextSnapshot): number[] {
  if (!prev) return next.paragraphs.map((_, i) => i);
  const seen = new Set(prev.paragraphs.map((p) => prev.text.slice(p.start, p.end)));
  const out: number[] = [];
  next.paragraphs.forEach((p, i) => {
    if (!seen.has(next.text.slice(p.start, p.end))) out.push(i);
  });
  return out;
}

/** Index of the paragraph containing `pos`, or -1. */
export function paragraphIndexAt(snapshot: TextSnapshot, pos: number): number {
  for (let i = 0; i < snapshot.paragraphs.length; i++) {
    const p = snapshot.paragraphs[i]!;
    if (pos >= p.start && pos <= p.end) return i;
  }
  return -1;
}

/** Build a snapshot from plain text with blank-line paragraph breaks. Used by tests, the mock path and the sample runner. */
export function snapshotFromText(text: string, version = 1): TextSnapshot {
  const paragraphs: Span[] = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim().length) paragraphs.push({ start: m.index, end: m.index + m[0].length });
  }
  return { text, paragraphs, version };
}

/* ---------- keys ---------- */

/** Stable cache key for a claim statement: lowercase, punctuation stripped, whitespace collapsed. */
export function normalizeClaim(statement: string): string {
  return normalizeText(statement, true)
    .text.replace(/[^\p{L}\p{N}%$.\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short, stable id from a string (FNV-1a, base36). */
export function stableId(prefix: string, input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${prefix}_${h.toString(36)}`;
}
