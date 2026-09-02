import type { Settings } from '../shared/types';
import { ClaudeProvider } from './claude';
import { MockProvider } from './mock';
import type { LLMProvider } from './types';

export function createProvider(settings: Settings): LLMProvider {
  if (settings.provider === 'mock') return new MockProvider();
  return new ClaudeProvider({ apiKey: settings.apiKey, model: settings.model, workspaceId: settings.workspaceId || undefined });
}

export function providerReady(settings: Settings): boolean {
  return settings.provider === 'mock' || settings.apiKey.trim().length > 0;
}
