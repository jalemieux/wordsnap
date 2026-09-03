// Content script entry. Finds composers on the host page, opens a session per composer, streams snapshots
// to the background, and mounts the overlay. Nothing here talks to a model or holds a credential.
import { adapterFor, type ComposerHandle, type HostAdapter } from '../adapters';
import { countWords } from '../adapters/base';
import { mountOverlay } from '../ui/overlay';
import type { OverlayController } from '../ui/types';
import type { TextSnapshot } from '../shared/types';
import { SessionClient } from './session-client';
import { shareBody, shareUrl } from './share';
import { log } from '../shared/log';

const MIN_WORDS = 40; // auto mode
const MIN_WORDS_MANUAL = 8; // after the user clicks the badge
const EDIT_DEBOUNCE_MS = 800;
const SCAN_THROTTLE_MS = 250;

interface Session {
  handle: ComposerHandle;
  client: SessionClient;
  overlay: OverlayController;
  teardown(): void;
}

const sessions = new Map<string, Session>();

function newSessionKey(adapter: HostAdapter, handle: ComposerHandle): string {
  return `${adapter.id}:${handle.key}:${Date.now().toString(36)}`;
}

function startSession(adapter: HostAdapter, handle: ComposerHandle): void {
  const sessionKey = newSessionKey(adapter, handle);
  const client = new SessionClient({ type: 'session/open', sessionKey, host: adapter.id, platform: handle.platform });
  let sentInitial = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  // Analysis is armed by the user clicking the badge, or by the autoAnalyze setting (delivered via session/config).
  let armed = false;
  let autoAnalyze = false;

  const send = (snapshot: TextSnapshot, reason: 'initial' | 'edit') => {
    if (!armed && !autoAnalyze) return;
    const words = countWords(snapshot.text);
    const min = armed ? MIN_WORDS_MANUAL : MIN_WORDS;
    if (words < min && !sentInitial) {
      log.info(`composer ${handle.key}: ${words} words, waiting for ${min} before analyzing`);
      return;
    }
    if (!sentInitial) {
      sentInitial = true;
      reason = 'initial';
    }
    log.info(`composer ${handle.key}: sending snapshot v${snapshot.version} (${words} words, ${reason})`);
    client.sendSnapshot(snapshot, reason);
  };

  const overlay = mountOverlay({
    handle,
    callbacks: {
      onApply(findingId, span, replacement) {
        if (debounce) clearTimeout(debounce);
        const ok = handle.applyEdit(span, replacement);
        if (ok) {
          client.sendAction(findingId, 'applied');
          send(handle.getSnapshot(), 'edit');
        }
        overlay.relayout();
      },
      onKeep(findingId) {
        client.sendAction(findingId, 'kept');
      },
      async onCopy() {
        await navigator.clipboard.writeText(handle.getSnapshot().text);
      },
      onShare(target) {
        const text = shareBody(handle.getSnapshot());
        window.open(shareUrl(target, text), '_blank', 'noopener');
      },
      onOpenChange(open) {
        if (!open) return;
        if (!armed) log.info(`composer ${handle.key}: analysis armed by the user`);
        armed = true;
        if (debounce) clearTimeout(debounce);
        send(handle.getSnapshot(), sentInitial ? 'edit' : 'initial');
      },
    },
    minWords: MIN_WORDS_MANUAL,
  });

  const unsubState = client.onState((state) => {
    const p = state.passes;
    log.info(`state v${state.snapshotVersion}: A=${p.A.state} B=${p.B.state} C=${p.C.state}`, p.A.error ?? p.B.error ?? p.C.error ?? '');
    overlay.update(state);
  });
  const unsubConfig = client.onConfig((c) => {
    autoAnalyze = c.autoAnalyze;
    if (autoAnalyze && !sentInitial) send(handle.getSnapshot(), 'initial');
  });
  const unsubDisabled = client.onDisabled((reason) => {
    log.warn(`session disabled (${reason}). ${reason === 'no-key' ? 'Connect a provider in WordSnap settings.' : 'This site is turned off in WordSnap settings.'}`);
    teardown();
  });
  const unsubError = client.onError((message) => log.error('background error:', message));

  const unsubChange = handle.onChange((snapshot) => {
    overlay.relayout();
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      send(snapshot, 'edit');
    }, EDIT_DEBOUNCE_MS);
  });

  const relayout = () => overlay.relayout();
  const scroller = handle.scrollParent();
  scroller.addEventListener('scroll', relayout, { passive: true });
  window.addEventListener('scroll', relayout, { passive: true, capture: true });
  window.addEventListener('resize', relayout, { passive: true });

  const teardown = () => {
    if (!sessions.has(sessionKey)) return;
    sessions.delete(sessionKey);
    if (debounce) clearTimeout(debounce);
    unsubState();
    unsubConfig();
    unsubDisabled();
    unsubError();
    unsubChange();
    scroller.removeEventListener('scroll', relayout);
    window.removeEventListener('scroll', relayout, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', relayout);
    overlay.destroy();
    client.close();
  };

  sessions.set(sessionKey, { handle, client, overlay, teardown });
  log.info(`session ${sessionKey} opened on ${adapter.id} composer ${handle.key}`);
  send(handle.getSnapshot(), 'initial');
}

/** Gmail and others keep hidden or zero-size editors in the DOM (templates, collapsed drafts). Only visible ones get a session. */
function isVisibleComposer(handle: ComposerHandle): boolean {
  const el = handle.element;
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 10) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function sessionForHandle(handle: ComposerHandle): Session | undefined {
  for (const s of sessions.values()) if (s.handle === handle) return s;
  return undefined;
}

function scan(adapter: HostAdapter): void {
  // Drop sessions whose composer went away or got hidden.
  for (const s of Array.from(sessions.values())) {
    if (!s.handle.isAlive() || !isVisibleComposer(s.handle)) {
      log.info(`composer ${s.handle.key} gone or hidden, closing its session`);
      s.teardown();
    }
  }
  for (const handle of adapter.findComposers(document)) {
    if (!isVisibleComposer(handle)) continue;
    if (sessionForHandle(handle)) continue;
    // One session per composer key. Gmail swaps the body element under the same compose window;
    // when that happens the old session is closed and a fresh one starts on the new element.
    const dup = sessionForKey(handle.key);
    if (dup) {
      log.info(`composer ${handle.key} was replaced, restarting its session`);
      dup.teardown();
    }
    startSession(adapter, handle);
  }
}

function sessionForKey(key: string): Session | undefined {
  for (const s of sessions.values()) if (s.handle.key === key) return s;
  return undefined;
}

export function main(): void {
  const adapter = adapterFor(new URL(location.href));
  if (!adapter) return;
  log.info(`active on ${location.hostname} with the ${adapter.id} adapter`);
  scan(adapter);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const mo = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan(adapter);
    }, SCAN_THROTTLE_MS);
  });
  mo.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => {
    for (const s of Array.from(sessions.values())) s.teardown();
  });
}

if (typeof document !== 'undefined' && !(globalThis as { __WORDSNAP_NO_AUTOSTART__?: boolean }).__WORDSNAP_NO_AUTOSTART__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => main(), { once: true });
  else main();
}
