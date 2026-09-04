// Tiny storage seam so session/orchestrator/cache never touch chrome.* directly.
export interface KeyValueStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class ChromeLocalStorage implements KeyValueStorage {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}

/**
 * chrome.storage.session when the browser has it (cleared when the browser closes), chrome.storage.local otherwise.
 * For state that should not outlive the browser but must outlive the background page, such as a pending sign-in.
 */
export class ChromeSessionStorage implements KeyValueStorage {
  private get area(): chrome.storage.StorageArea {
    return chrome.storage.session ?? chrome.storage.local;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const res = await this.area.get(key);
    return res[key] as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    await this.area.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }
}
