// Contract between the content script (owner of the composer) and the overlay UI (renderer).
import type { ComposerHandle } from '../adapters/types';
import type { SessionState } from '../shared/types';

export interface OverlayCallbacks {
  /** User clicked Apply change on a finding. The content script performs the edit and reports it. */
  onApply(findingId: string, span: { start: number; end: number }, replacement: string): void;
  /** User clicked Keep as-is. */
  onKeep(findingId: string): void;
  /** Copy the current draft (plain text) to the clipboard. */
  onCopy(): Promise<void>;
  /** Open a platform share target with the current text. */
  onShare(target: 'x' | 'linkedin'): void;
}

export interface OverlayController {
  /** Render the latest state. Cheap to call often. */
  update(state: SessionState): void;
  /** Recompute highlight geometry (scroll, resize, editor mutation). */
  relayout(): void;
  destroy(): void;
}

export interface MountOverlayOptions {
  handle: ComposerHandle;
  callbacks: OverlayCallbacks;
  /** Initial state; the controller renders an empty shell until the first update. */
  initial?: SessionState;
}

/** Implemented in src/ui/overlay.tsx. Mounts a closed Shadow DOM on document.documentElement. */
export type MountOverlay = (opts: MountOverlayOptions) => OverlayController;
