import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ClaudeProvider, type ClaudeClientLike, type MessageLike } from '../../src/providers/claude';
import type { PassEvent } from '../../src/providers/types';
import { ProviderError } from '../../src/providers/types';
import { buildPassA, buildPassB } from '../../src/passes/build';
import { snapshotFromText } from '../../src/shared/anchoring';
import { PassA, PassB } from '../../src/shared/schemas';
import { SAMPLE_PASS_A, SAMPLE_PASS_B, SAMPLE_TEXT } from '../../src/shared/sample';

function fakeClient(responses: MessageLike[], seen: Record<string, unknown>[] = []): ClaudeClientLike {
  let i = 0;
  return {
    beta: {
      messages: {
        stream(params) {
          seen.push(params);
          const msg = responses[Math.min(i++, responses.length - 1)]!;
          return { finalMessage: async () => msg, on: () => undefined };
        },
      },
    },
    models: {
      async *list() {
        yield { id: 'claude-opus-5', display_name: 'Claude Opus 5' };
      },
    },
  };
}

const text = (t: string) => ({ type: 'text', text: t });

describe('ClaudeProvider', () => {
  it('builds a zod output format for every pass schema', () => {
    for (const s of [PassA, PassB]) {
      const f = zodOutputFormat(s);
      expect(f.type).toBe('json_schema');
      expect(typeof f.schema).toBe('object');
    }
  });

  it('sends the expected request shape and parses the JSON text block', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient([{ content: [text(JSON.stringify(SAMPLE_PASS_A))], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } }], seen);
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', workspaceId: 'w', client });
    const req = buildPassA(snapshotFromText(SAMPLE_TEXT), { effort: 'low' });
    const res = await p.runPass(req, new AbortController().signal, () => undefined);
    expect(res.data.claims).toHaveLength(3);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, searches: 0 });
    const params = seen[0]!;
    expect(params.model).toBe('claude-opus-5');
    expect(params.tools).toBeUndefined();
    expect((params.output_config as { effort: string; format: { type: string } }).effort).toBe('low');
    expect((params.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect((params.system as Array<{ cache_control: unknown }>)[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    expect(params.thinking).toBeUndefined();
  });

  it('adds the web search tool for research passes and collects sources seen, skipping error results', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient(
      [
        {
          content: [
            { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'uk pilot' } },
            { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://autonomy.work/portfolio/uk4dwpilotresults/', title: 't' }] },
            { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'again' } },
            { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
            text(JSON.stringify(SAMPLE_PASS_B)),
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 2 } },
        },
      ],
      seen,
    );
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    const events: PassEvent[] = [];
    const req = buildPassB(SAMPLE_PASS_A.claims, snapshotFromText(SAMPLE_TEXT), { effort: 'high', blockedDomains: ['reddit.com'] });
    const res = await p.runPass(req, new AbortController().signal, (e) => events.push(e));
    expect(res.sourcesSeen).toEqual(['https://autonomy.work/portfolio/uk4dwpilotresults/']);
    expect(res.usage.searches).toBe(2);
    expect(events.filter((e) => e.type === 'search').map((e) => (e as { query: string }).query)).toEqual(['uk pilot', 'again']);
    const tools = seen[0]!.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({ type: 'web_search_20260318', name: 'web_search', max_uses: 6, blocked_domains: ['reddit.com'] });
  });

  it('continues after pause_turn by re-sending the assistant content', async () => {
    const seen: Record<string, unknown>[] = [];
    const paused: MessageLike = { content: [{ type: 'server_tool_use', id: 'x', name: 'web_search', input: { query: 'q' } }], stop_reason: 'pause_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    const done: MessageLike = { content: [text(JSON.stringify(SAMPLE_PASS_B))], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    const client = fakeClient([paused, done], seen);
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    const req = buildPassB(SAMPLE_PASS_A.claims, snapshotFromText(SAMPLE_TEXT), { effort: 'high', blockedDomains: [] });
    const res = await p.runPass(req, new AbortController().signal, () => undefined);
    expect(res.data.verdicts).toHaveLength(3);
    expect(seen).toHaveLength(2);
    const msgs = seen[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.role).toBe('assistant');
    expect(msgs[1]!.content).toBe(paused.content);
    expect(res.usage.inputTokens).toBe(2);
  });

  it('returns an empty result flagged refused on a refusal stop', async () => {
    const client = fakeClient([{ content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } }]);
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    const res = await p.runPass(buildPassA(snapshotFromText(SAMPLE_TEXT), { effort: 'low' }), new AbortController().signal, () => undefined);
    expect(res.refused).toBe(true);
    expect(res.data).toEqual({ clarity: [], claims: [] });
  });

  it('throws an invalid ProviderError on malformed output', async () => {
    const client = fakeClient([{ content: [text('sorry, no json here')], stop_reason: 'end_turn' }]);
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    await expect(p.runPass(buildPassA(snapshotFromText(SAMPLE_TEXT), { effort: 'low' }), new AbortController().signal, () => undefined)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('tolerates a fenced JSON block', async () => {
    const client = fakeClient([{ content: [text('```json\n' + JSON.stringify(SAMPLE_PASS_A) + '\n```')], stop_reason: 'end_turn' }]);
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    const res = await p.runPass(buildPassA(snapshotFromText(SAMPLE_TEXT), { effort: 'low' }), new AbortController().signal, () => undefined);
    expect(res.data.clarity).toHaveLength(2);
  });

  it('lists models', async () => {
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client: fakeClient([]) });
    expect(await p.listModels()).toEqual([{ id: 'claude-opus-5', displayName: 'Claude Opus 5' }]);
  });

  it('ProviderError carries a kind', () => {
    expect(new ProviderError('x', 'auth').kind).toBe('auth');
  });
});

describe('ClaudeProvider.probe', () => {
  it('sends one short request with low effort and no tools or output format', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient([{ content: [text('ready')], stop_reason: 'end_turn' }], seen);
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    await expect(p.probe(new AbortController().signal)).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    const params = seen[0]!;
    expect(params.model).toBe('claude-opus-5');
    expect(params.tools).toBeUndefined();
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.max_tokens).toBeLessThanOrEqual(1024);
  });

  it('maps client failures to provider errors', async () => {
    const client: ClaudeClientLike = {
      beta: {
        messages: {
          stream() {
            throw new ProviderError('The API key was rejected', 'auth');
          },
        },
      },
      models: { async *list() {} },
    };
    const p = new ClaudeProvider({ apiKey: 'k', model: 'claude-opus-5', client });
    await expect(p.probe(new AbortController().signal)).rejects.toMatchObject({ kind: 'auth' });
  });
});
