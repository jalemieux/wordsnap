// Service worker entry. Listeners are registered synchronously at top level so Chrome can wake the worker for them.
import { ClaimCache } from './cache';
import { registerOptionsHandler } from './options-handler';
import { registerPortHandler } from './port';
import { SettingsStore, SETTINGS_KEY } from './settings';
import { ChromeLocalStorage } from './storage';

const storage = new ChromeLocalStorage();
const store = new SettingsStore(storage);
const cache = new ClaimCache(storage);

registerPortHandler(store, cache);
registerOptionsHandler(store, cache);

// Another context (the options page writing directly, a future sync) changed settings: drop the cached copy.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) store.invalidate();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
