// src/ui/cowriter/RevisePane.tsx
// What Revise proposes, beside the draft: one change per comment as a diff, each one tickable, the comments it could
// not act on with why, and Apply (one edit for everything ticked) or Keep mine.
import { useState } from 'preact/hooks';
import type { Comment, ReviseChange, ReviseState } from '../../shared/cowriter';
import type { Span } from '../../shared/types';
import { readableDiff } from './diff';
import type { PaneGeometry } from './ShapePane';

export interface RevisePaneProps {
  revise: ReviseState;
  geo: PaneGeometry;
  onHover(span: Span | null): void;
  onApply(text: string, changes: ReviseChange[]): void;
  onKeep(): void;
  onRevise(): void;
}

export function RevisePane({ revise, geo, onHover, onApply, onKeep, onRevise }: RevisePaneProps) {
  // Unticked change indexes; everything is on until the user says otherwise.
  const [off, setOff] = useState<Set<number>>(new Set());
  const byId = new Map<string, { comment: Comment; n: number }>(revise.comments.map((c, i) => [c.id, { comment: c, n: i + 1 }]));
  const picked = revise.changes.filter((_, i) => !off.has(i));
  const toggle = (i: number) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <section class={`cw-pane${geo.wide ? '' : ' over'}`} style={{ left: `${geo.left}px`, top: `${geo.top}px`, width: `${geo.width}px`, height: `${geo.height}px` }} onMouseLeave={() => onHover(null)} aria-label="Revised draft">
      <header class="cw-pane-head">
        <b>Revised</b>
        <span>
          {revise.changes.length} change{revise.changes.length === 1 ? '' : 's'} from {revise.comments.length} comment{revise.comments.length === 1 ? '' : 's'}
        </span>
        <span class="acts">
          <button class="ws-btn" data-act="keep" onClick={onKeep}>
            Keep mine
          </button>
          <button class="ws-btn primary" data-act="apply" disabled={revise.stale || !picked.length} onClick={() => onApply(revise.text, picked)}>
            Apply {picked.length === revise.changes.length ? 'all' : picked.length}
          </button>
        </span>
      </header>
      {revise.stale ? (
        <div class="cw-stale">
          <span>Your draft changed since this was made.</span>
          <button class="ws-btn small" data-act="revise" onClick={onRevise}>
            Revise again
          </button>
        </div>
      ) : null}
      {revise.note ? <p class="cw-note">{revise.note}</p> : null}
      <div class="cw-text" style={{ fontFamily: geo.font.family, fontSize: geo.font.size, lineHeight: geo.font.lineHeight }}>
        {revise.changes.map((ch, i) => {
          const c = byId.get(ch.comment);
          return (
            <div class={`cw-rv${off.has(i) ? ' off' : ''}`} data-change={i} onMouseOver={() => onHover(ch.span)}>
              <input type="checkbox" checked={!off.has(i)} aria-label="Apply this change" onChange={() => toggle(i)} />
              <div class="grow">
                <div class="ask">
                  <b>{c?.n ?? '?'}</b> {c?.comment.text}
                </div>
                <div class="cw-diff">{readableDiff(ch.quote, ch.replacement).map((d) => (d.op === 'eq' ? d.text : d.op === 'del' ? <del>{d.text}</del> : <ins>{d.text}</ins>))}</div>
                {ch.note ? <p class="cw-why">{ch.note}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {revise.skipped.length ? (
        <div class="cw-box">
          <h5>Not changed</h5>
          {revise.skipped.map((sk) => {
            const c = byId.get(sk.comment);
            return (
              <div class="row">
                <div class="grow">
                  <b>{c?.n ?? '?'}</b> <q>{c?.comment.text}</q>: {sk.why}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
