import { ClaimCache } from '../../src/background/cache';
import { C_THROTTLE_MS, DEBOUNCE_MS, SessionOrchestrator, type Timers } from '../../src/background/orchestrator';
import { MemoryStorage } from '../../src/background/storage';
import { MockProvider } from '../../src/providers/mock';
import type { LLMProvider, PassRequest } from '../../src/providers/types';
import { ProviderError } from '../../src/providers/types';
import { snapshotFromText } from '../../src/shared/anchoring';
import { SAMPLE_DICTATED_TEXT, SAMPLE_PARAGRAPHS, SAMPLE_TEXT } from '../../src/shared/sample';
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
  // S, then A, then B, each a few awaits deep: enough microtask turns for a whole run on the zero-delay mock.
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

function setup(providerOverride?: LLMProvider, settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const clock = new FakeClock();
  const provider = providerOverride ?? new MockProvider({ delayMs: 0 });
  const storage = new MemoryStorage();
  const cache = new ClaimCache(storage, () => clock.now);
  const states: SessionState[] = [];
  const costs: number[] = [];
  // Most cases below exercise auto mode (re-run on edit); on-demand mode, the default, has its own describe.
  // Every check on: these cases cover the passes themselves; the picker has its own file (checks.test.ts).
  const settings = { ...DEFAULT_SETTINGS, provider: 'mock' as const, autoAnalyze: true, checks: { structure: true, polish: true, facts: true, challenge: true }, ...settingsOverride };
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
    expect(passes).toEqual(['A', 'B', 'C', 'S']);
    expect(provider.calls[0]!.pass).toBe('S'); // structure first; the sample keeps its order so the rest go ahead
    const s = last(states);
    expect(s.structure?.verdict).toBe('keeps');
    expect(s.passes.S.state).toBe('done');
    expect(s.claims).toHaveLength(3);
    expect(s.claims.every((c) => c.data.verdict)).toBe(true);
    expect(s.challenges).toHaveLength(4);
    expect(s.passes.A.state).toBe('done');
    expect(s.passes.B.state).toBe('done');
    expect(s.passes.C.state).toBe('done');
    expect(s.usage.searches).toBe(7);
    expect(costs.length).toBe(4);
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
    // Structure off so A is the first pass in flight (the structure pass has its own abort case below).
    const { orch, clock, provider, states } = setup(slow, { checks: { structure: false, polish: true, facts: true, challenge: true } });
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
      settings: () => ({ ...DEFAULT_SETTINGS, provider: 'mock', checks: { structure: true, polish: true, facts: true, challenge: true } }),
      cache: first.cache,
      emit: (s) => states.push(s),
      now: () => first.clock.now,
      timers: first.clock,
    });
    orch2.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true); // default settings: on demand, so the first run is the user's click
    await first.clock.advance(0);
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
      probe: (signal: AbortSignal) => inner.probe(signal),
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

describe('on-demand mode (autoAnalyze off, the default)', () => {
  it('runs the first snapshot when asked, then only shifts anchors on edits until analyzeNow', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass).sort()).toEqual(['A', 'B', 'C', 'S']);
    expect(last(states).analyzedVersion).toBe(1);
    provider.calls.length = 0;

    const edited = SAMPLE_TEXT.replace('not a single company went back to five days', 'almost all of them kept it');
    orch.handleSnapshot(snapshotFromText(edited, 2));
    await clock.advance(DEBOUNCE_MS * 3);
    expect(provider.calls).toHaveLength(0);
    const s = last(states);
    expect(s.snapshotVersion).toBe(2);
    expect(s.analyzedVersion).toBe(1); // draft changed since the last run
    expect(s.claims.find((c) => c.quote.includes('almost all'))?.status ?? s.claims.some((c) => c.status === 'stale')).toBeTruthy();

    orch.analyzeNow();
    await clock.advance(0);
    const passes = provider.calls.map((c) => c.pass);
    expect(passes).toContain('A');
    expect(passes).toContain('C'); // explicit request ignores the 20s throttle
    expect(provider.calls.find((c) => c.pass === 'A')!.user).toMatch(/Only these paragraphs changed/);
    expect(last(states).analyzedVersion).toBe(2);
  });

  it('analyzeNow on unchanged text is a full run', async () => {
    const { orch, clock, provider } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await clock.advance(0);
    provider.calls.length = 0;
    orch.analyzeNow();
    await clock.advance(0);
    const a = provider.calls.find((c) => c.pass === 'A')!;
    expect(a.user).not.toMatch(/Only these paragraphs changed/);
    expect(provider.calls.map((c) => c.pass)).toContain('C');
  });
});

