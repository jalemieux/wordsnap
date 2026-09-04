// chrome.runtime.onConnect handler: one port per composer session from the content script.
import { log } from '../shared/log';
import { createProvider, providerReady } from '../providers';
import type { LLMProvider } from '../providers/types';
import { PORT_NAME, type BackgroundToContent, type ContentToBackground } from '../shared/messages';
import type { Settings } from '../shared/types';
import type { ClaimCache } from './cache';
import { SessionOrchestrator } from './orchestrator';
import type { SettingsStore } from './settings';

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

export function registerPortHandler(store: SettingsStore, cache: ClaimCache): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const sessions = new Map<string, SessionOrchestrator>();
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

    port.onMessage.addListener((raw: ContentToBackground) => {
      void (async () => {
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
              emit: (state) => send({ type: 'session/state', sessionKey: raw.sessionKey, state }),
              onCost: (usd) => void store.addCost(usd),
              context: { platform: raw.platform.kind },
            });
            sessions.set(raw.sessionKey, orch);
            log.info(`session ${raw.sessionKey} open (${raw.host}, provider ${settings.provider})`);
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
          case 'session/close': {
            sessions.get(raw.sessionKey)?.close();
            sessions.delete(raw.sessionKey);
            return;
          }
        }
      })();
    });

    port.onDisconnect.addListener(() => {
      for (const s of sessions.values()) s.close();
      sessions.clear();
      unsubscribe();
    });
  });
}
