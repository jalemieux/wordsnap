// Mock provider: canned results from the shared sample. Used for development without a key, the options "try it" step
// when provider=mock, unit tests and the e2e suite. Matches request claims to sample verdicts by quote.
import { SAMPLE_DICTATED_MARKER, SAMPLE_IDEA_MARKER, SAMPLE_PASS_A, SAMPLE_PASS_B, SAMPLE_PASS_C, SAMPLE_PASS_S, SAMPLE_PASS_S_KEEPS, SAMPLE_PASS_S_OUTLINE, SAMPLE_SOURCES_SEEN } from '../shared/sample';
import { mockRevise, mockShape, mockTweak, SAMPLE_FILL, SAMPLE_SHAPE, type MockComment } from '../shared/cowriter-sample';
import { AGENTS_DUMP } from '../shared/dumps';
import type { LLMProvider, PassEvent, PassRequest, PassResult, PassUsage } from './types';

export interface MockProviderOptions {
  delayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Pretend to be a grounded (one search per request) provider, to exercise per-claim fan-out. */
  researchMode?: 'tool' | 'grounded' | 'none';
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

const MOCK_USAGE: Record<'S' | 'A' | 'B' | 'C' | 'shape' | 'fill' | 'tweak' | 'revise', PassUsage> = {
  S: { inputTokens: 2400, outputTokens: 700, cacheReadTokens: 1800, searches: 0 },
  A: { inputTokens: 2600, outputTokens: 900, cacheReadTokens: 1800, searches: 0 },
  B: { inputTokens: 18000, outputTokens: 1600, cacheReadTokens: 1800, searches: 4 },
  C: { inputTokens: 14000, outputTokens: 1800, cacheReadTokens: 1800, searches: 3 },
  shape: { inputTokens: 3000, outputTokens: 1000, cacheReadTokens: 0, searches: 0 },
  fill: { inputTokens: 1500, outputTokens: 500, cacheReadTokens: 0, searches: 0 },
  tweak: { inputTokens: 1200, outputTokens: 400, cacheReadTokens: 0, searches: 0 },
  revise: { inputTokens: 3200, outputTokens: 900, cacheReadTokens: 0, searches: 0 },
};

export class MockProvider implements LLMProvider {
  readonly id = 'mock' as const;
  readonly capabilities: { streaming: boolean; structuredOutput: boolean; webSearch: boolean; researchMode: 'tool' | 'grounded' | 'none' } = { streaming: true, structuredOutput: true, webSearch: true, researchMode: 'tool' };
  private readonly delayMs: number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Every request seen, for tests. */
  readonly calls: PassRequest<unknown>[] = [];

  constructor(opts: MockProviderOptions = {}) {
    this.delayMs = opts.delayMs ?? 300;
    this.sleep = opts.sleep ?? defaultSleep;
    if (opts.researchMode) this.capabilities.researchMode = opts.researchMode;
  }

