import { describe, expect, it } from 'vitest';
import { ClaimCache } from '../../src/background/cache';
import { handleOptionsRequest } from '../../src/background/options-handler';
import { SettingsStore, mergeSettings } from '../../src/background/settings';
import { MemoryStorage } from '../../src/background/storage';
import { createProvider, providerReady } from '../../src/providers';
import { DEFAULT_SETTINGS, SUPPORTED_MODEL } from '../../src/shared/types';

describe('mergeSettings pins the supported provider and model', () => {
  it('forces OpenRouter on z-ai/glm-5.2 served by Z.AI without fallbacks', () => {
    const s = mergeSettings({ openrouter: { apiKey: 'sk-or-v1-x', model: 'openai/gpt-5', providerOrder: [], allowFallbacks: true, webResults: 8 } });
    expect(s.provider).toBe('openrouter');
    expect(s.openrouter.model).toBe(SUPPORTED_MODEL);
    expect(s.openrouter.providerOrder).toEqual(['z-ai']);
    expect(s.openrouter.allowFallbacks).toBe(false);
    expect(s.openrouter.webResults).toBe(8);
    expect(s.openrouter.apiKey).toBe('sk-or-v1-x');
  });

  it('maps a stored Claude provider back to OpenRouter and leaves that key unused', () => {
    const s = mergeSettings({ provider: 'claude', apiKey: 'sk-ant-x', model: 'claude-opus-5' });
    expect(s.provider).toBe('openrouter');
    expect(providerReady(s)).toBe(false);
    expect(createProvider(s).id).toBe('openrouter');
  });

  it('keeps the mock provider for dev builds', () => {
    expect(mergeSettings({ provider: 'mock' }).provider).toBe('mock');
  });

  it('normalizes through the store on write', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const s = await store.set({ openrouter: { ...DEFAULT_SETTINGS.openrouter, model: 'anthropic/claude-opus-5' } });
    expect(s.openrouter.model).toBe(SUPPORTED_MODEL);
  });
});

describe('settings/validateKey', () => {
  it('refuses Anthropic keys without calling any provider', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const r = await handleOptionsRequest({ type: 'settings/validateKey', provider: 'claude', apiKey: 'sk-ant-x' }, store, new ClaimCache(new MemoryStorage()));
    expect(r.type === 'validateKey' && !r.ok && /OpenRouter/.test(r.error) && r.hint === undefined).toBe(true);
  });
});
