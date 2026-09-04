import { connectOpenRouter, handleAuthTabUpdate, startOpenRouterTabConnect } from '../../src/background/options-handler';
import { TAB_CALLBACK_URL, beginAuthTab, type AuthTabDeps } from '../../src/background/auth-tab';
import { SettingsStore } from '../../src/background/settings';
import { MemoryStorage } from '../../src/background/storage';

function fetchFor(responses: Record<string, Response>): typeof fetch {
  return (async (url: string) => {
    const r = responses[new URL(url).pathname];
    if (!r) return new Response('{}', { status: 404 });
    return r.clone();
  }) as unknown as typeof fetch;
}

describe('connectOpenRouter', () => {
  it('runs PKCE through the launcher, exchanges the code, stores the key and switches provider', async () => {
    const store = new SettingsStore(new MemoryStorage());
    let seenAuthUrl = '';
    const launch = async (url: string) => {
      seenAuthUrl = url;
      return 'https://abc.chromiumapp.org/?code=the-code';
    };
    const fetchImpl = fetchFor({
      '/api/v1/auth/keys': new Response(JSON.stringify({ key: 'sk-or-v1-new' }), { status: 200 }),
      '/api/v1/key': new Response(JSON.stringify({ data: {} }), { status: 200 }),
      '/api/v1/models': new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }] }), { status: 200 }),
    });
    const r = await connectOpenRouter(store, { launch, redirectUrl: () => 'https://abc.chromiumapp.org/', fetchImpl });
    expect(r).toEqual({ type: 'connect', ok: true, models: [{ id: 'z-ai/glm-5.2', displayName: 'GLM 5.2' }] });
    const u = new URL(seenAuthUrl);
    expect(u.host).toBe('openrouter.ai');
    expect(u.searchParams.get('callback_url')).toBe('https://abc.chromiumapp.org/');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const s = await store.get();
    expect(s.provider).toBe('openrouter');
    expect(s.openrouter.apiKey).toBe('sk-or-v1-new');
    expect(s.openrouter.model).toBe('z-ai/glm-5.2');
    expect(s.onboarded).toBe(true);
  });

  it('reports a cancelled sign-in without touching settings', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const r = await connectOpenRouter(store, { launch: async () => Promise.reject(new Error('The user did not approve access.')), redirectUrl: () => 'https://abc.chromiumapp.org/' });
    expect(r).toEqual({ type: 'connect', ok: false, error: 'Sign-in was cancelled.' });
    expect((await store.get()).openrouter.apiKey).toBe('');
  });

  it('fails cleanly when the redirect carries no code', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const r = await connectOpenRouter(store, { launch: async () => 'https://abc.chromiumapp.org/?error=denied', redirectUrl: () => 'https://abc.chromiumapp.org/' });
    expect(r.type === 'connect' && !r.ok && /code/.test(r.error)).toBe(true);
  });
});

describe('sign-in without chrome.identity (Safari)', () => {
  function tabDeps() {
    const storage = new MemoryStorage();
    const opened: string[] = [];
    const d: AuthTabDeps = { storage, tabs: { create: async ({ url }) => (opened.push(url), { id: 9 }), remove: async () => {} } };
    return { d, opened };
  }

  it('opens the sign-in in a tab and answers pending; the redirect finishes the exchange and stores the key', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const { d, opened } = tabDeps();
    const r = await startOpenRouterTabConnect({ begin: (url, cb, v) => beginAuthTab(d, url, cb, v) });
    expect(r).toEqual({ type: 'connect', ok: true, models: [], pending: true });
    const u = new URL(opened[0]!);
    expect(u.searchParams.get('callback_url')).toBe(TAB_CALLBACK_URL);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect((await store.get()).openrouter.apiKey).toBe('');

    const fetchImpl = fetchFor({
      '/api/v1/auth/keys': new Response(JSON.stringify({ key: 'sk-or-v1-tab' }), { status: 200 }),
      '/api/v1/key': new Response(JSON.stringify({ data: {} }), { status: 200 }),
      '/api/v1/models': new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }] }), { status: 200 }),
    });
    expect(await handleAuthTabUpdate(store, d, 9, 'https://openrouter.ai/auth?step=2', fetchImpl)).toBeNull();
    const e = await handleAuthTabUpdate(store, d, 9, `${TAB_CALLBACK_URL}?code=the-code`, fetchImpl);
    expect(e).toEqual({ type: 'openrouter/connected', ok: true, models: [{ id: 'z-ai/glm-5.2', displayName: 'GLM 5.2' }] });
    const s = await store.get();
    expect(s.provider).toBe('openrouter');
    expect(s.openrouter.apiKey).toBe('sk-or-v1-tab');
    expect(s.onboarded).toBe(true);
  });

  it('reports a rejected code as an event instead of storing anything', async () => {
    const store = new SettingsStore(new MemoryStorage());
    const { d } = tabDeps();
    await startOpenRouterTabConnect({ begin: (url, cb, v) => beginAuthTab(d, url, cb, v) });
    const e = await handleAuthTabUpdate(store, d, 9, `${TAB_CALLBACK_URL}?code=bad`, fetchFor({}));
    expect(e && !e.ok && /HTTP 404/.test(e.error)).toBe(true);
    expect((await store.get()).openrouter.apiKey).toBe('');
  });

  it('fails cleanly when the tab cannot be opened', async () => {
    const r = await startOpenRouterTabConnect({ begin: async () => Promise.reject(new Error('Could not open the sign-in tab.')) });
    expect(r).toEqual({ type: 'connect', ok: false, error: 'Could not open the sign-in tab.' });
  });
});
