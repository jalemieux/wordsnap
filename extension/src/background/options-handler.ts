// chrome.runtime.onMessage handler for the options page.
import { ClaudeProvider } from '../providers/claude';
import { createProvider } from '../providers';
import { ProviderError } from '../providers/types';
import { snapshotFromText } from '../shared/anchoring';
import type { OptionsRequest, OptionsResponse } from '../shared/messages';
import { SAMPLE_SUBJECT, SAMPLE_TEXT } from '../shared/sample';
import type { SessionState } from '../shared/types';
import type { ClaimCache } from './cache';
import { SessionOrchestrator } from './orchestrator';
import type { SettingsStore } from './settings';

export async function handleOptionsRequest(req: OptionsRequest, store: SettingsStore, cache: ClaimCache): Promise<OptionsResponse> {
  switch (req.type) {
    case 'settings/get':
      return { type: 'settings', settings: await store.get() };
    case 'settings/set':
      return { type: 'settings', settings: await store.set(req.patch) };
    case 'settings/validateKey': {
      const provider = new ClaudeProvider({ apiKey: req.apiKey, model: 'claude-opus-5', workspaceId: req.workspaceId || undefined });
      try {
        const models = await provider.listModels();
        return { type: 'validateKey', ok: true, models };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : String(err), 'unknown');
        const hint = pe.kind === 'auth' ? 'auth' : pe.kind === 'workspace' ? 'workspace' : pe.kind === 'billing' ? 'billing' : pe.kind === 'network' ? 'network' : undefined;
        return { type: 'validateKey', ok: false, error: pe.message, hint };
      }
    }
    case 'sample/run':
      return { type: 'sample', state: await runSample(store, cache) };
  }
}

/** Runs all three passes on the sample draft with the configured provider. Resolves when every pass has settled. */
export async function runSample(store: SettingsStore, cache: ClaimCache): Promise<SessionState> {
  const settings = await store.get();
  const provider = createProvider(settings);
  let latest: SessionState | null = null;
  const orch = new SessionOrchestrator('sample', 'generic', {
    provider: () => provider,
    settings: () => settings,
    cache,
    emit: (s) => {
      latest = s;
    },
    onCost: (usd) => void store.addCost(usd),
    context: { platform: 'email', subject: SAMPLE_SUBJECT },
  });
  orch.session.applySnapshot(snapshotFromText(SAMPLE_TEXT));
  await orch.run();
  const state = latest ?? orch.state;
  orch.close();
  return state;
}

export function registerOptionsHandler(store: SettingsStore, cache: ClaimCache): void {
  chrome.runtime.onMessage.addListener((raw: OptionsRequest, _sender, sendResponse: (r: OptionsResponse) => void) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return false;
    handleOptionsRequest(raw, store, cache)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
    return true; // async response
  });
}
