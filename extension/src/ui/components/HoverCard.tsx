import { useEffect, useRef, useState } from 'preact/hooks';
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
  /** `source` says whether the replacement is WordSnap's suggestion or the user's own wording. */
  onApply: (findingId: string, span: Span, replacement: string, source?: 'suggestion' | 'rewrite') => void;
  onKeep: (findingId: string) => void;
  /** The user opened the rewrite box: the card should stay up (pinned) while they type. */
  onRewriteStart?: (findingId: string) => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

/**
 * Keystrokes in the rewrite box must not reach the host page, whose bubbling shortcut handlers would see the shadow
 * host as the target. Capture-phase listeners on the document still run first; nothing here can stop those.
 */
function swallow(e: Event) {
  e.stopPropagation();
}

const CARD_W = 330;
const CARD_H_GUESS = 240;
/** With the rewrite box open the card is taller; the guess decides whether it flips above the anchor. */
const CARD_H_EDITING = 340;

export function cardPosition(anchor: RectLike, viewport: { width: number; height: number }, height = CARD_H_GUESS) {
  let left = anchor.left;
  let top = anchor.top + anchor.height + 8;
  if (left + CARD_W > viewport.width - 12) left = Math.max(8, viewport.width - 12 - CARD_W);
  if (top + height > viewport.height - 12) top = Math.max(8, anchor.top - height - 8);
  // No room either side: keep the buttons reachable rather than the top edge aligned.
  if (top + height > viewport.height - 12) top = Math.max(8, viewport.height - 12 - height);
  return { left, top };
}

export function HoverCard(p: HoverCardProps) {
  const { finding, pinned } = p;
  const f = finding.f;
  const open = f.status === 'open';
  const suggestion = finding.kind === 'clarity' ? finding.f.data.suggestion : finding.f.data.verdict?.suggestion;
  const done =
    f.status === 'applied' ? 'Change applied' : f.status === 'kept' ? 'Kept as written' : f.status === 'stale' ? 'Re-checking after your edit' : null;
  // Rewrite: the user types their own replacement for the quoted span. Prefilled with the suggestion when there is one.
  // Keyed by finding id so a card that moves to another finding opens closed, without an effect.
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const editing = editingFor === f.id;
  const setEditing = (on: boolean) => setEditingFor(on ? f.id : null);
  // Focus the box ourselves: the autofocus attribute is honoured once per document at most, and while focus sits on
  // the page after the Rewrite button unmounts, the first keystrokes would go to the host.
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    box.current?.focus();
    box.current?.select();
  }, [editing]);
  const canRewrite = open && !!f.span && !(finding.kind === 'claim' && finding.f.data.verdict?.status === 'supported');
  const trimmed = draft.trim();
  const rewriteOk = trimmed.length > 0 && trimmed !== f.quote;
  const pos = cardPosition(p.anchor, p.viewport, editing ? CARD_H_EDITING : CARD_H_GUESS);
  const startRewrite = () => {
    setDraft(suggestion ?? f.quote);
    setEditing(true);
    p.onRewriteStart?.(f.id);
  };

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
      {editing && canRewrite ? (
        <div class="ws-rewrite">
          <label class="ws-rewrite-l" for={`ws-rw-${f.id}`}>
            Your wording for this span
          </label>
          <textarea
            id={`ws-rw-${f.id}`}
            class="ws-rewrite-t"
            rows={3}
            value={draft}
            ref={box}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              swallow(e);
              // No Ctrl/Cmd+Enter to apply: in a mail composer that combination sends. Buttons only.
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onKeyUp={swallow}
            onKeyPress={swallow}
          />
          <div class="ws-btns">
            <button class="ws-btn primary" data-act="apply-rewrite" disabled={!rewriteOk} onClick={() => p.onApply(f.id, f.span!, trimmed, 'rewrite')}>
              Apply
            </button>
            <button class="ws-btn" data-act="cancel-rewrite" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <span class="ws-rewrite-hint">Replaces only this span. WordSnap re-checks it.</span>
          </div>
        </div>
      ) : open && suggestion && f.span ? (
        <>
          <div class="ws-diff">
            <del>{f.quote}</del> <ins>{suggestion}</ins>
          </div>
          <div class="ws-btns">
            <button class="ws-btn primary" data-act="apply" onClick={() => p.onApply(f.id, f.span!, suggestion, 'suggestion')}>
              Apply change
            </button>
            <button class="ws-btn" data-act="rewrite" onClick={startRewrite} title="Type your own wording for this span">
              Rewrite
            </button>
            <button class="ws-btn" data-act="keep" onClick={() => p.onKeep(f.id)}>
              Keep as-is
            </button>
          </div>
        </>
      ) : canRewrite ? (
        <div class="ws-btns">
          <button class="ws-btn" data-act="rewrite" onClick={startRewrite} title="Type your own wording for this span">
            Rewrite
          </button>
          <button class="ws-btn" data-act="keep" onClick={() => p.onKeep(f.id)}>
            Keep as-is
          </button>
        </div>
      ) : null}
    </div>
  );
}
