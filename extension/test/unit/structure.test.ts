import { describe, expect, it } from 'vitest';
import { buildPassS } from '../../src/passes/build';
import { STRUCTURE_MAX_RATIO, STRUCTURE_MIN_RATIO, STRUCTURE_MIN_WORD_REUSE, validatePassS, wordReuse } from '../../src/passes/validate';
import { snapshotFromText } from '../../src/shared/anchoring';
import { PassS } from '../../src/shared/schemas';

// Three paragraphs with filler at the front of the first two. The pilot result is buried in the middle.
const P1 = 'Um, ok so here is the thing. We should ship the beta on Friday because the pilot users asked for it twice.';
const P2 = 'Anyway, the pilot ran for six weeks with forty teams and support tickets dropped by a third.';
const P3 = 'The launch plan is ready and marketing has the copy staged.';
const DRAFT = [P1, P2, P3].join('\n\n');

const NOTE = 'Lead with the pilot result; the ask follows from it.';

// The writer's sentences, filler dropped, result first.
const REORDERED = [
  'The pilot ran for six weeks with forty teams and support tickets dropped by a third.',
  'We should ship the beta on Friday because the pilot users asked for it twice.',
  P3,
];

describe('wordReuse', () => {
  it('is 1 when every long word of the proposal is in the draft', () => {
    expect(wordReuse('alpha beta gamma', 'gamma alpha')).toBe(1);
  });

  it('is 1 when the proposal has no word of four letters or more', () => {
    expect(wordReuse('', 'a an the cat')).toBe(1);
    expect(wordReuse('unrelated words', '')).toBe(1);
  });

  it('ignores words shorter than four letters', () => {
    // "dog" and "the" do not count; "alpha" does and is present.
    expect(wordReuse('alpha', 'the dog alpha')).toBe(1);
  });

  it('counts with multiplicity: a word used once in the draft can be reused once', () => {
    expect(wordReuse('alpha beta', 'alpha alpha')).toBe(0.5);
    expect(wordReuse('alpha alpha beta', 'alpha alpha')).toBe(1);
  });

  it('is the share of proposal words the draft has', () => {
    expect(wordReuse('alpha beta gamma delta', 'alpha beta omega epsilon')).toBe(0.5);
  });

  it('ignores case, curly quotes and dashes', () => {
    expect(wordReuse("don't re-run Alpha", 'DON’T RE‑RUN alpha')).toBe(1);
  });
});

