import type { SessionState } from '../../shared/types';
import { anyRunning, draftChanged, firstError, lastCheckedAt, relativeTime } from '../format';

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
  if (draftChanged(state)) return { mode: 'stale', text: 'Draft changed' };
  const at = lastCheckedAt(state);
  if (at) return { mode: 'done', text: `Checked ${relativeTime(at, now)}` };
  return { mode: 'idle', text: 'Waiting for text' };
}

export function StatusPill({ state, now }: { state: SessionState; now?: number }) {
  const s = statusOf(state, now);
  return (
    <span class={`ws-status ${s.mode}`} role="status" aria-live="polite" title={s.text}>
      <span class="dot" />
      {s.text}
    </span>
  );
}
