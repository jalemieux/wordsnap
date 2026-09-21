// chrome.runtime.onConnect handler: one port per composer session from the content script.
import { log } from '../shared/log';
import { createProvider, providerReady } from '../providers';
import type { LLMProvider } from '../providers/types';
import { PORT_NAME, type BackgroundToContent, type ContentToBackground } from '../shared/messages';
import type { Settings } from '../shared/types';
import type { ClaimCache } from './cache';
import { SessionOrchestrator } from './orchestrator';
import type { SavedSession } from './session';
import type { SettingsStore } from './settings';
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
  key: (sessionKey: string) => `session:${sessionKey}`,
  async get(sessionKey: string): Promise<SavedSession | undefined> {
    try {
      const res = await chrome.storage.session?.get(this.key(sessionKey));
      return res?.[this.key(sessionKey)] as SavedSession | undefined;
    } catch {
      return undefined;
    }
  },
  async set(sessionKey: string, saved: SavedSession): Promise<void> {
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

export function registerPortHandler(store: SettingsStore, cache: ClaimCache): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const sessions = new Map<string, SessionOrchestrator>();
    const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const persist = (sessionKey: string) => {
      // Trailing debounce: emits come in bursts during a run.
      const prev = saveTimers.get(sessionKey);
      if (prev) clearTimeout(prev);
      saveTimers.set(
        sessionKey,
        setTimeout(() => {
          saveTimers.delete(sessionKey);
          const orch = sessions.get(sessionKey);
          if (orch) void sessionStore.set(sessionKey, orch.dump());
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
            const orch = new SessionOrchestrator(raw.sessionKey, raw.host, {
              provider: () => holder.get(),
              settings: () => settings!,
              cache,
              persistChecks: (checks) => {
                void store.set({ checks }).then((s) => {
                  settings = s;
                });
              },
              emit: (state) => {
                send({ type: 'session/state', sessionKey: raw.sessionKey, state });
                persist(raw.sessionKey);
              },
              onCost: (usd) => void store.addCost(usd),
              context: { platform: raw.platform.kind },
            });
            const saved = await sessionStore.get(raw.sessionKey);
            if (saved) orch.restore(saved);
            sessions.set(raw.sessionKey, orch);
            log.info(`session ${raw.sessionKey} open (${raw.host}, provider ${settings.provider}${saved ? ', restored after a worker restart' : ''})`);
            send({ type: 'session/config', sessionKey: raw.sessionKey, autoAnalyze: settings.autoAnalyze });
            send({ type: 'session/state', sessionKey: raw.sessionKey, state: orch.state });
            return;
          }
          case 'session/snapshot': {
            const orch = sessions.get(raw.sessionKey);
            if (!orch) {
              send({ type: 'session/error', sessionKey: raw.sessionKey, message: 'Session not open' });
              return;
            }
            log.info(`session ${raw.sessionKey}: snapshot v${raw.snapshot.version} (${raw.snapshot.text.split(/\s+/).filter(Boolean).length} words, ${raw.reason})`);
            orch.handleSnapshot(raw.snapshot, raw.reason === 'initial');
            return;
          }
          case 'finding/action': {
            sessions.get(raw.sessionKey)?.handleAction(raw.findingId, raw.action);
            return;
          }
          case 'session/recheck': {
            log.info(`session ${raw.sessionKey}: re-check after a change to ${raw.findingId}`);
            sessions.get(raw.sessionKey)?.recheck(raw.findingId);
            return;
          }
          case 'structure/action': {
            log.info(`session ${raw.sessionKey}: structure ${raw.action}`);
            sessions.get(raw.sessionKey)?.handleStructureAction(raw.action);
            return;
          }
          case 'session/checks': {
            settings = await store.set({ checks: raw.checks });
            sessions.get(raw.sessionKey)?.setChecks(raw.checks);
            return;
          }
          case 'session/analyze': {
            const orch = sessions.get(raw.sessionKey);
            if (!orch) {
              send({ type: 'session/error', sessionKey: raw.sessionKey, message: 'Session not open' });
              return;
            }
            log.info(`session ${raw.sessionKey}: re-analyze requested`);
            orch.analyzeNow();
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
