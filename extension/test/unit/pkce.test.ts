import { challengeFor, codeFromRedirect, exchangeCodeForKey, makeVerifier, openRouterAuthUrl } from '../../src/shared/pkce';

describe('pkce', () => {
  it('derives the S256 challenge from the RFC 7636 example verifier', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes url-safe verifiers of 43 chars', () => {
    const v = makeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(makeVerifier()).not.toBe(v);
  });

  it('builds the authorize url and reads the code back', () => {
    const url = openRouterAuthUrl('https://abc.chromiumapp.org/', 'chal');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(u.searchParams.get('callback_url')).toBe('https://abc.chromiumapp.org/');
    expect(u.searchParams.get('code_challenge')).toBe('chal');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(codeFromRedirect('https://abc.chromiumapp.org/?code=xyz')).toBe('xyz');
    expect(codeFromRedirect('not a url')).toBeNull();
  });

  it('exchanges the code with verifier and method', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ key: 'sk-or-v1-test' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await exchangeCodeForKey('code1', 'ver1', fetchImpl)).toBe('sk-or-v1-test');
    expect(calls[0]).toEqual({ url: 'https://openrouter.ai/api/v1/auth/keys', body: { code: 'code1', code_verifier: 'ver1', code_challenge_method: 'S256' } });
    const bad = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(exchangeCodeForKey('c', 'v', bad)).rejects.toThrow(/403/);
  });
});
