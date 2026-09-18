// Where each sentence of the draft lands in a structure proposal. Display-only: the compare pane draws the map,
// Apply still writes the proposal's paragraphs through minimalParagraphEdit. Both sides are split the same way,
// so an over-split abbreviation matches itself and costs nothing.
import type { Span } from './types';

export interface Sentence {
  span: Span;
  text: string;
}

export interface DraftSentence extends Sentence {
  /** Paragraph and position in the proposal, or null when the proposal dropped the sentence. */
  dest: { para: number; index: number } | null;
  /** Lands out of order relative to the sentences around it (not on the longest kept subsequence). */
  moved: boolean;
  /** Leading or trailing words the proposal cut ("anyway, "), as a span into the draft. */
  trim: Span | null;
}

export interface ProposedSentence {
  text: string;
  /** Index into `draft`, or null when no draft sentence matches (the model reworded it). */
  source: number | null;
}

export interface StructureMap {
  draft: DraftSentence[];
  paragraphs: { sentences: ProposedSentence[] }[];
}

const END = /[.!?…]+["')\]]*(?=\s|$)|\n/g;

/** Sentences with their spans. Breaks after a terminator run followed by whitespace, and at every line break. */
export function splitSentences(text: string, offset = 0): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const push = (from: number, to: number) => {
    let a = from;
    let b = to;
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) out.push({ span: { start: offset + a, end: offset + b }, text: text.slice(a, b) });
  };
  for (const m of text.matchAll(END)) {
    const at = m.index!;
    const end = m[0] === '\n' ? at : at + m[0].length;
    push(start, end);
    start = at + m[0].length;
  }
  push(start, text.length);
  return out;
}

/** Letters and digits only, lower-cased: punctuation, spacing and quotes never decide a match. */
export function normSentence(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

const ALNUM = /[\p{L}\p{N}]/u;

/** Offset in `text` where the kept part starts after its first `count` letters or digits: the head trim, punctuation and spacing included. */
function offsetAfter(text: string, count: number): number {
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (!ALNUM.test(text[i]!)) continue;
    if (seen === count) return i;
    seen++;
  }
  return text.length;
}

/** Offset in `text` where the tail trim starts: right after the last kept letter or digit. */
function offsetBefore(text: string, count: number): number {
  let seen = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (!ALNUM.test(text[i]!)) continue;
    if (seen === count) return i + 1;
    seen++;
  }
  return 0;
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Dice coefficient over word sets: 1 when the sentences share every word, 0 when none. */
export function wordOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return (2 * shared) / (wa.size + wb.size);
}

const MIN_KEEP = 0.5;
/** A sentence the model touched up (a fixed typo, a dropped "I mean") still maps when this share of its words survive. */
const MIN_OVERLAP = 0.6;

