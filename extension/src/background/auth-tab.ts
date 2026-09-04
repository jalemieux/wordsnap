// OAuth sign-in in a browser tab, for browsers without chrome.identity (Safari).
//
// A non-persistent background page can unload while the user signs in, so nothing here relies on a closure
// surviving: the pending sign-in (PKCE verifier, tab id, callback URL) lives in storage, and the redirect is
// caught by a tabs.onUpdated listener registered at top level (registerAuthTabHandlers). The provider redirects
// to TAB_CALLBACK_URL, a path on a host the extension already has access to, so the URL is visible in the update
// event; the tab is closed the moment it is seen, before the page renders.
import type { KeyValueStorage } from './storage';

export interface PendingAuth {
  verifier: string;
  tabId: number;
  callback: string;
  startedAt: number;
}

export const PENDING_AUTH_KEY = 'oauth:pending';
/** OpenRouter codes expire after 10 minutes; a pending sign-in older than that is dropped. */
export const AUTH_TIMEOUT_MS = 10 * 60_000;
/** Where OpenRouter sends the browser back to. Only the prefix matters: the tab is closed before it loads. */
export const TAB_CALLBACK_URL = 'https://openrouter.ai/wordsnap/connected';

export interface AuthTabDeps {
  storage: KeyValueStorage;
  tabs: {
    create(props: { url: string; active: boolean }): Promise<{ id?: number | undefined }>;
    remove(tabId: number): Promise<void>;
  };
  now?: () => number;
}

export async function beginAuthTab(deps: AuthTabDeps, url: string, callback: string, verifier: string): Promise<void> {
  const tab = await deps.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error('Could not open the sign-in tab.');
  const pending: PendingAuth = { verifier, tabId: tab.id, callback, startedAt: (deps.now ?? Date.now)() };
  await deps.storage.set(PENDING_AUTH_KEY, pending);
}

/**
 * For tabs.onUpdated. When `url` is the callback of the pending sign-in in that tab, clears the record, closes the
 * tab and returns what the exchange needs. Anything else (other tabs, other URLs, no pending sign-in) is null.
 */
export async function catchAuthCallback(deps: AuthTabDeps, tabId: number, url: string | undefined): Promise<{ redirectUrl: string; verifier: string } | { expired: true } | null> {
  if (!url) return null;
  const pending = await deps.storage.get<PendingAuth>(PENDING_AUTH_KEY);
  if (!pending || pending.tabId !== tabId || !url.startsWith(pending.callback)) return null;
  await deps.storage.remove(PENDING_AUTH_KEY);
  void deps.tabs.remove(tabId).catch(() => {});
  if ((deps.now ?? Date.now)() - pending.startedAt > AUTH_TIMEOUT_MS) return { expired: true };
  return { redirectUrl: url, verifier: pending.verifier };
}

/** For tabs.onRemoved. True when the closed tab was a pending sign-in (the user gave up); the record is cleared. */
export async function cancelAuthTab(deps: AuthTabDeps, tabId: number): Promise<boolean> {
  const pending = await deps.storage.get<PendingAuth>(PENDING_AUTH_KEY);
  if (!pending || pending.tabId !== tabId) return false;
  await deps.storage.remove(PENDING_AUTH_KEY);
  return true;
}

export function chromeAuthTabDeps(storage: KeyValueStorage): AuthTabDeps {
  return {
    storage,
    tabs: {
      create: (props) => chrome.tabs.create(props),
      remove: (tabId) => chrome.tabs.remove(tabId),
    },
  };
}
