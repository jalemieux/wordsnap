// src/ui/cowriter/TweakCard.tsx
// Select a passage, say what you want: the ✎ Tweak pill and the card that asks, shows the change as a diff, and applies it.
import { useState } from 'preact/hooks';
import type { Span } from '../../shared/types';
import type { TweakState, Tune } from '../../shared/cowriter';
import { LABEL, PRESETS } from './copy';
import { wordDiff } from './diff';

export interface TweakAsk {
  quote: string;
  span: Span;
}

export interface TweakCardProps {
  ask: TweakAsk | null;
  tweak: TweakState | undefined;
  tune: Tune;
  at: { left: number; top: number };
  onSend(instruction: string, mode: 'new' | 'refine' | 'again'): void;
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

function AskRow({ placeholder, label, primary, onSend }: { placeholder: string; label: string; primary: boolean; onSend(v: string): void }) {
  const [value, setValue] = useState('');
  const send = () => {
    const v = value.trim();
    if (!v) return;
    setValue('');
    onSend(v);
  };
  return (
    <div class="cw-askrow">
      <input
        value={value}
        placeholder={placeholder}
        autoFocus
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />
      <button class={`ws-btn${primary ? ' primary' : ''}`} data-submit disabled={!value.trim()} title="Send (Enter)" onClick={send}>
        {label} ↵
      </button>
    </div>
  );
}

export function TweakCard({ ask, tweak, tune, at, onSend, onApply, onKeep }: TweakCardProps) {
  if (!ask && !tweak) return null;
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
          <span>Tweak this passage</span>
          <span>
            {LABEL.length[tune.length]} · {LABEL.tone[tune.tone]}
          </span>
        </div>
        <AskRow placeholder="Say what you want: “make it say why it matters”" label="Tweak" primary onSend={(v) => onSend(v, 'new')} />
        {presets('new')}
      </>
    );
  } else if (tweak.status === 'running') {
    body = <p class="cw-line">{tweak.steps.length ? 'Refining…' : 'Tweaking…'}</p>;
  } else if (tweak.status === 'stale') {
    body = (
      <>
        <p class="cw-warn">This passage changed while I was working on it. Select it again.</p>
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
          <span>{Math.round((last.text.length / Math.max(1, tweak.quote.length)) * 100)}% of the length</span>
        </div>
        <div class="cw-diff">
          {wordDiff(tweak.quote, last.text).map((d) => (d.op === 'eq' ? d.text : d.op === 'del' ? <del>{d.text}</del> : <ins>{d.text}</ins>))}
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
        {presets('refine')}
      </>
    );
  }
  return (
    <div class="cw-card" style={{ left: `${at.left}px`, top: `${at.top}px` }} onKeyDown={(e) => e.key === 'Escape' && onKeep()}>
      {body}
    </div>
  );
}
