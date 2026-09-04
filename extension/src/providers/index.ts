import type { Settings } from '../shared/types';
import { MockProvider } from './mock';
import { OpenRouterProvider } from './openrouter';
import type { LLMProvider } from './types';

/**
 * OpenRouter or, in dev builds, the mock. The Claude provider (./claude) is not wired: this build is validated against
 * z-ai/glm-5.2 only, and mergeSettings never yields provider 'claude'.
 */
export function createProvider(settings: Settings): LLMProvider {
  if (settings.provider === 'mock') return new MockProvider();
  const o = settings.openrouter;
  return new OpenRouterProvider({ apiKey: o.apiKey, model: o.model, providerOrder: o.providerOrder, allowFallbacks: o.allowFallbacks, webResults: o.webResults });
}

export function providerReady(settings: Settings): boolean {
  if (settings.provider === 'mock') return true;
  if (settings.provider === 'openrouter') return settings.openrouter.apiKey.trim().length > 0;
  return false;
}
