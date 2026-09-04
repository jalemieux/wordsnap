import { z } from 'zod';
import { parseJson } from '../../src/providers/lenient';
import { PassB, PassC } from '../../src/shared/schemas';

const source = (n: number) => ({ url: `https://example.org/${n}`, title: `Source ${n}` });

const verdict = (over: Partial<Record<string, unknown>> = {}) => ({
  claimId: 'c1',
  status: 'supported',
  finding: 'Holds up.',
  confidence: 4,
  sources: [source(1)],
  ...over,
});

const challenge = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'x1',
  kind: 'gap',
  title: 'No metrics',
  body: 'Nothing says what success looks like.',
  howToAddress: 'Name two metrics.',
  anchors: ['the pilot'],
  sources: [],
  ...over,
});

describe('parseJson (lenient)', () => {
  it('returns a conforming answer untouched with no notes', () => {
    const r = parseJson(JSON.stringify({ verdicts: [verdict()] }), PassB);
    expect(r).toEqual({ ok: true, data: { verdicts: [verdict()] }, notes: [] });
  });

  it('drops a source with a malformed URL and keeps the verdict', () => {
    const text = JSON.stringify({ verdicts: [verdict({ sources: [source(1), { url: 'not a url', title: 'bad' }, source(2)] })] });
    const r = parseJson(text, PassB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.verdicts[0]!.sources.map((s) => s.url)).toEqual(['https://example.org/1', 'https://example.org/2']);
    expect(r.notes).toEqual(['verdicts.0.sources.1: dropped (did not match the schema)']);
  });

  it('drops a challenge with an unknown kind and keeps the others', () => {
    const text = JSON.stringify({ thesis: 'T', premises: [], challenges: [challenge({ id: 'a' }), challenge({ id: 'b', kind: 'nitpick' }), challenge({ id: 'c' })] });
    const r = parseJson(text, PassC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.challenges.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('prunes several items across nesting levels in one pass', () => {
    const text = JSON.stringify({
      thesis: 'T',
      premises: [],
      challenges: [
        challenge({ id: 'a', sources: [{ url: 'nope', title: 'x' }, source(1)] }),
        challenge({ id: 'b', anchors: [] }), // min(1) on anchors: the challenge goes
        challenge({ id: 'c', sources: [source(2), { url: 'also nope', title: 'y' }] }),
      ],
    });
    const r = parseJson(text, PassC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.challenges.map((c) => c.id)).toEqual(['a', 'c']);
    expect(r.data.challenges[0]!.sources.map((s) => s.url)).toEqual(['https://example.org/1']);
    expect(r.data.challenges[1]!.sources.map((s) => s.url)).toEqual(['https://example.org/2']);
  });

  it('clips over-long strings at a word boundary and marks the cut', () => {
    const long = 'word '.repeat(200).trim(); // 999 chars
    const r = parseJson(JSON.stringify({ verdicts: [verdict({ finding: long })] }), PassB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const finding = r.data.verdicts[0]!.finding;
    expect(finding.length).toBeLessThanOrEqual(600);
    expect(finding.endsWith('…')).toBe(true);
    expect(finding).not.toMatch(/wor…$/);
    expect(r.notes[0]).toMatch(/finding: clipped 999 to 600/);
  });

  it('rounds and clamps numbers and accepts numeric strings', () => {
    const text = JSON.stringify({ verdicts: [verdict({ confidence: 4.6 }), verdict({ claimId: 'c2', confidence: '3' }), verdict({ claimId: 'c3', confidence: 9 })] });
    const r = parseJson(text, PassB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.verdicts.map((v) => v.confidence)).toEqual([5, 3, 5]);
  });

  it('truncates arrays to their cap and drops nulls on optional fields', () => {
    const text = JSON.stringify({ verdicts: [verdict({ suggestion: null, sources: [1, 2, 3, 4, 5, 6].map(source) })] });
    const r = parseJson(text, PassB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.verdicts[0]!.sources).toHaveLength(4);
    expect('suggestion' in r.data.verdicts[0]!).toBe(false);
  });

  it('unwraps a single-key wrapper object', () => {
    const r = parseJson(JSON.stringify({ result: { verdicts: [verdict()] } }), PassB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.verdicts).toHaveLength(1);
  });

  it('tolerates trailing commas', () => {
    const r = parseJson('{"verdicts": [{"claimId":"c1","status":"supported","finding":"ok","confidence":3,"sources":[],},],}', PassB);
    expect(r.ok).toBe(true);
  });

  it('still fails when a required top-level field is missing or the answer is empty', () => {
    const missing = parseJson(JSON.stringify({ premises: [], challenges: [challenge()] }), PassC);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/thesis/);
    const empty = parseJson('   ', PassC);
    expect(empty).toEqual({ ok: false, error: 'empty answer' });
  });

  it('does not prune when the whole answer is one bad object', () => {
    const Small = z.object({ a: z.number(), b: z.string() });
    expect(parseJson('{"a":"nope","b":1}', Small).ok).toBe(false);
  });
});
