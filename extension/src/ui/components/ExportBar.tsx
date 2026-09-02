import type { SessionState } from '../../shared/types';
import { bodyText, openIssueCount } from '../format';
import { Mark } from './bits';

export interface ExportBarProps {
  state: SessionState;
  text: string;
  style?: Record<string, string>;
  inPanel?: boolean;
  onCopy: () => void;
  onShare: (target: 'x' | 'linkedin') => void;
  onPreview: () => void;
}

export function ExportBar({ state, text, style, inPanel, onCopy, onShare, onPreview }: ExportBarProps) {
  const checked = state.claims.some((c) => c.data.verdict);
  const n = openIssueCount(state);
  const chars = bodyText(text).length;
  let note;
  if (!checked) note = <span class="ws-empty">Claims not checked yet</span>;
  else if (n === 0) note = <span class="ok">Claims checked, nothing open</span>;
  else note = <span class="warn">{n === 1 ? '1 claim still contradicted or imprecise' : `${n} claims still open`}</span>;
  return (
    <div class={`ws-export${inPanel ? ' in-panel' : ''}`} style={style} role="toolbar" aria-label="Share">
      <Mark small />
      {note}
      <span class="grow" />
      <button class="ws-btn" data-x="copy" onClick={onCopy}>
        Copy
      </button>
      <button class="ws-btn" data-x="x" onClick={() => onShare('x')} title={chars > 280 ? 'Longer than one post; Preview splits it into a thread' : undefined}>
        Post on X <span class="g">{chars}</span>
      </button>
      <button class="ws-btn" data-x="linkedin" onClick={() => onShare('linkedin')}>
        LinkedIn
      </button>
      <button class="ws-btn" data-x="preview" onClick={onPreview}>
        Preview
      </button>
    </div>
  );
}
