// Shared helpers for UI tests: a SessionState anchored against SAMPLE_TEXT, and a fake ComposerHandle.
import type { ComposerHandle } from '../../../src/adapters/types';
import { SAMPLE_PASS_A, SAMPLE_PASS_B, SAMPLE_PASS_C, SAMPLE_TEXT } from '../../../src/shared/sample';
import { emptySession, type AnchoredChallenge, type SessionState, type Span } from '../../../src/shared/types';

export function spanOf(quote: string, text = SAMPLE_TEXT): Span {
  const i = text.indexOf(quote);
  if (i < 0) throw new Error(`quote not found: ${quote}`);
  return { start: i, end: i + quote.length };
}

export function sampleState(overrides: Partial<SessionState> = {}): SessionState {
  const s = emptySession('gmail:1', 'gmail');
  s.clarity = SAMPLE_PASS_A.clarity.map((c) => ({ id: c.id, quote: c.quote, span: spanOf(c.quote), status: 'open', data: c }));
  s.claims = SAMPLE_PASS_A.claims.map((c) => ({
    id: c.id,
    quote: c.quote,
    span: spanOf(c.quote),
    status: 'open',
    data: { ...c, verdict: SAMPLE_PASS_B.verdicts.find((v) => v.claimId === c.id) },
  }));
  s.argument = { thesis: SAMPLE_PASS_C.thesis, premises: SAMPLE_PASS_C.premises };
  // Deliberately shuffled so ordering is tested.
  const shuffled = [SAMPLE_PASS_C.challenges[3]!, SAMPLE_PASS_C.challenges[1]!, SAMPLE_PASS_C.challenges[0]!, SAMPLE_PASS_C.challenges[2]!];
  s.challenges = shuffled.map<AnchoredChallenge>((ch) => {
    const spans = ch.anchors.map((a) => spanOf(a));
    return { id: ch.id, quote: ch.anchors[0]!, span: spans[0]!, spans, status: 'open', data: ch };
  });
  const now = Date.now();
  s.passes = { A: { state: 'done', at: now }, B: { state: 'done', at: now }, C: { state: 'done', at: now } };
  return { ...s, ...overrides };
}

export function fakeHandle(text = SAMPLE_TEXT): ComposerHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return {
    key: 'gmail:1',
    element: el,
    platform: { kind: 'email' },
    getSnapshot: () => ({ text, paragraphs: [], version: 1 }),
    rangeFor: (span) =>
      ({
        getClientRects: () => [{ top: 100 + span.start / 10, left: 40, width: Math.max(10, span.end - span.start) * 6, height: 18 }],
        getBoundingClientRect: () => ({ top: 100, left: 40, width: 100, height: 18 }),
      }) as unknown as Range,
    applyEdit: () => true,
    onChange: () => () => {},
    anchorRect: () => ({ top: 60, left: 20, width: 600, height: 500, right: 620, bottom: 560, x: 20, y: 60, toJSON: () => ({}) }) as DOMRect,
    scrollParent: () => el,
    isAlive: () => true,
  };
}

export function mount(vnode: preact.VNode): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { render } = require('preact') as typeof import('preact');
  render(vnode, c);
  return c;
}

export function click(el: Element | null | undefined) {
  if (!el) throw new Error('element not found');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
