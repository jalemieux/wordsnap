// An in-page stand-in for the chrome.* surface WordSnap uses, so the background and the content script can run in
// one ordinary web page (the playground). Ports are pairs of in-memory objects, storage.local is localStorage,
// storage.session is a Map, and everything that needs a real browser (tabs, scripting, permissions, identity) is a
// harmless no-op. Messages are JSON round-tripped on the way across, as Chrome serializes them.
//
// Only the playground imports this. It never ships in the extension.

type Listener = (...args: unknown[]) => unknown;

class ShimEvent {
  private readonly listeners = new Set<Listener>();
  addListener(cb: Listener): void {
    this.listeners.add(cb);
  }
  removeListener(cb: Listener): void {
    this.listeners.delete(cb);
  }
  hasListener(cb: Listener): boolean {
    return this.listeners.has(cb);
  }
  hasListeners(): boolean {
    return this.listeners.size > 0;
  }
  emit(...args: unknown[]): unknown[] {
    return Array.from(this.listeners).map((cb) => cb(...args));
  }
}

export type TrafficDirection = 'content->background' | 'background->content';
export interface Traffic {
  at: number;
  direction: TrafficDirection;
  message: unknown;
}
type TrafficListener = (t: Traffic) => void;
const trafficListeners = new Set<TrafficListener>();
function tap(direction: TrafficDirection, message: unknown): void {
  const t = { at: Date.now(), direction, message };
  for (const cb of trafficListeners) cb(t);
}

function clone<T>(value: T): T {
  // The same serialization boundary a real port has. Chrome JSON-serializes runtime messages: `undefined` is dropped,
  // a DOM node (the content script's snapshots carry text nodes in their offset maps) becomes `{}`. structuredClone
  // would throw on that node, so it is the wrong emulation here.
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

class ShimPort {
  readonly onMessage = new ShimEvent();
  readonly onDisconnect = new ShimEvent();
  peer!: ShimPort;
  private connected = true;
  constructor(
    readonly name: string,
    private readonly direction: TrafficDirection,
  ) {}
  postMessage(message: unknown): void {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    const copy = clone(message);
    tap(this.direction, copy);
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer.connected) peer.onMessage.emit(copy, peer);
    });
  }
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    const peer = this.peer;
    if (peer.connected) {
      peer.connected = false;
      queueMicrotask(() => peer.onDisconnect.emit(peer));
    }
  }
}

type Items = Record<string, unknown>;
type Keys = string | string[] | Items | null | undefined;

/** A chrome.storage.StorageArea over a Map, with onChanged plumbing. Subclasses decide what backs the map. */
class ShimStorageArea {
  constructor(
    private readonly areaName: 'local' | 'session',
    private readonly load: () => Map<string, unknown>,
    private readonly save: (map: Map<string, unknown>) => void,
    private readonly onChanged: ShimEvent,
  ) {}
  async get(keys?: Keys): Promise<Items> {
    const map = this.load();
    const out: Items = {};
    if (keys === null || keys === undefined) {
      for (const [k, v] of map) out[k] = clone(v);
      return out;
    }
    if (typeof keys === 'string') {
      if (map.has(keys)) out[keys] = clone(map.get(keys));
      return out;
    }
    if (Array.isArray(keys)) {
      for (const k of keys) if (map.has(k)) out[k] = clone(map.get(k));
      return out;
    }
    for (const [k, fallback] of Object.entries(keys)) out[k] = map.has(k) ? clone(map.get(k)) : fallback;
    return out;
  }
  async set(items: Items): Promise<void> {
    const map = this.load();
    const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: map.has(k) ? clone(map.get(k)) : undefined, newValue: clone(v) };
      map.set(k, clone(v));
    }
    this.save(map);
    this.fire(changes);
  }
  async remove(keys: string | string[]): Promise<void> {
    const map = this.load();
    const changes: Record<string, { oldValue?: unknown }> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (!map.has(k)) continue;
      changes[k] = { oldValue: clone(map.get(k)) };
      map.delete(k);
    }
    this.save(map);
    if (Object.keys(changes).length) this.fire(changes);
  }
  async clear(): Promise<void> {
    const map = this.load();
    await this.remove(Array.from(map.keys()));
  }
  private fire(changes: Record<string, unknown>): void {
    // Real Chrome fires onChanged asynchronously, in every context including the writer's.
    queueMicrotask(() => this.onChanged.emit(changes, this.areaName));
  }
}

export const LOCAL_STORAGE_PREFIX = 'wordsnap-playground:';

function localStorageMap(): Map<string, unknown> {
  const map = new Map<string, unknown>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_STORAGE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        map.set(key.slice(LOCAL_STORAGE_PREFIX.length), JSON.parse(raw));
      } catch {
        /* a value another tool wrote; skip */
      }
    }
  } catch {
    /* no localStorage (a unit test without a DOM): stays empty, writes below are no-ops */
  }
  return map;
}

