import { describe, expect, it } from 'vitest';
import { ClaimCache } from '../../src/background/cache';
import { SessionOrchestrator, type Timers } from '../../src/background/orchestrator';
import { mergeSettings } from '../../src/background/settings';
import { MemoryStorage } from '../../src/background/storage';
import { buildPassA, buildPassC } from '../../src/passes/build';
import { MockProvider } from '../../src/providers/mock';
import { snapshotFromText } from '../../src/shared/anchoring';
import { SAMPLE_TEXT } from '../../src/shared/sample';
import { ALL_CHECKS, DEFAULT_CHECKS, DEFAULT_SETTINGS, clarityKindFilter, type Checks, type SessionState } from '../../src/shared/types';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const timers: Timers = { setTimeout: (fn) => (fn(), 0), clearTimeout: () => {} };

function setup(checks: Checks) {
  const provider = new MockProvider({ delayMs: 0 });
  const states: SessionState[] = [];
  const settings = { ...DEFAULT_SETTINGS, provider: 'mock' as const, checks };
  const orch = new SessionOrchestrator('s1', 'gmail', { provider: () => provider, settings: () => settings, cache: new ClaimCache(new MemoryStorage()), emit: (s) => states.push(s), timers, now: () => 1 });
  orch.handleSnapshot(snapshotFromText(SAMPLE_TEXT, 1), true);
  return { orch, provider, states };
}
const passes = (p: MockProvider) => p.calls.map((c) => c.pass);

describe('check picker', () => {
  it('defaults to Structure, Polish and Facts on and Challenge off', () => {
    expect(DEFAULT_CHECKS).toEqual({ structure: true, polish: true, facts: true, challenge: false });
    expect(mergeSettings({}).checks).toEqual(DEFAULT_CHECKS);
    expect(mergeSettings({ checks: { ...DEFAULT_CHECKS, challenge: true } }).checks.challenge).toBe(true);
  });

  it('with the defaults, C runs thesis-only without research and no challenges are kept', async () => {
    const { orch, provider } = setup({ ...DEFAULT_CHECKS });
    await flush();
    const c = provider.calls.find((x) => x.pass === 'C')!;
    expect(c.research).toBeUndefined();
    expect(c.system).toMatch(/thesis-only/);
    expect(c.effort).toBe('low');
    expect(orch.state.argument?.thesis).toBeTruthy();
    expect(orch.state.challenges).toEqual([]);
    expect(passes(provider)).toContain('B');
    expect(orch.state.checks).toEqual(DEFAULT_CHECKS);
    expect(orch.state.analyzedChecks).toEqual(DEFAULT_CHECKS);
  });

  it('with Challenge on, C runs with research and keeps the challenges', async () => {
    const { orch, provider } = setup({ ...ALL_CHECKS });
    await flush();
    const c = provider.calls.find((x) => x.pass === 'C')!;
    expect(c.research).toBeDefined();
    expect(orch.state.challenges.length).toBe(4);
  });

  it('with Facts off, B never runs, A is told to skip claims, and no claims are kept', async () => {
    const { orch, provider } = setup({ ...ALL_CHECKS, facts: false });
    await flush();
    expect(passes(provider)).not.toContain('B');
    expect(provider.calls.find((x) => x.pass === 'A')!.user).toMatch(/empty claims array/);
    expect(orch.state.claims).toEqual([]);
    expect(orch.state.clarity.length).toBeGreaterThan(0);
  });

  it('with only Challenge on, A and B do not run at all', async () => {
    const { provider } = setup({ structure: false, polish: false, facts: false, challenge: true });
    await flush();
    expect(passes(provider)).toEqual(['C']);
  });

  it('Polish and Structure split the clarity kinds', () => {
    const polishOnly = clarityKindFilter({ ...ALL_CHECKS, structure: false });
    expect(polishOnly('fuzzy')).toBe(true);
    expect(polishOnly('structure')).toBe(false);
    const structureOnly = clarityKindFilter({ ...ALL_CHECKS, polish: false });
    expect(structureOnly('unsupported_leap')).toBe(true);
    expect(structureOnly('hedge')).toBe(false);
  });

  it('turning a check off prunes at once and needs no run; turning one on makes the next run full', async () => {
    const { orch, provider, states } = setup({ ...ALL_CHECKS });
    await flush();
    expect(orch.state.challenges.length).toBe(4);
    const before = provider.calls.length;
    const off = { ...ALL_CHECKS, challenge: false, facts: false };
    orch.setChecks(off);
    expect(orch.state.challenges).toEqual([]);
    expect(orch.state.claims).toEqual([]);
    expect(orch.state.argument).toBeTruthy(); // Structure is still on
    expect(states.at(-1)!.checks).toEqual(off);
    expect(states.at(-1)!.analyzedChecks).toEqual(off); // the screen reflects exactly the reduced set
    await orch.run();
    await flush();
    expect(provider.calls.length).toBe(before); // same text, nothing turned on: nothing to do
    // Facts back on: the screen no longer reflects the set, so an unforced run is a full one.
    orch.setChecks({ ...off, facts: true });
    expect(states.at(-1)!.analyzedChecks).toEqual(off);
    await orch.run();
    await flush();
    const ran = passes(provider).slice(before);
    expect(ran).toEqual(expect.arrayContaining(['A', 'C']));
    expect(ran).not.toContain('B'); // the first run's verdicts are still in the claim cache
    expect(provider.calls.slice(before).find((c) => c.pass === 'C')!.research).toBeUndefined(); // thesis-only: Challenge is off
    expect(orch.state.claims.length).toBeGreaterThan(0);
    expect(orch.state.claims.every((c) => c.data.verdict)).toBe(true);
    expect(orch.state.challenges).toEqual([]);
    expect(orch.state.analyzedChecks).toEqual({ ...off, facts: true });
  });

  it('turning every check off prunes everything and runs nothing', async () => {
    const { orch, provider } = setup({ ...ALL_CHECKS });
    await flush();
    orch.setChecks({ structure: false, polish: false, facts: false, challenge: false });
    expect(orch.state.clarity).toEqual([]);
    expect(orch.state.argument).toBeUndefined();
    const before = provider.calls.length;
    await orch.run();
    await flush();
    expect(provider.calls.length).toBe(before);
  });
});

describe('pass builders and checks', () => {
  const snap = snapshotFromText(SAMPLE_TEXT);
  it('tell A to skip the part that is off', () => {
    expect(buildPassA(snap, { effort: 'low' }).user).not.toMatch(/Skip/);
    expect(buildPassA(snap, { effort: 'low', clarity: false }).user).toMatch(/empty clarity array/);
    expect(buildPassA(snap, { effort: 'low', claims: false }).user).toMatch(/empty claims array/);
  });
  it('build a thesis-only C with no research and low effort', () => {
    const full = buildPassC(snap, { effort: 'high', blockedDomains: [] });
    const thesis = buildPassC(snap, { effort: 'high', blockedDomains: [], thesisOnly: true });
    expect(full.research).toBeDefined();
    expect(thesis.research).toBeUndefined();
    expect(thesis.effort).toBe('low');
    expect(thesis.schema.safeParse({ thesis: 't', premises: [], challenges: [] }).success).toBe(true);
    expect(full.schema.safeParse({ thesis: 't', premises: [], challenges: [] }).success).toBe(false);
  });
});
