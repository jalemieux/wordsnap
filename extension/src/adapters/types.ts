// Host adapters: one per site. Everything above this interface is site-agnostic.
import type { PlatformInfo } from '../shared/messages';
import type { HostId, Span, TextSnapshot } from '../shared/types';

export interface HostAdapter {
  id: HostId;
  matches(url: URL): boolean;
  /** Called on load and from a throttled MutationObserver. Must be idempotent: return the same key for the same composer. */
  findComposers(root: Document): ComposerHandle[];
}

export interface ComposerHandle {
  /** Stable per compose window for the life of the page. */
  key: string;
  element: HTMLElement;
  platform: PlatformInfo;
  getSnapshot(): TextSnapshot;
  /** DOM range for a span in the current snapshot, or null if the text moved. */
  rangeFor(span: Span): Range | null;
  /** User-approved edits only. Returns false if the editor rejected the edit. */
  applyEdit(span: Span, replacement: string): boolean;
  /** Fires on input. The caller debounces. Returns an unsubscribe function. */
  onChange(cb: (snapshot: TextSnapshot) => void): () => void;
  /** Where to dock the panel: the composer's outer frame in viewport coordinates. */
  anchorRect(): DOMRect;
  /** The composer's scroll container, for repositioning highlights. */
  scrollParent(): HTMLElement;
  /** True while the composer is still attached and usable. */
  isAlive(): boolean;
  /** Subject or title context if the host has one (Gmail subject). */
  getContext?(): { subject?: string; recipients?: string[] };
  /**
   * Reserve `px` of the editor's width on the right for the structure compare pane (0 restores the host's own
   * style). A layout change on the host element, not an edit: the text reflows, the DOM is untouched.
   */
  setInset?(px: number): void;
  /** The part of the draft the user has selected right now, or null (nothing selected, or outside this editor). */
  selectionSpan?(): Span | null;
}