describe('structure pass', () => {
  const slowSleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(res, 0);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        const e = new Error('aborted');
        e.name = 'AbortError';
        rej(e);
      });
    });

  it('a dictated draft gets a reorder proposal and A, B and C wait for the user', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass)).toEqual(['S']);
    const s = last(states);
    expect(s.structure).toMatchObject({ verdict: 'reorder', status: 'open', forVersion: 1, paragraphs: SAMPLE_PARAGRAPHS });
    expect(s.structure!.note).toMatch(/ask/);
    expect(s.passes.S.state).toBe('done');
    expect(s.passes.A.state).toBe('idle');
    expect(s.passes.C.state).toBe('idle');
    expect(s.analyzedVersion).toBe(1);
  });

  it('Keep mine runs the held passes on the draft as written, without asking about structure again', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    provider.calls.length = 0;
    orch.handleStructureAction('kept');
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass).sort()).toEqual(['A', 'B', 'C']); // the dictated draft has the same sentences, so the claims anchor and B runs
    expect(last(states).structure?.status).toBe('kept');
    expect(last(states).passes.A.state).toBe('done');
    // Re-analyze on the same text: still no second structure pass
    provider.calls.length = 0;
    orch.analyzeNow();
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass)).not.toContain('S');
  });

  it('Apply structure: the reordered draft is analyzed once, without a second structure pass', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    provider.calls.length = 0;
    // The content script applies the proposal, reports it, sends the new snapshot and asks for a run.
    orch.handleStructureAction('applied');
    orch.handleSnapshot(snapshotFromText(SAMPLE_PARAGRAPHS.join('\n\n'), 2));
    orch.analyzeNow();
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass).sort()).toEqual(['A', 'B', 'C']);
    const s = last(states);
    expect(s.structure?.status).toBe('applied');
    expect(s.claims).toHaveLength(3);
    expect(s.claims.every((c) => c.data.verdict)).toBe(true);
    expect(s.analyzedVersion).toBe(2);
  });

  it('turning Structure off while S is in flight aborts it and nothing is held', async () => {
    const slow = new MockProvider({ delayMs: 500, sleep: slowSleep });
    const { orch, clock, provider, states } = setup(slow, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    expect(last(states).passes.S.state).toBe('running');
    orch.setChecks({ structure: false, polish: true, facts: true, challenge: true });
    await flush();
    expect(last(states).structure).toBeUndefined();
    expect(last(states).passes.S.state).not.toBe('running');
    expect(provider.calls.map((c) => c.pass)).toEqual(['S']);
  });

  it('in auto mode, edits on a stale proposal do not ask about structure again; the other passes run', async () => {
    const { orch, clock, provider, states } = setup(); // auto mode
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1));
    await clock.advance(DEBOUNCE_MS);
    expect(last(states).structure?.status).toBe('open');
    provider.calls.length = 0;
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT.replace('I guess', 'I think'), 2));
    await clock.advance(DEBOUNCE_MS);
    expect(last(states).structure?.status).toBe('stale');
    const passes = provider.calls.map((c) => c.pass);
    expect(passes).not.toContain('S');
    expect(passes).toContain('A');
  });

  it('an edit while a proposal is open makes it stale; the next Re-analyze asks again', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT + '\n\nPS: numbers attached.', 2));
    await clock.advance(0);
    expect(last(states).structure?.status).toBe('stale');
    provider.calls.length = 0;
    orch.analyzeNow();
    await clock.advance(0);
    expect(provider.calls[0]!.pass).toBe('S');
    expect(last(states).structure?.status).toBe('open');
    expect(last(states).structure?.forVersion).toBe(2);
  });

  it('with Structure off, no structure pass runs and the passes go straight on', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false, checks: { structure: false, polish: true, facts: true, challenge: true } });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass)).not.toContain('S');
    expect(last(states).structure).toBeUndefined();
  });

  it('turning Structure off drops the open proposal', async () => {
    const { orch, clock, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1), true);
    await clock.advance(0);
    orch.setChecks({ structure: false, polish: true, facts: true, challenge: true });
    expect(last(states).structure).toBeUndefined();
  });

  it('in auto mode a new edit aborts an in-flight structure pass and the debounced run asks again', async () => {
    const slow = new MockProvider({ delayMs: 500, sleep: slowSleep });
    const { orch, clock, provider, states } = setup(slow);
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT, 1));
    await clock.advance(DEBOUNCE_MS);
    expect(last(states).passes.S.state).toBe('running');
    orch.handleSnapshot(snapshotFromText(SAMPLE_DICTATED_TEXT + '\n\nPS', 2));
    await flush();
    expect(provider.calls.filter((c) => c.pass === 'S')).toHaveLength(1);
    expect(provider.calls.filter((c) => c.pass === 'A')).toHaveLength(0); // the aborted run did not fall through to A
    await clock.advance(DEBOUNCE_MS);
    expect(provider.calls.filter((c) => c.pass === 'S')).toHaveLength(2);
  });

  it('a structure pass failure does not block the other passes', async () => {
    const provider = new MockProvider({ delayMs: 0 });
    const failing: LLMProvider = {
      id: 'mock',
      capabilities: provider.capabilities,
      listModels: () => provider.listModels(),
      probe: (signal) => provider.probe(signal),
      runPass: (req, signal, onEvent) => {
        if (req.pass === 'S') return Promise.reject(new ProviderError('boom', 'invalid'));
        return provider.runPass(req, signal, onEvent);
      },
    };
    const { orch, clock, states } = setup(failing, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await clock.advance(0);
    const s = last(states);
    expect(s.passes.S.state).toBe('error');
    expect(s.passes.A.state).toBe('done');
    expect(s.claims).toHaveLength(3);
  });
});

