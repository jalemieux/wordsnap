// test/unit/cowriter-sample.test.ts
import { MockProvider } from '../../src/providers/mock';
import { buildShape, buildTweak } from '../../src/passes/cowriter-build';
import { validateShape, validateTweak } from '../../src/passes/cowriter-validate';
import { snapshotFromText } from '../../src/shared/anchoring';
import { DEFAULT_TUNE } from '../../src/shared/cowriter';
import { mockShape, mockTweak, SAMPLE_SHAPE } from '../../src/shared/cowriter-sample';
import { AGENTS_DUMP } from '../../src/shared/dumps';

describe('co-writer sample', () => {
  it('the canned agents shape passes validation whole, with its choice, drop and gap', () => {
    const r = validateShape(SAMPLE_SHAPE, AGENTS_DUMP);
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([]);
    expect(r.ok && [r.view.choices.length, r.view.dropped.length, r.view.missing.length]).toEqual([1, 1, 1]);
  });

  it('any other text gets an identity shape that validates', () => {
    const text = 'First idea here. Second idea.\n\nThird one.';
    expect(validateShape(mockShape(text), text).ok).toBe(true);
  });

  it('a mock tweak changes the passage and stays valid', () => {
    const passage = 'I actually did very little and simply waited.';
    const t = mockTweak(passage);
    expect(t.replacement).not.toBe(passage);
    expect(validateTweak(t, { passage, draft: passage, instruction: 'Shorter' }).ok).toBe(true);
  });

  it('the mock provider answers shape and tweak requests', async () => {
    const p = new MockProvider({ delayMs: 0 });
    const shape = await p.runPass(buildShape(snapshotFromText(AGENTS_DUMP), DEFAULT_TUNE), new AbortController().signal, () => {});
    expect(shape.data).toEqual(SAMPLE_SHAPE);
    const tw = await p.runPass(buildTweak({ draft: 'x', passage: 'really quite long passage here.', instruction: 'Shorter', tune: DEFAULT_TUNE }), new AbortController().signal, () => {});
    expect(tw.data.replacement).toBe('long passage here.');
  });
});
