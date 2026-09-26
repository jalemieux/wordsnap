// Contract between the content script and the co-writer overlay.
import type { ComposerHandle } from '../../adapters/types';
import type { CowriterState, ReviseChange, Tune, TweakScope } from '../../shared/cowriter';
import type { Span } from '../../shared/types';

export interface CowriterCallbacks {
  onTune(tune: Tune): void;
  onShape(): void;
  onFlip(choice: number): void;
  onFill(gap: number): void;
  /** Write the shaped draft into the editor. Returns false when the editor refused. */
  onApplyShape(text: string): boolean;
  onKeepShape(): void;
  onTweak(req: { id: string; quote: string; span: Span; instruction: string; mode: 'new' | 'refine' | 'again'; scope?: TweakScope }): void;
  /** Replace the passage (re-located by quote near `hint`) with `text`. Returns false when it could not. */
  onApplyTweak(id: string, quote: string, hint: number, text: string): boolean;
  onKeepTweak(id: string): void;
  /** Leave a margin note on a passage (quote and span) or on the whole draft (neither). Nothing runs. */
  onComment(c: { id: string; text: string; quote?: string; span?: Span }): void;
  onRemoveComment(id: string): void;
  onRevise(): void;
  /** Write these changes into the editor as one edit. `text` is the draft they were made for; false when it moved or the editor refused. */
  onApplyRevise(text: string, changes: ReviseChange[]): boolean;
  onKeepRevise(): void;
  onOpenChange?(open: boolean): void;
  onPanelMove?(pos: { left: number; top: number } | null): void;
}
export interface CowriterOverlay {
  update(state: CowriterState): void;
  relayout(): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  setPanelPos(pos: { left: number; top: number } | null): void;
  destroy(): void;
}
export type MountCowriter = (opts: { handle: ComposerHandle; callbacks: CowriterCallbacks; initial: CowriterState; startOpen?: boolean }) => CowriterOverlay;
