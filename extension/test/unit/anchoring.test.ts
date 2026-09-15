import { changedParagraphs, diffText, locateQuote, normalizeClaim, shiftSpans, snapshotFromText, stableId , minimalParagraphEdit } from '../../src/shared/anchoring';

describe('locateQuote', () => {
  const text = 'The evidence is stronger than people assume. In the UK’s 2022 pilot, not a single company went back.';

  it('finds an exact match', () => {
    expect(locateQuote(text, 'stronger than people')).toEqual({ start: 16, end: 36 });
  });

  it('matches across curly quotes, dashes and whitespace differences', () => {
    const span = locateQuote(text, "In the UK's  2022 pilot");
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe('In the UK’s 2022 pilot');
  });

  it('falls back to case-insensitive matching', () => {
    const span = locateQuote(text, 'the evidence IS stronger');
    expect(text.slice(span!.start, span!.end)).toBe('The evidence is stronger');
  });

  it('returns null when the quote is not present', () => {
    expect(locateQuote(text, 'four-day week')).toBeNull();
    expect(locateQuote(text, '')).toBeNull();
  });

  it('prefers the match nearest the hint when there are several', () => {
    const t = 'we win. they lose. we win. they lose.';
    expect(locateQuote(t, 'we win')!.start).toBe(0);
    expect(locateQuote(t, 'we win', 25)!.start).toBe(19);
  });
});

describe('diffText / shiftSpans', () => {
  it('reports no change for identical text', () => {
    const r = shiftSpans('abc def', 'abc def', [{ start: 4, end: 7 }]);
    expect(r).toEqual([{ span: { start: 4, end: 7 }, changed: false }]);
  });

  it('shifts spans after an insertion before them without marking them changed', () => {
    const oldT = 'Hello world, this is fine.';
    const newT = 'Hello big world, this is fine.';
    const [s] = shiftSpans(oldT, newT, [{ start: 13, end: 25 }]);
    expect(s!.changed).toBe(false);
    expect(newT.slice(s!.span!.start, s!.span!.end)).toBe('this is fine');
  });

  it('shifts spans after a deletion before them', () => {
    const oldT = 'Hello big world, this is fine.';
    const newT = 'Hello world, this is fine.';
    const [s] = shiftSpans(oldT, newT, [{ start: 17, end: 29 }]);
    expect(s!.changed).toBe(false);
    expect(newT.slice(s!.span!.start, s!.span!.end)).toBe('this is fine');
  });

  it('leaves spans before an edit untouched', () => {
    const oldT = 'productivity jumped 40%. Iceland ran trials.';
    const newT = 'productivity jumped 40%. Iceland ran many trials.';
    const [s] = shiftSpans(oldT, newT, [{ start: 0, end: 23 }]);
    expect(s).toEqual({ span: { start: 0, end: 23 }, changed: false });
  });

  it('marks a span changed when text inside it is edited and keeps it covering the edit', () => {
    const oldT = 'In the pilot, not a single company went back to five days.';
    const newT = 'In the pilot, almost no company went back to five days.';
    const [s] = shiftSpans(oldT, newT, [{ start: 14, end: 57 }]);
    expect(s!.changed).toBe(true);
    expect(newT.slice(s!.span!.start, s!.span!.end)).toBe('almost no company went back to five days');
  });

  it('drops a span whose text was deleted entirely', () => {
    const oldT = 'keep this. delete me. keep that.';
    const newT = 'keep this. keep that.';
    const [s] = shiftSpans(oldT, newT, [{ start: 11, end: 20 }]);
    expect(s!.span).toBeNull();
    expect(s!.changed).toBe(true);
  });

  it('does not treat an insertion at the span boundary as a change to the span', () => {
    const oldT = 'jumped 40%. Iceland';
    const newT = 'jumped 40% in a month. Iceland';
    const [s] = shiftSpans(oldT, newT, [{ start: 0, end: 10 }]);
    expect(s!.changed).toBe(false);
    expect(newT.slice(s!.span!.start, s!.span!.end)).toBe('jumped 40%');
  });

  it('handles two separate edits in one diff independently', () => {
    const oldT = 'aaa one bbb two ccc three ddd';
    const newT = 'aaa ONE bbb two ccc THREE ddd';
    const r = shiftSpans(oldT, newT, [
      { start: 4, end: 7 },
      { start: 12, end: 15 },
      { start: 20, end: 25 },
    ]);
    expect(r[0]!.changed).toBe(true);
    expect(r[1]!.changed).toBe(false);
    expect(newT.slice(r[1]!.span!.start, r[1]!.span!.end)).toBe('two');
    expect(r[2]!.changed).toBe(true);
  });

  it('produces ops that reconstruct the new text', () => {
    const oldT = 'The quick brown fox jumps over the lazy dog';
    const newT = 'The quick red fox leaps over a lazy dog!';
    const ops = diffText(oldT, newT);
    const rebuilt = ops.filter((o) => o.op !== 'del').map((o) => newT.slice(o.newStart, o.newEnd)).join('');
    expect(rebuilt).toBe(newT);
    const oldSide = ops.filter((o) => o.op !== 'ins').map((o) => oldT.slice(o.oldStart, o.oldEnd)).join('');
    expect(oldSide).toBe(oldT);
  });
});

