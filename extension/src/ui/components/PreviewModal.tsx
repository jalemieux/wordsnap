import { useEffect } from 'preact/hooks';
import type { SessionState } from '../../shared/types';
import { bodyText, containsOpenContradiction, openIssueCount, paragraphsOf, readSeconds, splitForX, wordCount } from '../format';
import { Mark } from './bits';

export type PreviewTab = 'email' | 'x' | 'linkedin';

export interface PreviewModalProps {
  state: SessionState;
  text: string;
  tab: PreviewTab;
  onTab: (t: PreviewTab) => void;
  onClose: () => void;
  onCopy: (text: string, what: string) => void;
  onShare: (target: 'x' | 'linkedin') => void;
}

const LI_FOLD = 210;

export function PreviewModal({ state, text, tab, onTab, onClose, onCopy, onShare }: PreviewModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = openIssueCount(state);
  const flag = open ? (
    <span class="flag">{open === 1 ? '1 fact-check flag still open' : `${open} fact-check flags still open`}</span>
  ) : (
    <span class="flag ok">Claims checked</span>
  );
  const body = bodyText(text);

  let content;
  let foot;
  if (tab === 'email') {
    content = (
      <>
        <div class="ws-meta">
          <span>
            <span class="n">{wordCount(text)}</span> words
          </span>
          <span>
            <span class="n">{readSeconds(text)}s</span> to read
          </span>
          {flag}
        </div>
        <div class="ws-mail">
          <div class="mb">
            {paragraphsOf(text).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </>
    );
    foot = (
      <>
        <span class="hint">This is what your reader will see. Sending stays in your mail client.</span>
        <button class="ws-btn" onClick={onClose}>
          Back to draft
        </button>
        <button class="ws-btn primary" onClick={onClose}>
          Looks right
        </button>
      </>
    );
  } else if (tab === 'x') {
    const n = body.length;
    const posts = splitForX(body);
    const over = n > 280;
    content = (
      <>
        <div class="ws-meta">
          <span>
            <span class={`n${over ? ' over' : ''}`}>{n.toLocaleString()} / 280</span> characters
          </span>
          {over ? (
            <span>
              Split into a thread of <span class="n">{posts.length}</span>
            </span>
          ) : null}
          {flag}
        </div>
        {posts.map((p, i) => {
          const hit = containsOpenContradiction(p, state, text);
          return (
            <div class={`ws-post${hit ? ' flag' : ''}`} key={i} data-post={i + 1}>
              {p}
              <div class={`cnt${p.length > 280 ? ' over' : ''}`}>{p.length} / 280</div>
              {hit ? <div class="pflag">Post {i + 1} still carries the contradicted claim.</div> : null}
            </div>
          );
        })}
      </>
    );
    foot = (
      <>
        <span class="hint">Greeting and sign-off dropped for X.</span>
        <button class="ws-btn" onClick={() => onCopy(posts.join('\n\n'), 'Thread copied')}>
          Copy thread
        </button>
        <button class="ws-btn primary" onClick={() => onShare('x')}>
          Open X with post 1
        </button>
      </>
    );
  } else {
    const above = body.slice(0, LI_FOLD);
    const below = body.slice(LI_FOLD);
    content = (
      <>
        <div class="ws-meta">
          <span>
            <span class={`n${body.length > 3000 ? ' over' : ''}`}>{body.length.toLocaleString()} / 3,000</span> characters
          </span>
          <span>
            First <span class="n">{LI_FOLD}</span> show before the fold
          </span>
          {flag}
        </div>
        <div class="ws-li">
          {above}
          {below ? <span class="fold" /> : null}
          {below}
        </div>
      </>
    );
    foot = (
      <>
        <span class="hint">Your hook is whatever lands above the fold.</span>
        <button class="ws-btn" onClick={() => onCopy(body, 'Copied for LinkedIn')}>
          Copy for LinkedIn
        </button>
        <button class="ws-btn primary" onClick={() => onShare('linkedin')}>
          Open LinkedIn share
        </button>
      </>
    );
  }

  return (
    <div class="ws-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="ws-modal" role="dialog" aria-modal="true" aria-label="Preview before sharing">
        <div class="ws-mhead">
          <Mark small />
          <div class="ws-tabs" role="tablist">
            {(['email', 'x', 'linkedin'] as PreviewTab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
                {t === 'email' ? 'Email' : t === 'x' ? 'X' : 'LinkedIn'}
              </button>
            ))}
          </div>
          <button class="ws-mclose" aria-label="Close preview" onClick={onClose}>
            ✕
          </button>
        </div>
        <div class="ws-mbody">{content}</div>
        <div class="ws-mfoot">{foot}</div>
      </div>
    </div>
  );
}