function saveLocalStorageMap(map: Map<string, unknown>): void {
  try {
    const keep = new Set(Array.from(map.keys()).map((k) => LOCAL_STORAGE_PREFIX + k));
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_STORAGE_PREFIX) && !keep.has(key)) localStorage.removeItem(key);
    }
    for (const [k, v] of map) localStorage.setItem(LOCAL_STORAGE_PREFIX + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export interface ShimOptions {
  /** Backing for storage.local. Defaults to localStorage under LOCAL_STORAGE_PREFIX; a Map keeps it in memory. */
  local?: Map<string, unknown>;
  manifest?: Partial<chrome.runtime.ManifestV3>;
}

export interface ChromeShim {
  chrome: typeof chrome;
  /** Every message that crosses a port, for the playground's inspector. */
  onTraffic(cb: TrafficListener): () => void;
  /** Ports currently open (content side), for the inspector. */
  openPorts(): number;
}

/**
 * Build the shim and install it as `globalThis.chrome`. Call before importing anything from src/background or
 * src/content: both register their listeners at import time.
 */
export function installChromeShim(opts: ShimOptions = {}): ChromeShim {
  const localOnChanged = new ShimEvent();
  const localMap = opts.local;
  const local = new ShimStorageArea(
    'local',
    localMap ? () => localMap : localStorageMap,
    localMap ? () => {} : saveLocalStorageMap,
    localOnChanged,
  );
  const sessionMap = new Map<string, unknown>();
  const session = new ShimStorageArea('session', () => sessionMap, () => {}, localOnChanged);

  const onConnect = new ShimEvent();
  const onMessage = new ShimEvent();
  const ports = new Set<ShimPort>();

  const manifest: chrome.runtime.ManifestV3 = {
    manifest_version: 3,
    name: 'WordSnap (playground)',
    version: '0.0.0',
    content_scripts: [],
    ...opts.manifest,
  };

  const runtime = {
    id: 'playground',
    lastError: undefined as { message: string } | undefined,
    onConnect,
    onMessage,
    onInstalled: new ShimEvent(),
    onStartup: new ShimEvent(),
    getManifest: () => manifest,
    getURL: (p: string) => (typeof location === 'undefined' ? p : new URL(p, location.href).toString()),
    openOptionsPage: async () => {
      window.open('/options', '_blank');
    },
    connect(info?: { name?: string }): ShimPort {
      const name = info?.name ?? '';
      const contentSide = new ShimPort(name, 'content->background');
      const backgroundSide = new ShimPort(name, 'background->content');
      contentSide.peer = backgroundSide;
      backgroundSide.peer = contentSide;
      ports.add(contentSide);
      contentSide.onDisconnect.addListener(() => ports.delete(contentSide));
      backgroundSide.onDisconnect.addListener(() => ports.delete(contentSide));
      // Synchronous, unlike Chrome, so the background's port listeners exist before the first message lands.
      onConnect.emit(backgroundSide);
      return contentSide;
    },
    sendMessage(message: unknown, callback?: (response: unknown) => void): Promise<unknown> | undefined {
      const copy = clone(message);
      const sender = { id: 'playground', url: typeof location === 'undefined' ? '' : location.href };
      const promise = new Promise<unknown>((resolve) => {
        let settled = false;
        const respond = (response: unknown) => {
          if (settled) return;
          settled = true;
          resolve(response === undefined ? undefined : clone(response));
        };
        setTimeout(() => {
          const results = onMessage.emit(copy, sender, respond);
          // No listener kept the channel open: the answer is undefined, as in Chrome.
          if (!results.some((r) => r === true)) respond(undefined);
        }, 0);
      });
      if (callback) {
        void promise.then((r) => callback(r));
        return undefined;
      }
      return promise;
    },
  };

  const noop = async () => {};
  const shim = {
    runtime,
    storage: { local, session, onChanged: localOnChanged },
    tabs: {
      query: async () => [],
      get: async () => undefined,
      create: async (props: { url?: string }) => {
        if (props.url) window.open(props.url, '_blank');
        return { id: -1 };
      },
      remove: noop,
      sendMessage: async () => undefined,
      onUpdated: new ShimEvent(),
      onRemoved: new ShimEvent(),
    },
    scripting: {
      executeScript: async () => [],
      registerContentScripts: noop,
      unregisterContentScripts: noop,
      getRegisteredContentScripts: async () => [],
    },
    permissions: {
      contains: async () => false,
      request: async () => false,
      remove: async () => true,
    },
    // No `identity`: sign-in takes the tab path, which needs a real browser. Paste a key in the playground instead.
  };

  (globalThis as { chrome?: unknown }).chrome = shim;
  return {
    chrome: shim as unknown as typeof chrome,
    onTraffic(cb) {
      trafficListeners.add(cb);
      return () => trafficListeners.delete(cb);
    },
    openPorts: () => ports.size,
  };
}
