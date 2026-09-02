// @vitest-environment happy-dom
import { shareBody, shareUrl } from '../../../src/content/share';
import { buildTextareaSnapshot } from '../../../src/content/text-snapshot';
import { SAMPLE_PARAGRAPHS, SAMPLE_TEXT } from '../../../src/shared/sample';

const snapOf = (text: string) => {
  document.body.innerHTML = '<textarea id="t"></textarea>';
  const ta = document.getElementById('t') as HTMLTextAreaElement;
  ta.value = text;
  return buildTextareaSnapshot(ta);
};

describe('shareBody', () => {
  it('drops the greeting and the sign-off of an email', () => {
    const body = shareBody(snapOf(SAMPLE_TEXT));
    expect(body.startsWith(SAMPLE_PARAGRAPHS[1]!)).toBe(true);
    expect(body.endsWith(SAMPLE_PARAGRAPHS[5]!)).toBe(true);
    expect(body).not.toContain('Hi all,');
    expect(body).not.toContain('— Jordan');
  });

  it('keeps a post that has no greeting or sign-off intact', () => {
    const text = 'First real paragraph with several words in it.\n\nSecond paragraph that also has plenty of words.';
    expect(shareBody(snapOf(text))).toBe(text);
  });

  it('never drops the only paragraph', () => {
    expect(shareBody(snapOf('Hi all,'))).toBe('Hi all,');
  });

  it('builds intent URLs', () => {
    expect(shareUrl('x', 'a b')).toBe('https://x.com/intent/post?text=a%20b');
    expect(shareUrl('linkedin', 'a&b')).toBe('https://www.linkedin.com/feed/?shareActive=true&text=a%26b');
  });
});
