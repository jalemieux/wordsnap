// chrome.runtime.onConnect handler: one port per composer session from the content script.
import { log } from '../shared/log';
import { createProvider, providerReady } from '../providers';
import type { LLMProvider } from '../providers/types';
import { PORT_NAME, type BackgroundToContent, type ContentToBackground } from '../shared/messages';
import type { Settings } from '../shared/types';
import type { ClaimCache } from './cache';
import { CowriterSession, type SavedCowriter } from './cowriter';
import { tuneFor, type SettingsStore } from './settings';
import { serialQueue } from './queue';

export class ProviderHolder {
  private provider: LLMProvider | null = null;
  private forKey = '';
  constructor(private readonly settings: () => Settings) {}
  get(): LLMProvider {
    const s = this.settings();
    const key = `${s.provider}|${s.apiKey}|${s.model}|${s.workspaceId}`;
    if (!this.provider || key !== this.forKey) {
      this.provider = createProvider(s);
      this.forKey = key;
    }
    return this.provider;
  }
}

/** Session state outlives the service worker in chrome.storage.session (cleared when the browser closes). */
const sessionStore = {
  // A different key from the critique build's sessions, so none of those is ever read back.
  key: (sessionKey: string) => `cowriter:${sessionKey}`,
  async get(sessionKey: string): Promise<SavedCowriter | undefined> {
    try {
      const res = await chrome.storage.session?.get(this.key(sessionKey));
      return res?.[this.key(sessionKey)] as SavedCowriter | undefined;
    } catch {
      return undefined;
    }
  },
  async set(sessionKey: string, saved: SavedCowriter): Promise<void> {
    try {
      await chrome.storage.session?.set({ [this.key(sessionKey)]: saved });
    } catch {
      /* quota or no session storage: the session just will not survive a worker restart */
    }
  },
  async remove(sessionKey: string): Promise<void> {
    try {
      await chrome.storage.session?.remove(this.key(sessionKey));
    } catch {
      /* ignore */
    }
  },
};

/** One port message to the session it is for. Pure routing; nothing here decides to run a model. */
export async function routeMessage(s: CowriterSession, m: ContentToBackground): Promise<void> {
  switch (m.type) {
    case 'session/snapshot':
      return s.handleSnapshot(m.snapshot);
    case 'tune/set':
      return s.setTune(m.tune);
    case 'shape/run':
      return s.shape();
    case 'shape/flip':
      return s.flip(m.choice);
    case 'shape/fill':
      return s.fill(m.gap);
    case 'shape/action':
      return s.shapeAction(m.action);
    case 'tweak/run':
      return s.tweak({ id: m.id, quote: m.quote, span: m.span, instruction: m.instruction, mode: m.mode });
    case 'tweak/action':
      return s.tweakAction(m.id, m.action);
    default:
      return;
  }
}

export function registerPortHandler(store: SettingsStore, _cache?: ClaimCache): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const sessions = new Map<string, CowriterSession>();
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const persist = (sessionKey: string) => {
      // Trailing debounce: emits come in bursts during a request.
      const prev = saveTimers.get(sessionKey);
      if (prev) clearTimeout(prev);
      saveTimers.set(
        sessionKey,
        setTimeout(() => {
          saveTimers.delete(sessionKey);
          const s = sessions.get(sessionKey);
          if (s) void sessionStore.set(sessionKey, s.dump());
        }, 250),
      );
    };
    let settings: Settings | null = null;
    const holder = new ProviderHolder(() => settings!);
    const unsubscribe = store.onChange((s) => {
      settings = s;
    });

    const send = (msg: BackgroundToContent) => {
      try {
        port.postMessage(msg);
      } catch {
        /* port gone */
      }
    };

    // One message at a time, in arrival order: `session/open` must finish before the snapshot sent right behind it.
    // Model requests are not awaited in the queue: a shape can take a minute and must not hold up the next snapshot.
    const enqueue = serialQueue((err) => log.error('port handler failed:', err));
    port.onMessage.addListener((raw: ContentToBackground) => {
      enqueue(async () => {
        settings = await store.get();
        switch (raw.type) {
          case 'session/open': {
            if (!settings.enabledHosts[raw.host]) {
              send({ type: 'session/disabled', sessionKey: raw.sessionKey, reason: 'host-disabled' });
              return;
            }
            if (!providerReady(settings)) {
              log.warn(`session ${raw.sessionKey} refused: provider ${settings.provider} has no credential`);
              send({ type: 'session/disabled', sessionKey: raw.sessionKey, reason: 'no-key' });
              return;
            }
            if (sessions.has(raw.sessionKey)) return;
            const origin = raw.origin ?? '';
            const s = new CowriterSession(raw.sessionKey, raw.host, {
              provider: () => holder.get(),
              settings: () => settings!,
              tune: tuneFor(settings, origin),
              onTune: (tune) => {
                if (!origin) return;
                void store.set({ tune: { [origin]: tune } }).then((next) => {
                  settings = next;
                });
              },
              onCost: (usd) => void store.addCost(usd),
              emit: (state) => {
                send({ type: 'session/state', sessionKey: raw.sessionKey, state });
                persist(raw.sessionKey);
              },
              trace: __WORDSNAP_DEV__,
            });
            const saved = await sessionStore.get(raw.sessionKey);
            const restored = saved ? s.restore(saved) : false;
            sessions.set(raw.sessionKey, s);
            log.info(`session ${raw.sessionKey} open (${raw.host}, provider ${settings.provider}${restored ? ', restored after a worker restart' : ''})`);
            send({ type: 'session/state', sessionKey: raw.sessionKey, state: s.state });
            return;
          }
          case 'session/ping':
            return;
          case 'session/close': {
            sessions.get(raw.sessionKey)?.close();
            sessions.delete(raw.sessionKey);
            const t = saveTimers.get(raw.sessionKey);
            if (t) clearTimeout(t);
            saveTimers.delete(raw.sessionKey);
            void sessionStore.remove(raw.sessionKey);
            return;
          }
          default: {
            const s = sessions.get(raw.sessionKey);
            if (!s) {
              send({ type: 'session/error', sessionKey: raw.sessionKey, message: 'Session not open' });
              return;
            }
            log.info(`session ${raw.sessionKey}: ${raw.type}`);
            void routeMessage(s, raw);
            return;
          }
        }
      });
    });

    port.onDisconnect.addListener(() => {
      for (const s of sessions.values()) s.close();
      sessions.clear();
      unsubscribe();
    });
  });
}
