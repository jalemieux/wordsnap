import { z } from 'zod';
import { OpenRouterProvider, parseJson } from '../../src/providers/openrouter';
import { ProviderError, type PassRequest } from '../../src/providers/types';
import { PassA } from '../../src/shared/schemas';
import { SAMPLE_PASS_A } from '../../src/shared/sample';

const Small = z.object({ a: z.number(), b: z.string() });

function sse(events: unknown[], opts: { comments?: boolean } = {}): Response {
  const lines: string[] = [];
  if (opts.comments) lines.push(': OPENROUTER PROCESSING');
  for (const e of events) lines.push(`data: ${JSON.stringify(e)}`, '');
  lines.push('data: [DONE]', '');
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Split mid-line to exercise buffering.
      const all = lines.join('\n');
      const mid = Math.floor(all.length / 2);
      c.enqueue(enc.encode(all.slice(0, mid)));
      c.enqueue(enc.encode(all.slice(mid)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function textChunks(text: string, extra: Partial<{ annotations: unknown[]; usage: unknown }> = {}): unknown[] {
  const parts = text.match(/.{1,17}/gs) ?? [];
  const out: unknown[] = parts.map((p) => ({ choices: [{ delta: { content: p } }] }));
  if (extra.annotations) out.push({ choices: [{ delta: { content: '', annotations: extra.annotations } }] });
  out.push({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: extra.usage ?? { prompt_tokens: 100, completion_tokens: 20 } });
  return out;
}

function fakeFetch(responses: Response[]): { fetchImpl: typeof fetch; calls: { url: string; body: Record<string, unknown> }[] } {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    return r;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseReq = (research: boolean): PassRequest<z.infer<typeof Small>> => ({
  pass: research ? 'B' : 'A',
  system: 'SYS',
  user: 'USER',
  schema: Small,
  effort: 'high',
  research: research ? { maxSearches: 3, blockedDomains: [] } : undefined,
});

describe('parseJson', () => {
  it('accepts a bare object, a fenced block, and prose around an object', () => {
    expect(parseJson('{"a":1,"b":"x"}', Small)).toEqual({ ok: true, data: { a: 1, b: 'x' }, notes: [] });
    expect(parseJson('Here you go:\n```json\n{"a":2,"b":"y"}\n```', Small)).toEqual({ ok: true, data: { a: 2, b: 'y' }, notes: [] });
    expect(parseJson('Sure. {"a":3,"b":"z"} Done.', Small)).toEqual({ ok: true, data: { a: 3, b: 'z' }, notes: [] });
  });
  it('reports schema errors', () => {
    const r = parseJson('{"a":"nope","b":1}', Small);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/a:/);
  });
  it('validates the real pass A schema from sample data', () => {
    expect(parseJson(JSON.stringify(SAMPLE_PASS_A), PassA).ok).toBe(true);
  });
});

describe('OpenRouterProvider', () => {
  it('streams, parses, and reports usage; no plugins on a non-research pass', async () => {
    const { fetchImpl, calls } = fakeFetch([sse(textChunks('{"a":1,"b":"ok"}'), { comments: true })]);
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'z-ai/glm-5.2', providerOrder: ['z-ai'], fetchImpl });
    const events: string[] = [];
    const res = await p.runPass(baseReq(false), new AbortController().signal, (e) => events.push(e.type));
    expect(res.data).toEqual({ a: 1, b: 'ok' });
    expect(res.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, searches: 0 });
    expect(res.sourcesSeen).toEqual([]);
    const body = calls[0]!.body;
    expect(body.model).toBe('z-ai/glm-5.2');
    expect(body.plugins).toBeUndefined();
    expect(body.provider).toEqual({ order: ['z-ai'], allow_fallbacks: false });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect((body.messages as { role: string; content: string }[])[0]!.content).toContain('JSON Schema');
    expect(events).not.toContain('search');
  });

  it('adds the web plugin on research passes and collects url_citation sources', async () => {
    const ann = [
      { type: 'url_citation', url_citation: { url: 'https://autonomy.work/portfolio/uk4dwpilotresults/', title: 'UK pilot' } },
      { type: 'url_citation', url_citation: { url: 'https://example.org/a', title: 'a' } },
      { type: 'url_citation', url_citation: { url: 'https://example.org/a', title: 'dup' } },
    ];
    const { fetchImpl, calls } = fakeFetch([sse(textChunks('{"a":2,"b":"r"}', { annotations: ann }))]);
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'z-ai/glm-5.2', webResults: 4, fetchImpl });
    const events: string[] = [];
    const res = await p.runPass(baseReq(true), new AbortController().signal, (e) => events.push(e.type));
    expect(calls[0]!.body.plugins).toEqual([{ id: 'web', max_results: 4 }]);
    expect(res.sourcesSeen).toEqual(['https://autonomy.work/portfolio/uk4dwpilotresults/', 'https://example.org/a']);
    expect(res.usage.searches).toBe(2);
    expect(events[0]).toBe('search');
  });

  it('repairs once when the first answer does not match the schema, without research', async () => {
    const { fetchImpl, calls } = fakeFetch([sse(textChunks('{"a":"bad","b":"r"}')), sse(textChunks('{"a":5,"b":"fixed"}'))]);
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetchImpl });
    const res = await p.runPass(baseReq(true), new AbortController().signal, () => {});
    expect(res.data).toEqual({ a: 5, b: 'fixed' });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.plugins).toBeUndefined();
    const msgs = calls[1]!.body.messages as { role: string; content: string }[];
    expect(msgs.at(-2)!.role).toBe('assistant');
    expect(msgs.at(-1)!.content).toMatch(/not valid/);
    expect(res.usage.inputTokens).toBe(200);
  });

  it('throws invalid after a failed repair', async () => {
    const { fetchImpl } = fakeFetch([sse(textChunks('nonsense')), sse(textChunks('still nonsense'))]);
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetchImpl });
    await expect(p.runPass(baseReq(false), new AbortController().signal, () => {})).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('maps http errors to provider error kinds', async () => {
    const mk = (status: number, headers?: Record<string, string>) => new Response(JSON.stringify({ error: { message: `E${status}` } }), { status, headers });
    for (const [status, kind] of [
      [401, 'auth'],
      [402, 'billing'],
      [429, 'rate_limit'],
      [400, 'invalid'],
      [503, 'network'],
    ] as const) {
      const { fetchImpl } = fakeFetch([mk(status, status === 429 ? { 'retry-after': '7' } : undefined)]);
      const p = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetchImpl });
      const err = await p.runPass(baseReq(false), new AbortController().signal, () => {}).catch((e) => e as ProviderError);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe(kind);
      if (status === 429) expect((err as ProviderError).retryAfterMs).toBe(7000);
    }
  });

  it('surfaces mid-stream error chunks', async () => {
    const { fetchImpl } = fakeFetch([sse([{ error: { message: 'Provider returned error', code: 502 } }])]);
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetchImpl });
    await expect(p.runPass(baseReq(false), new AbortController().signal, () => {})).rejects.toMatchObject({ kind: 'network' });
  });

  it('listModels validates the key first and sorts z-ai models to the top', async () => {
    const { fetchImpl } = fakeFetch([
      new Response(JSON.stringify({ data: { label: 'k' } }), { status: 200 }),
      new Response(JSON.stringify({ data: [{ id: 'openai/gpt-5', name: 'GPT-5' }, { id: 'z-ai/glm-5.2', name: 'GLM 5.2' }, { id: 'z-ai/glm-5.2:free' }] }), { status: 200 }),
    ]);
    const p = new OpenRouterProvider({ apiKey: 'k', model: 'z-ai/glm-5.2', fetchImpl });
    const models = await p.listModels();
    expect(models[0]).toEqual({ id: 'z-ai/glm-5.2', displayName: 'GLM 5.2' });
    expect(models.map((m) => m.id)).not.toContain('z-ai/glm-5.2:free');
    const bad = fakeFetch([new Response('{}', { status: 401 })]);
    await expect(new OpenRouterProvider({ apiKey: 'x', model: 'm', fetchImpl: bad.fetchImpl }).listModels()).rejects.toMatchObject({ kind: 'auth' });
  });
});
