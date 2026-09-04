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
  /** Version of the snapshot the last run started on; differs from snapshotVersion when the draft changed since. */
  analyzedVersion?: number;
  clarity: Anchored<ClarityFinding>[];
  claims: Anchored<ClaimWithVerdict>[];
  argument?: { thesis: string; premises: string[] };
  challenges: AnchoredChallenge[];
  passes: Record<PassId, PassStatus>;
  usage: Usage;
}

export type ProviderId = 'openrouter' | 'claude' | 'mock';

export interface OpenRouterSettings {
  apiKey: string;
  model: string;
  /** Provider slugs to pin, in order. Empty means let OpenRouter choose. */
  providerOrder: string[];
  /** When false, a request fails rather than falling through to another provider. */
  allowFallbacks: boolean;
  /** Web results attached per research request (OpenRouter's web plugin, $4 per 1,000 results). */
  webResults: number;
}

export interface Settings {
  provider: ProviderId;
  /** Anthropic key, model and workspace (used when provider === 'claude'). */
  apiKey: string;
  model: string;
  workspaceId: string;
  openrouter: OpenRouterSettings;
  blockedDomains: string[];
  enabledHosts: Record<HostId, boolean>;
  effort: Record<PassId, Effort>;
  /** running estimate across all sessions, in USD */
  lifetimeCostUsd: number;
  onboarded: boolean;
  /** Analyze as soon as a draft passes the word threshold. Off by default: WordSnap waits for a click on its badge. */
  autoAnalyze: boolean;
}

export const DEFAULT_OPENROUTER: OpenRouterSettings = {
  apiKey: '',
  model: 'z-ai/glm-5.2',
  providerOrder: ['z-ai'],
  allowFallbacks: false,
  webResults: 5,
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openrouter',
  apiKey: '',
  model: 'claude-opus-5',
  workspaceId: '',
  openrouter: { ...DEFAULT_OPENROUTER },
  blockedDomains: [],
  enabledHosts: { gmail: true, x: true, linkedin: true, generic: false },
  effort: { A: 'low', B: 'high', C: 'high' },
  lifetimeCostUsd: 0,
  onboarded: false,
  autoAnalyze: false,
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

/** The model the active provider will use. */
export function activeModel(s: Settings): string {
  return s.provider === 'openrouter' ? s.openrouter.model : s.model;
}
