import type { ClarityFinding } from '../../shared/schemas';
import type { Anchored, ClaimWithVerdict, Span } from '../../shared/types';
import { CLARITY_LABEL, VERDICT_LABEL } from '../format';
import { Chip, Meter, Sources } from './bits';
import type { RectLike } from './HighlightLayer';

export type CardFinding =
  | { kind: 'clarity'; f: Anchored<ClarityFinding> }
  | { kind: 'claim'; f: Anchored<ClaimWithVerdict> };

export interface HoverCardProps {
  finding: CardFinding;
  /** The first client rect of the highlight; the card is placed below it, or above when there is no room. */
  anchor: RectLike;
  pinned: boolean;
  viewport: { width: number; height: number };
  onApply: (findingId: string, span: Span, replacement: string) => void;
  onKeep: (findingId: string) => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

const CARD_W = 330;
const CARD_H_GUESS = 240;

export function cardPosition(anchor: RectLike, viewport: { width: number; height: number }, height = CARD_H_GUESS) {
  let left = anchor.left;
  let top = anchor.top + anchor.height + 8;
  if (left + CARD_W > viewport.width - 12) left = Math.max(8, viewport.width - 12 - CARD_W);
  if (top + height > viewport.height - 12) top = Math.max(8, anchor.top - height - 8);
  return { left, top };
}

export function HoverCard(p: HoverCardProps) {
  const { finding, pinned } = p;
  const pos = cardPosition(p.anchor, p.viewport);
  const f = finding.f;
  const open = f.status === 'open';
  const suggestion = finding.kind === 'clarity' ? finding.f.data.suggestion : finding.f.data.verdict?.suggestion;
  const done =
    f.status === 'applied' ? 'Change applied' : f.status === 'kept' ? 'Kept as written' : f.status === 'stale' ? 'Re-checking after your edit' : null;

  return (
    <div
      class="ws-card"
      id={`ws-card-${f.id}`}
      role="dialog"
      aria-label={finding.kind === 'clarity' ? 'Clarity note' : 'Fact check'}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onMouseEnter={p.onEnter}
      onMouseLeave={p.onLeave}
    >
      <div class="k">
        {finding.kind === 'clarity' ? 'Clarity' : 'Fact check'}
        <span class="pin">{pinned ? 'pinned · click text to unpin' : 'click text to pin'}</span>
      </div>
      {finding.kind === 'claim' ? (
        <>
          <div class="ws-fi-top">
            {finding.f.data.verdict ? (
              <>
                <Chip status={finding.f.data.verdict.status} label={VERDICT_LABEL[finding.f.data.verdict.status] ?? finding.f.data.verdict.status} />
                <Meter n={finding.f.data.verdict.confidence} />
              </>
            ) : (
              <Chip status="unverifiable" label="Checking" />
            )}
          </div>
          <q class="ws-q">{f.quote}</q>
          <div>{finding.f.data.verdict?.finding ?? finding.f.data.statement}</div>
          {finding.f.data.verdict ? <Sources list={finding.f.data.verdict.sources} /> : null}
        </>
      ) : (
        <>
          <div class="ws-fi-top">
            <Chip status="clarity" label={CLARITY_LABEL[finding.f.data.kind] ?? finding.f.data.kind} />
            <span class="ws-meter-l" style={{ marginLeft: 'auto' }}>
              clarity pass
            </span>
          </div>
          <q class="ws-q">{f.quote}</q>
          <div>{finding.f.data.note}</div>
        </>
      )}
      {done ? <div class="ws-done">{done}</div> : null}
      {open && suggestion && f.span ? (
        <>
          <div class="ws-diff">
            <del>{f.quote}</del> <ins>{suggestion}</ins>
          </div>
          <div class="ws-btns">
            <button class="ws-btn primary" data-act="apply" onClick={() => p.onApply(f.id, f.span!, suggestion)}>
              Apply change
            </button>
            <button class="ws-btn" data-act="keep" onClick={() => p.onKeep(f.id)}>
              Keep as-is
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
