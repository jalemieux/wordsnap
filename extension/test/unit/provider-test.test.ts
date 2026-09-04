import { testProvider } from '../../src/background/options-handler';
import { SettingsStore } from '../../src/background/settings';
import { MemoryStorage } from '../../src/background/storage';
import { MockProvider } from '../../src/providers/mock';
import { ProviderError, type LLMProvider } from '../../src/providers/types';
import { DEFAULT_OPENROUTER } from '../../src/shared/types';

function failing(err: Error): LLMProvider {
  const inner = new MockProvider({ delayMs: 0 });
  return { ...inner, id: 'mock', listModels: () => inner.listModels(), runPass: (r, s, e) => inner.runPass(r, s, e), probe: () => Promise.reject(err) };
}

describe('testProvider', () => {
  it('answers with the model and the elapsed time, and records onboarding as done', async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.set({ provider: 'openrouter', openrouter: { apiKey: 'sk-or-v1-x', model: 'z-ai/glm-5.2', providerOrder: ['z-ai'], allowFallbacks: false, webResults: 5 } });
    let clock = 1000;
    const r = await testProvider(store, { provider: () => new MockProvider({ delayMs: 0 }), now: () => (clock += 700) });
    expect(r).toEqual({ type: 'test', ok: true, model: 'z-ai/glm-5.2', ms: 700 });
    expect((await store.get()).onboarded).toBe(true);
  });

  it('refuses to run without a key and leaves onboarding open', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const r = await testProvider(store, { provider: () => new MockProvider({ delayMs: 0 }) });
    expect(r).toEqual({ type: 'test', ok: false, error: 'No key is configured.', hint: 'auth' });
    expect((await store.get()).onboarded).toBe(false);
  });

  it('maps provider errors to hints and does not mark onboarding done', async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.set({ provider: 'openrouter', openrouter: { ...DEFAULT_OPENROUTER, apiKey: 'sk-or-v1-x' } });
    const r = await testProvider(store, { provider: () => failing(new ProviderError('Billing is not set up for this key', 'billing')) });
    expect(r).toEqual({ type: 'test', ok: false, error: 'Billing is not set up for this key', hint: 'billing' });
    expect((await store.get()).onboarded).toBe(false);
  });

  it('reports a timeout as a network problem naming the model', async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.set({ provider: 'openrouter', openrouter: { ...DEFAULT_OPENROUTER, apiKey: 'sk-or-v1-x' } });
    const timeout = new Error('signal timed out');
    timeout.name = 'TimeoutError';
    const r = await testProvider(store, { provider: () => failing(timeout) });
    expect(r.type === 'test' && !r.ok && r.hint === 'network' && /z-ai\/glm-5.2 did not answer/.test(r.error)).toBe(true);
  });

  it('uses the mock provider without a key', async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.set({ provider: 'mock' });
    const r = await testProvider(store, { provider: () => new MockProvider({ delayMs: 0 }) });
    expect(r.type === 'test' && r.ok && r.model === 'mock').toBe(true);
    expect((await store.get()).onboarded).toBe(true);
  });
});
