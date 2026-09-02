import type { SessionState } from '../../shared/types';
import { anyRunning, firstError, lastCheckedAt, relativeTime } from '../format';

export function statusOf(state: SessionState, now = Date.now()): { mode: 'running' | 'error' | 'done' | 'idle'; text: string } {
  if (anyRunning(state)) {
    const detail = Object.values(state.passes).find((p) => p.state === 'running' && p.detail)?.detail;
    return { mode: 'running', text: detail ? `Re-analyzing… ${detail}` : 'Re-analyzing…' };
  }
  const err = firstError(state);
  if (err) return { mode: 'error', text: err };
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
