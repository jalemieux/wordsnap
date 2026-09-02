// Text for platform share targets. The greeting and sign-off of an email are dropped for a post.
import type { TextSnapshot } from '../shared/types';

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function shareBody(snapshot: Pick<TextSnapshot, 'text' | 'paragraphs'>): string {
  const paras = snapshot.paragraphs.map((p) => snapshot.text.slice(p.start, p.end).trim()).filter(Boolean);
  if (paras.length >= 2) {
    const first = paras[0]!;
    if (first.endsWith(',') || wordCount(first) <= 4) paras.shift();
  }
  if (paras.length >= 2) {
    const last = paras[paras.length - 1]!;
    if (/^[—–-]\s*/.test(last) || wordCount(last) <= 3) paras.pop();
  }
  return paras.join('\n\n');
}

export function shareUrl(target: 'x' | 'linkedin', text: string): string {
  const q = encodeURIComponent(text);
  return target === 'x' ? `https://x.com/intent/post?text=${q}` : `https://www.linkedin.com/feed/?shareActive=true&text=${q}`;
}
