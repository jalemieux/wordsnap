// Message protocol.
//  - Content script <-> background: a long-lived chrome.runtime.Port named PORT_NAME, one per composer session.
//  - Options page, popup and content script -> background: chrome.runtime.sendMessage request/response.
//  - Background -> content script: chrome.tabs.sendMessage, only to switch the generic adapter on.
import type { HostId, SessionState, Settings, TextSnapshot, Checks } from './types';

export const PORT_NAME = 'wordsnap-session';

export interface PlatformInfo {
  kind: 'email' | 'post';
  charLimit?: number;
}

/** Content script -> background (over the port). */
export type ContentToBackground =
  | { type: 'session/open'; sessionKey: string; host: HostId; platform: PlatformInfo }
  | { type: 'session/snapshot'; sessionKey: string; snapshot: TextSnapshot; reason: 'initial' | 'edit' }
  | { type: 'finding/action'; sessionKey: string; findingId: string; action: 'applied' | 'kept' }
  /**
   * The user applied a change (WordSnap's suggestion or their own rewrite) to a finding's span. Sent after the
   * snapshot that carries the edit: the pass that produced the finding re-runs on the changed paragraphs right away,
   * whatever the mode, and the finding itself is dropped so the fresh result decides.
   */
  | { type: 'session/recheck'; sessionKey: string; findingId: string }
  /**
   * The user acted on the structure proposal. Kept: A, B and C run on the draft as written. Applied on an outline
   * keeps it beside the draft as a guide; done closes the guide and runs everything on what was written.
   */
  | { type: 'structure/action'; sessionKey: string; action: 'applied' | 'kept' | 'done' }
  /** The user asked for a fresh analysis of the latest snapshot: no debounce, no C throttle. */
  | { type: 'session/analyze'; sessionKey: string }
  /** The user flipped a check chip in the panel: remember it and drop findings the new set no longer covers. */
  | { type: 'session/checks'; sessionKey: string; checks: Checks }
  /** Keepalive while a composer is open: any port message resets the service worker's idle timer. */
  | { type: 'session/ping'; sessionKey: string }
  | { type: 'session/close'; sessionKey: string };

/** Background -> content script (over the port). */
export type BackgroundToContent =
  | { type: 'session/state'; sessionKey: string; state: SessionState }
  /** Sent once after session/open: per-session behaviour derived from settings. */
  | { type: 'session/config'; sessionKey: string; autoAnalyze: boolean }
  | { type: 'session/error'; sessionKey: string; message: string }
  | { type: 'session/disabled'; sessionKey: string; reason: 'no-key' | 'host-disabled' };

/**
 * Where WordSnap stands on a page, for the toolbar popup. builtin: Gmail, X or LinkedIn, on through the manifest.
 * registered: an origin the user set to always on. available: any other http(s) page. unsupported: browser pages,
 * files, the popup itself.
 */
export type SiteStatus = 'builtin' | 'registered' | 'available' | 'unsupported';

/** Options page, popup or content script -> background (sendMessage). Each request has a matching response type below. */
export type OptionsRequest =
  | { type: 'settings/get' }
  | { type: 'settings/set'; patch: Partial<Settings> }
  | { type: 'settings/validateKey'; provider: 'claude' | 'openrouter'; apiKey: string; workspaceId?: string }
  /**
   * One-click OpenRouter sign-in (OAuth PKCE). With chrome.identity the response carries the outcome. Without it
   * (Safari) the sign-in opens in a tab, the response is `ok: true, pending: true`, and the outcome arrives later
   * as an `openrouter/connected` event. Stores the resulting key on success.
   */
  | { type: 'openrouter/connect' }
  /** One short completion through the configured provider and model; marks onboarding done when it answers. */
  | { type: 'provider/test' }
  | { type: 'sample/run' }
  /** Popup: where WordSnap stands on the active tab's URL. */
  | { type: 'site/status'; url: string }
  /** Popup, "Use WordSnap here": inject the content script into the tab and switch the generic adapter on. */
  | { type: 'site/use'; tabId: number }
  /**
   * Popup, "Always on": register the content script for an origin the user has just granted, remember it in
   * settings, and switch it on in the tab that asked. The popup requests the host permission first (it needs the
   * click); the background refuses when the grant is missing.
   */
  | { type: 'site/register'; origin: string; tabId?: number }
  /** Popup or Settings: unregister the content script, revoke the origin, forget it. */
  | { type: 'site/unregister'; origin: string }
  /** Content script on load, outside the built-in sites: is this origin always on? */
  | { type: 'site/registered'; origin: string };

export type OptionsResponse =
  | { type: 'settings'; settings: Settings }
  | { type: 'validateKey'; ok: true; models: { id: string; displayName: string }[] }
  | { type: 'validateKey'; ok: false; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' }
  | { type: 'connect'; ok: true; models: { id: string; displayName: string }[]; pending?: boolean }
  | { type: 'connect'; ok: false; error: string }
  | { type: 'test'; ok: true; model: string; ms: number }
  | { type: 'test'; ok: false; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' }
  | { type: 'sample'; state: SessionState }
  | { type: 'site'; site: SiteInfo }
  | { type: 'error'; message: string };

/** The answer to every site/* request: where the page stands after the request ran. */
export interface SiteInfo {
  status: SiteStatus;
  /** "https://host[:port]", null when the page has no http(s) origin. */
  origin: string | null;
  /** Always on can only be offered for origins the optional host permission covers (https, plus local hosts in dev builds). */
  canRegister: boolean;
  /** The "Other sites (on click)" master switch in settings. Off: the popup offers nothing. */
  generic: boolean;
  /** Origins set to always on, sorted. */
  sites: string[];
  /** After site/use or site/register: how many composers the generic adapter found in the tab, when it was reached. */
  composers?: number;
}

/** Background -> content script (tabs.sendMessage). */
export type ContentRequest = { type: 'generic/activate' };
export type ContentResponse = { type: 'generic/active'; composers: number };

/** Background -> extension pages (sendMessage broadcast): the outcome of a sign-in that ran in a tab. */
export type OptionsEvent =
  | { type: 'openrouter/connected'; ok: true; models: { id: string; displayName: string }[] }
  | { type: 'openrouter/connected'; ok: false; error: string };

export function sendToBackground<R extends OptionsResponse = OptionsResponse>(req: OptionsRequest): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(req, (res: R) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
}