export function mapStructure(text: string, paragraphs: string[]): StructureMap {
  const draft: DraftSentence[] = splitSentences(text).map((s) => ({ ...s, dest: null, moved: false, trim: null }));
  const dn = draft.map((d) => normSentence(d.text));
  const claimed = new Set<number>();
  const out: StructureMap['paragraphs'] = [];
  const order: number[] = [];

  const place = (i: number, para: number, index: number, trim: Span | null) => {
    const d = draft[i]!;
    if (d.dest) return; // a split sentence keeps its first landing and never gains a trim from a later piece
    d.dest = { para, index };
    d.trim = trim;
    order.push(i);
  };

  paragraphs.forEach((p, para) => {
    const sentences: ProposedSentence[] = [];
    splitSentences(p).forEach((s, index) => {
      const sn = normSentence(s.text);
      let source: number | null = null;
      if (sn) {
        // Exact, unused.
        let i = dn.findIndex((n, k) => !claimed.has(k) && n === sn);
        if (i >= 0) {
          claimed.add(i);
          place(i, para, index, null);
          source = i;
        } else {
          // Filler cut from one end: the proposal sentence is the head or tail of a draft sentence.
          i = dn.findIndex((n, k) => !claimed.has(k) && sn.length >= MIN_KEEP * n.length && (n.endsWith(sn) || n.startsWith(sn)));
          if (i >= 0) {
            claimed.add(i);
            const d = draft[i]!;
            const n = dn[i]!;
            const trim: Span = n.endsWith(sn)
              ? { start: d.span.start, end: d.span.start + offsetAfter(d.text, n.length - sn.length) }
              : { start: d.span.start + offsetBefore(d.text, n.length - sn.length), end: d.span.end };
            place(i, para, index, trim);
            source = i;
          } else {
            // A run-on split at a joint: several proposal sentences share one draft sentence.
            i = dn.findIndex((n) => n.length > sn.length && n.includes(sn));
            if (i >= 0) {
              place(i, para, index, null);
              source = i;
            } else {
              // Two draft sentences joined into one.
              const j = dn.findIndex((n, k) => !claimed.has(k) && k + 1 < dn.length && !claimed.has(k + 1) && n + dn[k + 1]! === sn);
              if (j >= 0) {
                claimed.add(j);
                claimed.add(j + 1);
                place(j, para, index, null);
                place(j + 1, para, index, null);
                source = j;
              } else {
                // Touched up rather than moved: the unclaimed draft sentence sharing most of its words.
                let best = -1;
                let bestScore = MIN_OVERLAP;
                draft.forEach((d, k) => {
                  if (claimed.has(k) || d.dest) return;
                  const score = wordOverlap(d.text, s.text);
                  if (score > bestScore) {
                    bestScore = score;
                    best = k;
                  }
                });
                if (best >= 0) {
                  claimed.add(best);
                  place(best, para, index, null);
                  source = best;
                }
              }
            }
          }
        }
      }
      sentences.push({ text: s.text, source });
    });
    out.push({ sentences });
  });

  // A trim marks words the proposal cut. When a draft sentence feeds two proposal sentences it was split, not cut,
  // and the tail that looked trimmed lives on in the second piece.
  const feeds = new Map<number, number>();
  for (const p of out) for (const s of p.sentences) if (s.source !== null) feeds.set(s.source, (feeds.get(s.source) ?? 0) + 1);
  draft.forEach((d, i) => {
    if (d.trim && (feeds.get(i) ?? 0) > 1) d.trim = null;
  });

  // Sentences off the longest increasing run of draft positions are the ones that moved.
  const kept = new Set(longestIncreasing(order));
  order.forEach((i) => {
    draft[i]!.moved = !kept.has(i);
  });
  return { draft, paragraphs: out };
}

/** Values of the longest strictly increasing subsequence (first one found). */
export function longestIncreasing(seq: number[]): number[] {
  const n = seq.length;
  if (!n) return [];
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j]! < seq[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
    }
    if (len[i]! > len[best]!) best = i;
  }
  const out: number[] = [];
  for (let i = best; i >= 0; i = prev[i]!) out.push(seq[i]!);
  return out.reverse();
}

/* ---------------- outline guide ---------------- */

/** How far a slot of an applied outline has been written: nothing there, only the seeded fragment, or more. */
export type SlotFill = 'empty' | 'seeded' | 'written';

/** Paragraph spans of a plain-text draft (blank line separated), for the fill check. */
export function paragraphSpans(text: string): Span[] {
  const out: Span[] = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** A paragraph counts as written once it carries this many words beyond the fragment it started from. */
const WRITTEN_MARGIN = 3;

/**
 * Per slot, whether the writer has written into it. A slot whose fragment is in the draft is `seeded` until its
 * paragraph grows past the fragment. A slot with no fragment is `written` once a paragraph exists between the
 * paragraphs of its placed neighbours, `empty` otherwise. No model call: this reads the draft only.
 */
export function outlineFill(text: string, map: StructureMap, slotCount: number): SlotFill[] {
  const paras = paragraphSpans(text);
  const paraOf = (pos: number) => paras.findIndex((p) => pos >= p.start && pos < p.end);
  const slotPara: (number | null)[] = [];
  const fills: SlotFill[] = [];
  for (let k = 0; k < slotCount; k++) {
    const seeds = map.draft.filter((d) => d.dest?.para === k);
    if (!seeds.length) {
      slotPara.push(null);
      fills.push('empty');
      continue;
    }
    const p = paraOf(seeds[0]!.span.start);
    slotPara.push(p >= 0 ? p : null);
    if (p < 0) {
      fills.push('empty');
      continue;
    }
    const seeded = seeds.reduce((n, d) => n + wordCount(d.text), 0);
    const have = wordCount(text.slice(paras[p]!.start, paras[p]!.end));
    fills.push(have >= seeded + WRITTEN_MARGIN ? 'written' : 'seeded');
  }
  for (let k = 0; k < slotCount; k++) {
    if (slotPara[k] !== null) continue;
    let before = -1;
    for (let i = k - 1; i >= 0; i--)
      if (slotPara[i] !== null) {
        before = slotPara[i]!;
        break;
      }
    let after = paras.length;
    for (let i = k + 1; i < slotCount; i++)
      if (slotPara[i] !== null) {
        after = slotPara[i]!;
        break;
      }
    if (after - before > 1) fills[k] = 'written';
  }
  return fills;
}
