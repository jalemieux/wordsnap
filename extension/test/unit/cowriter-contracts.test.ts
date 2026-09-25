import { DEFAULT_TUNE, emptyCowriterState, isTune, shapedText, type ShapeView } from '../../src/shared/cowriter';
import { PassShape, PassTweak } from '../../src/shared/schemas';

const view: ShapeView = {
  note: 'n',
  paragraphs: [
    { role: 'Why', sentences: [{ text: 'We move the offsite to March.', from: ['move the offsite to march'], bridge: false }, { text: 'The budget closes in Q1.', from: ['the budget closes in q1'], bridge: false }] },
    { role: 'Ask', sentences: [{ text: 'Bring laptops.', from: ['bring laptops'], bridge: false }] },
  ],
  choices: [{ topic: 'the month', kept: 'no, march', other: 'maybe april is better', paragraph: 0, sentence: 0, alt: { text: 'April may be better.', from: ['maybe april is better'] } }],
  dropped: [],
  missing: [{ what: 'Who books the venue', after: 0 }],
};

describe('cowriter contracts', () => {
  it('recognizes a tune and rejects anything else', () => {
    expect(isTune(DEFAULT_TUNE)).toBe(true);
    expect(isTune({ length: 'huge', tone: 'neutral', for: 'post' })).toBe(false);
    expect(isTune(null)).toBe(false);
  });

  it('starts a session with the given tune and nothing shaped', () => {
    const s = emptyCowriterState('k', 'gmail', { length: 'tight', tone: 'formal', for: 'email' });
    expect(s).toMatchObject({ sessionKey: 'k', host: 'gmail', snapshotVersion: 0, tune: { length: 'tight' }, applied: [] });
    expect(s.shape).toBeUndefined();
  });

  it('writes the shaped draft as paragraphs, with flips swapped in and fills after their paragraph', () => {
    expect(shapedText(view, [], {})).toBe('We move the offsite to March. The budget closes in Q1.\n\nBring laptops.');
    expect(shapedText(view, [0], { 0: ['Someone has to book it.'] })).toBe('April may be better. The budget closes in Q1. Someone has to book it.\n\nBring laptops.');
  });

  it('parses a shape answer and a tweak answer', () => {
    expect(PassShape.parse({ note: 'x', paragraphs: [{ sentences: [{ text: 'A.', from: ['a'] }] }], choices: [], dropped: [], missing: [] }).paragraphs).toHaveLength(1);
    expect(() => PassTweak.parse({ replacement: '' })).toThrow();
  });
});
