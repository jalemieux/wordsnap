// Message protocol.
//  - Content script <-> background: a long-lived chrome.runtime.Port named PORT_NAME, one per composer session.
//  - Options page  <-> background: chrome.runtime.sendMessage request/response.
import type { HostId, SessionState, Settings, TextSnapshot } from './types';

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
  | { type: 'session/close'; sessionKey: string };

/** Background -> content script (over the port). */
export type BackgroundToContent =
  | { type: 'session/state'; sessionKey: string; state: SessionState }
  | { type: 'session/error'; sessionKey: string; message: string }
  | { type: 'session/disabled'; sessionKey: string; reason: 'no-key' | 'host-disabled' };

/** Options page -> background (sendMessage). Each request has a matching response type below. */
export type OptionsRequest =
  | { type: 'settings/get' }
  | { type: 'settings/set'; patch: Partial<Settings> }
  | { type: 'settings/validateKey'; apiKey: string; workspaceId?: string }
  | { type: 'sample/run' };

export type OptionsResponse =
  | { type: 'settings'; settings: Settings }
  | { type: 'validateKey'; ok: true; models: { id: string; displayName: string }[] }
  | { type: 'validateKey'; ok: false; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' }
  | { type: 'sample'; state: SessionState }
  | { type: 'error'; message: string };

export function sendToBackground<R extends OptionsResponse = OptionsResponse>(req: OptionsRequest): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(req, (res: R) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
}
