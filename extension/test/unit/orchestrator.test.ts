import { ClaimCache } from '../../src/background/cache';
import { C_THROTTLE_MS, DEBOUNCE_MS, SessionOrchestrator, type Timers } from '../../src/background/orchestrator';
import { MemoryStorage } from '../../src/background/storage';
import { MockProvider } from '../../src/providers/mock';
import type { LLMProvider, PassRequest } from '../../src/providers/types';
import { ProviderError } from '../../src/providers/types';
import { snapshotFromText } from '../../src/shared/anchoring';
import { SAMPLE_TEXT } from '../../src/shared/sample';
import { DEFAULT_SETTINGS, type SessionState } from '../../src/shared/types';

/** Deterministic fake clock + timers. */
class FakeClock implements Timers {
  now = 1_000_000;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.q.push({ at: this.now + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.q = this.q.filter((t) => t.id !== handle);
  }
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const next = this.q[0];
      if (!next || next.at > target) break;
      this.q.shift();
      this.now = next.at;
      next.fn();
      await flush();
    }
    this.now = target;
    await flush();
  }
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(providerOverride?: LLMProvider) {
  const clock = new FakeClock();
  const provider = providerOverride ?? new MockProvider({ delayMs: 0 });
  const storage = new MemoryStorage();
  const cache = new ClaimCache(storage, () => clock.now);
  const states: SessionState[] = [];
  const costs: number[] = [];
  const settings = { ...DEFAULT_SETTINGS, provider: 'mock' as const };
  const orch = new SessionOrchestrator('s1', 'gmail', {
    provider: () => provider,
    settings: () => settings,
    cache,
    emit: (s) => states.push(s),
    onCost: (usd) => costs.push(usd),
    now: () => clock.now,
    timers: clock,
  });
  return { orch, clock, provider: provider as MockProvider, states, costs, cache };
}

const last = (states: SessionState[]) => states[states.length - 1]!;

