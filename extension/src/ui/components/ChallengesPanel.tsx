import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { SessionState } from '../../shared/types';
import { CHALLENGE_LABEL, sortChallenges, summaryCounts } from '../format';
import { Mark, Sources } from './bits';
import { StatusPill } from './StatusPill';

export interface ChallengesPanelProps {
  state: SessionState;
  style?: Record<string, string>;
  onHot: (ids: string[]) => void;
  /** Rendered at the bottom of the panel (the export bar when it does not fit under the composer). */
  footer?: ComponentChildren;
  now?: number;
}

export function ChallengesPanel({ state, style, onHot, footer, now }: ChallengesPanelProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const c = summaryCounts(state);
  const list = sortChallenges(state.challenges);
  const running = Object.values(state.passes).some((p) => p.state === 'running');

  return (
    <aside class="ws-panel" style={style} aria-label="WordSnap">
      <div class="ws-head">
        <Mark />
        <span class="ws-name">WordSnap</span>
        <StatusPill state={state} now={now} />
      </div>
      <div class={`ws-progress${running ? ' running' : ''}`} />
      {running && !state.argument && state.claims.every((cl) => !cl.data.verdict) ? <PassProgress state={state} /> : null}
      <div class="ws-summary">
        <span>
          <b>{c.checked}</b> claims checked
        </span>
        <span>
          <b>{c.contradicted}</b> contradicted
        </span>
        <span>
          <b>{c.precision}</b> needs precision
        </span>
        <span>
          <b>{c.challenges}</b> challenges
        </span>
        <span>
          <b>{c.clarity}</b> clarity notes
        </span>
      </div>
      <div class="ws-scroll">
        <section class="ws-sec">
          <h3>
            Your argument<span class="pass">as WordSnap reads it</span>
          </h3>
          {state.argument ? (
            <p class="ws-core">{state.argument.thesis}</p>
          ) : (
            <p class="ws-empty">{state.passes.C.state === 'running' ? 'Reading your argument…' : 'Nothing analyzed yet.'}</p>
          )}
        </section>
        <section class="ws-sec">
          <h3>
            Challenges <span class="count">{c.challenges}</span>
            <span class="pass">counterargument pass</span>
          </h3>
          {list.length === 0 ? (
            <p class="ws-empty">{state.passes.C.state === 'running' ? 'Looking for the strongest rebuttal…' : 'No challenges yet.'}</p>
          ) : null}
          {list.map((ch, i) => {
            const isOpen = !!open[ch.id];
            const dim = ch.status !== 'open';
            const tag =
              ch.status === 'applied' || ch.status === 'kept'
                ? 'Addressed by your edit'
                : ch.status === 'stale'
                  ? 'Re-checking after your edit'
                  : (CHALLENGE_LABEL[ch.data.kind] ?? ch.data.kind);
            return (
              <div
                key={ch.id}
                class={`ws-ch${ch.data.kind === 'strongest_rebuttal' ? ' strong' : ''}${isOpen ? ' open' : ''}${dim ? ' dim' : ''}`}
                data-id={ch.id}
                data-kind={ch.data.kind}
                onMouseEnter={() => onHot([ch.id])}
                onMouseLeave={() => onHot([])}
              >
                <button class="ws-ch-row" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [ch.id]: !isOpen })}>
                  <span class="ws-ch-num">{i + 1}</span>
                  <span class="ws-ch-title">
                    <span class="ws-ch-tag">{tag}</span>
                    {ch.data.title}
                  </span>
                  <span class="ws-ch-chev" aria-hidden="true">
                    ▶
                  </span>
                </button>
                {isOpen ? (
                  <div class="ws-ch-body">
                    {ch.data.body}
                    <div class="ws-ch-fix">
                      <b>How to address it.</b> {ch.data.howToAddress}
                    </div>
                    <Sources list={ch.data.sources} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </div>
      {footer}
    </aside>
  );
}


const PASS_LABEL: Record<'A' | 'B' | 'C', string> = { A: 'Reading for clarity and claims', B: 'Checking facts', C: 'Building the counterargument' };

/** Shown only during the first analysis, when there is nothing else to look at yet. */
function PassProgress({ state }: { state: SessionState }) {
  return (
    <div class="ws-firstrun" role="status" aria-live="polite">
      <div class="ws-firstrun-title">Analyzing your draft</div>
      <ul>
        {(['A', 'B', 'C'] as const).map((id) => {
          const p = state.passes[id];
          const mark = p.state === 'done' ? '✓' : p.state === 'running' ? <span class="ws-spin" /> : p.state === 'error' ? '!' : '·';
          return (
            <li key={id} class={p.state}>
              <span class="ws-firstrun-mark">{mark}</span>
              <span>{PASS_LABEL[id]}</span>
              {p.state === 'running' && p.detail ? <span class="ws-firstrun-detail">{p.detail}</span> : null}
            </li>
          );
        })}
      </ul>
      <p class="ws-firstrun-note">Fact checks search the web, so the first pass on a new draft can take up to a minute. Findings appear as each pass finishes.</p>
    </div>
  );
}