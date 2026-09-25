// test/unit/cowriter-diff.test.ts
import { wordDiff } from '../../src/ui/cowriter/diff';

describe('wordDiff', () => {
  it('marks words removed and added, keeping spaces with the words around them', () => {
    expect(wordDiff('a b c', 'a x c')).toEqual([{ op: 'eq', text: 'a ' }, { op: 'del', text: 'b' }, { op: 'ins', text: 'x' }, { op: 'eq', text: ' c' }]);
  });
  it('handles a full rewrite and an unchanged text', () => {
    expect(wordDiff('old', 'new')).toEqual([{ op: 'del', text: 'old' }, { op: 'ins', text: 'new' }]);
    expect(wordDiff('same text', 'same text')).toEqual([{ op: 'eq', text: 'same text' }]);
  });
});