describe('snapshots', () => {
  it('splits paragraphs on blank lines', () => {
    const s = snapshotFromText('one\n\ntwo\nstill two\n\nthree');
    expect(s.paragraphs.map((p) => s.text.slice(p.start, p.end))).toEqual(['one', 'two\nstill two', 'three']);
  });

  it('reports changed paragraph indexes', () => {
    const a = snapshotFromText('one\n\ntwo\n\nthree', 1);
    const b = snapshotFromText('one\n\ntwo edited\n\nthree', 2);
    expect(changedParagraphs(a, b)).toEqual([1]);
    expect(changedParagraphs(null, b)).toEqual([0, 1, 2]);
  });
});

describe('keys', () => {
  it('normalizes claims for cache keys', () => {
    expect(normalizeClaim('  Microsoft Japan’s trial raised productivity by 40%! ')).toBe('microsoft japans trial raised productivity by 40%');
  });
  it('makes stable ids', () => {
    expect(stableId('cl', 'x')).toBe(stableId('cl', 'x'));
    expect(stableId('cl', 'x')).not.toBe(stableId('cl', 'y'));
  });
});

describe('minimalParagraphEdit', () => {
  const snap = (t: string) => snapshotFromText(t, 1);
  it('replaces only the paragraphs between a kept greeting and a kept sign-off', () => {
    const text = 'Hi all,\n\nB\n\nA\n\nC\n\n-- \nJane\nCTO';
    const e = minimalParagraphEdit(snap(text), ['Hi all,', 'A', 'B', 'C', '-- \nJane\nCTO'])!;
    expect(text.slice(e.span.start, e.span.end)).toBe('B\n\nA'); // C and the sign-off are a kept suffix
    expect(e.replacement).toBe('A\n\nB');
  });
  it('compares paragraphs after whitespace and quote normalization', () => {
    const text = 'Hi  all,\n\nB\n\nA';
    const e = minimalParagraphEdit(snap(text), ['Hi all,', 'A', 'B'])!;
    expect(text.slice(e.span.start, e.span.end)).toBe('B\n\nA');
  });
  it('returns null when nothing differs and falls back to the whole draft for a pure insertion', () => {
    expect(minimalParagraphEdit(snap('A\n\nB'), ['A', 'B'])).toBeNull();
    const e = minimalParagraphEdit(snap('A\n\nB'), ['A', 'X', 'B'])!;
    expect(e.span).toEqual({ start: 0, end: 4 });
    expect(e.replacement).toBe('A\n\nX\n\nB');
  });
  it('a dropped paragraph and a changed order still bound the edit to the moved block', () => {
    const text = 'Hi,\n\num ok\n\nB\n\nA\n\nBye';
    const e = minimalParagraphEdit(snap(text), ['Hi,', 'A', 'B', 'Bye'])!;
    expect(text.slice(e.span.start, e.span.end)).toBe('um ok\n\nB\n\nA');
    expect(e.replacement).toBe('A\n\nB');
  });
});
