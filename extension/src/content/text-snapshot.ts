// Canonical plain text for a composer, with an offset map back to DOM text nodes.
//
// Rules (see docs/SPEC.md §3, "Text model and anchoring"):
//  - Block boundaries (div, p, li, blockquote, headings, pre, table rows) emit "\n"; <br> emits "\n".
//    Two consecutive breaks therefore read as a paragraph break ("\n\n"), which is how Gmail
//    (<div><br></div>), Quill (<p><br></p>) and Draft.js (empty block) all render a blank line.
//  - Paragraph spans are maximal runs separated by two or more newlines.
//  - Whitespace collapses the way the browser renders it unless the root is white-space: pre*.
//  - Hidden nodes and WordSnap's own elements are skipped.
//  - The model never sees offsets; offsets exist only so the overlay can draw over the real text
//    and so approved edits can select the right range.
import type { Span, TextSnapshot } from '../shared/types';

export interface OffsetSegment {
  node: Text;
  /** offset into node.data where this run starts */
  nodeOffset: number;
  /** offset into snapshot.text where this run starts */
  textOffset: number;
  length: number;
}

export interface SnapshotWithMap extends TextSnapshot {
  /** Sorted by textOffset. Empty for textarea snapshots. */
  segments: OffsetSegment[];
}

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TABLE', 'TBODY',
  'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'HR', 'ADDRESS', 'DL', 'DT', 'DD',
]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'WORDSNAP-OVERLAY']);

let versionCounter = 0;
export function nextVersion(): number {
  return ++versionCounter;
}

export function isWordSnapElement(el: Element): boolean {
  return el.hasAttribute('data-wordsnap') || el.tagName === 'WORDSNAP-OVERLAY';
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
  const inline = (el as HTMLElement).style;
  if (inline && (inline.display === 'none' || inline.visibility === 'hidden')) return true;
  try {
    const view = el.ownerDocument.defaultView;
    if (view) {
      const cs = view.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
  } catch {
    /* environments without layout */
  }
  return false;
}

function preservesWhitespace(root: HTMLElement): boolean {
  try {
    const ws = root.ownerDocument.defaultView?.getComputedStyle(root).whiteSpace ?? '';
    return ws.startsWith('pre');
  } catch {
    return false;
  }
}

function paragraphSpans(text: string): Span[] {
  const out: Span[] = [];
  const re = /\n{2,}/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > start) out.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out.filter((p) => text.slice(p.start, p.end).trim().length > 0);
}

class Builder {
  text = '';
  segments: OffsetSegment[] = [];
  private pendingSpace: { node: Text; offset: number } | null = null;
  constructor(private readonly collapse: boolean) {}

  private lastChar(): string {
    return this.text.length ? this.text[this.text.length - 1]! : '';
  }

  private pushChar(ch: string, node: Text, nodeOffset: number) {
    const last = this.segments[this.segments.length - 1];
    if (last && last.node === node && last.nodeOffset + last.length === nodeOffset && last.textOffset + last.length === this.text.length) {
      last.length += 1;
    } else {
      this.segments.push({ node, nodeOffset, textOffset: this.text.length, length: 1 });
    }
    this.text += ch;
  }

  /** A block boundary or <br>. Newlines are synthetic: they map to no node. */
  lineBreak(force = false) {
    this.pendingSpace = null;
    if (force || (this.text.length > 0 && this.lastChar() !== '\n')) this.text += '\n';
  }

  textNode(node: Text) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]!;
      if (ch === ' ') {
        this.flushSpace();
        this.pushChar(' ', node, i);
        continue;
      }
      if (this.collapse && (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r')) {
        if (!this.pendingSpace) this.pendingSpace = { node, offset: i };
        continue;
      }
      if (!this.collapse && ch === '\r') continue;
      this.flushSpace();
      this.pushChar(ch, node, i);
    }
  }

  private flushSpace() {
    if (!this.pendingSpace) return;
    const { node, offset } = this.pendingSpace;
    this.pendingSpace = null;
    // Spaces at the start of a line are not rendered.
    if (this.text.length === 0 || this.lastChar() === '\n' || this.lastChar() === ' ') return;
    this.pushChar(' ', node, offset);
  }

  finish(): SnapshotWithMap {
    this.pendingSpace = null;
    // Trailing whitespace and line breaks carry no content; drop them so quotes anchor cleanly.
    let end = this.text.length;
    while (end > 0 && /[\s]/.test(this.text[end - 1]!)) end--;
    const text = this.text.slice(0, end);
    const segments = this.segments.filter((s) => s.textOffset < end);
    const last = segments[segments.length - 1];
    if (last && last.textOffset + last.length > end) last.length = end - last.textOffset;
    return { text, paragraphs: paragraphSpans(text), version: nextVersion(), segments };
  }
}

