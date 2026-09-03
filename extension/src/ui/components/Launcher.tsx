// The always-visible entry point: a small badge on the compose window. Click to open or collapse WordSnap.
import type { SessionState } from '../../shared/types';
import { anyRunning, openIssueCount } from '../format';
import type { RectLike } from './HighlightLayer';

export interface LauncherProps {
  state: SessionState;
  anchor: RectLike;
  open: boolean;
  onToggle: () => void;
}

export function launcherStyle(anchor: RectLike): Record<string, string> {
  // Inside the compose frame, right edge, just under the host's title bar.
  return { left: `${anchor.left + anchor.width - 44}px`, top: `${anchor.top + 52}px` };
}

export function Launcher({ state, anchor, open, onToggle }: LauncherProps) {
  const running = anyRunning(state);
  const issues = openIssueCount(state);
  const analyzed = !!state.argument || state.claims.some((c) => c.data.verdict) || state.clarity.length > 0;
  const title = open ? 'Hide WordSnap' : running ? 'WordSnap is analyzing your draft' : analyzed ? `WordSnap: ${issues} ${issues === 1 ? 'thing' : 'things'} to look at` : 'Check this draft with WordSnap';
  return (
    <button class={`ws-launcher${open ? ' open' : ''}${running ? ' running' : ''}`} style={launcherStyle(anchor)} onClick={onToggle} title={title} aria-label={title} aria-pressed={open}>
      <span class="ws-launcher-mark">W</span>
      {running ? <span class="ws-launcher-ring" /> : null}
      {!open && !running && analyzed ? <span class={`ws-launcher-count${issues ? ' warn' : ' ok'}`}>{issues || '✓'}</span> : null}
    </button>
  );
}
