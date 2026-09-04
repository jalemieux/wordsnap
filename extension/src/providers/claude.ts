// Claude provider. Runs in the extension's background service worker, which is a browser context:
// the SDK needs dangerouslyAllowBrowser and the API needs the direct-browser-access header.
import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import type { LLMProvider, PassEvent, PassRequest, PassResult, PassUsage } from './types';
import { ProviderError } from './types';

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  workspaceId?: string;
  /** Test seam: a minimal client stand-in. */
  client?: ClaudeClientLike;
  maxContinuations?: number;
}

/* Minimal structural view of the SDK client so tests can inject a fake without the network. */
export interface StreamLike {
  finalMessage(): Promise<MessageLike>;
  on?(event: string, cb: (...args: unknown[]) => void): unknown;
}
export interface MessageLike {
  content: unknown[];
  stop_reason: string | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    server_tool_use?: { web_search_requests?: number | null } | null;
  } | null;
}
export interface ClaudeClientLike {
  beta: { messages: { stream(params: Record<string, unknown>, options?: { signal?: AbortSignal }): StreamLike } };
  models: { list(): AsyncIterable<{ id: string; display_name: string }> };
}

const MAX_TOKENS = 16000;
/** Room for adaptive thinking before the one-word answer; the answer itself is not checked. */
const PROBE_MAX_TOKENS = 256;
const PROBE_PROMPT = 'Reply with the single word: ready';

export class ClaudeProvider implements LLMProvider {
  readonly id = 'claude' as const;
  readonly capabilities = { streaming: true, structuredOutput: true, webSearch: true, researchMode: 'tool' as const };
  private readonly client: ClaudeClientLike;
  private readonly model: string;
  private readonly maxContinuations: number;

  constructor(opts: ClaudeProviderOptions) {
    this.model = opts.model;
    this.maxContinuations = opts.maxContinuations ?? 5;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const defaultHeaders: Record<string, string> = { 'anthropic-dangerous-direct-browser-access': 'true' };
      if (opts.workspaceId) defaultHeaders['anthropic-workspace-id'] = opts.workspaceId;
      this.client = new Anthropic({
        apiKey: opts.apiKey,
        dangerouslyAllowBrowser: true,
        defaultHeaders,
        maxRetries: 1,
      }) as unknown as ClaudeClientLike;
    }
  }

  async listModels(): Promise<{ id: string; displayName: string }[]> {
    try {
      const out: { id: string; displayName: string }[] = [];
      for await (const m of this.client.models.list()) {
        out.push({ id: m.id, displayName: m.display_name });
        if (out.length >= 50) break;
      }
      return out;
    } catch (err) {
      throw mapError(err);
    }
  }

  async probe(signal: AbortSignal): Promise<void> {
    try {
      await this.client.beta.messages
        .stream(
          {
            model: this.model,
            max_tokens: PROBE_MAX_TOKENS,
            messages: [{ role: 'user', content: PROBE_PROMPT }],
            output_config: { effort: 'low' },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal },
        )
        .finalMessage();
    } catch (err) {
      throw mapError(err);
    }
  }

  async runPass<T>(req: PassRequest<T>, signal: AbortSignal, onEvent: (e: PassEvent) => void): Promise<PassResult<T>> {
    const format = zodOutputFormat(req.schema as unknown as Parameters<typeof zodOutputFormat>[0]);
    const tools = req.research
      ? [
          {
            type: 'web_search_20260318',
            name: 'web_search',
            max_uses: req.research.maxSearches,
            ...(req.research.blockedDomains.length ? { blocked_domains: req.research.blockedDomains } : {}),
          },
        ]
      : undefined;

    const messages: Record<string, unknown>[] = [{ role: 'user', content: req.user }];
    const usage: PassUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, searches: 0 };
    const sourcesSeen: string[] = [];
    let finalText = '';
    let refused = false;

    onEvent({ type: 'status', text: req.research ? 'Researching…' : 'Reading…' });

    for (let turn = 0; turn <= this.maxContinuations; turn++) {
      let message: MessageLike;
      try {
        const stream = this.client.beta.messages.stream(
          {
            model: this.model,
            max_tokens: MAX_TOKENS,
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages,
            output_config: { effort: req.effort, format: { type: format.type, schema: format.schema } },
            ...(tools ? { tools } : {}),
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal },
        );
        stream.on?.('contentBlock', (block: unknown) => {
          const b = block as { type?: string; name?: string; input?: { query?: string } };
          if (b?.type === 'server_tool_use' && b.input?.query) onEvent({ type: 'search', query: b.input.query });
        });
        message = await stream.finalMessage();
      } catch (err) {
        throw mapError(err);
      }

      const u = message.usage ?? {};
      usage.inputTokens += u.input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      usage.searches += u.server_tool_use?.web_search_requests ?? 0;
      onEvent({ type: 'usage', usage: { ...usage } });

      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.type === 'server_tool_use') {
          const q = (block.input as { query?: string } | undefined)?.query;
          if (q) onEvent({ type: 'search', query: q });
        } else if (block.type === 'web_search_tool_result') {
          const content = block.content;
          if (Array.isArray(content)) {
            for (const r of content as Array<{ type?: string; url?: string }>) {
              if (r.type === 'web_search_result' && r.url) sourcesSeen.push(r.url);
            }
          }
          // object content is an error (max_uses_exceeded, too_many_requests, unavailable): continue with what we have
        } else if (block.type === 'text' && typeof block.text === 'string') {
          finalText = block.text; // the JSON object is the last text block
        }
      }

      if (message.stop_reason === 'refusal') {
        refused = true;
        break;
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        onEvent({ type: 'status', text: 'Still researching…' });
        continue;
      }
      break;
    }

    if (refused) {
      return { data: emptyResult(req.schema), sourcesSeen, usage, refused: true };
    }

    const data = parseJson<T>(finalText, req.schema);
    return { data, sourcesSeen, usage };
  }
}

