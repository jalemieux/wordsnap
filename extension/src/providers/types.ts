// LLM provider abstraction. The passes call `runPass`; providers own transport, streaming, tools and parsing.
import type { ZodType } from 'zod';
import type { Effort, PassId } from '../shared/types';

export interface ProviderCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  webSearch: boolean;
}

export interface ResearchBudget {
  maxSearches: number;
  blockedDomains: string[];
}

export interface PassRequest<T> {
  pass: PassId;
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
  | { type: 'usage'; usage: Partial<PassUsage> };

export interface LLMProvider {
  id: 'claude' | 'mock';
  capabilities: ProviderCapabilities;
  runPass<T>(req: PassRequest<T>, signal: AbortSignal, onEvent: (e: PassEvent) => void): Promise<PassResult<T>>;
  /** Used by settings to validate credentials and populate the model list. */
  listModels(): Promise<{ id: string; displayName: string }[]>;
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
