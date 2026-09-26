// src/ui/cowriter/TweakCard.tsx
// Select a passage, say what you want: the ✎ Tweak pill and the card that asks, shows the change as a diff, and applies it.
// A draft-wide tweak (asked for in the panel) uses the same card, wider, over the whole draft.
import { useState } from 'preact/hooks';
import type { Span } from '../../shared/types';
import type { TweakScope, TweakState, Tune } from '../../shared/cowriter';
import { LABEL, PRESETS } from './copy';
import { readableDiff } from './diff';

export interface TweakAsk {
  quote: string;
  span: Span;
  scope?: TweakScope;
}

export interface TweakCardProps {
  ask: TweakAsk | null;
  tweak: TweakState | undefined;
  tune: Tune;
  at: { left: number; top: number };
  onSend(instruction: string, mode: 'new' | 'refine' | 'again'): void;
  /** Leave the instruction as a comment on the selection instead of running it now. */
  onComment?(text: string): void;
  onApply(): void;
  onKeep(): void;
}

export function TweakPill({ at, onOpen }: { at: { left: number; top: number }; onOpen(): void }) {
  return (
    <button class="cw-pill" style={{ left: `${at.left}px`, top: `${at.top}px` }} onMouseDown={(e) => e.preventDefault()} onClick={onOpen}>
      ✎ Tweak
    </button>
  );
}

export function AskRow({ placeholder, label, primary, onSend, second }: { placeholder: string; label: string; primary: boolean; onSend(v: string): void; second?: { label: string; onSend(v: string): void } }) {
  const [value, setValue] = useState('');
  const send = (to: (v: string) => void = onSend) => {
    const v = value.trim();
    if (!v) return;
    setValue('');
    to(v);
  };
  return (
    <div class="cw-askrow">
      <input
        value={value}
        placeholder={placeholder}
        autoFocus
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />
      <button class={`ws-btn${primary ? ' primary' : ''}`} data-submit disabled={!value.trim()} title="Send (Enter)" onClick={() => send()}>
        {label} ↵
      </button>
      {second ? (
        <button class="ws-btn" data-second disabled={!value.trim()} onClick={() => send(second.onSend)}>
          {second.label}
        </button>
      ) : null}
    </div>
  );
}

export function TweakCard({ ask, tweak, tune, at, onSend, onComment, onApply, onKeep }: TweakCardProps) {
  if (!ask && !tweak) return null;
  const draftWide = (tweak?.scope ?? ask?.scope) === 'draft';
  const presets = (mode: 'new' | 'refine') => (
    <div class="cw-presets">
      {PRESETS.map((p) => (
        <button data-preset={p} onClick={() => onSend(p, mode)}>
          {p}
        </button>
      ))}
    </div>
  );
  let body;
  if (!tweak) {
    body = (
      <>
        <div class="cw-k">
          <span>{draftWide ? 'Change the whole draft' : onComment ? 'Comment on this passage' : 'Tweak this passage'}</span>
          <span>
            {LABEL.length[tune.length]} · {LABEL.tone[tune.tone]}
          </span>
        </div>
        {onComment ? (
          <>
            <AskRow placeholder="What should change here: “say X”, “instead of Y, Z”" label="Comment" primary onSend={onComment} second={{ label: 'Tweak now', onSend: (v) => onSend(v, 'new') }} />
            <p class="cw-hint">A comment waits in the panel until you press Revise. Tweak now runs on this passage alone.</p>
          </>
        ) : (
          <AskRow placeholder="Say what you want: “make it say why it matters”" label="Tweak" primary onSend={(v) => onSend(v, 'new')} />
        )}
        {presets('new')}
      </>
    );
  } else if (tweak.status === 'running') {
    body = <p class="cw-line">{tweak.steps.length ? 'Refining…' : draftWide ? 'Changing the draft…' : 'Tweaking…'}</p>;
  } else if (tweak.status === 'stale') {
    body = (
      <>
        <p class="cw-warn">{draftWide ? 'The draft changed while I was working on it. Ask again.' : 'This passage changed while I was working on it. Select it again.'}</p>
        <button class="ws-btn" data-tw="keep" onClick={onKeep}>
          Close
        </button>
      </>
    );
  } else if (tweak.status === 'error') {
    body = (
      <>
        <p class="cw-warn">{tweak.error}</p>
        <AskRow placeholder="Say it another way…" label="Tweak" primary onSend={(v) => onSend(v, tweak.steps.length ? 'refine' : 'new')} />
        <button class="ws-btn" data-tw="keep" onClick={onKeep}>
          Close
        </button>
      </>
    );
  } else {
    const last = tweak.steps[tweak.steps.length - 1]!;
    body = (
      <>
        <div class="cw-k">
          <span>{tweak.steps.map((s) => s.instruction).join(' → ')}</span>
          <span>{draftWide ? 'whole draft' : `${Math.round((last.text.length / Math.max(1, tweak.quote.length)) * 100)}% of the length`}</span>
        </div>
        <div class="cw-diff">
          {readableDiff(tweak.quote, last.text).map((d) => (d.op === 'eq' ? d.text : d.op === 'del' ? <del>{d.text}</del> : <ins>{d.text}</ins>))}
        </div>
        {last.note ? <p class="cw-why">{last.note}</p> : null}
        <div class="cw-acts">
          <button class="ws-btn primary" data-tw="apply" onClick={onApply}>
            Apply
          </button>
          <button class="ws-btn" data-tw="again" onClick={() => onSend(last.instruction, 'again')}>
            Again
          </button>
          <button class="ws-btn" data-tw="keep" onClick={onKeep}>
            Keep mine
          </button>
        </div>
        <AskRow placeholder="Refine: “less formal”, “keep the first half”…" label="Refine" primary={false} onSend={(v) => onSend(v, 'refine')} />
        {draftWide ? null : presets('refine')}
      </>
    );
  }
  return (
    <div class={`cw-card${draftWide ? ' wide' : ''}`} data-scope={draftWide ? 'draft' : 'passage'} style={{ left: `${at.left}px`, top: `${at.top}px` }} onKeyDown={(e) => e.key === 'Escape' && onKeep()}>
      {body}
    </div>
  );
}