describe('re-check after an applied change', () => {
  it('drops the finding and re-runs A on the changed paragraph only, without C, even on demand', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await clock.advance(0);
    const claim = last(states).claims.find((c) => c.quote === 'not a single company went back to five days')!;
    expect(claim.data.verdict?.status).toBe('contradicted');
    provider.calls.length = 0;

    // The content script applied the suggestion, sent the snapshot, then asked for the re-check.
    orch.handleAction(claim.id, 'applied');
    const edited = SAMPLE_TEXT.replace('not a single company went back to five days', '56 of the 61 companies kept it');
    orch.handleSnapshot(snapshotFromText(edited, 2));
    orch.recheck(claim.id);
    await clock.advance(0);

    const passes = provider.calls.map((c) => c.pass);
    expect(passes).toEqual(['A']); // scoped A; the other claims keep their verdicts, so no B; never S or C
    expect(provider.calls[0]!.user).toMatch(/Only these paragraphs changed since your last analysis: P3\./);
    const s = last(states);
    expect(s.claims.find((c) => c.id === claim.id)).toBeUndefined();
    expect(s.claims.filter((c) => c.status === 'open' && c.data.verdict?.status === 'contradicted')).toHaveLength(0);
    expect(s.analyzedVersion).toBe(2);
    expect(s.passes.A.state).toBe('done');
    expect(s.passes.C.at).toBeDefined();
    expect(s.structure?.status).not.toBe('open');
  });

  it('a recheck leaves the analyzed checks alone, so a chip flipped before it still asks for a full run', async () => {
    const { orch, clock, states } = setup(undefined, { autoAnalyze: false, checks: { structure: true, polish: true, facts: true, challenge: false } });
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await clock.advance(0);
    orch.setChecks({ structure: true, polish: true, facts: true, challenge: true });
    const note = last(states).clarity[0]!;
    orch.handleAction(note.id, 'applied');
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT.replace(note.quote, 'x'), 2));
    orch.recheck(note.id);
    await clock.advance(0);
    expect(last(states).analyzedChecks?.challenge).toBe(false);
  });

  it('a rewritten clarity span that still reads the same way is flagged again by the fresh run', async () => {
    const { orch, clock, provider, states } = setup(undefined, { autoAnalyze: false });
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await clock.advance(0);
    const note = last(states).clarity.find((c) => c.data.kind === 'hedge')!;
    provider.calls.length = 0;
    // The user's rewrite removes the flagged phrase; the mock's canned A result no longer locates it, so it is gone.
    orch.handleAction(note.id, 'applied');
    orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT.replace(note.quote, 'so retention risk looks low'), 2));
    orch.recheck(note.id);
    await clock.advance(0);
    expect(provider.calls.map((c) => c.pass)).toEqual(['A']);
    expect(last(states).clarity.find((c) => c.id === note.id)).toBeUndefined();
    expect(last(states).clarity.some((c) => c.status === 'applied')).toBe(false);
  });
});

describe('surviving a service worker restart', () => {
  it('dump + restore keeps findings, and the replayed snapshot does not re-run unchanged text', async () => {
    const first = setup(undefined, { autoAnalyze: false });
    first.orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await first.clock.advance(0);
    const saved = first.orch.dump();
    expect(saved.state.claims).toHaveLength(3);

    const second = setup(undefined, { autoAnalyze: false });
    second.orch.restore(saved);
    expect(second.orch.state.challenges).toHaveLength(4);
    expect(second.orch.state.passes.A.state).toBe('done');
    // the content script replays its last snapshot as 'initial' on reconnect
    second.orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
    await second.clock.advance(0);
    expect(second.provider.calls).toHaveLength(0);
    expect(last(second.states).claims).toHaveLength(3);
    // an edit made while the worker was down is picked up as an incremental run on Re-analyze
    const edited = SAMPLE_TEXT.replace('20 minutes', 'thirty minutes');
    second.orch.handleSnapshot(snapshotFromText(edited, 2));
    second.orch.analyzeNow();
    await second.clock.advance(0);
    expect(second.provider.calls.find((c) => c.pass === 'A')!.user).toMatch(/Only these paragraphs changed/);
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
