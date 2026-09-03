// Typed wrapper over the long-lived port to the background. One instance per composer session.
import { log } from '../shared/log';
import { PORT_NAME, type BackgroundToContent, type ContentToBackground } from '../shared/messages';
import type { SessionState, TextSnapshot } from '../shared/types';

type OpenMessage = Extract<ContentToBackground, { type: 'session/open' }>;
type DisabledReason = Extract<BackgroundToContent, { type: 'session/disabled' }>['reason'];

export class SessionClient {
  private port: chrome.runtime.Port | null = null;
  private closed = false;
  private reconnected = false;
  private lastSnapshot: TextSnapshot | null = null;
  private stateCbs = new Set<(s: SessionState) => void>();
  private disabledCbs = new Set<(r: DisabledReason) => void>();
  private configCbs = new Set<(c: { autoAnalyze: boolean }) => void>();
  private lostCbs = new Set<() => void>();
  private errorCbs = new Set<(m: string) => void>();

  constructor(private readonly open: OpenMessage) {
    this.connect();
  }

  get sessionKey(): string {
    return this.open.sessionKey;
  }

  private connect(): void {
    if (this.closed) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (e) {
      // Extension was reloaded or removed; this content script is orphaned.
      this.closed = true;
      this.lostCbs.forEach((cb) => cb());
      return;
    }
    this.port = port;
    port.onMessage.addListener((raw: unknown) => this.dispatch(raw as BackgroundToContent));
    port.onDisconnect.addListener(() => {
      log.warn('port to the background closed' + (chrome.runtime.lastError ? `: ${chrome.runtime.lastError.message}` : ''));
      this.port = null;
      if (this.closed) return;
      if (!chrome.runtime?.id) {
        // Extension context invalidated: the extension was reloaded or updated under this page.
        this.closed = true;
        this.lostCbs.forEach((cb) => cb());
        return;
      }
      // The service worker may have been evicted; reconnect once and replay what it needs.
      if (!this.reconnected) {
        this.reconnected = true;
        setTimeout(() => this.connect(), 400);
      } else {
        this.errorCbs.forEach((cb) => cb('Lost connection to WordSnap.'));
      }
    });
    this.post(this.open);
    if (this.lastSnapshot) this.post({ type: 'session/snapshot', sessionKey: this.sessionKey, snapshot: this.lastSnapshot, reason: 'initial' });
  }

  private dispatch(msg: BackgroundToContent): void {
    if (!msg || msg.sessionKey !== this.sessionKey) return;
    switch (msg.type) {
      case 'session/state':
        this.stateCbs.forEach((cb) => cb(msg.state));
        break;
      case 'session/disabled':
        this.disabledCbs.forEach((cb) => cb(msg.reason));
        break;
      case 'session/error':
        this.errorCbs.forEach((cb) => cb(msg.message));
        break;
      case 'session/config':
        this.configCbs.forEach((cb) => cb({ autoAnalyze: msg.autoAnalyze }));
        break;
    }
  }

  private post(msg: ContentToBackground): void {
    try {
      this.port?.postMessage(msg);
    } catch {
      /* port died between checks; onDisconnect handles it */
    }
  }

  onState(cb: (s: SessionState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  /** The extension was reloaded or removed while this page stayed open. The overlay should remove itself. */
  onLost(cb: () => void): () => void {
    this.lostCbs.add(cb);
    return () => this.lostCbs.delete(cb);
  }

  onConfig(cb: (c: { autoAnalyze: boolean }) => void): () => void {
    this.configCbs.add(cb);
    return () => this.configCbs.delete(cb);
  }

  onDisabled(cb: (r: DisabledReason) => void): () => void {
    this.disabledCbs.add(cb);
    return () => this.disabledCbs.delete(cb);
  }
  onError(cb: (m: string) => void): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  sendSnapshot(snapshot: TextSnapshot, reason: 'initial' | 'edit'): void {
    this.lastSnapshot = snapshot;
    this.post({ type: 'session/snapshot', sessionKey: this.sessionKey, snapshot, reason });
  }

  sendAction(findingId: string, action: 'applied' | 'kept'): void {
    this.post({ type: 'finding/action', sessionKey: this.sessionKey, findingId, action });
  }

  close(): void {
    if (this.closed) return;
    this.post({ type: 'session/close', sessionKey: this.sessionKey });
    this.closed = true;
    try {
      this.port?.disconnect();
    } catch {
      /* already gone */
    }
    this.port = null;
  }
}
