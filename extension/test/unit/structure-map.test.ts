import { describe, expect, it } from 'vitest';
import { SAMPLE_DICTATED_TEXT, SAMPLE_PARAGRAPHS } from '../../src/shared/sample';
import { longestIncreasing, mapStructure, normSentence, splitSentences } from '../../src/shared/structure-map';

// A stream-of-consciousness draft: one run-on paragraph, the question first, the next step last.
const Q = 'Can agents self organize with a rigid harness?';
const S1 = 'I noticed the other day that two sessions were talking to one another.';
const S2 = 'I found that by chance, but it is expected given the work others have put in.';
const S3 = 'anyway, the story out of the lab confirmed my hunch that scaffolding is counterproductive.';
const S4 = 'So I built a simple message board and told the sessions to use it.';
const S5 = 'What I saw was interesting: the sessions would pick up work and coordinate on collision.';
const N = 'I want to take it a step further and let agents be notified instead of polling.';
const DRAFT = `${Q}\n${S1} ${S2} ${S3} ${S4} ${S5}\n\n${N}`;

// The proposal: four paragraphs, S2 moved after S3, "anyway, " cut.
const PROPOSAL = [Q, `${S1} ${S3.slice('anyway, '.length)} ${S2}`, `${S4} ${S5}`, N];

describe('splitSentences', () => {
  it('breaks after a terminator followed by space, and at line breaks, keeping spans into the text', () => {
    const s = splitSentences(DRAFT);
    expect(s.map((x) => x.text)).toEqual([Q, S1, S2, S3, S4, S5, N]);
    for (const x of s) expect(DRAFT.slice(x.span.start, x.span.end)).toBe(x.text);
  });

  it('does not break inside a number or before a non-space', () => {
    expect(splitSentences('Costs went up 1.3x since v2.0 shipped. Fine.').map((x) => x.text)).toEqual(['Costs went up 1.3x since v2.0 shipped.', 'Fine.']);
  });

  it('treats an ellipsis run as one terminator', () => {
    expect(splitSentences('swarms.... anyway this').map((x) => x.text)).toEqual(['swarms....', 'anyway this']);
  });

  it('offsets spans when given a paragraph offset', () => {
    expect(splitSentences('One. Two.', 100).map((x) => x.span)).toEqual([
      { start: 100, end: 104 },
      { start: 105, end: 109 },
    ]);
  });
});

describe('normSentence', () => {
  it('keeps letters and digits only, lower-cased', () => {
    expect(normSentence('Anyway, this: the "story" (40%)!')).toBe('anywaythisthestory40');
  });
});

describe('longestIncreasing', () => {
  it('returns the values of the longest increasing run', () => {
    expect(longestIncreasing([0, 1, 3, 2, 4, 6])).toEqual([0, 1, 3, 4, 6]);
    expect(longestIncreasing([])).toEqual([]);
    expect(longestIncreasing([5])).toEqual([5]);
  });
});

describe('mapStructure', () => {
  const map = mapStructure(DRAFT, PROPOSAL);

  it('gives every draft sentence its destination paragraph and position', () => {
    expect(map.draft.map((d) => d.dest)).toEqual([
      { para: 0, index: 0 },
      { para: 1, index: 0 },
      { para: 1, index: 2 },
      { para: 1, index: 1 },
      { para: 2, index: 0 },
      { para: 2, index: 1 },
      { para: 3, index: 0 },
    ]);
  });

  it('marks the one sentence that lands out of order as moved', () => {
    expect(map.draft.map((d) => d.moved)).toEqual([false, false, true, false, false, false, false]);
  });

  it('records cut filler as a trim span into the draft', () => {
    const s3 = map.draft[3]!;
    expect(s3.trim).not.toBeNull();
    expect(DRAFT.slice(s3.trim!.start, s3.trim!.end)).toBe('anyway, ');
  });

  it('points each proposed sentence back at its source', () => {
    expect(map.paragraphs.map((p) => p.sentences.map((s) => s.source))).toEqual([[0], [1, 3, 2], [4, 5], [6]]);
  });

  it('leaves a sentence the proposal dropped without a destination', () => {
    const m = mapStructure(DRAFT, [Q, `${S1} ${S3}`, N]);
    expect(m.draft[2]!.dest).toBeNull();
    expect(m.draft[4]!.dest).toBeNull();
  });

  it('shares one draft sentence across a split, and joins two into one', () => {
    const split = mapStructure('First half, second half. Tail.', ['First half. Second half.', 'Tail.']);
    expect(split.paragraphs[0]!.sentences.map((s) => s.source)).toEqual([0, 0]);
    expect(split.draft[0]!.trim).toBeNull();
    const joined = mapStructure('One thing. Another thing.', ['One thing another thing.']);
    expect(joined.paragraphs[0]!.sentences[0]!.source).toBe(0);
    expect(joined.draft.map((d) => d.dest)).toEqual([
      { para: 0, index: 0 },
      { para: 0, index: 0 },
    ]);
  });

  it('a sentence split in two keeps no trim: the tail lives on in the second piece', () => {
    const draft = "I'd suggest a pilot for design, with a checkpoint at six weeks, and support can follow once we've worked out coverage I guess.";
    const m = mapStructure(draft, ["I'd suggest a pilot for design, with a checkpoint at six weeks. Support can follow once we've worked out coverage."]);
    expect(m.paragraphs[0]!.sentences.map((s) => s.source)).toEqual([0, 0]);
    expect(m.draft[0]!.trim).toBeNull();
  });

  it('a lightly edited sentence still maps by word overlap, with no trim', () => {
    const m = mapStructure(DRAFT, [Q, 'I noticed the other day that two sessions were talking to each other.', N]);
    expect(m.paragraphs[1]!.sentences[0]!.source).toBe(1);
    expect(m.draft[1]!.trim).toBeNull();
  });

  it('a reworded sentence has no source, and is not counted as a move', () => {
    const m = mapStructure(DRAFT, [Q, 'Something entirely new here.', N]);
    expect(m.paragraphs[1]!.sentences[0]!.source).toBeNull();
    expect(m.draft.every((d) => !d.moved)).toBe(true);
  });

  it('maps the dictated sample onto the canned proposal with no unmatched proposal sentence', () => {
    const m = mapStructure(SAMPLE_DICTATED_TEXT, SAMPLE_PARAGRAPHS);
    const unmatched = m.paragraphs.flatMap((p) => p.sentences.filter((s) => s.source === null).map((s) => s.text));
    expect(unmatched).toEqual([]);
    // The ask moved up from the last paragraph.
    const ask = m.draft.find((d) => d.text.includes('four-day work week pilot on the table'))!;
    expect(ask.dest).toEqual({ para: 1, index: 0 });
    expect(ask.moved).toBe(true);
  });
});
