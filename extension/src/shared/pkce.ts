// OAuth PKCE helpers (RFC 7636, S256). Uses WebCrypto, available in the service worker and extension pages.

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_KEY_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

export function openRouterAuthUrl(callbackUrl: string, challenge: string): string {
  const u = new URL(OPENROUTER_AUTH_URL);
  u.searchParams.set('callback_url', callbackUrl);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/** Pulls the single-use code out of the redirect URL OpenRouter sends the browser back to. */
export function codeFromRedirect(redirectUrl: string): string | null {
  try {
    return new URL(redirectUrl).searchParams.get('code');
  } catch {
    return null;
  }
}

/** Exchanges the code for a user-controlled OpenRouter API key. The code expires after 10 minutes. */
export async function exchangeCodeForKey(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) throw new Error(`OpenRouter did not accept the sign-in code (HTTP ${res.status}).`);
  const data = (await res.json()) as { key?: string };
  if (!data.key) throw new Error('OpenRouter returned no key.');
  return data.key;
}
