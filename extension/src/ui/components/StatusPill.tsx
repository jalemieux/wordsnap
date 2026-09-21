import type { SessionState } from '../../shared/types';
import { anyRunning, checksChanged, draftChanged, firstError, lastCheckedAt, relativeTime, structureGuiding, structureOpen } from '../format';

export function statusOf(state: SessionState, now = Date.now()): { mode: 'running' | 'error' | 'stale' | 'done' | 'idle'; text: string } {
  if (anyRunning(state)) {
    // Generic provider chatter ("Thinking…") stays in the progress block; the pill only carries specific detail.
    const detail = Object.values(state.passes).find((p) => p.state === 'running' && p.detail && !/^thinking/i.test(p.detail))?.detail;
    const firstRun = !lastCheckedAt(state) && state.claims.length === 0 && state.challenges.length === 0;
    const verb = firstRun ? 'Analyzing…' : 'Re-analyzing…';
    return { mode: 'running', text: detail ? `${verb} ${detail}` : verb };
  }
  const err = firstError(state);
  if (err) return { mode: 'error', text: err };
  if (structureOpen(state)) return { mode: 'stale', text: state.structure?.verdict === 'outline' ? 'Skeleton proposed' : 'Structure proposed' };
  if (structureGuiding(state)) return { mode: 'stale', text: 'Writing into the skeleton' };
  if (draftChanged(state)) return { mode: 'stale', text: 'Draft changed' };
  if (checksChanged(state)) return { mode: 'stale', text: 'Checks changed' };
  const at = lastCheckedAt(state);
  if (at) return { mode: 'done', text: `Checked ${relativeTime(at, now)}` };
  return { mode: 'idle', text: 'Waiting for text' };
}

export function StatusPill({ state, now }: { state: SessionState; now?: number }) {
  const s = statusOf(state, now);
  return (
    <span class={`ws-status ${s.mode}`} role="status" aria-live="polite" title={s.text}>
      <span class="dot" />
      <span>{s.text}</span>
    </span>
  );
}
