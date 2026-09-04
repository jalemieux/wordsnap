import { AUTH_TIMEOUT_MS, PENDING_AUTH_KEY, beginAuthTab, cancelAuthTab, catchAuthCallback, type AuthTabDeps } from '../../src/background/auth-tab';
import { MemoryStorage } from '../../src/background/storage';

function deps(now = () => 1_000) {
  const storage = new MemoryStorage();
  const created: string[] = [];
  const removed: number[] = [];
  const d: AuthTabDeps = {
    storage,
    tabs: {
      create: async ({ url }) => {
        created.push(url);
        return { id: 42 };
      },
      remove: async (id) => {
        removed.push(id);
      },
    },
    now,
  };
  return { d, storage, created, removed };
}

describe('sign-in in a tab', () => {
  it('opens the tab and records the pending sign-in', async () => {
    const { d, storage, created } = deps();
    await beginAuthTab(d, 'https://openrouter.ai/auth?x=1', 'https://openrouter.ai/wordsnap/connected', 'v1');
    expect(created).toEqual(['https://openrouter.ai/auth?x=1']);
    expect(await storage.get(PENDING_AUTH_KEY)).toEqual({ verifier: 'v1', tabId: 42, callback: 'https://openrouter.ai/wordsnap/connected', startedAt: 1_000 });
  });

  it('ignores updates that are not the callback in the sign-in tab', async () => {
    const { d, removed } = deps();
    await beginAuthTab(d, 'u', 'https://openrouter.ai/wordsnap/connected', 'v1');
    expect(await catchAuthCallback(d, 42, undefined)).toBeNull();
    expect(await catchAuthCallback(d, 42, 'https://openrouter.ai/auth?step=2')).toBeNull();
    expect(await catchAuthCallback(d, 7, 'https://openrouter.ai/wordsnap/connected?code=c')).toBeNull();
    expect(removed).toEqual([]);
  });

  it('catches the redirect once, closes the tab and hands back the verifier', async () => {
    const { d, storage, removed } = deps();
    await beginAuthTab(d, 'u', 'https://openrouter.ai/wordsnap/connected', 'v1');
    const hit = await catchAuthCallback(d, 42, 'https://openrouter.ai/wordsnap/connected?code=the-code');
    expect(hit).toEqual({ redirectUrl: 'https://openrouter.ai/wordsnap/connected?code=the-code', verifier: 'v1' });
    expect(removed).toEqual([42]);
    expect(await storage.get(PENDING_AUTH_KEY)).toBeUndefined();
    expect(await catchAuthCallback(d, 42, 'https://openrouter.ai/wordsnap/connected?code=the-code')).toBeNull();
  });

  it('drops a redirect that arrives after the code has expired', async () => {
    let t = 0;
    const { d } = deps(() => t);
    await beginAuthTab(d, 'u', 'https://openrouter.ai/wordsnap/connected', 'v1');
    t = AUTH_TIMEOUT_MS + 1;
    expect(await catchAuthCallback(d, 42, 'https://openrouter.ai/wordsnap/connected?code=c')).toEqual({ expired: true });
  });

  it('treats the sign-in tab closing as a cancel, other tabs closing as nothing', async () => {
    const { d, storage } = deps();
    await beginAuthTab(d, 'u', 'https://openrouter.ai/wordsnap/connected', 'v1');
    expect(await cancelAuthTab(d, 7)).toBe(false);
    expect(await cancelAuthTab(d, 42)).toBe(true);
    expect(await storage.get(PENDING_AUTH_KEY)).toBeUndefined();
    expect(await cancelAuthTab(d, 42)).toBe(false);
  });
});
