// @vitest-environment happy-dom
import { SAMPLE_PARAGRAPHS, SAMPLE_TEXT } from '../../../src/shared/sample';
import { buildContenteditableSnapshot, buildTextareaSnapshot, rangeForSpan } from '../../../src/content/text-snapshot';
import { loadFixture } from './helpers';

const body = () => document.getElementById('message-body') as HTMLElement;

describe('buildContenteditableSnapshot (Gmail fixture)', () => {
  beforeEach(() => loadFixture('gmail-compose.html'));

  it('produces the canonical sample text', () => {
    const snap = buildContenteditableSnapshot(body());
    expect(snap.text).toBe(SAMPLE_TEXT);
  });

  it('paragraph spans match the sample paragraphs', () => {
    const snap = buildContenteditableSnapshot(body());
    expect(snap.paragraphs.map((p) => snap.text.slice(p.start, p.end))).toEqual(SAMPLE_PARAGRAPHS);
  });

  it('increments the version per build', () => {
    const a = buildContenteditableSnapshot(body());
    const b = buildContenteditableSnapshot(body());
    expect(b.version).toBeGreaterThan(a.version);
  });

  it('rangeFor round-trips a span inside one text node', () => {
    const snap = buildContenteditableSnapshot(body());
    const quote = 'not a single company went back to five days';
    const start = snap.text.indexOf(quote);
    const range = rangeForSpan(snap, { start, end: start + quote.length });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe(quote);
  });

  it('rangeFor round-trips a span across nodes and inline markup', () => {
    body().innerHTML = '<div>Iceland ran <b>trials</b> covering <i>more than</i> 1% of its workforce.</div><div><br></div><div>Next.</div>';
    const snap = buildContenteditableSnapshot(body());
    expect(snap.text).toBe('Iceland ran trials covering more than 1% of its workforce.\n\nNext.');
    const quote = 'ran trials covering more than 1%';
    const start = snap.text.indexOf(quote);
    const range = rangeForSpan(snap, { start, end: start + quote.length });
    expect(range!.toString()).toBe(quote);
  });

  it('nudges a span that starts on a synthetic newline to the next real character', () => {
    const snap = buildContenteditableSnapshot(body());
    const idx = snap.text.indexOf('\n\nI want');
    const range = rangeForSpan(snap, { start: idx, end: idx + 2 + 'I want'.length });
    expect(range!.toString()).toBe('I want');
  });

  it('returns null for spans outside the text or after the node is removed', () => {
    const snap = buildContenteditableSnapshot(body());
    expect(rangeForSpan(snap, { start: 5, end: 2 })).toBeNull();
    expect(rangeForSpan(snap, { start: 0, end: snap.text.length + 10 })).toBeNull();
    body().innerHTML = '<div>gone</div>';
    expect(rangeForSpan(snap, { start: 0, end: 5 })).toBeNull();
  });

  it('collapses whitespace runs, skips hidden and WordSnap nodes, keeps nbsp as a space', () => {
    body().innerHTML = '<div>Hello&nbsp;&nbsp;world   and\n  more<span hidden>secret</span><span data-wordsnap="x">ours</span></div>';
    const snap = buildContenteditableSnapshot(body());
    expect(snap.text).toBe('Hello  world and more');
  });

  it('treats a bare leading text node followed by divs the Gmail way', () => {
    body().innerHTML = 'Hi all,<div><br></div><div>Second paragraph here.</div>';
    const snap = buildContenteditableSnapshot(body());
    expect(snap.text).toBe('Hi all,\n\nSecond paragraph here.');
    expect(snap.paragraphs).toHaveLength(2);
  });
});

describe('other editors', () => {
  it('reads a Draft.js structure (X fixture)', () => {
    loadFixture('x-composer.html');
    const root = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement;
    const snap = buildContenteditableSnapshot(root);
    expect(snap.paragraphs.map((p) => snap.text.slice(p.start, p.end))).toEqual(SAMPLE_PARAGRAPHS.slice(0, 3));
  });

  it('reads a Quill structure (LinkedIn fixture)', () => {
    loadFixture('linkedin-share.html');
    const root = document.querySelector('.ql-editor') as HTMLElement;
    const snap = buildContenteditableSnapshot(root);
    expect(snap.paragraphs.map((p) => snap.text.slice(p.start, p.end))).toEqual(SAMPLE_PARAGRAPHS.slice(0, 3));
  });

  it('reads a textarea', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const ta = document.getElementById('t') as HTMLTextAreaElement;
    ta.value = 'One.\r\n\r\nTwo.\n';
    const snap = buildTextareaSnapshot(ta);
    expect(snap.text).toBe('One.\n\nTwo.');
    expect(snap.paragraphs).toEqual([{ start: 0, end: 4 }, { start: 6, end: 10 }]);
    expect(rangeForSpan(snap, { start: 0, end: 4 })).toBeNull();
  });
});
