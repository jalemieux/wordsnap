// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bodyText, openIssueCount, readSeconds, relativeTime, splitForX, summaryCounts, wordCount } from '../../../src/ui/format';
import { SAMPLE_TEXT } from '../../../src/shared/sample';
import { sampleState } from './ui-helpers';

describe('bodyText', () => {
  it('drops the greeting and sign-off of an email', () => {
    const b = bodyText(SAMPLE_TEXT);
    expect(b.startsWith('I want to put')).toBe(true);
    expect(b.endsWith("Thursday's agenda?")).toBe(true);
    expect(b).not.toContain('Hi all');
    expect(b).not.toContain('Jordan');
  });
  it('keeps a single paragraph intact', () => {
    expect(bodyText('Just one line here.')).toBe('Just one line here.');
  });
  it('keeps a long first paragraph that is not a greeting', () => {
    const t = 'This opening paragraph has plenty of words in it.\n\nSecond paragraph.';
    expect(bodyText(t).startsWith('This opening')).toBe(true);
  });
});

describe('splitForX', () => {
  it('returns text that fits as a single unnumbered post', () => {
    expect(splitForX('Short post.')).toEqual(['Short post.']);
  });
  it('splits on sentence boundaries, numbers posts, and keeps each within 280', () => {
    const posts = splitForX(bodyText(SAMPLE_TEXT));
    expect(posts.length).toBeGreaterThan(1);
    posts.forEach((p, i) => {
      expect(p.endsWith(`(${i + 1}/${posts.length})`)).toBe(true);
      expect(p.length).toBeLessThanOrEqual(280);
      const bare = p.replace(/ \(\d+\/\d+\)$/, '');
      expect(bare.length).toBeLessThanOrEqual(270);
    });
    // Nothing lost: every sentence of the body appears in some post.
    const joined = posts.map((p) => p.replace(/ \(\d+\/\d+\)$/, '')).join(' ');
    expect(joined).toContain('not a single company went back to five days');
    expect(joined).toContain("Thursday's agenda?");
  });
  it('hard-wraps a single overlong sentence', () => {
    const long = 'word '.repeat(120).trim();
    const posts = splitForX(long);
    posts.forEach((p) => expect(p.length).toBeLessThanOrEqual(280));
    expect(posts.length).toBeGreaterThan(1);
  });
});

describe('counts and time', () => {
  it('counts words and reading time', () => {
    expect(wordCount('one two  three')).toBe(3);
    expect(readSeconds('word '.repeat(230))).toBe(60);
    expect(readSeconds('a')).toBe(1);
  });
  it('formats relative time', () => {
    const now = 1_000_000;
    expect(relativeTime(now - 2000, now)).toBe('just now');
    expect(relativeTime(now - 30_000, now)).toBe('30s ago');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
  });
  it('counts open issues and summary', () => {
    const s = sampleState();
    expect(openIssueCount(s)).toBe(2);
    expect(summaryCounts(s)).toEqual({ checked: 3, contradicted: 1, precision: 1, challenges: 4, clarity: 2 });
    s.claims.find((c) => c.id === 'f3')!.status = 'applied';
    expect(openIssueCount(s)).toBe(1);
  });
});
