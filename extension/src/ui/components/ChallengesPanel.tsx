import { useState } from 'preact/hooks';
import type { StructureSlot } from '../../shared/schemas';
import type { SlotFill } from '../../shared/structure-map';
import { CHECK_IDS, type CheckId, type Checks, type SessionState } from '../../shared/types';
import { CHALLENGE_LABEL, CHECK_HINT, CHECK_LABEL, checksChanged, checksOf, draftChanged, elaborateStage, firstError, intentHint, sortChallenges, staleFindings, structureGuiding, structureOpen, summaryCounts } from '../format';
import { Mark, Sources } from './bits';
import { StatusPill } from './StatusPill';

/** Width of the panel; matches `.ws-panel` in styles.css. */
export const PANEL_W = 336;
const EDGE = 8;
const SNAP = 24;
const MIN_VISIBLE_H = 160;

/**
 * Where a panel the user dragged sits: the whole width and at least 160px of height on screen, snapped to an edge
 * dropped within 24px of it, as tall as the room below allows up to 80% of the viewport.
 */
export function placePanel(pos: { left: number; top: number }, viewport: { width: number; height: number }) {
  const maxLeft = viewport.width - PANEL_W - EDGE;
  const maxTop = viewport.height - MIN_VISIBLE_H - EDGE;
  let left = Math.round(Math.min(Math.max(pos.left, EDGE), Math.max(EDGE, maxLeft)));
  let top = Math.round(Math.min(Math.max(pos.top, EDGE), Math.max(EDGE, maxTop)));
  if (left - EDGE < SNAP) left = EDGE;
  else if (maxLeft - left < SNAP) left = maxLeft;
  if (top - EDGE < SNAP) top = EDGE;
  const maxHeight = Math.min(viewport.height - top - EDGE, Math.round(viewport.height * 0.8));
  return { left, top, maxHeight };
}

export interface ChallengesPanelProps {
  state: SessionState;
  style?: Record<string, string>;
  onHot: (ids: string[]) => void;
  onClose?: () => void;
  /** Re-analyze button. Enabled when the draft changed since the last run or a pass failed. */
  onAnalyze?: () => void;
  /** The user flipped a check chip. Absent: chips render but are inert. */
  onChecks?: (checks: Checks) => void;
  /** Apply structure: replace the draft with the proposal's paragraphs. Absent: the proposal shows without buttons. */
  onApplyStructure?: (paragraphs: string[]) => void;
  /** Keep mine: dismiss the proposal and analyze the draft as written. */
  onKeepStructure?: () => void;
  /** The proposal is drawn beside the draft: the panel shrinks to its header and one line, and the buttons live there. */
  compare?: boolean;
  /** An applied outline with no room for the pane beside a narrow draft: the panel carries the checklist and Done. */
  outlineGuide?: { slots: StructureSlot[]; fills: SlotFill[]; onDone?: () => void };
  /** Words in the draft right now and the minimum before analysis starts; drives the idle hint. */
  wordCount?: number;
  minWords?: number;
  /** The draft as it stands, for the hint under the picks before the first run. */
  draftText?: string;
  /** Start the first run with the picks as they are. Absent (auto mode, or already running): no Start block. */
  onStart?: () => void;
  /** A press on the header outside its buttons: the overlay drags the panel from there. */
  onDragStart?: (e: PointerEvent) => void;
  /** Double-click on the header: back to the default place. */
  onResetPlace?: () => void;
  now?: number;
}

