import { Session } from '../../src/background/session';
import { validatePassA, validatePassB, validatePassC } from '../../src/passes/validate';
import { snapshotFromText } from '../../src/shared/anchoring';
import { SAMPLE_PASS_A, SAMPLE_PASS_B, SAMPLE_PASS_C, SAMPLE_SOURCES_SEEN, SAMPLE_TEXT } from '../../src/shared/sample';

function seeded() {
  const s = new Session('k', 'gmail');
  s.applySnapshot(snapshotFromText(SAMPLE_TEXT, 1));
  const toVerify = s.mergePassA(validatePassA(SAMPLE_PASS_A, SAMPLE_TEXT));
  return { s, toVerify };
}

describe('Session', () => {
  it('anchors pass A with stable ids and reports checkable claims to verify', () => {
    const { s, toVerify } = seeded();
    expect(s.state.clarity).toHaveLength(2);
    expect(s.state.claims).toHaveLength(3);
    expect(toVerify.map((c) => c.quote)).toEqual(['productivity jumped 40%', 'more than 1% of its entire workforce', 'not a single company went back to five days']);
    const ids = s.state.claims.map((c) => c.id);
    const again = new Session('k2', 'gmail');
    again.applySnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    again.mergePassA(validatePassA(SAMPLE_PASS_A, SAMPLE_TEXT));
    expect(again.state.claims.map((c) => c.id)).toEqual(ids);
  });

  it('attaches verdicts by the ids it handed out', () => {
    const { s, toVerify } = seeded();
    const verdicts = validatePassB(
      { verdicts: SAMPLE_PASS_B.verdicts.map((v) => ({ ...v, claimId: toVerify.find((c) => c.quote === SAMPLE_PASS_A.claims.find((sc) => sc.id === v.claimId)!.quote)!.id })) },
      toVerify,
      SAMPLE_TEXT,
      SAMPLE_SOURCES_SEEN,
    );
    s.attachVerdicts(verdicts);
    expect(s.state.claims.filter((c) => c.data.verdict)).toHaveLength(3);
  });

  it('marks a finding stale when its text is edited and shifts the others', () => {
    const { s } = seeded();
    const edited = SAMPLE_TEXT.replace('not a single company went back to five days', 'almost every company kept it');
    s.applySnapshot(snapshotFromText(edited, 2));
    const f3 = s.state.claims.find((c) => c.data.statement.startsWith('No company'))!;
    expect(f3.status).toBe('stale');
    const f1 = s.state.claims.find((c) => c.quote === 'productivity jumped 40%')!;
    expect(f1.status).toBe('open');
    const c2 = s.state.clarity.find((c) => c.data.kind === 'hedge')!;
    expect(edited.slice(c2.span!.start, c2.span!.end)).toBe(c2.quote);
  });

  it('a new version of identical text keeps the analyzed mark, a changed one does not', () => {
    const s = new Session('k', 'gmail');
    s.applySnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    s.state.analyzedVersion = 1;
    s.applySnapshot(snapshotFromText(SAMPLE_TEXT, 2));
    expect(s.state.snapshotVersion).toBe(2);
    expect(s.state.analyzedVersion).toBe(2);
    s.applySnapshot(snapshotFromText(SAMPLE_TEXT + ' PS', 3));
    expect(s.state.analyzedVersion).toBe(2);
  });

  it('drops a finding whose text was deleted', () => {
    const { s } = seeded();
    const edited = SAMPLE_TEXT.replace("In the UK's 2022 pilot, not a single company went back to five days.", '');
    s.applySnapshot(snapshotFromText(edited, 2));
    expect(s.state.claims.find((c) => c.data.statement.startsWith('No company'))).toBeUndefined();
  });

  it('keeps kept/applied statuses through a re-run and does not resurrect them', () => {
    const { s } = seeded();
    const c1 = s.state.clarity[0]!;
    expect(s.applyAction(c1.id, 'kept')).toBe(true);
    s.mergePassA(validatePassA(SAMPLE_PASS_A, SAMPLE_TEXT));
    expect(s.state.clarity.find((c) => c.id === c1.id)!.status).toBe('kept');
  });

  it('incremental merge only replaces findings inside the changed paragraphs', () => {
    const { s } = seeded();
    // pretend the model re-analyzed paragraph 3 only and found nothing there
    s.mergePassA({ clarity: [], claims: [] }, [3]);
    expect(s.state.clarity.map((c) => c.data.kind)).toEqual(['fuzzy']); // the hedge in P4 (index 3) is gone
    expect(s.state.claims).toHaveLength(3); // claims in P3 (index 2) untouched
  });

  it('merges challenges with anchors and stable ids', () => {
    const { s } = seeded();
    s.mergePassC(validatePassC(SAMPLE_PASS_C, SAMPLE_TEXT, SAMPLE_SOURCES_SEEN));
    expect(s.state.challenges).toHaveLength(4);
    expect(s.state.argument?.thesis).toContain('four-day week');
    const first = s.state.challenges[0]!;
    expect(first.spans.length).toBe(2);
    expect(s.challengeParagraphs().has(2)).toBe(true);
  });
});
