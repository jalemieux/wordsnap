// Sites beyond Gmail, X and LinkedIn. The toolbar popup injects the content script into the active tab on request
// ("Use WordSnap here", covered by activeTab) or registers it for an origin for good ("Always on", covered by a host
// permission the popup requests in the click). The bookkeeping lives here, over a small dependency surface, so it
// runs against fake chrome APIs in unit tests. Nothing here widens the manifest: registration is per origin, and the
// generic adapter still starts only when told to.
import type { ContentRequest, ContentResponse, OptionsRequest, OptionsResponse, SiteInfo, SiteStatus } from '../shared/messages';
import { log } from '../shared/log';
import type { Settings } from '../shared/types';
import type { SettingsStore } from './settings';

export interface SiteDeps {
  /** Match patterns of the content script the manifest declares (the built-in sites; dev builds add local hosts). */
  builtinMatches: string[];
  /** The files that content script loads, injected as they are. */
  contentFiles: string[];
  scripting: {
    executeScript(tabId: number, files: string[]): Promise<void>;
    registerContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
    unregisterContentScripts(ids: string[]): Promise<void>;
    getRegisteredContentScripts(): Promise<{ id: string }[]>;
  };
  permissions: {
    contains(origins: string[]): Promise<boolean>;
    remove(origins: string[]): Promise<boolean>;
  };
  tabs: {
    sendMessage(tabId: number, msg: ContentRequest): Promise<ContentResponse | undefined>;
  };
}

const SCRIPT_PREFIX = 'site:';
export function scriptIdFor(origin: string): string {
  return `${SCRIPT_PREFIX}${origin}`;
}
export function originPattern(origin: string): string {
  return `${origin}/*`;
}

/** "https://host[:port]" for an http(s) URL, null for anything else (chrome://, file://, extension pages, garbage). */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** The optional host permission covers https origins; dev builds also hold the local fixture hosts outright. */
export function canRegister(origin: string | null): boolean {
  if (!origin) return false;
  return origin.startsWith('https://') || (__WORDSNAP_DEV__ && /^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(origin));
}

/**
 * Does a manifest match pattern (https://mail.google.com/<star>, <star>://<star>.x.com/<star>) cover a URL? Enough of the
 * pattern grammar for what the manifest uses; all_urls is never in it.
 */