describe('SessionOrchestrator', () => {
  it('debounces snapshots and runs A, B and C once for the first draft', async () => {
    const { orch, clock, provider, states, costs } = setup();
    orch.handleSnapshot(snapshotFromText('Hi', 1));
    await clock.advance(DEBOUNCE_MS / 2);
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 2));
    await clock.advance(DEBOUNCE_MS / 2);
    expect(provider.calls).toHaveLength(0);
    await clock.advance(DEBOUNCE_MS);
    const passes = provider.calls.map((c) => c.pass).sort();
    expect(passes).toEqual(['A', 'B', 'C']);
    const s = last(states);
    expect(s.claims).toHaveLength(3);
    expect(s.claims.every((c) => c.data.verdict)).toBe(true);
    expect(s.challenges).toHaveLength(4);
    expect(s.passes.A.state).toBe('done');
    expect(s.passes.B.state).toBe('done');
    expect(s.passes.C.state).toBe('done');
    expect(s.usage.searches).toBe(7);
    expect(costs.length).toBe(3);
    expect(s.usage.estCostUsd).toBeGreaterThan(0.1);
  });

  it('after an edit, re-runs A but verifies only claims without a verdict and throttles C', async () => {
    const { orch, clock, provider } = setup();
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await clock.advance(DEBOUNCE_MS);
    provider.calls.length = 0;

    // edit the contradicted claim's sentence (paragraph 3) and the hedge (paragraph 4)
    const edited = SAMPLE_TEXT.replace('not a single company went back to five days', 'almost all of them kept it');
    orch.handleSnapshot(snapshotFromText(edited, 2));
    await clock.advance(DEBOUNCE_MS);
    const passes = provider.calls.map((c) => c.pass);
    expect(passes).toContain('A');
    expect(passes).not.toContain('C'); // within the 20s window: deferred
    const a = provider.calls.find((c) => c.pass === 'A')!;
    expect(a.user).toMatch(/Only these paragraphs changed since your last analysis: P3\./);
    // the mock returns the full sample for A; the reworded claim no longer locates, the other two keep their verdicts
    const b = provider.calls.filter((c) => c.pass === 'B');
    expect(b).toHaveLength(0);

    await clock.advance(C_THROTTLE_MS);
    expect(provider.calls.map((c) => c.pass)).toContain('C');
  });

  it('cancels an in-flight pass A when a new snapshot arrives', async () => {
    const slow = new MockProvider({ delayMs: 500, sleep: (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, 0); signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); }) });
    const { orch, clock, provider, states } = setup(slow);
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await clock.advance(DEBOUNCE_MS);
    // A is now "in flight" (its sleep resolves on a real macrotask we never let run before the next snapshot)
    expect(last(states).passes.A.state).toBe('running');
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT + '\n\nPS', 2));
    await flush();
    expect(provider.calls.filter((c) => c.pass === 'A')).toHaveLength(1);
    await clock.advance(DEBOUNCE_MS);
    expect(provider.calls.filter((c) => c.pass === 'A')).toHaveLength(2);
    expect(last(states).passes.A.state).not.toBe('error');
  });

  it('uses the claim cache instead of calling B for known claims', async () => {
    const first = setup();
    first.orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await first.clock.advance(DEBOUNCE_MS);
    expect(first.provider.calls.filter((c) => c.pass === 'B')).toHaveLength(1);

    // second session, same storage-backed cache
    const provider2 = new MockProvider({ delayMs: 0 });
    const states: SessionState[] = [];
    const orch2 = new SessionOrchestrator('s2', 'gmail', {
      provider: () => provider2,
      settings: () => ({ ...DEFAULT_SETTINGS, provider: 'mock' }),
      cache: first.cache,
      emit: (s) => states.push(s),
      now: () => first.clock.now,
      timers: first.clock,
    });
    orch2.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await first.clock.advance(DEBOUNCE_MS);
    expect(provider2.calls.filter((c) => c.pass === 'B')).toHaveLength(0);
    expect(last(states).claims.filter((c) => c.data.verdict)).toHaveLength(3);
  });

  it('backs off and retries on rate limits, and surfaces other errors on the pass', async () => {
    let failures = 0;
    const inner = new MockProvider({ delayMs: 0 });
    const flaky: LLMProvider = {
      id: 'mock',
      capabilities: inner.capabilities,
      listModels: () => inner.listModels(),
      runPass: <T>(req: PassRequest<T>, signal: AbortSignal, on: Parameters<LLMProvider['runPass']>[2]) => {
        if (req.pass === 'A' && failures < 1) {
          failures++;
          return Promise.reject(new ProviderError('slow down', 'rate_limit'));
        }
        if (req.pass === 'C') return Promise.reject(new ProviderError('nope', 'auth'));
        return inner.runPass(req, signal, on);
      },
    };
    const { orch, clock, states } = setup(flaky);
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await clock.advance(DEBOUNCE_MS);
    expect(last(states).passes.A.state).toBe('error');
    expect(last(states).passes.A.error).toMatch(/Rate limited, retrying in 2s/);
    expect(last(states).passes.C.state).toBe('error');
    expect(last(states).passes.C.error).toMatch(/API key rejected/);
    await clock.advance(2_000);
    expect(last(states).passes.A.state).toBe('done');
    expect(last(states).claims).toHaveLength(3);
  });

  it('records applied and kept actions', async () => {
    const { orch, clock, states } = setup();
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await clock.advance(DEBOUNCE_MS);
    const id = last(states).clarity[0]!.id;
    orch.handleAction(id, 'kept');
    expect(last(states).clarity.find((c) => c.id === id)!.status).toBe('kept');
  });
});

describe('grounded research providers', () => {
  it('verifies one claim per request and keeps B running until the batch is done', async () => {
    const provider = new MockProvider({ delayMs: 0, researchMode: 'grounded' });
    const { orch, clock, states } = setup(provider);
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1));
    await clock.advance(DEBOUNCE_MS + 10);
    const bCalls = provider.calls.filter((c) => c.pass === 'B');
    expect(bCalls).toHaveLength(3);
    for (const c of bCalls) expect((c.user.match(/"id":/g) ?? []).length).toBe(1);
    const final = states.at(-1)!;
    expect(final.passes.B.state).toBe('done');
    expect(final.claims.filter((c) => c.data.verdict)).toHaveLength(3);
    // Progressive: a state was emitted with B still running and at least one verdict attached.
    expect(states.some((s) => s.passes.B.state === 'running' && s.claims.some((c) => c.data.verdict))).toBe(true);
  });
});