export function ChallengesPanel({ state, style, onHot, now, onClose, onAnalyze, onChecks, onApplyStructure, onKeepStructure, compare, outlineGuide, wordCount, minWords, draftText, onStart, onDragStart, onResetPlace }: ChallengesPanelProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const c = summaryCounts(state);
  const list = sortChallenges(state.challenges);
  const running = Object.values(state.passes).some((p) => p.state === 'running');
  const analyzed = state.analyzedVersion !== undefined;
  const checks = checksOf(state);
  const noneOn = CHECK_IDS.every((k) => !checks[k]);
  const canAnalyze = !running && !noneOn && !structureOpen(state) && (draftChanged(state) || checksChanged(state) || staleFindings(state) || !!firstError(state));
  const compact = !!compare && (structureOpen(state) || structureGuiding(state));
  // Before the first run the panel is the picks, the hint and Start; counts and sections would only say zero.
  const beforeStart = !!onStart && !analyzed && !running && !state.structure && state.claims.length === 0 && state.clarity.length === 0 && !Object.values(state.passes).some((p) => p.state === 'error');
  const stage = elaborateStage(state);
  const writing = structureGuiding(state);
  // Structure and Elaborate are two jobs for one pass: picking one clears the other; picking it again picks neither.
  const pick = (id: CheckId) => {
    if (!onChecks) return;
    const on = checks[id];
    if (id === 'structure' || id === 'elaborate') onChecks({ ...checks, structure: id === 'structure' && !on, elaborate: id === 'elaborate' && !on });
    else onChecks({ ...checks, [id]: !on });
  };
  const chip = (id: CheckId) => {
    const on = checks[id];
    return (
      <button key={id} class={`ws-pick${on ? ' on' : ''}`} data-check={id} aria-pressed={on} title={CHECK_HINT[id]} onClick={() => pick(id)}>
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
  };

  return (
    <aside class="ws-panel" style={style} aria-label="WordSnap">
      <div
        class={`ws-head${onDragStart ? ' ws-drag' : ''}`}
        title={onDragStart ? 'Drag to move. Double-click to put it back.' : undefined}
        onPointerDown={onDragStart ? (e) => !(e.target as Element).closest('button') && e.button === 0 && onDragStart(e as unknown as PointerEvent) : undefined}
        onDblClick={onResetPlace ? (e) => !(e.target as Element).closest('button') && onResetPlace() : undefined}
      >
        <Mark />
        <span class="ws-name">WordSnap</span>
        <StatusPill state={state} now={now} />
        {onAnalyze && analyzed ? (
          <button
            class="ws-btn ws-reanalyze"
            disabled={!canAnalyze}
            onClick={onAnalyze}
            title={canAnalyze ? 'Re-run clarity on the changed paragraphs, check new claims, and refresh the counterargument' : running ? 'Analyzing…' : structureOpen(state) ? 'Apply or keep the proposed structure first' : 'Nothing changed since the last analysis'}
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
      {stage ? (
        <div class="ws-stages" aria-label="Elaborate stages">
          {(['elaborate', 'write', 'check'] as const).map((st, i) => {
            const at = ['elaborate', 'write', 'check'].indexOf(stage);
            const cls = i < at ? 'done' : i === at ? 'now' : '';
            return (
              <span key={st} class={`ws-stage ${cls}`} data-stage={st}>
                <b>{i < at ? '✓' : i + 1}</b>
                {st === 'elaborate' ? 'Elaborate' : st === 'write' ? 'Write' : 'Check'}
              </span>
            );
          })}
        </div>
      ) : null}
      <div class={`ws-picks${writing ? ' dim' : ''}`} role="group" aria-label="What to check">
        <div class="ws-pair" role="group" aria-label="Structure or Elaborate">
          {chip('structure')}
          {chip('elaborate')}
        </div>
        {CHECK_IDS.filter((id) => id !== 'structure' && id !== 'elaborate').map(chip)}
      </div>
      {writing ? <p class="ws-picks-note">Polish, Facts and Challenge run when you press Done in the pane, on what you wrote.</p> : null}
      <div class={`ws-progress${running ? ' running' : ''}`} />
      {compact ? (
        <StructureSection state={state} compact guide={outlineGuide} />
      ) : (
        <>
      {noneOn && analyzed ? <div class="ws-idle">Pick at least one check.</div> : null}
      {running && !state.argument && state.claims.every((cl) => !cl.data.verdict) ? <PassProgress state={state} checks={checks} /> : null}
      {!running && !state.argument && !state.structure && state.claims.length === 0 && state.clarity.length === 0 && !Object.values(state.passes).some((p) => p.state === 'error') ? (
        beforeStart && (wordCount ?? 0) >= (minWords ?? 8) ? (
          <StartBlock text={draftText ?? ''} checks={checks} noneOn={noneOn} onStart={onStart} onChecks={onChecks} />
        ) : (
          <IdleHint wordCount={wordCount ?? 0} minWords={minWords ?? 8} />
        )
      ) : null}
      {beforeStart ? null : (
      <>
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
        {checks.structure ? <StructureSection state={state} onApply={onApplyStructure} onKeep={onKeepStructure} /> : null}
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
      </>
      )}
        </>
      )}
    </aside>
  );
}


const PASS_LABEL: Record<'S' | 'A' | 'B' | 'C', string> = { S: 'Reading the order of your ideas', A: 'Reading for clarity and claims', B: 'Checking facts', C: 'Building the counterargument' };

/**
 * The structure pass's answer: a proposed order with Apply / Keep while it is open, otherwise one line on what it
 * found. Nothing until the pass has run.
 */
function StructureSection({
  state,
  onApply,
  onKeep,
  compact,
  guide,
}: {
  state: SessionState;
  onApply?: (paragraphs: string[]) => void;
  onKeep?: () => void;
  compact?: boolean;
  guide?: { slots: StructureSlot[]; fills: SlotFill[]; onDone?: () => void };
}) {
  const st = state.structure;
  const running = state.passes.S?.state === 'running';
  if (!st && !running) return null;
  const open = !!st && st.verdict !== 'keeps' && st.status === 'open';
  const guiding = !!st && st.verdict === 'outline' && st.status === 'guiding';
  if (compact && st && (open || guiding)) {
    const outline = st.verdict === 'outline';
    return (
      <section class="ws-sec ws-structure" data-status={st.status}>
        <h3>
          {outline ? 'Skeleton' : 'Structure'}
          <span class="pass">{guiding ? 'as you write' : 'waiting on you'}</span>
        </h3>
        {guide ? (
          <>
            <p class="ws-struct-note">Writing into the skeleton. Each paragraph, and whether it is written yet:</p>
            <ul class="ws-guide" aria-label="Skeleton">
              {guide.slots.map((sl, i) => (
                <li key={i} data-fill={guide.fills[i]}>
                  <b>¶{i + 1}</b>
                  {sl.role}
                  <span>{guide.fills[i] === 'written' ? 'written' : guide.fills[i] === 'seeded' ? 'fragment only' : 'nothing yet'}</span>
                </li>
              ))}
            </ul>
            {guide.onDone ? (
              <div class="ws-btns">
                <button class="ws-btn primary" data-act="outline-done" onClick={guide.onDone} title="Close the skeleton and check what you wrote">
                  Done, check it
                </button>
              </div>
            ) : null}
          </>
        ) : guiding ? (
          <p class="ws-struct-note">Writing into the skeleton beside your draft. Done in the pane runs the checks on what you wrote; so does Re-analyze.</p>
        ) : outline ? (
          <p class="ws-struct-note">A skeleton for what you typed, beside it: {(st.slots ?? []).length} paragraphs to write. Apply it or keep yours as it is; the other checks wait for that.</p>
        ) : (
          <p class="ws-struct-note">{st.paragraphs.length} paragraphs, beside your draft. Apply it or keep yours there; the other checks wait for that.</p>
        )}
      </section>
    );
  }
  return (
    <section class="ws-sec ws-structure" data-status={st ? (st.verdict === 'reorder' ? st.status : 'keeps') : 'running'}>
      <h3>
        Structure<span class="pass">{open ? 'waiting on you' : 'structure pass'}</span>
      </h3>
      {running ? (
        <p class="ws-empty">Reading the order of your ideas…</p>
      ) : !st ? null : st.verdict === 'keeps' ? (
        <p class="ws-struct-ok">Your order holds. {st.note}</p>
      ) : st.status === 'open' ? (
        <>
          <p class="ws-struct-note">{st.note}</p>
          <div class="ws-proposal" aria-label="Proposed order">
            {st.verdict === 'outline'
              ? (st.slots ?? []).map((sl, i) => (
                  <p key={i}>
                    <b>{sl.role}.</b> {sl.job}
                  </p>
                ))
              : st.paragraphs.map((para, i) => <p key={i}>{para}</p>)}
          </div>
          {onApply || onKeep ? (
            <div class="ws-btns">
              {onApply ? (
                <button class="ws-btn primary" data-act="apply-structure" onClick={() => onApply(st.paragraphs)} title="Replace the draft with your sentences in this order">
                  Apply structure
                </button>
              ) : null}
              {onKeep ? (
                <button class="ws-btn" data-act="keep-structure" onClick={onKeep} title="Keep your order and check the draft as written">
                  Keep mine
                </button>
              ) : null}
            </div>
          ) : null}
          <p class="ws-struct-hint">Your sentences, reordered; nothing added. Undo in the editor puts the draft back.</p>
        </>
      ) : st.status === 'guiding' ? (
        <p class="ws-struct-note">Writing into the skeleton. Re-analyze checks what you wrote.</p>
      ) : st.status === 'applied' ? (
        <p class="ws-struct-ok">{st.verdict === 'outline' ? 'Skeleton done.' : 'Structure applied.'} {st.note}</p>
      ) : st.status === 'kept' ? (
        <p class="ws-empty">Kept your order.</p>
      ) : (
        <p class="ws-empty">The draft changed since this order was proposed. Re-analyze for a fresh one.</p>
      )}
    </section>
  );
}

/** Shown only during the first analysis, when there is nothing else to look at yet. */
function PassProgress({ state, checks }: { state: SessionState; checks: Checks }) {
  const ids = (checks.structure ? (['S', 'A', 'B', 'C'] as const) : (['A', 'B', 'C'] as const)).filter((id) => id !== 'B' || checks.facts).filter((id) => id !== 'C' || checks.challenge || checks.structure);
  return (
    <div class="ws-firstrun" role="status" aria-live="polite">
      <div class="ws-firstrun-title">Analyzing your draft</div>
      <ul>
        {ids.map((id) => {
          const p = state.passes[id] ?? { state: 'idle' as const };
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

/**
 * Before the first run: the picks are above, this says what the text reads like and which job fits it, and Start
 * runs with the picks as they are. Nothing has left the page yet.
 */
function StartBlock({ text, checks, noneOn, onStart, onChecks }: { text: string; checks: Checks; noneOn: boolean; onStart: () => void; onChecks?: (c: Checks) => void }) {
  const hint = intentHint(text, checks);
  const label = checks.elaborate ? 'Build the skeleton' : checks.structure ? 'Check this draft' : 'Run the checks';
  return (
    <div class="ws-start" role="status">
      <p class="ws-start-hint" data-intent={hint.intent}>
        {hint.text}
        {hint.suggest && onChecks ? (
          <>
            {' '}
            <button class="ws-link" data-act={`pick-${hint.suggest}`} onClick={() => onChecks({ ...checks, structure: hint.suggest === 'structure', elaborate: hint.suggest === 'elaborate' })}>
              Pick {hint.suggest === 'elaborate' ? 'Elaborate' : 'Structure'}
            </button>
          </>
        ) : null}
      </p>
      <button class="ws-btn primary ws-start-btn" data-act="start" disabled={noneOn} onClick={onStart} title={noneOn ? 'Pick at least one check' : 'Nothing is sent until you press this'}>
        {label}
      </button>
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