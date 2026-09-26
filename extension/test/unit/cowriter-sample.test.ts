// test/unit/cowriter-sample.test.ts
import { MockProvider } from '../../src/providers/mock';
import { buildShape, buildTweak } from '../../src/passes/cowriter-build';
import { validateShape, validateTweak } from '../../src/passes/cowriter-validate';
import { snapshotFromText } from '../../src/shared/anchoring';
import { DEFAULT_TUNE } from '../../src/shared/cowriter';
import { mockRevise, mockShape, mockTweak, parseRename, renameIn, SAMPLE_SHAPE } from '../../src/shared/cowriter-sample';
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

  it('the mock renames a term across the text when the instruction asks for it', () => {
    expect(parseRename('say bot instead of persona')).toEqual({ from: 'persona', to: 'bot' });
    expect(parseRename('instead of referring to persona we should refer to bot and use bot across the text')).toEqual({ from: 'persona', to: 'bot' });
    expect(parseRename('replace "persona" with "bot"')).toEqual({ from: 'persona', to: 'bot' });
    expect(parseRename('Shorter')).toBeNull();
    expect(renameIn('A persona is what the user sees. Personas share a host; the persona count is 3.', 'persona', 'bot')).toBe('A bot is what the user sees. Bots share a host; the bot count is 3.');
    const text = 'A persona is what the user sees.';
    expect(mockTweak(text, 'say bot instead of persona')).toEqual({ replacement: 'A bot is what the user sees.' });
    expect(mockTweak(text, 'say bot instead of agent')).toMatchObject({ replacement: text, note: '"agent" is not in the text.' });
  });

  it('the mock answers comments: a rename or a "say:" on a passage, one edit per sentence on the whole draft', () => {
    const draft = 'A bot is what the user sees. Bots share a host. The end.';
    const r = mockRevise(draft, [
      { n: 1, quote: 'The end.', text: 'say: That is all.' },
      { n: 2, text: 'say agent instead of bot' },
      { n: 3, text: 'make it sing' },
    ]);
    expect(r.changes).toEqual([{ comment: 1, replacement: 'That is all.' }]);
    expect(r.edits).toEqual([
      // The mock does not fix the article; the real pass is told to.
      { comment: 2, quote: 'A bot is what the user sees.', replacement: 'A agent is what the user sees.' },
      { comment: 2, quote: 'Bots share a host.', replacement: 'Agents share a host.' },
    ]);
    expect(r.skipped).toEqual([{ comment: 3, why: 'The mock only knows "say X instead of Y" on the whole draft.' }]);
  });

  it('the mock provider answers shape and tweak requests', async () => {
    const p = new MockProvider({ delayMs: 0 });
    const shape = await p.runPass(buildShape(snapshotFromText(AGENTS_DUMP), DEFAULT_TUNE), new AbortController().signal, () => {});
    expect(shape.data).toEqual(SAMPLE_SHAPE);
    const tw = await p.runPass(buildTweak({ draft: 'x', passage: 'really quite long passage here.', instruction: 'Shorter', tune: DEFAULT_TUNE }), new AbortController().signal, () => {});
    expect(tw.data.replacement).toBe('long passage here.');
  });
});