function parseJson<T>(text: string, schema: ZodType<T>): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new ProviderError('Model returned no JSON object', 'invalid');
    try {
      raw = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new ProviderError('Model returned malformed JSON', 'invalid');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ProviderError(`Model output failed schema validation: ${parsed.error.message.slice(0, 200)}`, 'invalid');
  return parsed.data;
}

/** A schema-valid empty result for refusals: arrays empty, strings empty. Falls back to a best effort parse of {}. */
function emptyResult<T>(schema: ZodType<T>): T {
  const candidates: unknown[] = [
    { clarity: [], claims: [] },
    { verdicts: [] },
    { thesis: '', premises: [], challenges: [{ id: 'none', kind: 'gap', title: '', body: '', howToAddress: '', anchors: [''], sources: [] }] },
    {},
  ];
  for (const c of candidates) {
    const r = schema.safeParse(c);
    if (r.success) return r.data;
  }
  return {} as T;
}

export function mapError(err: unknown): Error {
  if (err instanceof ProviderError) return err;
  if (err instanceof APIUserAbortError) return err;
  if (err instanceof APIConnectionError) return new ProviderError('Could not reach api.anthropic.com', 'network');
  if (err instanceof APIError) {
    const status = err.status;
    const msg = err.message || 'API error';
    if (status === 401) return new ProviderError('The API key was rejected', 'auth');
    if (status === 400 && /workspace/i.test(msg)) return new ProviderError('This key needs a workspace ID', 'workspace');
    if (status === 402 || status === 403 || /billing|credit|payment/i.test(msg)) return new ProviderError('Billing is not set up for this key', 'billing');
    if (status === 429) {
      const ra = err.headers?.get?.('retry-after');
      const ms = ra ? Number(ra) * 1000 : undefined;
      return new ProviderError('Rate limited', 'rate_limit', Number.isFinite(ms) ? ms : undefined);
    }
    if (status === 400) return new ProviderError(msg, 'invalid');
    return new ProviderError(msg, 'unknown');
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return err;
    if (/fetch|network|Failed to fetch/i.test(err.message)) return new ProviderError(err.message, 'network');
    return new ProviderError(err.message, 'unknown');
  }
  return new ProviderError(String(err), 'unknown');
}

export function isAbort(err: unknown): boolean {
  return err instanceof APIUserAbortError || (err instanceof Error && err.name === 'AbortError');
}
