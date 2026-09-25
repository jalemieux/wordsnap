// src/ui/cowriter/Panel.tsx
// The co-writer panel: stage line, the dials, what Shape is doing, the tweaks applied, and Check (soon).
import type { CowriterState, Tune } from '../../shared/cowriter';
import { AUDIENCES, LENGTHS, TONES } from '../../shared/cowriter';
import { Mark } from '../components/bits';
import { CHECK_SOON, DIAL_HINT, DIAL_TITLE, LABEL, STAGES, type Stage } from './copy';

export interface PanelProps {
  state: CowriterState;
  stage: Stage;
  onStage(stage: Stage): void;
  onTune(tune: Tune): void;
  onShape(): void;
  onClose(): void;
  compact: boolean;
  style?: Record<string, string>;
  onDragStart?: (e: PointerEvent) => void;
  onResetPlace?: () => void;
}

export function busy(s: CowriterState): boolean {
  return s.shape?.status === 'running' || s.shape?.filling !== undefined || s.tweak?.status === 'running';
}

const OPTIONS = { length: LENGTHS, tone: TONES, for: AUDIENCES } as const;

export function Panel({ state, stage, onStage, onTune, onShape, onClose, compact, style, onDragStart, onResetPlace }: PanelProps) {
  const working = busy(state);
  const sh = state.shape;
  const dial = (key: keyof Tune) => (
    <div class="cw-dial">
      <label>
        {DIAL_TITLE[key]}
        <b>{(DIAL_HINT[key] as Record<string, string>)[state.tune[key]]}</b>
      </label>
      <div class="cw-seg">
        {OPTIONS[key].map((v) => (
          <button class={state.tune[key] === v ? 'on' : ''} data-dial={key} data-v={v} aria-pressed={state.tune[key] === v} onClick={() => onTune({ ...state.tune, [key]: v })}>
            {(LABEL[key] as Record<string, string>)[v]}
          </button>
        ))}
      </div>
    </div>
  );
  const shapeButton = (
    <button class="ws-btn primary cw-cta" data-act="shape" disabled={working} onClick={onShape}>
      {sh ? 'Re-shape my draft' : 'Shape my draft'}
    </button>
  );
  let body;
  if (stage === 'tune') {
    body = (
      <>
        {dial('length')}
        {dial('tone')}
        {dial('for')}
        <p class="cw-hint">Set these once for this site. Shape uses them; Tweak starts from them.</p>
        {shapeButton}
      </>
    );
  } else if (stage === 'shape') {
    body = !sh ? (
      <p class="cw-line">Nothing shaped yet. Set the dials, then shape.</p>
    ) : sh.status === 'running' ? (
      <p class="cw-line">Shaping your draft…</p>
    ) : sh.status === 'error' ? (
      <>
        <p class="cw-line cw-err">{sh.error}</p>
        {shapeButton}
      </>
    ) : sh.status === 'open' ? (
      <p class="cw-line">The shaped draft is beside yours. Hover a sentence to see what it came from.</p>
    ) : (
      <>
        <p class="cw-line">{sh.status === 'applied' ? 'Applied. Undo in the editor brings your draft back.' : 'You kept your draft.'}</p>
        {shapeButton}
      </>
    );
  } else if (stage === 'tweak') {
    body = (
      <>
        <div class="cw-mini">
          <span>{LABEL.length[state.tune.length]}</span>
          <span>{LABEL.tone[state.tune.tone]}</span>
          <span>{LABEL.for[state.tune.for]}</span>
        </div>
        <p class="cw-line">Select any passage in your draft and press ✎ Tweak. Say what you want, or pick a preset.</p>
        <div class="cw-tweaks">
          <h5>Applied tweaks</h5>
          {state.applied.length ? state.applied.map((t) => <div class="cw-tw">{t.instruction} <span>on “{t.quote.length > 40 ? t.quote.slice(0, 40) + '…' : t.quote}”</span></div>) : <div class="cw-tw"><span>None yet.</span></div>}
        </div>
      </>
    );
  } else {
    body = <p class="cw-line">{CHECK_SOON}</p>;
  }
  return (
    <aside class={`ws-panel cw-panel${compact ? ' compact' : ''}`} style={style} aria-label="WordSnap">
      <div
        class={`ws-head${onDragStart ? ' ws-drag' : ''}`}
        title={onDragStart ? 'Drag to move. Double-click to put it back.' : undefined}
        onPointerDown={onDragStart ? (e) => !(e.target as Element).closest('button') && e.button === 0 && onDragStart(e as unknown as PointerEvent) : undefined}
        onDblClick={onResetPlace ? (e) => !(e.target as Element).closest('button') && onResetPlace() : undefined}
      >
        <Mark />
        <span class="ws-name">WordSnap</span>
        <span class={`cw-status${working ? ' busy' : ''}`}>
          <i />
          {working ? 'Working…' : 'Ready'}
        </span>
        <button class="ws-close" onClick={onClose} aria-label="Hide WordSnap" title="Hide WordSnap">
          ✕
        </button>
      </div>
      <nav class="cw-stages">
        {STAGES.map((s, i) => (
          <button class={`${stage === s.id ? 'on' : ''}${s.id === 'check' ? ' soon' : ''}`} data-stage={s.id} aria-current={stage === s.id ? 'step' : undefined} onClick={() => onStage(s.id)}>
            <span class="n">{i + 1}</span>
            {s.label}
            {s.id === 'check' ? <span class="soon-tag">soon</span> : null}
          </button>
        ))}
      </nav>
      {compact ? null : <div class="cw-body">{body}</div>}
    </aside>
  );
}
