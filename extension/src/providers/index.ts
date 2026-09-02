import type { Settings } from '../shared/types';
import { ClaudeProvider } from './claude';
import { MockProvider } from './mock';
import { OpenRouterProvider } from './openrouter';
import type { LLMProvider } from './types';

export function createProvider(settings: Settings): LLMProvider {
  if (settings.provider === 'mock') return new MockProvider();
  if (settings.provider === 'openrouter') {
    const o = settings.openrouter;
    return new OpenRouterProvider({ apiKey: o.apiKey, model: o.model, providerOrder: o.providerOrder, allowFallbacks: o.allowFallbacks, webResults: o.webResults });
  }
  return new ClaudeProvider({ apiKey: settings.apiKey, model: settings.model, workspaceId: settings.workspaceId || undefined });
}

export function providerReady(settings: Settings): boolean {
  if (settings.provider === 'mock') return true;
  if (settings.provider === 'openrouter') return settings.openrouter.apiKey.trim().length > 0;
  return settings.apiKey.trim().length > 0;
}