export function buildContenteditableSnapshot(root: HTMLElement): SnapshotWithMap {
  const b = new Builder(!preservesWhitespace(root));
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      b.textNode(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName) || isWordSnapElement(el) || isHidden(el)) return;
    if (el.tagName === 'BR') {
      b.lineBreak(true);
      return;
    }
    const block = el !== root && BLOCK_TAGS.has(el.tagName);
    if (block) b.lineBreak();
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
    if (block) b.lineBreak();
  };
  walk(root);
  return b.finish();
}

export function buildTextareaSnapshot(el: HTMLTextAreaElement): SnapshotWithMap {
  const text = el.value.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return { text, paragraphs: paragraphSpans(text), version: nextVersion(), segments: [] };
}

/**
 * DOM Range for a span. Returns null when the span falls outside mapped text or the nodes are gone.
 * Span edges that land on synthetic newlines are nudged inward to the nearest real character.
 */
export function rangeForSpan(snap: SnapshotWithMap, span: Span): Range | null {
  const { segments } = snap;
  if (!segments.length || span.start < 0 || span.end > snap.text.length || span.end <= span.start) return null;
  let startSeg: OffsetSegment | undefined;
  let endSeg: OffsetSegment | undefined;
  for (const s of segments) {
    if (!startSeg && span.start < s.textOffset + s.length && span.end > s.textOffset) startSeg = s;
    if (s.textOffset < span.end && s.textOffset + s.length >= span.end) endSeg = s;
    else if (s.textOffset < span.end) endSeg = s; // last segment before the end
  }
  if (!startSeg || !endSeg) return null;
  if (!startSeg.node.isConnected || !endSeg.node.isConnected) return null;
  const startOffset = startSeg.nodeOffset + Math.max(0, span.start - startSeg.textOffset);
  const endOffset = endSeg.nodeOffset + Math.min(endSeg.length, span.end - endSeg.textOffset);
  if (startOffset > startSeg.node.data.length || endOffset > endSeg.node.data.length) return null;
  const range = startSeg.node.ownerDocument.createRange();
  range.setStart(startSeg.node, startOffset);
  range.setEnd(endSeg.node, endOffset);
  return range;
}

/**
 * Textarea fallback: a textarea has no DOM ranges, so highlights are measured with a mirror element
 * that copies the textarea's typography. Approximate by design; good enough to draw an underline.
 */
export function measureTextareaSpan(el: HTMLTextAreaElement, span: Span): DOMRect[] {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];
  const mirror = doc.createElement('div');
  mirror.setAttribute('data-wordsnap', 'mirror');
  const cs = view.getComputedStyle(el);
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'width', 'whiteSpace', 'wordBreak', 'overflowWrap'] as const) {
    (mirror.style as unknown as Record<string, string>)[p] = cs[p];
  }
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', top: '0', left: '0' });
  const text = el.value;
  mirror.append(doc.createTextNode(text.slice(0, span.start)));
  const mark = doc.createElement('span');
  mark.textContent = text.slice(span.start, span.end);
  mirror.append(mark, doc.createTextNode(text.slice(span.end)));
  doc.body.append(mirror);
  const base = el.getBoundingClientRect();
  const mbase = mirror.getBoundingClientRect();
  const rects = Array.from(mark.getClientRects()).map(
    (r) => new DOMRect(r.left - mbase.left + base.left, r.top - mbase.top + base.top - el.scrollTop, r.width, r.height),
  );
  mirror.remove();
  return rects;
}

/** The snapshot span a DOM range covers (the user's selection), or null when it touches none of the text. */
export function spanForRange(snap: SnapshotWithMap, range: Range): Span | null {
  let start = -1;
  let end = -1;
  for (const s of snap.segments) {
    if (!s.node.isConnected) continue;
    const segStart = s.nodeOffset;
    const segEnd = s.nodeOffset + s.length;
    let a = segStart;
    let b = segEnd;
    if (range.startContainer === s.node) a = Math.max(a, range.startOffset);
    else if (range.comparePoint(s.node, segEnd) < 0) continue; // ends before the range
    if (range.endContainer === s.node) b = Math.min(b, range.endOffset);
    else if (range.comparePoint(s.node, segStart) > 0) continue; // starts after the range
    if (b <= a) continue;
    if (start === -1) start = s.textOffset + (a - segStart);
    end = s.textOffset + (b - segStart);
  }
  return start === -1 ? null : { start, end };
}
