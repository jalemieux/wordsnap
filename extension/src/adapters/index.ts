import { genericAdapter } from './generic';
import { gmailAdapter } from './gmail';
import { linkedinAdapter } from './linkedin';
import type { HostAdapter } from './types';
import { xAdapter } from './x';
import type { HostId } from '../shared/types';

export { activateGeneric, deactivateGeneric, genericAdapter, isGenericActive } from './generic';
export type { ComposerHandle, HostAdapter } from './types';

export const adapters: readonly HostAdapter[] = [gmailAdapter, xAdapter, linkedinAdapter, genericAdapter];

const byId = new Map<HostId, HostAdapter>(adapters.map((a) => [a.id, a]));

/**
 * Adapter for a page. Dev builds honour an override (`?wordsnap-host=gmail` or `<html data-wordsnap-host="gmail">`)
 * so fixture pages exercise the real site adapters.
 */
export function adapterFor(url: URL, doc: Document | null = typeof document === 'undefined' ? null : document): HostAdapter | null {
  if (__WORDSNAP_DEV__) {
    const override = (url.searchParams.get('wordsnap-host') ?? doc?.documentElement?.dataset?.wordsnapHost ?? '') as HostId | '';
    if (override && byId.has(override)) return byId.get(override)!;
  }
  return adapters.find((a) => a.id !== 'generic' && a.matches(url)) ?? null;
}
