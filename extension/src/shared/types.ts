// Runtime types shared by background, content script, UI and options page.
import type { Challenge, Claim, ClarityFinding, StructureSlot, Verdict } from './schemas';

export type HostId = 'gmail' | 'x' | 'linkedin' | 'generic';
/** S runs first and proposes an order; A reads clarity and claims; B checks facts; C argues back. */
export type PassId = 'S' | 'A' | 'B' | 'C';
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

/**
 * What the structure pass said about the draft. `reorder` is a proposal the user applies or keeps from the panel;
 * while it is `open`, A, B and C wait. `keeps` records that the order already serves the reader (note says why).
 */
export interface StructureResult {
  /** outline: the text read as notes; `slots` say what to write, `paragraphs` is empty. */
  verdict: 'keeps' | 'reorder' | 'outline';
  note: string;
  /** The proposed draft, one entry per paragraph. Empty when the verdict is `keeps`. */
  paragraphs: string[];
  /** A short label per proposed paragraph ("Ask", "Evidence"); absent when the model gave none. */
  roles?: string[];
  /** Outline only: the paragraphs to write, with the writer's fragments already placed. */
  slots?: StructureSlot[];
  /**
   * open: waiting on the user. stale: the draft changed since it was proposed. guiding: an outline the user
   * applied; it stays beside the draft while they write and edits do not stale it. applied: done with.
   */
  status: 'open' | 'applied' | 'kept' | 'stale' | 'guiding';
  /** Snapshot version the proposal was made for. */
  forVersion: number;
}

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

/**
 * The four checks a person can pick in the panel. Structure is pass S (a proposed order for the draft) plus the
 * structure half of pass A's clarity notes and the thesis; Polish is the other half of A's notes; Facts is pass B;
 * Challenge is pass C. With Structure on and Challenge off, C runs thesis-only without research.
 */
export type CheckId = 'structure' | 'polish' | 'facts' | 'challenge';
export type Checks = Record<CheckId, boolean>;
export const CHECK_IDS: readonly CheckId[] = ['structure', 'polish', 'facts', 'challenge'];
export const DEFAULT_CHECKS: Checks = { structure: true, polish: true, facts: true, challenge: false };
export const ALL_CHECKS: Checks = { structure: true, polish: true, facts: true, challenge: true };
export type ClarityKindFilter = (kind: ClarityFinding['kind']) => boolean;
/** Which clarity kinds a check set keeps: Polish owns fuzzy, hedge and grammar; Structure owns structure and unsupported_leap. */
export function clarityKindFilter(checks: Checks): ClarityKindFilter {
  return (kind) => (kind === 'structure' || kind === 'unsupported_leap' ? checks.structure : checks.polish);
}
export function sameChecks(a: Checks | undefined, b: Checks | undefined): boolean {
  if (!a || !b) return a === b;
  return CHECK_IDS.every((k) => a[k] === b[k]);
}

/** Full state of one composer session. The background sends the whole thing on every change. */
export interface SessionState {
  sessionKey: string;
  host: HostId;
  snapshotVersion: number;
  /** Version of the snapshot the last run started on; differs from snapshotVersion when the draft changed since. */
  analyzedVersion?: number;
  /** Checks selected in the panel (from settings at open); absent on states from older workers means all on. */
  checks?: Checks;
  /** Checks the findings on screen reflect: set by a run, narrowed when a chip is turned off. A chip turned on since makes it differ from `checks`. */
  analyzedChecks?: Checks;
  clarity: Anchored<ClarityFinding>[];
  claims: Anchored<ClaimWithVerdict>[];
  argument?: { thesis: string; premises: string[] };
  /** Result of the structure pass for this draft; absent until it has run. */
  structure?: StructureResult;
  challenges: AnchoredChallenge[];
  passes: Record<PassId, PassStatus>;
  usage: Usage;
}

export type ProviderId = 'openrouter' | 'claude' | 'mock';

/**
 * The only model this build runs. Prompts, lenient parsing and the repair round are validated against it and nothing
 * else, so settings are normalized to it on every read and write (see mergeSettings). 'claude' remains in ProviderId
 * for stored-settings compatibility; the store maps it back to OpenRouter and the provider code stays dormant.
 */
export const SUPPORTED_MODEL = 'z-ai/glm-5.2';
export const SUPPORTED_PROVIDER_ORDER: readonly string[] = ['z-ai'];

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
  /** Which checks run, as last picked in the panel. Remembered per browser, not per draft. */
  checks: Checks;
}

export const DEFAULT_OPENROUTER: OpenRouterSettings = {
  apiKey: '',
  model: SUPPORTED_MODEL,
  providerOrder: [...SUPPORTED_PROVIDER_ORDER],
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
  effort: { S: 'medium', A: 'low', B: 'high', C: 'high' },
  lifetimeCostUsd: 0,
  onboarded: false,
  autoAnalyze: false,
  checks: { ...DEFAULT_CHECKS },
};

export const EMPTY_PASSES: Record<PassId, PassStatus> = {
  S: { state: 'idle' },
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
    passes: { S: { ...EMPTY_PASSES.S }, A: { ...EMPTY_PASSES.A }, B: { ...EMPTY_PASSES.B }, C: { ...EMPTY_PASSES.C } },
    usage: { inputTokens: 0, outputTokens: 0, searches: 0, estCostUsd: 0 },
  };
}

/** The model the active provider will use. */
export function activeModel(s: Settings): string {
  return s.provider === 'openrouter' ? s.openrouter.model : s.model;
}
