// Message protocol.
//  - Content script <-> background: a long-lived chrome.runtime.Port named PORT_NAME, one per composer session.
//  - Options page  <-> background: chrome.runtime.sendMessage request/response.
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

/** Options page -> background (sendMessage). Each request has a matching response type below. */
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
  | { type: 'sample/run' };

export type OptionsResponse =
  | { type: 'settings'; settings: Settings }
  | { type: 'validateKey'; ok: true; models: { id: string; displayName: string }[] }
  | { type: 'validateKey'; ok: false; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' }
  | { type: 'connect'; ok: true; models: { id: string; displayName: string }[]; pending?: boolean }
  | { type: 'connect'; ok: false; error: string }
  | { type: 'test'; ok: true; model: string; ms: number }
  | { type: 'test'; ok: false; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' }
  | { type: 'sample'; state: SessionState }
  | { type: 'error'; message: string };

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
