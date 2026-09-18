// Shared ComposerHandle implementations. Adapters only decide where composers are and how they are framed.
import type { PlatformInfo } from '../shared/messages';
import type { Span, TextSnapshot } from '../shared/types';
import {
  buildContenteditableSnapshot,
  buildTextareaSnapshot,
  measureTextareaSpan,
  rangeForSpan,
  type SnapshotWithMap,
} from '../content/text-snapshot';
import type { ComposerHandle } from './types';

let keyCounter = 0;
/** Stable key per element for the life of the page. */
export function ensureKey(el: Element, prefix: string): string {
  const existing = el.getAttribute('data-wordsnap-key');
  if (existing) return existing;
  const key = `${prefix}-${++keyCounter}`;
  el.setAttribute('data-wordsnap-key', key);
  return key;
}

const handles = new WeakMap<HTMLElement, ComposerHandle>();
/** findComposers must return the same handle for the same element. */
export function cachedHandle(el: HTMLElement, make: () => ComposerHandle): ComposerHandle {
  let h = handles.get(el);
  if (!h) {
    h = make();
    handles.set(el, h);
  }
  return h;
}

export function findScrollParent(el: HTMLElement): HTMLElement {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  let cur: HTMLElement | null = el;
  while (cur && cur !== doc.body) {
    try {
      const cs = view?.getComputedStyle(cur);
      const oy = cs?.overflowY ?? '';
      if (oy === 'auto' || oy === 'scroll') return cur;
    } catch {
      /* no layout */
    }
    cur = cur.parentElement;
  }
  return (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface ContenteditableOptions {
  key: string;
  root: HTMLElement;
  platform: PlatformInfo;
  /** The frame the panel docks to (compose dialog, share box). Defaults to the root. */
  anchorElement?: () => HTMLElement | null;
  /** Only the generic adapter may fall back to writing text nodes directly. */
  allowDirectReplace?: boolean;
  getContext?: () => { subject?: string; recipients?: string[] };
}

export class ContenteditableComposer implements ComposerHandle {
  readonly key: string;
  readonly element: HTMLElement;
  readonly platform: PlatformInfo;
  private snap: SnapshotWithMap | null = null;
  private readonly opts: ContenteditableOptions;

  constructor(opts: ContenteditableOptions) {
    this.opts = opts;
    this.key = opts.key;
    this.element = opts.root;
    this.platform = opts.platform;
    if (opts.getContext) this.getContext = opts.getContext;
  }

  getContext?: () => { subject?: string; recipients?: string[] };

  invalidate(): void {
    this.snap = null;
  }

  getSnapshot(): TextSnapshot {
    return this.mapped();
  }

  private mapped(): SnapshotWithMap {
    if (!this.snap) this.snap = buildContenteditableSnapshot(this.element);
    return this.snap;
  }

  rangeFor(span: Span): Range | null {
    return rangeForSpan(this.mapped(), span);
  }

  applyEdit(span: Span, replacement: string): boolean {
    const before = this.mapped();
    const range = rangeForSpan(before, span);
    if (!range) return false;
    const doc = this.element.ownerDocument;
    const view = doc.defaultView;
    const sel = view?.getSelection?.();
    if (sel) {
      this.element.focus?.();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let ok = false;
    try {
      ok = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, replacement);
    } catch {
      ok = false;
    }
    this.invalidate();
    if (ok && this.verify(span.start, replacement)) return true;
    if (!this.opts.allowDirectReplace) return false;
    // Generic adapter only: the editor does not implement insertText. Replace the text nodes directly
    // and tell the page about it so frameworks bound to `input` can catch up.
    try {
      const again = rangeForSpan(before, span) ?? range;
      again.deleteContents();
      again.insertNode(doc.createTextNode(replacement));
      this.element.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      return false;
    }
    this.invalidate();
    return this.verify(span.start, replacement);
  }

  private verify(start: number, replacement: string): boolean {
    const text = this.mapped().text;
    return text.slice(start, start + replacement.length) === replacement;
  }

  onChange(cb: (snapshot: TextSnapshot) => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        this.invalidate();
        cb(this.getSnapshot());
      }, 50);
    };
    this.element.addEventListener('input', fire);
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver((records) => {
        // Ignore mutations WordSnap made to its own attributes.
        if (records.every((r) => r.type === 'attributes' && (r.attributeName ?? '').startsWith('data-wordsnap'))) return;
        fire();
      });
      mo.observe(this.element, { childList: true, characterData: true, subtree: true });
    }
    return () => {
      this.element.removeEventListener('input', fire);
      mo?.disconnect();
      if (timer) clearTimeout(timer);
    };
  }

  anchorRect(): DOMRect {
    const el = this.opts.anchorElement?.() ?? this.element;
    return el.getBoundingClientRect();
  }

  private inset = 0;
  private insetSaved: { paddingRight: string; boxSizing: string } | null = null;

  setInset(px: number): void {
    if (px === this.inset) return;
    const st = this.element.style;
    if (px > 0) {
      if (!this.insetSaved) this.insetSaved = { paddingRight: st.paddingRight, boxSizing: st.boxSizing };
      st.boxSizing = 'border-box';
      st.paddingRight = `${px}px`;
    } else if (this.insetSaved) {
      st.paddingRight = this.insetSaved.paddingRight;
      st.boxSizing = this.insetSaved.boxSizing;
      this.insetSaved = null;
    }
    this.inset = px;
  }

  scrollParent(): HTMLElement {
    return findScrollParent(this.element);
  }

  isAlive(): boolean {
    const ce = this.element.getAttribute('contenteditable');
    return this.element.isConnected && ce !== null && ce !== 'false';
  }
}

