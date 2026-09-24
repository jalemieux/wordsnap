// OpenRouter provider: OpenAI-compatible chat completions over fetch (no SDK; keeps the background bundle small).
// Research uses OpenRouter's web plugin, which runs one search on the request up front and attaches results;
// citations come back as `url_citation` annotations and feed `sourcesSeen` for the source allowlist gate.
// Structured output: `response_format` json_schema when the endpoint enforces schemas; the Z.AI endpoint does
// not, so every response is parsed leniently, validated with Zod, and repaired once by a second request if needed.
import { log } from '../shared/log';
import { parseJson, schemaFor, type JsonSchema } from './lenient';
import type { LLMProvider, PassEvent, PassRequest, PassResult, PassUsage } from './types';
import { ProviderError } from './types';

export { parseJson } from './lenient';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const APP_HEADERS = { 'HTTP-Referer': 'https://github.com/wordsnap', 'X-Title': 'WordSnap' };

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  providerOrder?: string[];
  allowFallbacks?: boolean;
  webResults?: number;
  fetchImpl?: typeof fetch;
  /** Endpoints that enforce json_schema. Default: assume not, which is the safe path. */
  schemaEnforced?: boolean;
}

interface Chunk {
  id?: string;
  choices?: { delta?: { content?: string | null; reasoning?: string | null; annotations?: Annotation[] }; finish_reason?: string | null; message?: { content?: string; annotations?: Annotation[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string; code?: number | string };
}

interface Annotation {
  type: string;
  url_citation?: { url: string; title?: string; content?: string };
}

const EFFORT: Record<string, 'low' | 'medium' | 'high'> = { low: 'low', medium: 'medium', high: 'high' };
/** Counts reasoning tokens too on most OpenRouter endpoints, so leave room for a high-effort pass to think. */
const MAX_TOKENS = 16_384;
/** Room for a reasoning model to think before its one-word answer; the answer itself is not checked. */
const PROBE_MAX_TOKENS = 256;
const PROBE_PROMPT = 'Reply with the single word: ready';

export class OpenRouterProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  readonly capabilities = { streaming: true, structuredOutput: true, webSearch: true, researchMode: 'grounded' as const };
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenRouterOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json', ...APP_HEADERS };
  }

  async listModels(): Promise<{ id: string; displayName: string }[]> {
    // /key validates the credential (401 on a bad key); /models is public and lists everything.
    const keyRes = await this.fetchImpl(`${OPENROUTER_BASE}/key`, { headers: this.headers() }).catch((e) => {
      throw new ProviderError(`Could not reach OpenRouter: ${(e as Error).message}`, 'network');
    });
    if (!keyRes.ok) throw await toProviderError(keyRes);
    const res = await this.fetchImpl(`${OPENROUTER_BASE}/models`, { headers: this.headers() });
    if (!res.ok) throw await toProviderError(res);
    const data = (await res.json()) as { data: { id: string; name?: string }[] };
    const preferred = (id: string) => (id.startsWith('z-ai/') ? 0 : id.startsWith('anthropic/') ? 1 : id.startsWith('openai/') ? 2 : id.startsWith('google/') ? 3 : 4);
    return data.data
      .filter((m) => !m.id.endsWith(':free') || m.id === this.opts.model)
      .sort((a, b) => preferred(a.id) - preferred(b.id) || a.id.localeCompare(b.id))
      .slice(0, 400)
      .map((m) => ({ id: m.id, displayName: m.name ?? m.id }));
  }

  async probe(signal: AbortSignal): Promise<void> {
    await this.stream(this.probeBody(), signal, () => undefined);
  }

