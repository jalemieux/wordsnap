// src/ui/cowriter/copy.ts
// Every string the co-writer panel shows about the dials, stages and presets. Plain, specific, no praise.
import type { Audience, Length, Tone } from '../../shared/cowriter';

export const LABEL = {
  length: { tight: 'Tight', balanced: 'Balanced', full: 'Full' } as Record<Length, string>,
  tone: { casual: 'Casual', neutral: 'Neutral', formal: 'Formal' } as Record<Tone, string>,
  for: { email: 'Email', post: 'Post', thread: 'Thread', doc: 'Doc' } as Record<Audience, string>,
};
export const DIAL_TITLE = { length: 'Length', tone: 'Tone', for: 'For' } as const;
export const DIAL_HINT = {
  length: { tight: 'Only the core of each point.', balanced: 'Each point with its support.', full: 'Everything you said, with connecting lines.' } as Record<Length, string>,
  tone: { casual: 'Contractions, plain words.', neutral: 'Plain and direct.', formal: 'No contractions, fuller words.' } as Record<Tone, string>,
  for: { email: 'Short paragraphs, a greeting line.', post: 'Paragraphs, no headings.', thread: 'Parts that post one at a time.', doc: 'Sections that stand on their own.' } as Record<Audience, string>,
};
export const PRESETS = ['Shorter', 'Clearer', 'Punchier', 'Warmer', 'More formal'] as const;
export type Stage = 'tune' | 'shape' | 'tweak' | 'check';
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'tune', label: 'Tune' },
  { id: 'shape', label: 'Shape' },
  { id: 'tweak', label: 'Tweak' },
  { id: 'check', label: 'Check' },
];
export const CHECK_SOON = 'Check is coming next. Facts verifies each claim in your draft with a web search and cites what it found. Challenge states your argument and argues back. Each runs only when you press it.';