export class TextareaComposer implements ComposerHandle {
  readonly key: string;
  readonly element: HTMLElement;
  readonly platform: PlatformInfo;
  private snap: SnapshotWithMap | null = null;

  constructor(key: string, private readonly textarea: HTMLTextAreaElement, platform: PlatformInfo) {
    this.key = key;
    this.element = textarea;
    this.platform = platform;
  }

  getSnapshot(): TextSnapshot {
    if (!this.snap) this.snap = buildTextareaSnapshot(this.textarea);
    return this.snap;
  }

  /** No DOM ranges in a textarea. Use `rectsFor` for geometry. */
  rangeFor(): Range | null {
    return null;
  }

  rectsFor(span: Span): DOMRect[] {
    return measureTextareaSpan(this.textarea, span);
  }

  /** Character offsets are identical to snapshot offsets (the snapshot only trims the tail). */
  selectionFor(span: Span): { start: number; end: number } {
    return { start: span.start, end: span.end };
  }

  applyEdit(span: Span, replacement: string): boolean {
    const v = this.textarea.value;
    if (span.end > v.length) return false;
    this.textarea.focus?.();
    this.textarea.setSelectionRange(span.start, span.end);
    let ok = false;
    try {
      ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, replacement);
    } catch {
      ok = false;
    }
    if (!ok || this.textarea.value.slice(span.start, span.start + replacement.length) !== replacement) {
      this.textarea.value = v.slice(0, span.start) + replacement + v.slice(span.end);
      this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.snap = null;
    return this.textarea.value.slice(span.start, span.start + replacement.length) === replacement;
  }

  onChange(cb: (snapshot: TextSnapshot) => void): () => void {
    const fire = () => {
      this.snap = null;
      cb(this.getSnapshot());
    };
    this.textarea.addEventListener('input', fire);
    return () => this.textarea.removeEventListener('input', fire);
  }

  anchorRect(): DOMRect {
    return this.textarea.getBoundingClientRect();
  }

  scrollParent(): HTMLElement {
    return findScrollParent(this.textarea);
  }

  isAlive(): boolean {
    return this.textarea.isConnected && !this.textarea.disabled;
  }
}
