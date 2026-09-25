// src/ui/cowriter/geometry.ts
// Where the overlay's pieces go, measured from the host editor. The pane takes the editor's right half through a
// padding on the host element (a style, restored on close); below 720px of width it sits over the draft instead.
import type { ComposerHandle } from '../../adapters/types';
import { locateQuote } from '../../shared/anchoring';
import type { RectLike } from '../components/HighlightLayer';
import type { PaneGeometry } from './ShapePane';

const WIDE = 720;
const GAP = 20;
const MIN_W = 320;
const MAX_W = 560;
const insets = new WeakMap<ComposerHandle, number>();

function inset(handle: ComposerHandle, px: number): void {
  if ((insets.get(handle) ?? 0) === px) return;
  insets.set(handle, px);
  handle.setInset?.(px);
}

export function releasePane(handle: ComposerHandle): void {
  inset(handle, 0);
}

export function toRects(range: Range | null): RectLike[] {
  if (!range) return [];
  const out: RectLike[] = [];
  const rs = range.getClientRects();
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    if (r.width === 0 && r.height === 0) continue;
    out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
}

export function paneGeometry(handle: ComposerHandle, viewport: { width: number; height: number }): PaneGeometry {
  const el = handle.element;
  const er = el.getBoundingClientRect();
  const wide = er.width >= WIDE;
  const width = wide ? Math.min(MAX_W, Math.max(MIN_W, Math.round(er.width * 0.5))) : Math.round(Math.min(er.width, viewport.width - 16));
  inset(handle, wide ? width + GAP : 0);
  const frame = handle.anchorRect();
  const top = Math.max(frame.top, 0);
  const bottom = Math.min(frame.bottom, viewport.height);
  let font = { family: '', size: '', lineHeight: '' };
  try {
    const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (cs) font = { family: cs.fontFamily, size: cs.fontSize, lineHeight: cs.lineHeight };
  } catch {
    /* no layout */
  }
  return { left: Math.round(wide ? er.right - width : er.left), top, width, height: Math.max(160, bottom - top), wide, font };
}

/** Rects over the fragments of the draft that `quotes` point at. A quote that does not locate draws nothing. */
export function sourceRects(handle: ComposerHandle, text: string, quotes: string[]): RectLike[] {
  return quotes.flatMap((q) => {
    const span = locateQuote(text, q);
    return span ? toRects(handle.rangeFor(span)) : [];
  });
}