  /** A one-word request through the same route the passes use (model, pinned provider), no research. */
  probeBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [{ role: 'user', content: PROBE_PROMPT }],
      stream: true,
      usage: { include: true },
      max_tokens: PROBE_MAX_TOKENS,
      reasoning: { effort: 'low' },
    };
    if (this.opts.providerOrder?.length) {
      body.provider = { order: this.opts.providerOrder, allow_fallbacks: this.opts.allowFallbacks ?? false };
    }
    return body;
  }

  async runPass<T>(req: PassRequest<T>, signal: AbortSignal, onEvent: (e: PassEvent) => void): Promise<PassResult<T>> {
    const schema = schemaFor(req.schema);
    const body = this.body(req, schema);
    if (req.research) onEvent({ type: 'search', query: firstLine(req.user) });
    onEvent({ type: 'status', text: 'Thinking…' });
    const first = await this.stream(body, signal, onEvent);
    let parsed = parseJson(first.text, req.schema, schema);
    let usage = first.usage;
    if (!parsed.ok) {
      log.warn(`pass ${req.pass}: answer did not parse (finish_reason ${first.finishReason ?? 'none'}, ${first.text.length} chars): ${parsed.error}`, tail(first.text));
      // One repair round: no research, low effort, the broken output and the validation errors.
      onEvent({ type: 'status', text: 'Tidying the response…' });
      onEvent({ type: 'mark', mark: 'repair' });
      const cutOff = first.finishReason === 'length';
      const repair = this.body({ ...req, research: undefined, effort: 'low' }, schema, first.text, cutOff ? `the answer was cut off before it ended (${parsed.error})` : parsed.error);
      const second = await this.stream(repair, signal, onEvent);
      usage = addUsage(usage, second.usage);
      parsed = parseJson(second.text, req.schema, schema);
      if (!parsed.ok) {
        log.warn(`pass ${req.pass}: repair did not parse (finish_reason ${second.finishReason ?? 'none'}, ${second.text.length} chars): ${parsed.error}`, tail(second.text));
        throw new ProviderError(`Model output did not match the schema: ${parsed.error}`, 'invalid');
      }
    }
    if (parsed.notes.length) log.info(`pass ${req.pass}: accepted with ${parsed.notes.length} fix-up(s): ${parsed.notes.slice(0, 6).join('; ')}`);
    return { data: parsed.data, sourcesSeen: first.sources, usage };
  }

  /** Builds the chat completion body. `previous`/`errors` switch it into repair mode. */
  body<T>(req: PassRequest<T>, schema: JsonSchema, previous?: string, errors?: string): Record<string, unknown> {
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: `${req.system}\n\nRespond with a single JSON object matching this JSON Schema and nothing else:\n${JSON.stringify(schema)}` },
      { role: 'user', content: req.user },
    ];
    if (previous !== undefined) {
      messages.push({ role: 'assistant', content: previous.slice(0, 20_000) });
      messages.push({ role: 'user', content: `That was not valid against the schema: ${errors}. Return the corrected JSON object only.` });
    }
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      stream: true,
      usage: { include: true },
      max_tokens: MAX_TOKENS,
      response_format: this.opts.schemaEnforced
        ? { type: 'json_schema', json_schema: { name: `pass_${req.pass}`, strict: true, schema } }
        : { type: 'json_object' },
      reasoning: { effort: EFFORT[req.effort] ?? 'medium' },
    };
    if (this.opts.providerOrder?.length) {
      body.provider = { order: this.opts.providerOrder, allow_fallbacks: this.opts.allowFallbacks ?? false };
    }
    if (req.research && previous === undefined) {
      body.plugins = [{ id: 'web', max_results: this.opts.webResults ?? 5 }];
    }
    return body;
  }

  private async stream(body: Record<string, unknown>, signal: AbortSignal, onEvent: (e: PassEvent) => void): Promise<{ text: string; sources: string[]; usage: PassUsage; finishReason?: string }> {
    let res: Response;
    onEvent({ type: 'mark', mark: 'sent' });
    try {
      res = await this.fetchImpl(`${OPENROUTER_BASE}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ProviderError(`Could not reach OpenRouter: ${(e as Error).message}`, 'network');
    }
    if (!res.ok) throw await toProviderError(res);
    if (!res.body) throw new ProviderError('Empty response from OpenRouter.', 'unknown');

    let text = '';
    const sources = new Set<string>();
    const usage: PassUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, searches: 0 };
    let sawContent = false;
    let sawReasoning = false;
    let finishReason: string | undefined;
    for await (const chunk of sseChunks(res.body, signal)) {
      if (chunk.error) throw new ProviderError(chunk.error.message ?? 'OpenRouter error', kindFromCode(chunk.error.code));
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta ?? choice?.message;
      if (!sawReasoning && !sawContent && choice?.delta?.reasoning) {
        sawReasoning = true;
        onEvent({ type: 'mark', mark: 'firstReasoning' });
      }
      if (delta?.content) {
        text += delta.content;
        if (!sawContent) {
          sawContent = true;
          onEvent({ type: 'mark', mark: 'firstContent' });
          onEvent({ type: 'status', text: 'Writing findings…' });
        }
      }
      for (const a of delta?.annotations ?? []) if (a.type === 'url_citation' && a.url_citation?.url) sources.add(a.url_citation.url);
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
        usage.cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
    }
    onEvent({ type: 'mark', mark: 'end' });
    if (body.plugins) usage.searches = sources.size || (this.opts.webResults ?? 5);
    return { text, sources: [...sources], usage, finishReason };
  }
}

/* ---------------- helpers ---------------- */

async function* sseChunks(stream: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Chunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue; // comments (": OPENROUTER PROCESSING") and blank lines
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload) as Chunk;
        } catch {
          /* partial or malformed line: skip */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function toProviderError(res: Response): Promise<ProviderError> {
  let message = `OpenRouter HTTP ${res.status}`;
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    if (data.error?.message) message = data.error.message;
  } catch {
    /* no body */
  }
  const retry = Number(res.headers.get('retry-after'));
  return new ProviderError(message, kindFromCode(res.status), Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined);
}

function kindFromCode(code: number | string | undefined): ProviderError['kind'] {
  const n = typeof code === 'string' ? Number(code) : code;
  if (n === 401 || n === 403) return 'auth';
  if (n === 402) return 'billing';
  if (n === 429) return 'rate_limit';
  if (n === 400 || n === 404 || n === 422) return 'invalid';
  if (n !== undefined && n >= 500) return 'network';
  return 'unknown';
}

function addUsage(a: PassUsage, b: PassUsage): PassUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, searches: a.searches + b.searches };
}

function tail(text: string): string {
  return text.length > 400 ? `…${text.slice(-400)}` : text;
}

function firstLine(s: string): string {
  const m = s.match(/"statement":\s*"([^"]{8,120})/);
  if (m?.[1]) return m[1];
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
