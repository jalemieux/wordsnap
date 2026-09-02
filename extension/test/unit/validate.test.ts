import { filterSources, validatePassA, validatePassB, validatePassC } from '../../src/passes/validate';
import { SAMPLE_PASS_A, SAMPLE_PASS_B, SAMPLE_PASS_C, SAMPLE_SOURCES_SEEN, SAMPLE_TEXT } from '../../src/shared/sample';

describe('validatePassA', () => {
  it('locates every sample quote', () => {
    const r = validatePassA(SAMPLE_PASS_A, SAMPLE_TEXT);
    expect(r.clarity).toHaveLength(2);
    expect(r.claims).toHaveLength(3);
    for (const c of r.claims) expect(SAMPLE_TEXT.slice(c.span.start, c.span.end)).toBe(c.data.quote);
  });

  it('drops findings whose quote is not in the text', () => {
    const r = validatePassA(
      { clarity: [{ id: 'x', quote: 'not in the draft at all', kind: 'fuzzy', note: 'n', severity: 'low' }], claims: [] },
      SAMPLE_TEXT,
    );
    expect(r.clarity).toHaveLength(0);
  });

  it('drops suggestions longer than 1.3x the quote and keeps the finding', () => {
    const r = validatePassA(
      { clarity: [{ id: 'x', quote: 'Hi all,', kind: 'structure', note: 'n', severity: 'low', suggestion: 'Hello everyone on the leadership team, hope you are well,' }], claims: [] },
      SAMPLE_TEXT,
    );
    expect(r.clarity).toHaveLength(1);
    expect(r.clarity[0]!.data.suggestion).toBeUndefined();
  });

  it('dedupes overlapping clarity findings keeping the higher severity', () => {
    const r = validatePassA(
      {
        clarity: [
          { id: 'a', quote: 'The evidence is stronger than people assume.', kind: 'fuzzy', note: 'n', severity: 'low' },
          { id: 'b', quote: 'stronger than people assume', kind: 'hedge', note: 'n', severity: 'high' },
        ],
        claims: [],
      },
      SAMPLE_TEXT,
    );
    expect(r.clarity).toHaveLength(1);
    expect(r.clarity[0]!.data.id).toBe('b');
  });
});

describe('sources', () => {
  it('keeps only URLs that appeared in search results, ignoring case and trailing slash', () => {
    const kept = filterSources(
      [
        { url: 'https://autonomy.work/portfolio/uk4dwpilotresults', title: 'a' },
        { url: 'https://made-up.example/report', title: 'b' },
        { url: 'https://AUTONOMY.work/portfolio/uk4dwpilotresults/', title: 'dupe' },
      ],
      SAMPLE_SOURCES_SEEN,
    );
    expect(kept.map((s) => s.title)).toEqual(['a']);
  });
});

describe('validatePassB', () => {
  const claims = SAMPLE_PASS_A.claims;

  it('passes the sample through intact', () => {
    const v = validatePassB(SAMPLE_PASS_B, claims, SAMPLE_TEXT, SAMPLE_SOURCES_SEEN);
    expect(v).toHaveLength(3);
    expect(v.find((x) => x.claimId === 'f3')!.status).toBe('contradicted');
    expect(v.find((x) => x.claimId === 'f3')!.suggestion).toBe('56 of the 61 companies kept it');
  });

  it('downgrades a verdict to unverifiable when none of its sources were seen', () => {
    const v = validatePassB(SAMPLE_PASS_B, claims, SAMPLE_TEXT, []);
    expect(v.every((x) => x.status === 'unverifiable')).toBe(true);
    expect(v.every((x) => x.sources.length === 0)).toBe(true);
  });

  it('ignores verdicts for unknown or duplicate claim ids', () => {
    const v = validatePassB(
      { verdicts: [{ ...SAMPLE_PASS_B.verdicts[0]!, claimId: 'nope' }, SAMPLE_PASS_B.verdicts[1]!, SAMPLE_PASS_B.verdicts[1]!] },
      claims,
      SAMPLE_TEXT,
      SAMPLE_SOURCES_SEEN,
    );
    expect(v.map((x) => x.claimId)).toEqual(['f2']);
  });
});

describe('validatePassC', () => {
  it('locates anchors and filters sources', () => {
    const r = validatePassC(SAMPLE_PASS_C, SAMPLE_TEXT, SAMPLE_SOURCES_SEEN);
    expect(r.challenges).toHaveLength(4);
    expect(r.challenges[0]!.spans).toHaveLength(2);
    expect(r.challenges[0]!.data.sources).toHaveLength(1);
  });

  it('drops a challenge with no locatable anchor', () => {
    const r = validatePassC(
      { ...SAMPLE_PASS_C, challenges: [{ ...SAMPLE_PASS_C.challenges[1]!, anchors: ['nowhere to be found'] }] },
      SAMPLE_TEXT,
      [],
    );
    expect(r.challenges).toHaveLength(0);
  });
});
