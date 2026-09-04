// Service worker entry. Listeners are registered synchronously at top level so Chrome can wake the worker for them.
import { ClaimCache } from './cache';
import { registerAuthTabHandlers, registerOptionsHandler } from './options-handler';
import { registerPortHandler } from './port';
import { SettingsStore, SETTINGS_KEY } from './settings';
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

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
