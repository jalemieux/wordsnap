// test/unit/cowriter-diff.test.ts
import { readableDiff, wordDiff } from '../../src/ui/cowriter/diff';

describe('wordDiff', () => {
  it('marks words removed and added, keeping spaces with the words around them', () => {
    expect(wordDiff('a b c', 'a x c')).toEqual([{ op: 'eq', text: 'a ' }, { op: 'del', text: 'b' }, { op: 'ins', text: 'x' }, { op: 'eq', text: ' c' }]);
  });
  it('handles a full rewrite and an unchanged text', () => {
    expect(wordDiff('old', 'new')).toEqual([{ op: 'del', text: 'old' }, { op: 'ins', text: 'new' }]);
    expect(wordDiff('same text', 'same text')).toEqual([{ op: 'eq', text: 'same text' }]);
  });
});

describe('readableDiff', () => {
  it('keeps the word diff when most of the passage survives', () => {
    expect(readableDiff('bring the laptops along', 'bring the chargers along')).toEqual([
      { op: 'eq', text: 'bring the ' },
      { op: 'del', text: 'laptops' },
      { op: 'ins', text: 'chargers' },
      { op: 'eq', text: ' along' },
    ]);
  });
  it('shows a rewrite as old struck and new whole', () => {
    expect(readableDiff('How the fleet stays private: each holds its own data.', 'How data stays local while a fleet of agents runs.')).toEqual([
      { op: 'del', text: 'How the fleet stays private: each holds its own data.' },
      { op: 'eq', text: ' ' },
      { op: 'ins', text: 'How data stays local while a fleet of agents runs.' },
    ]);
  });
});
