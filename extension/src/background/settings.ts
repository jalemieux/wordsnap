import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
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
    const next = mergeSettings({ ...current, ...patch, enabledHosts: { ...current.enabledHosts, ...(patch.enabledHosts ?? {}) }, effort: { ...current.effort, ...(patch.effort ?? {}) }, openrouter: { ...current.openrouter, ...(patch.openrouter ?? {}) } });
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

export function mergeSettings(partial: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    enabledHosts: { ...DEFAULT_SETTINGS.enabledHosts, ...(partial.enabledHosts ?? {}) },
    effort: { ...DEFAULT_SETTINGS.effort, ...(partial.effort ?? {}) },
    blockedDomains: Array.isArray(partial.blockedDomains) ? partial.blockedDomains : [],
    apiKey: typeof partial.apiKey === 'string' ? partial.apiKey : '',
    model: partial.model || DEFAULT_SETTINGS.model,
    openrouter: { ...DEFAULT_SETTINGS.openrouter, ...(partial.openrouter ?? {}) },
  };
}