  async listModels() {
    return [
      { id: 'claude-opus-5', displayName: 'Claude Opus 5 (mock)' },
      { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5 (mock)' },
    ];
  }

  async probe(signal: AbortSignal): Promise<void> {
    if (this.delayMs > 0) await this.sleep(this.delayMs, signal);
  }

  async runPass<T>(req: PassRequest<T>, signal: AbortSignal, onEvent: (e: PassEvent) => void): Promise<PassResult<T>> {
    this.calls.push(req as PassRequest<unknown>);
    onEvent({ type: 'status', text: req.research ? 'Researching…' : 'Reading…' });
    onEvent({ type: 'mark', mark: 'sent' });
    if (this.delayMs > 0) await this.sleep(this.delayMs, signal);
    if (signal.aborted) throw abortError();
    onEvent({ type: 'mark', mark: 'firstContent' });
    onEvent({ type: 'mark', mark: 'end' });
    const usage = MOCK_USAGE[req.pass];

    if (req.pass === 'shape') {
      const dump = req.user.slice(req.user.indexOf('<dump>\n') + 7, req.user.lastIndexOf('\n</dump>'));
      return { data: req.schema.parse(dump === AGENTS_DUMP ? SAMPLE_SHAPE : mockShape(dump)), sourcesSeen: [], usage };
    }
    if (req.pass === 'fill') return { data: req.schema.parse(SAMPLE_FILL), sourcesSeen: [], usage };
    if (req.pass === 'revise') {
      const draft = req.user.match(/<draft>\n([\s\S]*?)\n<\/draft>/)?.[1] ?? '';
      const block = req.user.match(/<comments>\n([\s\S]*?)\n<\/comments>/)?.[1] ?? '';
      const comments: MockComment[] = [];
      for (const line of block.split('\n')) {
        const m = line.match(/^(\d+)\. (?:On "([\s\S]*)": |On the whole draft: )(.*)$/);
        if (m) comments.push(m[2] !== undefined ? { n: Number(m[1]), quote: m[2], text: m[3]! } : { n: Number(m[1]), text: m[3]! });
      }
      return { data: req.schema.parse(mockRevise(draft, comments)), sourcesSeen: [], usage };
    }
    if (req.pass === 'tweak') {
      const cur = req.user.match(/<current>\n([\s\S]*?)\n<\/current>/)?.[1];
      // A draft-wide tweak sends no <passage>: the draft is the passage.
      const passage = cur ?? req.user.match(/<passage>\n([\s\S]*?)\n<\/passage>/)?.[1] ?? req.user.match(/<draft>\n([\s\S]*?)\n<\/draft>/)?.[1] ?? '';
      const instruction = req.user.match(/^Instruction: (.*)$/m)?.[1] ?? '';
      return { data: req.schema.parse(mockTweak(passage, instruction)), sourcesSeen: [], usage };
    }

    if (req.pass === 'S') {
      // The dictated sample gets the reorder that turns it into SAMPLE_TEXT; anything else already holds.
      // Elaborate: the sample notes get the skeleton, anything else keeps. Organize: the dictated sample gets the reorder that turns it into SAMPLE_TEXT.
      const elaborate = req.user.startsWith('Mode: elaborate');
      const data = elaborate ? (req.user.includes(SAMPLE_IDEA_MARKER) ? SAMPLE_PASS_S_OUTLINE : SAMPLE_PASS_S_KEEPS) : req.user.includes(SAMPLE_DICTATED_MARKER) ? SAMPLE_PASS_S : SAMPLE_PASS_S_KEEPS;
      return { data: req.schema.parse(data), sourcesSeen: [], usage };
    }
    if (req.pass === 'A') {
      return { data: req.schema.parse(SAMPLE_PASS_A), sourcesSeen: [], usage };
    }
    if (req.pass === 'B') {
      onEvent({ type: 'search', query: 'UK four-day week pilot 2022 results' });
      if (this.delayMs > 0) await this.sleep(this.delayMs, signal);
      const requested = extractClaims(req.user);
      const verdicts = requested.flatMap((rc) => {
        const sample = SAMPLE_PASS_A.claims.find((sc) => rc.quote.includes(sc.quote) || sc.quote.includes(rc.quote));
        const v = sample ? SAMPLE_PASS_B.verdicts.find((sv) => sv.claimId === sample.id) : undefined;
        if (!v) {
          return [{ claimId: rc.id, status: 'unverifiable' as const, finding: 'No source found in the mock corpus.', confidence: 1, sources: [] }];
        }
        return [{ ...v, claimId: rc.id }];
      });
      return { data: req.schema.parse({ verdicts }), sourcesSeen: [...SAMPLE_SOURCES_SEEN], usage };
    }
    onEvent({ type: 'search', query: 'four-day week trial selection bias self-reported productivity' });
    if (this.delayMs > 0) await this.sleep(this.delayMs, signal);
    return { data: req.schema.parse(SAMPLE_PASS_C), sourcesSeen: [...SAMPLE_SOURCES_SEEN], usage };
  }
}

function extractClaims(user: string): { id: string; quote: string }[] {
  const m = user.match(/<claims>\s*([\s\S]*?)\s*<\/claims>/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]!) as Array<{ id: string; quote: string }>;
    return arr.map((c) => ({ id: c.id, quote: c.quote }));
  } catch {
    return [];
  }
}
