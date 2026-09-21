// chrome.runtime.onMessage handler for the options page.
import { createProvider, providerReady } from '../providers';
import { OpenRouterProvider } from '../providers/openrouter';
import { challengeFor, codeFromRedirect, exchangeCodeForKey, makeVerifier, openRouterAuthUrl } from '../shared/pkce';
import { ProviderError } from '../providers/types';
import { snapshotFromText } from '../shared/anchoring';
import type { OptionsEvent, OptionsRequest, OptionsResponse } from '../shared/messages';
import { SAMPLE_SUBJECT, SAMPLE_TEXT } from '../shared/sample';
import { ALL_CHECKS, SUPPORTED_MODEL, type SessionState, type Settings } from '../shared/types';
import type { LLMProvider } from '../providers/types';
import { AUTH_TIMEOUT_MS, TAB_CALLBACK_URL, beginAuthTab, cancelAuthTab, catchAuthCallback, chromeAuthTabDeps, type AuthTabDeps } from './auth-tab';
import type { ClaimCache } from './cache';
import { SessionOrchestrator } from './orchestrator';
import type { SettingsStore } from './settings';
import { chromeSiteDeps, handleSiteRequest, type SiteDeps } from './sites';
import { ChromeSessionStorage } from './storage';

/** Chrome has chrome.identity (declared in the manifest); Safari has neither the API nor the permission. */
function hasIdentity(): boolean {
  return typeof chrome.identity?.launchWebAuthFlow === 'function';
}

export async function handleOptionsRequest(req: OptionsRequest, store: SettingsStore, cache: ClaimCache, sites: () => SiteDeps = chromeSiteDeps): Promise<OptionsResponse> {
  switch (req.type) {
    case 'settings/get':
      return { type: 'settings', settings: await store.get() };
    case 'settings/set':
      return { type: 'settings', settings: await store.set(req.patch) };
    case 'settings/validateKey': {
      if (req.provider !== 'openrouter') {
        return { type: 'validateKey', ok: false, error: `Only OpenRouter keys work in this build; WordSnap is validated against ${SUPPORTED_MODEL} only.` };
      }
      const provider = new OpenRouterProvider({ apiKey: req.apiKey, model: SUPPORTED_MODEL });
      try {
        const models = await provider.listModels();
        return { type: 'validateKey', ok: true, models };
      } catch (err) {
        const pe = asProviderError(err);
        return { type: 'validateKey', ok: false, error: pe.message, hint: hintFor(pe) };
      }
    }
    case 'openrouter/connect':
      return hasIdentity() ? connectOpenRouter(store) : startOpenRouterTabConnect({ begin: (url, cb, v) => beginAuthTab(chromeAuthTabDeps(new ChromeSessionStorage()), url, cb, v) });
    case 'provider/test':
      return testProvider(store);
    case 'sample/run':
      return { type: 'sample', state: await runSample(store, cache) };
    case 'site/status':
    case 'site/use':
    case 'site/register':
    case 'site/unregister':
    case 'site/registered':
      return handleSiteRequest(req, store, sites());
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
  const model = settings.provider === 'mock' ? 'mock' : settings.openrouter.model;
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
    return await finishOpenRouterConnect(store, returned, verifier, deps.fetchImpl);
  } catch (err) {
    return { type: 'connect', ok: false, error: connectErrorMessage(err) };
  }
}

/**
 * The same sign-in without chrome.identity (Safari): the sign-in page opens in a tab and this returns at once with
 * `pending: true`. The redirect is caught by the top-level listeners in registerAuthTabHandlers, which finish the
 * exchange and broadcast an `openrouter/connected` event to the options page.
 */
export async function startOpenRouterTabConnect(deps: { begin: (url: string, callback: string, verifier: string) => Promise<void>; callback?: string }): Promise<OptionsResponse> {
  const callback = deps.callback ?? TAB_CALLBACK_URL;
  try {
    const verifier = makeVerifier();
    const challenge = await challengeFor(verifier);
    await deps.begin(openRouterAuthUrl(callback, challenge), callback, verifier);
    return { type: 'connect', ok: true, models: [], pending: true };
  } catch (err) {
    return { type: 'connect', ok: false, error: connectErrorMessage(err) };
  }
}

/** Second half of either sign-in: code out of the redirect, key out of the code, key into settings. */
export async function finishOpenRouterConnect(store: SettingsStore, redirectUrl: string, verifier: string, fetchImpl?: typeof fetch): Promise<OptionsResponse> {
  try {
    const code = codeFromRedirect(redirectUrl);
    if (!code) return { type: 'connect', ok: false, error: 'OpenRouter did not return a sign-in code. Try again.' };
    const key = await exchangeCodeForKey(code, verifier, fetchImpl);
    const current = await store.get();
    await store.set({ provider: 'openrouter', openrouter: { ...current.openrouter, apiKey: key }, onboarded: true });
    const models = await new OpenRouterProvider({ apiKey: key, model: current.openrouter.model, fetchImpl }).listModels().catch(() => []);
    return { type: 'connect', ok: true, models };
  } catch (err) {
    return { type: 'connect', ok: false, error: connectErrorMessage(err) };
  }
}

function connectErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return /canceled|cancelled|closed by the user|did not approve/i.test(message) ? 'Sign-in was cancelled.' : message;
}

/**
 * Top-level tab listeners for the sign-in-in-a-tab path. Registered in every build (they only act on a pending
 * sign-in, and Chrome never starts one), synchronously at startup so an event page that unloaded while the user
 * was signing in still catches the redirect.
 */
export function registerAuthTabHandlers(store: SettingsStore, deps: AuthTabDeps = chromeAuthTabDeps(new ChromeSessionStorage()), notify: (e: OptionsEvent) => void = broadcast): void {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    void handleAuthTabUpdate(store, deps, tabId, info.url).then((e) => e && notify(e));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void cancelAuthTab(deps, tabId).then((was) => was && notify({ type: 'openrouter/connected', ok: false, error: 'Sign-in was cancelled.' }));
  });
}

export async function handleAuthTabUpdate(store: SettingsStore, deps: AuthTabDeps, tabId: number, url: string | undefined, fetchImpl?: typeof fetch): Promise<OptionsEvent | null> {
  const caught = await catchAuthCallback(deps, tabId, url);
  if (!caught) return null;
  if ('expired' in caught) return { type: 'openrouter/connected', ok: false, error: `Sign-in took longer than ${AUTH_TIMEOUT_MS / 60_000} minutes. Try again.` };
  const r = await finishOpenRouterConnect(store, caught.redirectUrl, caught.verifier, fetchImpl);
  if (r.type !== 'connect') return null;
  return r.ok ? { type: 'openrouter/connected', ok: true, models: r.models } : { type: 'openrouter/connected', ok: false, error: r.error };
}

function broadcast(e: OptionsEvent): void {
  // Rejects when no extension page is listening (the options page was closed); the key is stored either way.
  chrome.runtime.sendMessage(e).catch(() => {});
}

/** Runs all three passes on the sample draft with the configured provider. Resolves when every pass has settled. */
export async function runSample(store: SettingsStore, cache: ClaimCache): Promise<SessionState> {
  const settings = await store.get();
  const provider = createProvider(settings);
  let latest: SessionState | null = null;
  const orch = new SessionOrchestrator('sample', 'generic', {
    provider: () => provider,
    settings: () => ({ ...settings, checks: { ...ALL_CHECKS } }),
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
