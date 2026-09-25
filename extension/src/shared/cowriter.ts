// The co-writer's contracts: the dials, what Shape and Tweak return once validated, and the session state the overlay renders.
import type { RunTrace } from './trace';
import type { HostId, Span, Usage } from './types';

export type Length = 'tight' | 'balanced' | 'full';
export type Tone = 'casual' | 'neutral' | 'formal';
export type Audience = 'email' | 'post' | 'thread' | 'doc';
export interface Tune {
  length: Length;
  tone: Tone;
  for: Audience;
}
export const LENGTHS: readonly Length[] = ['tight', 'balanced', 'full'];
export const TONES: readonly Tone[] = ['casual', 'neutral', 'formal'];
export const AUDIENCES: readonly Audience[] = ['email', 'post', 'thread', 'doc'];
export const DEFAULT_TUNE: Tune = { length: 'balanced', tone: 'neutral', for: 'post' };

export function isTune(x: unknown): x is Tune {
  const t = x as Tune | null;
  return !!t && LENGTHS.includes(t.length) && TONES.includes(t.tone) && AUDIENCES.includes(t.for);
}

export type CowriterPassId = 'shape' | 'fill' | 'tweak';

export interface ShapeSentence {
  text: string;
  /** Fragments of the dump this sentence says; every one located in the dump. Empty only for a bridge. */
  from: string[];
  /** Written by WordSnap to connect; carries nothing that is not in the dump. */
  bridge: boolean;
}
export interface ShapeParagraph {
  role?: string;
  sentences: ShapeSentence[];
}
export interface ShapeChoice {
  topic: string;
  kept: string;
  other: string;
  /** The sentence stating the kept side, as indexes into the validated view. */
  paragraph: number;
  sentence: number;
  alt: { text: string; from: string[] };
}
export interface ShapeView {
  note: string;
  paragraphs: ShapeParagraph[];
  choices: ShapeChoice[];
  dropped: { quote: string; why: string }[];
  missing: { what: string; after: number }[];
}

export interface ShapeState {
  status: 'running' | 'open' | 'applied' | 'kept' | 'error';
  view?: ShapeView;
  /** The dials the result was made with; differs from CowriterState.tune when the user changed them since. */
  tune: Tune;
  forVersion: number;
  /** The draft changed since this was shaped. */
  stale: boolean;
  /** Indexes into view.choices that are flipped to the other side. */
  flips: number[];
  /** Fill sentences per index into view.missing. */
  fills: Record<number, string[]>;
  /** Index into view.missing being filled right now. */
  filling?: number;
  error?: string;
}

export interface TweakState {
  id: string;
  /** The selected passage as the user selected it. */
  quote: string;
  span: Span;
  forVersion: number;
  steps: { instruction: string; text: string; note?: string }[];
  status: 'running' | 'open' | 'stale' | 'error';
  error?: string;
}

export interface AppliedTweak {
  instruction: string;
  quote: string;
}

export interface CowriterState {
  sessionKey: string;
  host: HostId;
  snapshotVersion: number;
  tune: Tune;
  shape?: ShapeState;
  tweak?: TweakState;
  /** Newest first. */
  applied: AppliedTweak[];
  usage: Usage;
  /** Timing of the last runs; dev builds and the playground only, never saved. */
  trace?: RunTrace[];
}

export function emptyCowriterState(sessionKey: string, host: HostId, tune: Tune): CowriterState {
  return { sessionKey, host, snapshotVersion: 0, tune: { ...tune }, applied: [], usage: { inputTokens: 0, outputTokens: 0, searches: 0, estCostUsd: 0 } };
}

/** The shaped draft as it would be written into the editor: roles are never written. */
export function shapedText(view: ShapeView, flips: number[], fills: Record<number, string[]>): string {
  const swap = new Map<string, string>();
  for (const i of flips) {
    const c = view.choices[i];
    if (c) swap.set(`${c.paragraph}:${c.sentence}`, c.alt.text);
  }
  const extra = new Map<number, string[]>();
  view.missing.forEach((m, i) => {
    if (fills[i]?.length) extra.set(m.after, [...(extra.get(m.after) ?? []), ...fills[i]!]);
  });
  return view.paragraphs
    .map((p, pi) => [...p.sentences.map((s, si) => swap.get(`${pi}:${si}`) ?? s.text), ...(extra.get(pi) ?? [])].join(' '))
    .join('\n\n');
}
