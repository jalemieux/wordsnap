import { describe, expect, it } from 'vitest';
import { SettingsStore, mergeSettings } from '../../src/background/settings';
import { handleSiteRequest, isBuiltinSite, matchesPattern, originOf, registerSite, scriptIdFor, siteStatusFor, syncRegisteredSites, unregisterSite, useHere, type SiteDeps } from '../../src/background/sites';
import { MemoryStorage } from '../../src/background/storage';
import type { ContentRequest } from '../../src/shared/messages';

const BUILTIN = ['https://mail.google.com/*', 'https://x.com/*', 'https://twitter.com/*', 'https://www.linkedin.com/*', 'http://127.0.0.1/*'];

/** Fake chrome.scripting / chrome.permissions / chrome.tabs with a log of every call. */
function fakeDeps(opts: { granted?: string[]; registered?: string[]; composers?: number } = {}) {
  const granted = new Set(opts.granted ?? []);
  const registered = new Map<string, chrome.scripting.RegisteredContentScript>();
  for (const id of opts.registered ?? []) registered.set(id, { id, js: [] });
  const calls: string[] = [];
  const deps: SiteDeps = {
    builtinMatches: BUILTIN,
    contentFiles: ['content.js'],
    scripting: {
      executeScript: async (tabId, files) => {
        calls.push(`execute ${tabId} ${files.join(',')}`);
      },
      registerContentScripts: async (scripts) => {
        for (const s of scripts) {
          if (!granted.has(s.matches![0]!)) throw new Error(`no host permission for ${s.matches![0]}`);
          if (registered.has(s.id)) throw new Error(`duplicate script id ${s.id}`);
          registered.set(s.id, s);
          calls.push(`register ${s.id}`);
        }
      },
      unregisterContentScripts: async (ids) => {
        for (const id of ids) {
          if (!registered.delete(id)) throw new Error(`unknown script id ${id}`);
          calls.push(`unregister ${id}`);
        }
      },
      getRegisteredContentScripts: async () => [...registered.values()],
    },
    permissions: {
      contains: async (origins) => origins.every((o) => granted.has(o)),
      remove: async (origins) => {
        for (const o of origins) {
          granted.delete(o);
          calls.push(`revoke ${o}`);
        }
        return true;
      },
    },
    tabs: {
      sendMessage: async (tabId, msg: ContentRequest) => {
        calls.push(`send ${tabId} ${msg.type}`);
        return { type: 'generic/active', composers: opts.composers ?? 1 };
      },
    },
  };
  return { deps, calls, granted, registered };
}

function storeWith(sites: string[] = [], generic = true) {
  const storage = new MemoryStorage();
  const store = new SettingsStore(storage);
  return { store, ready: store.set({ sites, enabledHosts: { gmail: true, x: true, linkedin: true, generic } }) };
}

