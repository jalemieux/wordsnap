// LLM provider abstraction. The passes call `runPass`; providers own transport, streaming, tools and parsing.
import type { ZodType } from 'zod';
import type { TraceMarkName } from '../shared/trace';
import type { CowriterPassId } from '../shared/cowriter';
import type { Effort, PassId } from '../shared/types';

export interface ProviderCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  webSearch: boolean;
  /**
   * 'tool': the model decides when to search and can issue several queries per request (Claude web_search).
   * 'grounded': one search is run up front on the request text and the results are attached (OpenRouter web plugin).
   * Grounded research is more accurate when pass B is fanned out one claim per request.
   */
  researchMode: 'tool' | 'grounded' | 'none';
}

export interface ResearchBudget {
  maxSearches: number;
  blockedDomains: string[];
}

export interface PassRequest<T> {
  pass: PassId | CowriterPassId;
  /** Stable byte-for-byte across requests: carries the cache breakpoint. */
  system: string;
  /** Volatile: the draft and any per-run context. */
  user: string;
  schema: ZodType<T>;
  effort: Effort;
  /** Present only for passes that may search. */
  research?: ResearchBudget;
}

export interface PassUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  searches: number;
}

export interface PassResult<T> {
  data: T;
  /** Every URL that appeared in a web_search_tool_result for this request. Used to validate cited sources. */
  sourcesSeen: string[];
  usage: PassUsage;
  /** Set when the model refused; `data` is then an empty result and the UI shows nothing. */
  refused?: boolean;
}

export type PassEvent =
  | { type: 'status'; text: string }
  | { type: 'search'; query: string }
  | { type: 'usage'; usage: Partial<PassUsage> }
  /** Timing marks for traces; the receiver stamps the time. */
  | { type: 'mark'; mark: TraceMarkName };

export interface LLMProvider {
  id: 'openrouter' | 'claude' | 'mock';
  capabilities: ProviderCapabilities;
  runPass<T>(req: PassRequest<T>, signal: AbortSignal, onEvent: (e: PassEvent) => void): Promise<PassResult<T>>;
  /** Used by settings to validate credentials and populate the model list. */
  listModels(): Promise<{ id: string; displayName: string }[]>;
  /**
   * The cheapest real completion against the configured model: proves the credential, the model and the routing
   * actually answer (credits, pinned provider, workspace), which listing models does not. Rejects with a ProviderError.
   */
  probe(signal: AbortSignal): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'workspace' | 'billing' | 'rate_limit' | 'network' | 'invalid' | 'unknown',
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
