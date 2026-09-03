// The always-visible entry point: a small badge on the compose window. Click to open or collapse WordSnap.
import type { SessionState } from '../../shared/types';
import { anyRunning, openIssueCount } from '../format';
import type { RectLike } from './HighlightLayer';

export interface LauncherProps {
  state: SessionState;
  anchor: RectLike;
  /** A box the badge must not sit under (the open panel). */
  avoid?: RectLike;
  open: boolean;
  onToggle: () => void;
}

const SIZE = 32;

export function launcherStyle(anchor: RectLike, avoid?: RectLike): Record<string, string> {
  // Inside the compose frame, right edge, just under the host's title bar.
  let left = anchor.left + anchor.width - 44;
  const top = anchor.top + 52;
  if (avoid && intersects({ left, top, width: SIZE, height: SIZE }, avoid)) left = avoid.left - SIZE - 10;
  return { left: `${Math.max(4, left)}px`, top: `${Math.max(4, top)}px` };
}

function intersects(a: RectLike, b: RectLike): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

export function Launcher({ state, anchor, avoid, open, onToggle }: LauncherProps) {
  const running = anyRunning(state);
  const issues = openIssueCount(state);
  const analyzed = !!state.argument || state.claims.some((c) => c.data.verdict) || state.clarity.length > 0;
  const title = open ? 'Hide WordSnap' : running ? 'WordSnap is analyzing your draft' : analyzed ? `WordSnap: ${issues} ${issues === 1 ? 'thing' : 'things'} to look at` : 'Check this draft with WordSnap';
  return (
    <button class={`ws-launcher${open ? ' open' : ''}${running ? ' running' : ''}`} style={launcherStyle(anchor, avoid)} onClick={onToggle} title={title} aria-label={title} aria-pressed={open}>
      <span class="ws-launcher-mark">W</span>
      {running ? <span class="ws-launcher-ring" /> : null}
      {!open && !running && analyzed ? <span class={`ws-launcher-count${issues ? ' warn' : ' ok'}`}>{issues || '✓'}</span> : null}
    </button>
  );
}
