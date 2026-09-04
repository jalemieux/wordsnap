// chrome.runtime.onMessage handler for the options page.
import { ClaudeProvider } from '../providers/claude';
import { createProvider, providerReady } from '../providers';
import { OpenRouterProvider } from '../providers/openrouter';
import { challengeFor, codeFromRedirect, exchangeCodeForKey, makeVerifier, openRouterAuthUrl } from '../shared/pkce';
import { ProviderError } from '../providers/types';
import { snapshotFromText } from '../shared/anchoring';
import type { OptionsRequest, OptionsResponse } from '../shared/messages';
import { SAMPLE_SUBJECT, SAMPLE_TEXT } from '../shared/sample';
import type { SessionState, Settings } from '../shared/types';
import type { LLMProvider } from '../providers/types';
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
      const provider =
        req.provider === 'openrouter'
          ? new OpenRouterProvider({ apiKey: req.apiKey, model: 'z-ai/glm-5.2' })
          : new ClaudeProvider({ apiKey: req.apiKey, model: 'claude-opus-5', workspaceId: req.workspaceId || undefined });
      try {
        const models = await provider.listModels();
        return { type: 'validateKey', ok: true, models };
      } catch (err) {
        const pe = asProviderError(err);
        return { type: 'validateKey', ok: false, error: pe.message, hint: hintFor(pe) };
      }
    }
    case 'openrouter/connect':
      return connectOpenRouter(store);
    case 'provider/test':
      return testProvider(store);
    case 'sample/run':
      return { type: 'sample', state: await runSample(store, cache) };
  }
}

function asProviderError(err: unknown): ProviderError {
  return err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : String(err), 'unknown');
}

function hintFor(pe: ProviderError): 'workspace' | 'billing' | 'auth' | 'network' | undefined {
  return pe.kind === 'auth' ? 'auth' : pe.kind === 'workspace' ? 'workspace' : pe.kind === 'billing' ? 'billing' : pe.kind === 'network' ? 'network' : undefined;
}

const PROBE_TIMEOUT_MS = 45_000;

/**
 * The setup check: one short completion through the configured provider and model. When it answers, setup is
 * complete and `onboarded` is recorded so the options page opens on settings from then on.
 */
export async function testProvider(store: SettingsStore, deps: { provider?: (s: Settings) => LLMProvider; now?: () => number } = {}): Promise<OptionsResponse> {
  const settings = await store.get();
  const model = settings.provider === 'openrouter' ? settings.openrouter.model : settings.provider === 'claude' ? settings.model : 'mock';
  if (!providerReady(settings)) return { type: 'test', ok: false, error: 'No key is configured.', hint: 'auth' };
  const now = deps.now ?? (() => Date.now());
  const started = now();
  try {
    await (deps.provider ?? createProvider)(settings).probe(AbortSignal.timeout(PROBE_TIMEOUT_MS));
  } catch (err) {
    const pe = asProviderError(err);
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { type: 'test', ok: false, error: timedOut ? `${model} did not answer within ${PROBE_TIMEOUT_MS / 1000} seconds.` : pe.message, hint: timedOut ? 'network' : hintFor(pe) };
  }
  const ms = now() - started;
  await store.set({ onboarded: true });
  return { type: 'test', ok: true, model, ms };
}

/**
 * One-click OpenRouter sign-in. OAuth PKCE through chrome.identity.launchWebAuthFlow: the user approves on
 * openrouter.ai, the browser is redirected to the extension's chromiumapp.org URL with a single-use code,
 * and the code is exchanged for a key the user controls from their OpenRouter account.
 */
export async function connectOpenRouter(store: SettingsStore, deps: { launch?: (url: string) => Promise<string>; redirectUrl?: () => string; fetchImpl?: typeof fetch } = {}): Promise<OptionsResponse> {
  const launch = deps.launch ?? ((url: string) => chrome.identity.launchWebAuthFlow({ url, interactive: true }).then((r) => r ?? ''));
  const redirectUrl = (deps.redirectUrl ?? (() => chrome.identity.getRedirectURL()))();
  try {
    const verifier = makeVerifier();
    const challenge = await challengeFor(verifier);
    const returned = await launch(openRouterAuthUrl(redirectUrl, challenge));
    const code = codeFromRedirect(returned);
    if (!code) return { type: 'connect', ok: false, error: 'OpenRouter did not return a sign-in code. Try again.' };
    const key = await exchangeCodeForKey(code, verifier, deps.fetchImpl);
    const current = await store.get();
    await store.set({ provider: 'openrouter', openrouter: { ...current.openrouter, apiKey: key }, onboarded: true });
    const models = await new OpenRouterProvider({ apiKey: key, model: current.openrouter.model, fetchImpl: deps.fetchImpl }).listModels().catch(() => []);
    return { type: 'connect', ok: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cancelled = /canceled|cancelled|closed by the user|did not approve/i.test(message);
    return { type: 'connect', ok: false, error: cancelled ? 'Sign-in was cancelled.' : message };
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