export function matchesPattern(pattern: string, url: URL): boolean {
  const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host, path] = m as unknown as [string, string, string, string];
  if (scheme === '*' ? url.protocol !== 'http:' && url.protocol !== 'https:' : url.protocol !== `${scheme}:`) return false;
  const h = url.hostname;
  if (host === '*') {
    /* any host */
  } else if (host.startsWith('*.')) {
    const base = host.slice(2);
    if (h !== base && !h.endsWith(`.${base}`)) return false;
  } else if (h !== host) {
    return false;
  }
  const re = new RegExp(`^${path.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(url.pathname + url.search);
}

export function isBuiltinSite(url: string, builtinMatches: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  // Dev builds add the local fixture hosts to the manifest; those are not built-in sites, they stand in for any page.
  return builtinMatches.some((p) => p.startsWith('https://') && matchesPattern(p, u));
}

export function siteStatusFor(url: string, settings: Settings, builtinMatches: string[]): SiteStatus {
  if (isBuiltinSite(url, builtinMatches)) return 'builtin';
  const origin = originOf(url);
  if (!origin) return 'unsupported';
  return settings.sites.includes(origin) ? 'registered' : 'available';
}

function infoFor(url: string | null, settings: Settings, deps: SiteDeps, composers?: number): SiteInfo {
  const origin = url ? originOf(url) : null;
  const info: SiteInfo = {
    status: url ? siteStatusFor(url, settings, deps.builtinMatches) : 'unsupported',
    origin,
    canRegister: canRegister(origin),
    generic: settings.enabledHosts.generic,
    sites: settings.sites,
  };
  if (composers !== undefined) info.composers = composers;
  return info;
}

/** Inject the content script (a no-op where it already runs: it guards against a second start) and switch the generic adapter on. */
export async function useHere(deps: SiteDeps, tabId: number): Promise<number> {
  await deps.scripting.executeScript(tabId, deps.contentFiles);
  const res = await deps.tabs.sendMessage(tabId, { type: 'generic/activate' });
  const composers = res?.type === 'generic/active' ? res.composers : 0;
  log.info(`tab ${tabId}: generic adapter on (${composers} composer${composers === 1 ? '' : 's'})`);
  return composers;
}

/** Register the content script for an origin whose host permission is already granted, and remember the origin. */
export async function registerSite(deps: SiteDeps, store: SettingsStore, origin: string): Promise<void> {
  if (!(await deps.permissions.contains([originPattern(origin)]))) throw new Error(`WordSnap was not allowed on ${origin}.`);
  const id = scriptIdFor(origin);
  const have = new Set((await deps.scripting.getRegisteredContentScripts()).map((s) => s.id));
  if (!have.has(id)) {
    await deps.scripting.registerContentScripts([{ id, matches: [originPattern(origin)], js: deps.contentFiles, runAt: 'document_idle', persistAcrossSessions: true }]);
  }
  const settings = await store.get();
  if (!settings.sites.includes(origin)) await store.set({ sites: [...settings.sites, origin] });
  log.info(`site ${origin}: always on`);
}

/** Unregister the content script, give the origin back, forget it. Each step tolerates the others having already happened. */
export async function unregisterSite(deps: SiteDeps, store: SettingsStore, origin: string): Promise<void> {
  const id = scriptIdFor(origin);
  const have = new Set((await deps.scripting.getRegisteredContentScripts()).map((s) => s.id));
  if (have.has(id)) await deps.scripting.unregisterContentScripts([id]);
  try {
    await deps.permissions.remove([originPattern(origin)]);
  } catch (err) {
    log.warn(`site ${origin}: could not give the host permission back:`, err instanceof Error ? err.message : err);
  }
  const settings = await store.get();
  if (settings.sites.includes(origin)) await store.set({ sites: settings.sites.filter((o) => o !== origin) });
  log.info(`site ${origin}: off`);
}

/**
 * Make the registered scripts match settings.sites: register what is missing (an extension update drops dynamic
 * scripts), forget origins whose permission the user took back at chrome://extensions, and drop registrations that
 * outlived their setting. Run at install and at browser start.
 */
export async function syncRegisteredSites(deps: SiteDeps, store: SettingsStore): Promise<void> {
  const settings = await store.get();
  const registered = new Set((await deps.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const keep: string[] = [];
  for (const origin of settings.sites) {
    if (!(await deps.permissions.contains([originPattern(origin)]))) {
      log.info(`site ${origin}: permission gone, forgetting it`);
      continue;
    }
    keep.push(origin);
    const id = scriptIdFor(origin);
    if (registered.has(id)) continue;
    await deps.scripting.registerContentScripts([{ id, matches: [originPattern(origin)], js: deps.contentFiles, runAt: 'document_idle', persistAcrossSessions: true }]);
    log.info(`site ${origin}: registered again`);
  }
  const stale = [...registered].filter((id) => id.startsWith(SCRIPT_PREFIX) && !keep.includes(id.slice(SCRIPT_PREFIX.length)));
  if (stale.length) await deps.scripting.unregisterContentScripts(stale);
  if (keep.length !== settings.sites.length) await store.set({ sites: keep });
}

export type SiteRequest = Extract<OptionsRequest, { type: `site/${string}` }>;

export async function handleSiteRequest(req: SiteRequest, store: SettingsStore, deps: SiteDeps): Promise<OptionsResponse> {
  switch (req.type) {
    case 'site/status':
      return { type: 'site', site: infoFor(req.url, await store.get(), deps) };
    case 'site/registered': {
      const settings = await store.get();
      return { type: 'site', site: infoFor(`${req.origin}/`, settings, deps) };
    }
    case 'site/use': {
      const settings = await store.get();
      if (!settings.enabledHosts.generic) return { type: 'error', message: 'Other sites are turned off in WordSnap settings.' };
      const composers = await useHere(deps, req.tabId);
      return { type: 'site', site: infoFor(null, settings, deps, composers) };
    }
    case 'site/register': {
      if (!(await store.get()).enabledHosts.generic) return { type: 'error', message: 'Other sites are turned off in WordSnap settings.' };
      await registerSite(deps, store, req.origin);
      const composers = req.tabId !== undefined ? await useHere(deps, req.tabId) : undefined;
      return { type: 'site', site: infoFor(`${req.origin}/`, await store.get(), deps, composers) };
    }
    case 'site/unregister':
      await unregisterSite(deps, store, req.origin);
      return { type: 'site', site: infoFor(`${req.origin}/`, await store.get(), deps) };
  }
}

/** The real thing. Built lazily so importing this module never touches `chrome`. */
export function chromeSiteDeps(): SiteDeps {
  const cs = chrome.runtime.getManifest().content_scripts?.[0];
  return {
    builtinMatches: cs?.matches ?? [],
    contentFiles: cs?.js ?? ['content.js'],
    scripting: {
      executeScript: async (tabId, files) => {
        await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files });
      },
      registerContentScripts: (scripts) => chrome.scripting.registerContentScripts(scripts),
      unregisterContentScripts: (ids) => chrome.scripting.unregisterContentScripts({ ids }),
      getRegisteredContentScripts: () => chrome.scripting.getRegisteredContentScripts(),
    },
    permissions: {
      contains: (origins) => chrome.permissions.contains({ origins }),
      remove: (origins) => chrome.permissions.remove({ origins }),
    },
    tabs: {
      sendMessage: (tabId, msg) => chrome.tabs.sendMessage(tabId, msg) as Promise<ContentResponse | undefined>,
    },
  };
}
