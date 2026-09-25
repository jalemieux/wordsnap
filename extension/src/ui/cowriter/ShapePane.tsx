// src/ui/cowriter/ShapePane.tsx
// The shaped draft beside the dump: every sentence traced to what the writer said, bridges marked, the choices it made
// (flippable), what it left out, what is missing (fillable), Apply and Keep mine.
import { shapedText, type ShapeState, type Tune } from '../../shared/cowriter';
import { LABEL } from './copy';

export interface PaneGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  wide: boolean;
  font: { family: string; size: string; lineHeight: string };
}

export interface ShapePaneProps {
  shape: ShapeState;
  tuneNow: Tune;
  geo: PaneGeometry;
  hotQuote: string | null;
  onHover(from: string[] | null): void;
  onFlip(choice: number): void;
  onFill(gap: number): void;
  onApply(text: string): void;
  onKeep(): void;
  onReshape(): void;
}

const sameTune = (a: Tune, b: Tune) => a.length === b.length && a.tone === b.tone && a.for === b.for;

export function ShapePane({ shape, tuneNow, geo, hotQuote, onHover, onFlip, onFill, onApply, onKeep, onReshape }: ShapePaneProps) {
  const view = shape.view!;
  const t = shape.tune;
  const swapped = new Map(shape.flips.map((i) => [`${view.choices[i]!.paragraph}:${view.choices[i]!.sentence}`, view.choices[i]!.alt] as const));
  const nBridge = view.paragraphs.reduce((n, p) => n + p.sentences.filter((s) => s.bridge).length, 0);
  const nAll = view.paragraphs.reduce((n, p) => n + p.sentences.length, 0);
  const tuneChanged = !sameTune(t, tuneNow);
  return (
    <section class={`cw-pane${geo.wide ? '' : ' over'}`} style={{ left: `${geo.left}px`, top: `${geo.top}px`, width: `${geo.width}px`, height: `${geo.height}px` }} onMouseLeave={() => onHover(null)} aria-label="Shaped draft">
      <header class="cw-pane-head">
        <b>Shaped</b>
        <span>
          {LABEL.length[t.length]} · {LABEL.tone[t.tone]} · {LABEL.for[t.for]}
        </span>
        <span class="acts">
          <button class="ws-btn" data-act="keep" onClick={onKeep}>
            Keep mine
          </button>
          <button class="ws-btn primary" data-act="apply" onClick={() => onApply(shapedText(view, shape.flips, shape.fills))}>
            Apply
          </button>
        </span>
      </header>
      {tuneChanged || shape.stale ? (
        <div class="cw-stale">
          <span>{tuneChanged ? 'The dials changed since this was shaped.' : null} {shape.stale ? 'Your draft changed since this was shaped.' : null}</span>
          <button class="ws-btn small" data-act="reshape" onClick={onReshape}>
            Re-shape
          </button>
        </div>
      ) : null}
      <p class="cw-note">
        {view.note} {nBridge ? `${nBridge} of ${nAll} sentences are WordSnap's (dashed); the rest say what you wrote.` : 'Every sentence says something you wrote.'}
      </p>
      <div class="cw-text" style={{ fontFamily: geo.font.family, fontSize: geo.font.size, lineHeight: geo.font.lineHeight }}>
        {view.paragraphs.map((p, pi) => (
          <div class="cw-sec">
            {p.role ? <div class="cw-role">{p.role}</div> : null}
            <p>
              {p.sentences.map((s, si) => {
                const alt = swapped.get(`${pi}:${si}`);
                const from = alt ? alt.from : s.from;
                const hot = hotQuote !== null && from.includes(hotQuote);
                return (
                  <>
                    <span class={`cw-sn${s.bridge ? ' bridge' : ''}${alt ? ' flipped' : ''}${hot ? ' hot' : ''}`} title={s.bridge ? 'Written by WordSnap to connect. No new facts.' : undefined} onMouseOver={() => onHover(from)}>
                      {alt ? alt.text : s.text}
                    </span>{' '}
                  </>
                );
              })}
              {view.missing.map((m, mi) => (m.after === pi ? (shape.fills[mi] ?? []).map((f) => <><span class="cw-sn bridge">{f}</span>{' '}</>) : null))}
            </p>
          </div>
        ))}
      </div>
      {view.choices.length ? (
        <div class="cw-box">
          <h5>Where you went back and forth</h5>
          {view.choices.map((c, i) => {
            const on = shape.flips.includes(i);
            return (
              <div class="row">
                <div class="grow">
                  On {c.topic}, I kept <q>{on ? c.other : c.kept}</q> over <q>{on ? c.kept : c.other}</q>.
                </div>
                <button class={`cw-switch${on ? ' on' : ''}`} data-flip={i} aria-pressed={on} title="Flip to the other side" onClick={() => onFlip(i)} />
              </div>
            );
          })}
        </div>
      ) : null}
      {view.dropped.length ? (
        <div class="cw-box">
          <h5>Left out</h5>
          {view.dropped.map((d) => (
            <div class="row">
              <div class="grow">
                <q>{d.quote}</q>: {d.why}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {view.missing.length ? (
        <div class="cw-box">
          <h5>Missing</h5>
          {view.missing.map((m, i) => (
            <div class="row">
              <div class="grow">{m.what}.</div>
              {shape.fills[i] ? (
                <span class="cw-done">bridged</span>
              ) : (
                <button class="ws-btn small" data-fill={i} disabled={shape.filling !== undefined} onClick={() => onFill(i)}>
                  {shape.filling === i ? 'Filling…' : 'Fill this'}
                </button>
              )}
            </div>
          ))}
          {shape.error ? <p class="cw-err">{shape.error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
