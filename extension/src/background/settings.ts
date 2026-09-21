import { DEFAULT_CHECKS, DEFAULT_SETTINGS, SUPPORTED_MODEL, SUPPORTED_PROVIDER_ORDER, type Settings } from '../shared/types';
import type { KeyValueStorage } from './storage';

export const SETTINGS_KEY = 'settings';

export class SettingsStore {
  private cache: Settings | null = null;
  private listeners = new Set<(s: Settings) => void>();

  constructor(private readonly storage: KeyValueStorage) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    const stored = (await this.storage.get<Partial<Settings>>(SETTINGS_KEY)) ?? {};
    this.cache = mergeSettings(stored);
    return this.cache;
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next = mergeSettings({ ...current, ...patch, enabledHosts: { ...current.enabledHosts, ...(patch.enabledHosts ?? {}) }, effort: { ...current.effort, ...(patch.effort ?? {}) }, openrouter: { ...current.openrouter, ...(patch.openrouter ?? {}) }, checks: { ...current.checks, ...(patch.checks ?? {}) } });
    this.cache = next;
    await this.storage.set(SETTINGS_KEY, next);
    for (const l of this.listeners) l(next);
    return next;
  }

  async addCost(usd: number): Promise<void> {
    const current = await this.get();
    await this.set({ lifetimeCostUsd: Math.round((current.lifetimeCostUsd + usd) * 1e6) / 1e6 });
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Drop the in-memory copy (e.g. after chrome.storage.onChanged from another context). */
  invalidate(): void {
    this.cache = null;
  }
}

/**
 * Fill defaults and pin what this build supports: OpenRouter serving z-ai/glm-5.2 from Z.AI with no fallbacks. A stored
 * 'claude' provider (from an earlier build) becomes OpenRouter; its key stays in `apiKey`, unused. The mock provider is
 * left alone so dev builds and tests keep working.
 */
export function mergeSettings(partial: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    provider: partial.provider === 'mock' ? 'mock' : 'openrouter',
    enabledHosts: { ...DEFAULT_SETTINGS.enabledHosts, ...(partial.enabledHosts ?? {}) },
    effort: { ...DEFAULT_SETTINGS.effort, ...(partial.effort ?? {}) },
    checks: { ...DEFAULT_CHECKS, ...(partial.checks ?? {}) },
    blockedDomains: Array.isArray(partial.blockedDomains) ? partial.blockedDomains : [],
    sites: Array.isArray(partial.sites) ? [...new Set(partial.sites.filter((o): o is string => typeof o === 'string' && o.length > 0))].sort() : [],
    apiKey: typeof partial.apiKey === 'string' ? partial.apiKey : '',
    model: partial.model || DEFAULT_SETTINGS.model,
    openrouter: {
      ...DEFAULT_SETTINGS.openrouter,
      ...(partial.openrouter ?? {}),
      model: SUPPORTED_MODEL,
      providerOrder: [...SUPPORTED_PROVIDER_ORDER],
      allowFallbacks: false,
    },
  };
}
