// Content script entry. Finds composers on the host page, opens a session per composer, streams snapshots
// to the background, and mounts the overlay. Nothing here talks to a model or holds a credential.
import { adapterFor, type ComposerHandle, type HostAdapter } from '../adapters';
import { countWords } from '../adapters/base';
import { mountOverlay } from '../ui/overlay';
import type { OverlayController } from '../ui/types';
import type { TextSnapshot } from '../shared/types';
import { SessionClient } from './session-client';
import { shareBody, shareUrl } from './share';

const MIN_WORDS = 40;
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

  const send = (snapshot: TextSnapshot, reason: 'initial' | 'edit') => {
    if (countWords(snapshot.text) < MIN_WORDS && !sentInitial) return; // wait until there is something to analyse
    if (!sentInitial) {
      sentInitial = true;
      reason = 'initial';
    }
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
    },
  });

  const unsubState = client.onState((state) => overlay.update(state));
  const unsubDisabled = client.onDisabled(() => teardown());
  const unsubError = client.onError(() => {
    /* surfaced by the overlay through pass status; nothing else to do here */
  });

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
  send(handle.getSnapshot(), 'initial');
}

function sessionForHandle(handle: ComposerHandle): Session | undefined {
  for (const s of sessions.values()) if (s.handle === handle) return s;
  return undefined;
}

function scan(adapter: HostAdapter): void {
  // Drop sessions whose composer went away.
  for (const s of Array.from(sessions.values())) if (!s.handle.isAlive()) s.teardown();
  for (const handle of adapter.findComposers(document)) {
    if (!sessionForHandle(handle)) startSession(adapter, handle);
  }
}

export function main(): void {
  const adapter = adapterFor(new URL(location.href));
  if (!adapter) return;
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
