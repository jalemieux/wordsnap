// Service worker entry. Listeners are registered synchronously at top level so Chrome can wake the worker for them.
import { log } from '../shared/log';
import type { OptionsRequest } from '../shared/messages';
import { ClaimCache } from './cache';
import { handleOptionsRequest, registerAuthTabHandlers, registerOptionsHandler } from './options-handler';
import { registerPortHandler } from './port';
import { SettingsStore, SETTINGS_KEY } from './settings';
import { chromeSiteDeps, syncRegisteredSites } from './sites';
import { ChromeLocalStorage } from './storage';

const storage = new ChromeLocalStorage();
const store = new SettingsStore(storage);
const cache = new ClaimCache(storage);

registerPortHandler(store, cache);
registerOptionsHandler(store, cache);
registerAuthTabHandlers(store);

// Another context (the options page writing directly, a future sync) changed settings: drop the cached copy.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) store.invalidate();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
  // Content scripts only auto-inject into pages loaded after this point. Attach to tabs that are already open
  // (Gmail tabs live for days), so an install or a dev reload takes effect without a page refresh.
  void injectIntoOpenTabs();
  // An update drops dynamically registered scripts: put the always-on sites back.
  void syncRegisteredSites(chromeSiteDeps(), store).catch((err) => log.warn('always-on sites not synced:', err instanceof Error ? err.message : err));
});

chrome.runtime.onStartup.addListener(() => {
  void syncRegisteredSites(chromeSiteDeps(), store).catch((err) => log.warn('always-on sites not synced:', err instanceof Error ? err.message : err));
});

async function injectIntoOpenTabs(): Promise<void> {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  for (const cs of scripts) {
    const matches = cs.matches ?? [];
    const files = cs.js ?? [];
    if (!matches.length || !files.length) continue;
    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({ url: matches });
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: false }, files });
      } catch {
        /* tab not scriptable (chrome://, discarded, or no permission); skip */
      }
    }
  }
}

// The toolbar button opens the popup (manifest action.default_popup); onClicked does not fire when a popup is set.

if (__WORDSNAP_DEV__) {
  // The e2e suite drives the popup's requests from the worker (a worker cannot message itself).
  (globalThis as { __wordsnapDev?: unknown }).__wordsnapDev = { request: (req: OptionsRequest) => handleOptionsRequest(req, store, cache) };
}
