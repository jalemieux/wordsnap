import { useState } from 'preact/hooks';
import { CHECK_IDS, type Checks, type SessionState } from '../../shared/types';
import { CHALLENGE_LABEL, CHECK_HINT, CHECK_LABEL, checksChanged, checksOf, draftChanged, firstError, sortChallenges, summaryCounts } from '../format';
import { Mark, Sources } from './bits';
import { StatusPill } from './StatusPill';

export interface ChallengesPanelProps {
  state: SessionState;
  style?: Record<string, string>;
  onHot: (ids: string[]) => void;
  onClose?: () => void;
  /** Re-analyze button. Enabled when the draft changed since the last run or a pass failed. */
  onAnalyze?: () => void;
  /** The user flipped a check chip. Absent: chips render but are inert. */
  onChecks?: (checks: Checks) => void;
  /** Words in the draft right now and the minimum before analysis starts; drives the idle hint. */
  wordCount?: number;
  minWords?: number;
  now?: number;
}

export function ChallengesPanel({ state, style, onHot, now, onClose, onAnalyze, onChecks, wordCount, minWords }: ChallengesPanelProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const c = summaryCounts(state);
  const list = sortChallenges(state.challenges);
  const running = Object.values(state.passes).some((p) => p.state === 'running');
  const analyzed = state.analyzedVersion !== undefined;
  const checks = checksOf(state);
  const noneOn = CHECK_IDS.every((k) => !checks[k]);
  const canAnalyze = !running && !noneOn && (draftChanged(state) || checksChanged(state) || !!firstError(state));

  return (
    <aside class="ws-panel" style={style} aria-label="WordSnap">
      <div class="ws-head">
        <Mark />
        <span class="ws-name">WordSnap</span>
        <StatusPill state={state} now={now} />
        {onAnalyze && analyzed ? (
          <button
            class="ws-btn ws-reanalyze"
            disabled={!canAnalyze}
            onClick={onAnalyze}
            title={canAnalyze ? 'Re-run clarity on the changed paragraphs, check new claims, and refresh the counterargument' : running ? 'Analyzing…' : 'Nothing changed since the last analysis'}
          >
            Re-analyze
          </button>
        ) : null}
        {onClose ? (
          <button class="ws-close" onClick={onClose} aria-label="Hide WordSnap" title="Hide WordSnap">
            ✕
          </button>
        ) : null}
      </div>
      <div class="ws-picks" role="group" aria-label="What to check">
        {CHECK_IDS.map((id) => {
          const on = checks[id];
          return (
            <button
              key={id}
              class={`ws-pick${on ? ' on' : ''}`}
              data-check={id}
              aria-pressed={on}
              title={CHECK_HINT[id]}
              onClick={() => onChecks?.({ ...checks, [id]: !on })}
            >
              {on ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="2" />
                </svg>
              )}
              {CHECK_LABEL[id]}
            </button>
          );
        })}
      </div>
      <div class={`ws-progress${running ? ' running' : ''}`} />
      {noneOn ? <div class="ws-idle">Pick at least one check.</div> : null}
      {running && !state.argument && state.claims.every((cl) => !cl.data.verdict) ? <PassProgress state={state} /> : null}
      {!running && !state.argument && state.claims.length === 0 && state.clarity.length === 0 && !Object.values(state.passes).some((p) => p.state === 'error') ? (
        <IdleHint wordCount={wordCount ?? 0} minWords={minWords ?? 8} />
      ) : null}
      <div class="ws-summary">
        {checks.facts ? (
          <>
            <span>
              <b>{c.checked}</b> claims checked
            </span>
            <span>
              <b>{c.contradicted}</b> contradicted
            </span>
            <span>
              <b>{c.precision}</b> needs precision
            </span>
          </>
        ) : null}
        {checks.challenge ? (
          <span>
            <b>{c.challenges}</b> challenges
          </span>
        ) : null}
        {checks.polish || checks.structure ? (
          <span>
            <b>{c.clarity}</b> clarity notes
          </span>
        ) : null}
      </div>
      <div class="ws-scroll">
        {checks.structure || checks.challenge ? (
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
        ) : null}
        <section class="ws-sec">
          <h3>
            Challenges {checks.challenge ? <span class="count">{c.challenges}</span> : null}
            <span class="pass">{checks.challenge ? 'counterargument pass' : 'off'}</span>
          </h3>
          {!checks.challenge ? (
            <p class="ws-off">
              Turn on Challenge to hear the strongest rebuttal, the blind spots and the gaps.{' '}
              {onChecks ? (
                <button class="link" onClick={() => onChecks({ ...checks, challenge: true })}>
                  Turn on
                </button>
              ) : null}
            </p>
          ) : list.length === 0 ? (
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

function IdleHint({ wordCount, minWords }: { wordCount: number; minWords: number }) {
  const missing = Math.max(0, minWords - wordCount);
  return (
    <div class="ws-idle" role="status">
      {missing > 0 ? (
        <>
          <b>Write {missing} more {missing === 1 ? 'word' : 'words'}</b> and WordSnap will start. It reads for clarity, checks facts against the web and argues back.
        </>
      ) : (
        <>
          <b>Starting…</b> WordSnap reads for clarity, checks facts against the web and argues back.
        </>
      )}
    </div>
  );
}