describe('validatePassS', () => {
  it('passes a keeps verdict through with empty paragraphs and a trimmed note', () => {
    const r = validatePassS({ verdict: 'keeps', note: '  Reads in order already. ', paragraphs: ['ignored'] }, DRAFT);
    expect(r).toEqual({ proposal: { verdict: 'keeps', note: 'Reads in order already.', paragraphs: [] } });
    expect(r.reason).toBeUndefined();
  });

  it('demotes a reorder with no paragraphs to keeps', () => {
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: [] }, DRAFT);
    expect(r.proposal).toEqual({ verdict: 'keeps', note: NOTE, paragraphs: [] });
    expect(r.reason).toBe('empty proposal');
  });

  it('treats blank paragraphs as no paragraphs', () => {
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: ['', '   ', '\n\t'] }, DRAFT);
    expect(r.proposal.verdict).toBe('keeps');
    expect(r.reason).toBe('empty proposal');
  });

  it('demotes a proposal that is the draft itself, ignoring case, whitespace and quote style', () => {
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: [P1.toUpperCase(), `  ${P2}  `, P3.replace(/ /g, '  ')] }, DRAFT);
    expect(r.proposal).toEqual({ verdict: 'keeps', note: NOTE, paragraphs: [] });
    expect(r.reason).toBe('proposal equals the draft');
  });

  it('demotes a proposal shorter than half the draft', () => {
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: ['We should ship the beta on Friday.'] }, DRAFT);
    expect(r.proposal.verdict).toBe('keeps');
    expect(r.proposal.paragraphs).toEqual([]);
    expect(r.reason).toMatch(/^length ratio 0\.\d\d out of bounds$/);
  });

  it('demotes a proposal longer than 1.2x the draft', () => {
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: [P1, P2, P3, P1, P2, P3] }, DRAFT);
    expect(r.proposal.verdict).toBe('keeps');
    expect(r.reason).toMatch(/^length ratio \d\.\d\d out of bounds$/);
  });

  it('demotes a proposal that brings in words the writer did not use', () => {
    // The first paragraph rewritten with new vocabulary; the other two kept verbatim so the length stays in bounds.
    const rewritten = 'Customers demanded the beta repeatedly, so engineering recommends releasing it Friday.';
    const paragraphs = [REORDERED[0]!, rewritten, P3];
    const reuse = wordReuse(DRAFT, paragraphs.join('\n\n'));
    expect(reuse).toBeLessThan(STRUCTURE_MIN_WORD_REUSE);
    const ratio = paragraphs.join('\n\n').length / DRAFT.length;
    expect(ratio).toBeGreaterThanOrEqual(STRUCTURE_MIN_RATIO);
    expect(ratio).toBeLessThanOrEqual(STRUCTURE_MAX_RATIO);

    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs }, DRAFT);
    expect(r.proposal).toEqual({ verdict: 'keeps', note: NOTE, paragraphs: [] });
    expect(r.reason).toMatch(/^word reuse 0\.\d\d below 0\.9$/);
  });

  it('keeps a reorder that only moves the writer sentences and drops filler', () => {
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: REORDERED }, DRAFT);
    expect(r.reason).toBeUndefined();
    expect(r.proposal).toEqual({ verdict: 'reorder', note: NOTE, paragraphs: REORDERED });
  });

  it('trims and collapses spaces inside the paragraphs it returns, keeping single line breaks', () => {
    const messy = [`  ${REORDERED[0]}\n`, REORDERED[1]!.replace('ship the', 'ship   the'), `\t${P3}  `];
    const r = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: messy }, DRAFT);
    expect(r.proposal.verdict).toBe('reorder');
    expect(r.proposal.paragraphs).toEqual(REORDERED);
    // A multi-line sign-off or address block keeps its line breaks; blank lines inside a paragraph do not survive.
    const withBreaks = [...REORDERED.slice(0, -1), `${P3}\n  -- \n\nJane  \nCTO`];
    const r2 = validatePassS({ verdict: 'reorder', note: NOTE, paragraphs: withBreaks }, DRAFT);
    expect(r2.proposal.paragraphs[r2.proposal.paragraphs.length - 1]).toBe(`${P3}\n--\nJane\nCTO`);
  });

  it('checks a reorder at the boundary ratios with the same constants the code exports', () => {
    expect(STRUCTURE_MIN_RATIO).toBe(0.5);
    expect(STRUCTURE_MAX_RATIO).toBe(1.2);
    expect(STRUCTURE_MIN_WORD_REUSE).toBe(0.9);
  });
});

describe('PassS schema', () => {
  it('accepts the two verdicts and caps note and paragraph count', () => {
    expect(PassS.safeParse({ verdict: 'keeps', note: '', paragraphs: [] }).success).toBe(true);
    expect(PassS.safeParse({ verdict: 'reorder', note: NOTE, paragraphs: REORDERED }).success).toBe(true);
    expect(PassS.safeParse({ verdict: 'rewrite', note: NOTE, paragraphs: [] }).success).toBe(false);
    expect(PassS.safeParse({ verdict: 'keeps', note: 'x'.repeat(281), paragraphs: [] }).success).toBe(false);
    expect(PassS.safeParse({ verdict: 'reorder', note: NOTE, paragraphs: new Array(21).fill('p') }).success).toBe(false);
  });
});

describe('buildPassS', () => {
  const snapshot = snapshotFromText(DRAFT);

  it('builds a structure request with no research', () => {
    const req = buildPassS(snapshot, { effort: 'medium' });
    expect(req.pass).toBe('S');
    expect(req.schema).toBe(PassS);
    expect(req.effort).toBe('medium');
    expect(req.research).toBeUndefined();
    expect(req.system.length).toBeGreaterThan(0);
  });

  it('puts the numbered draft in the user text', () => {
    const req = buildPassS(snapshot, { effort: 'low' });
    expect(req.user).toContain(`<draft>\n[P1] ${P1}\n\n[P2] ${P2}\n\n[P3] ${P3}\n</draft>`);
  });

  it('prefixes the medium and subject when given', () => {
    const req = buildPassS(snapshot, { effort: 'low', context: { platform: 'email', subject: 'Beta on Friday' } });
    expect(req.user.startsWith('Medium: email. Subject line: Beta on Friday\n\n<draft>')).toBe(true);
  });
});
