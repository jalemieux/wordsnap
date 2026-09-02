// Runtime types shared by background, content script, UI and options page.
import type { Challenge, Claim, ClarityFinding, Verdict } from './schemas';

export type HostId = 'gmail' | 'x' | 'linkedin' | 'generic';
export type PassId = 'A' | 'B' | 'C';
export type Effort = 'low' | 'medium' | 'high';

/** Half-open character range [start, end) into TextSnapshot.text. */
export interface Span {
  start: number;
  end: number;
}

/**
 * Canonical plain text of a composer. Paragraphs are separated by "\n\n" in `text`.
 * `version` increases on every change so late results can be matched to the snapshot they came from.
 */
export interface TextSnapshot {
  text: string;
  paragraphs: Span[];
  version: number;
}

export type FindingStatus = 'open' | 'stale' | 'applied' | 'kept' | 'dropped';

export interface Anchored<T> {
  id: string;
  /** null when the quote could not be located in the current snapshot; such findings are not shown. */
  span: Span | null;
  quote: string;
  status: FindingStatus;
  data: T;
}

export interface ClaimWithVerdict extends Claim {
  verdict?: Verdict;
}

export interface AnchoredChallenge extends Anchored<Challenge> {
  /** One span per located anchor quote. `span` is the first of these. */
  spans: Span[];
}

export type PassRunState = 'idle' | 'running' | 'done' | 'error';

export interface PassStatus {
  state: PassRunState;
  error?: string;
  /** epoch ms of the last completed run */
  at?: number;
  /** transient status text, e.g. "Searching: UK four-day week pilot results" */
  detail?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searches: number;
  estCostUsd: number;
}

/** Full state of one composer session. The background sends the whole thing on every change. */
export interface SessionState {
  sessionKey: string;
  host: HostId;
  snapshotVersion: number;
  clarity: Anchored<ClarityFinding>[];
  claims: Anchored<ClaimWithVerdict>[];
  argument?: { thesis: string; premises: string[] };
  challenges: AnchoredChallenge[];
  passes: Record<PassId, PassStatus>;
  usage: Usage;
}

export interface Settings {
  provider: 'claude' | 'mock';
  apiKey: string;
  model: string;
  workspaceId: string;
  blockedDomains: string[];
  enabledHosts: Record<HostId, boolean>;
  effort: Record<PassId, Effort>;
  /** running estimate across all sessions, in USD */
  lifetimeCostUsd: number;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  apiKey: '',
  model: 'claude-opus-5',
  workspaceId: '',
  blockedDomains: [],
  enabledHosts: { gmail: true, x: true, linkedin: true, generic: false },
  effort: { A: 'low', B: 'high', C: 'high' },
  lifetimeCostUsd: 0,
  onboarded: false,
};

export const EMPTY_PASSES: Record<PassId, PassStatus> = {
  A: { state: 'idle' },
  B: { state: 'idle' },
  C: { state: 'idle' },
};

export function emptySession(sessionKey: string, host: HostId): SessionState {
  return {
    sessionKey,
    host,
    snapshotVersion: 0,
    clarity: [],
    claims: [],
    challenges: [],
    passes: { A: { ...EMPTY_PASSES.A }, B: { ...EMPTY_PASSES.B }, C: { ...EMPTY_PASSES.C } },
    usage: { inputTokens: 0, outputTokens: 0, searches: 0, estCostUsd: 0 },
  };
}