describe('origins and match patterns', () => {
  it('reduces a URL to its http(s) origin and rejects the rest', () => {
    expect(originOf('https://docs.example.com/d/1?x=1#y')).toBe('https://docs.example.com');
    expect(originOf('http://localhost:4173/page.html')).toBe('http://localhost:4173');
    expect(originOf('chrome://extensions')).toBeNull();
    expect(originOf('chrome-extension://abc/popup.html')).toBeNull();
    expect(originOf('file:///tmp/a.html')).toBeNull();
    expect(originOf('')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('matches manifest patterns the way Chrome does, for the shapes the manifest uses', () => {
    const u = (s: string) => new URL(s);
    expect(matchesPattern('https://mail.google.com/*', u('https://mail.google.com/mail/u/0/#inbox'))).toBe(true);
    expect(matchesPattern('https://mail.google.com/*', u('http://mail.google.com/'))).toBe(false);
    expect(matchesPattern('https://mail.google.com/*', u('https://mail.google.com.evil.io/'))).toBe(false);
    expect(matchesPattern('*://*.x.com/*', u('https://pro.x.com/compose'))).toBe(true);
    expect(matchesPattern('*://*.x.com/*', u('https://x.com/'))).toBe(true);
    expect(matchesPattern('*://*.x.com/*', u('ftp://x.com/'))).toBe(false);
    expect(matchesPattern('https://example.com/docs/*', u('https://example.com/blog'))).toBe(false);
    expect(matchesPattern('<all_urls>', u('https://example.com/'))).toBe(false);
  });

  it('knows the built-in sites and does not count the dev fixture host as one', () => {
    expect(isBuiltinSite('https://mail.google.com/mail/', BUILTIN)).toBe(true);
    expect(isBuiltinSite('https://www.linkedin.com/feed/', BUILTIN)).toBe(true);
    expect(isBuiltinSite('http://127.0.0.1:4173/any-site.html', BUILTIN)).toBe(false);
    expect(isBuiltinSite('https://docs.example.com/', BUILTIN)).toBe(false);
    expect(isBuiltinSite('garbage', BUILTIN)).toBe(false);
  });

  it('reports where a page stands', () => {
    const s = mergeSettings({ sites: ['https://docs.example.com'] });
    expect(siteStatusFor('https://x.com/home', s, BUILTIN)).toBe('builtin');
    expect(siteStatusFor('https://docs.example.com/d/1', s, BUILTIN)).toBe('registered');
    expect(siteStatusFor('https://other.example.com/', s, BUILTIN)).toBe('available');
    expect(siteStatusFor('chrome://newtab', s, BUILTIN)).toBe('unsupported');
  });
});

describe('settings.sites', () => {
  it('defaults to an empty list and keeps only unique origin strings, sorted', () => {
    expect(mergeSettings({}).sites).toEqual([]);
    expect(mergeSettings({ sites: ['https://b.example', 'https://a.example', 'https://b.example', 7, ''] as unknown as string[] }).sites).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('Use WordSnap here', () => {
  it('injects the content script into the tab, then tells it to switch the generic adapter on', async () => {
    const { deps, calls } = fakeDeps({ composers: 2 });
    expect(await useHere(deps, 12)).toBe(2);
    expect(calls).toEqual(['execute 12 content.js', 'send 12 generic/activate']);
  });

  it('is refused while Other sites is off in settings', async () => {
    const { deps, calls } = fakeDeps();
    const { store, ready } = storeWith([], false);
    await ready;
    const r = await handleSiteRequest({ type: 'site/use', tabId: 1 }, store, deps);
    expect(r.type === 'error' && /turned off/.test(r.message)).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('Always on', () => {
  it('registers one persistent script for the origin and records the origin once', async () => {
    const { deps, calls, registered } = fakeDeps({ granted: ['https://docs.example.com/*'] });
    const { store, ready } = storeWith();
    await ready;
    await registerSite(deps, store, 'https://docs.example.com');
    await registerSite(deps, store, 'https://docs.example.com');
    expect(calls).toEqual(['register site:https://docs.example.com']);
    expect(registered.get(scriptIdFor('https://docs.example.com'))).toEqual({
      id: 'site:https://docs.example.com',
      matches: ['https://docs.example.com/*'],
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    });
    expect((await store.get()).sites).toEqual(['https://docs.example.com']);
  });

  it('refuses an origin the browser has not granted, and records nothing', async () => {
    const { deps, calls } = fakeDeps();
    const { store, ready } = storeWith();
    await ready;
    await expect(registerSite(deps, store, 'https://docs.example.com')).rejects.toThrow(/not allowed/);
    expect(calls).toEqual([]);
    expect((await store.get()).sites).toEqual([]);
  });

  it('through the request handler: registers, switches the asking tab on, and answers with the new status', async () => {
    const { deps, calls } = fakeDeps({ granted: ['https://docs.example.com/*'] });
    const { store, ready } = storeWith();
    await ready;
    const r = await handleSiteRequest({ type: 'site/register', origin: 'https://docs.example.com', tabId: 3 }, store, deps);
    expect(r.type === 'site' && r.site.status === 'registered' && r.site.composers === 1 && r.site.sites).toEqual(['https://docs.example.com']);
    expect(calls).toEqual(['register site:https://docs.example.com', 'execute 3 content.js', 'send 3 generic/activate']);
  });

  it('a registered origin answers the content script that it is always on; others are not', async () => {
    const { deps } = fakeDeps();
    const { store, ready } = storeWith(['https://docs.example.com']);
    await ready;
    const yes = await handleSiteRequest({ type: 'site/registered', origin: 'https://docs.example.com' }, store, deps);
    const no = await handleSiteRequest({ type: 'site/registered', origin: 'https://other.example.com' }, store, deps);
    expect(yes.type === 'site' && yes.site.status).toBe('registered');
    expect(no.type === 'site' && no.site.status).toBe('available');
  });
});

describe('Remove', () => {
  it('unregisters the script, gives the origin back and forgets it', async () => {
    const { deps, calls, granted } = fakeDeps({ granted: ['https://docs.example.com/*'], registered: ['site:https://docs.example.com'] });
    const { store, ready } = storeWith(['https://docs.example.com', 'https://other.example.com']);
    await ready;
    await unregisterSite(deps, store, 'https://docs.example.com');
    expect(calls).toEqual(['unregister site:https://docs.example.com', 'revoke https://docs.example.com/*']);
    expect(granted.size).toBe(0);
    expect((await store.get()).sites).toEqual(['https://other.example.com']);
  });

  it('tolerates a script that was never registered and a permission already gone', async () => {
    const { deps, calls } = fakeDeps();
    const { store, ready } = storeWith(['https://docs.example.com']);
    await ready;
    await unregisterSite(deps, store, 'https://docs.example.com');
    expect(calls).toEqual(['revoke https://docs.example.com/*']);
    expect((await store.get()).sites).toEqual([]);
  });
});

describe('sync at install and browser start', () => {
  it('re-registers sites an update dropped, forgets sites whose permission was taken back, drops stale registrations', async () => {
    const { deps, calls } = fakeDeps({ granted: ['https://a.example/*', 'https://c.example/*'], registered: ['site:https://c.example', 'site:https://gone.example'] });
    const { store, ready } = storeWith(['https://a.example', 'https://b.example', 'https://c.example']);
    await ready;
    await syncRegisteredSites(deps, store);
    expect(calls).toEqual(['register site:https://a.example', 'unregister site:https://gone.example']);
    expect((await store.get()).sites).toEqual(['https://a.example', 'https://c.example']);
  });

  it('does nothing when everything already agrees', async () => {
    const { deps, calls } = fakeDeps({ granted: ['https://a.example/*'], registered: ['site:https://a.example'] });
    const { store, ready } = storeWith(['https://a.example']);
    await ready;
    await syncRegisteredSites(deps, store);
    expect(calls).toEqual([]);
  });
});
