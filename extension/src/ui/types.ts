// Contract between the content script (owner of the composer) and the overlay UI (renderer).
import type { ComposerHandle } from '../adapters/types';
import type { SessionState } from '../shared/types';

export interface OverlayCallbacks {
  /** User clicked Apply change on a finding. The content script performs the edit and reports it. */
  onApply(findingId: string, span: { start: number; end: number }, replacement: string): void;
  /** User clicked Keep as-is. */
  onKeep(findingId: string): void;
  /** The user opened (true) or collapsed (false) the panel from the launcher badge. */
  onOpenChange?(open: boolean): void;
  /** The user pressed Re-analyze in the panel. */
  onAnalyze?(): void;
}

export interface OverlayController {
  /** Render the latest state. Cheap to call often. */
  update(state: SessionState): void;
  /** Recompute highlight geometry (scroll, resize, editor mutation). */
  relayout(): void;
  /** Show or collapse the panel and highlights. The launcher badge is always visible. */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  destroy(): void;
}

export interface MountOverlayOptions {
  handle: ComposerHandle;
  callbacks: OverlayCallbacks;
  /** Initial state; the controller renders an empty shell until the first update. */
  initial?: SessionState;
  /** Start with the panel open. Default false: only the launcher badge shows. */
  startOpen?: boolean;
  /** Words needed before analysis starts; shown in the panel while the draft is shorter. */
  minWords?: number;
}

/** Implemented in src/ui/overlay.tsx. Mounts a closed Shadow DOM on document.documentElement. */
export type MountOverlay = (opts: MountOverlayOptions) => OverlayController;
