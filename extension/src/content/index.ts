// Content script entry. Finds composers on the host page, opens a session per composer, streams snapshots
// to the background, and mounts the overlay. Nothing here talks to a model or holds a credential.
import { activateGeneric, adapterFor, genericAdapter, type ComposerHandle, type HostAdapter } from '../adapters';
import { mountCowriter } from '../ui/cowriter/overlay';
import type { CowriterOverlay } from '../ui/cowriter/types';
import { DEFAULT_TUNE, emptyCowriterState } from '../shared/cowriter';
import type { TextSnapshot } from '../shared/types';
import { locateQuote } from '../shared/anchoring';
import { sendToBackground, type ContentRequest, type ContentResponse } from '../shared/messages';
import { SessionClient } from './session-client';
import { loadPanelPos, savePanelPos } from './panel-pos';
import { log } from '../shared/log';

const EDIT_DEBOUNCE_MS = 800;
const SCAN_THROTTLE_MS = 250;
/** A composer must be missing or hidden on this many consecutive scans before its session closes. Hosts re-render. */
const HIDDEN_SCANS_TO_CLOSE = 3;
/** How long a closed session's UI state (panel open, analysis armed) survives for a composer with the same key. */
const CARRY_TTL_MS = 15_000;

/** UI state that survives a session restart on the same composer, so a host re-render does not collapse the panel. */
interface Carry {
  open: boolean;
}

interface Session {
  handle: ComposerHandle;
  client: SessionClient;
  overlay: CowriterOverlay;
  hiddenScans: number;
  carry(): Carry;
  teardown(): void;
}

const sessions = new Map<string, Session>();
const carried = new Map<string, { carry: Carry; at: number }>();
let stopScanning: (() => void) | null = null;

function newSessionKey(adapter: HostAdapter, handle: ComposerHandle): string {
  return `${adapter.id}:${handle.key}:${Date.now().toString(36)}`;
}

function startSession(adapter: HostAdapter, handle: ComposerHandle, carry?: Carry): void {
  const sessionKey = newSessionKey(adapter, handle);
  const client = new SessionClient({ type: 'session/open', sessionKey, host: adapter.id, platform: handle.platform, origin: location.origin });
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastSent: string | null = null;
  // Sending text to the background runs nothing: the co-writer only works on a click.
  const send = (snapshot: TextSnapshot) => {
    if (snapshot.text === lastSent) return;
    lastSent = snapshot.text;
    client.sendSnapshot(snapshot);
  };
  const flush = () => {
    if (debounce) clearTimeout(debounce);
    debounce = null;
    send(handle.getSnapshot());
  };

  const overlay = mountCowriter({
    handle,
    initial: emptyCowriterState(sessionKey, adapter.id, DEFAULT_TUNE),
    startOpen: carry?.open ?? false,
    callbacks: {
      onTune: (tune) => client.post({ type: 'tune/set', sessionKey, tune }),
      onShape: () => {
        flush();
        client.post({ type: 'shape/run', sessionKey });
      },
      onFlip: (choice) => client.post({ type: 'shape/flip', sessionKey, choice }),
      onFill: (gap) => client.post({ type: 'shape/fill', sessionKey, gap }),
      onApplyShape(text) {
        const snap = handle.getSnapshot();
        const ok = handle.applyEdit({ start: 0, end: snap.text.length }, text);
        if (ok) {
          client.post({ type: 'shape/action', sessionKey, action: 'applied' });
          flush();
          log.info(`composer ${handle.key}: shape applied (${text.length} chars)`);
        } else log.warn(`composer ${handle.key}: the editor rejected the shaped draft`);
        overlay.relayout();
        return ok;
      },
      onKeepShape: () => client.post({ type: 'shape/action', sessionKey, action: 'kept' }),
      onTweak: (req) => {
        flush();
        client.post({ type: 'tweak/run', sessionKey, ...req });
      },
      onApplyTweak(id, quote, hint, text) {
        const snap = handle.getSnapshot();
        const span = locateQuote(snap.text, quote, hint);
        const ok = !!span && handle.applyEdit(span, text);
        if (ok) {
          client.post({ type: 'tweak/action', sessionKey, id, action: 'applied' });
          flush();
        } else log.warn(`composer ${handle.key}: tweak ${id} not applied (${span ? 'editor refused' : 'passage moved'})`);
        overlay.relayout();
        return ok;
      },
      onKeepTweak: (id) => client.post({ type: 'tweak/action', sessionKey, id, action: 'kept' }),
      onPanelMove: (pos) => void savePanelPos(location.origin, pos),
    },
  });
  void loadPanelPos(location.origin).then((pos) => pos && overlay.setPanelPos(pos));

  const unsubState = client.onState((state) => overlay.update(state));
  const unsubLost = client.onLost(() => {
    log.warn('WordSnap was reloaded or updated; removing this stale overlay. The new version attaches on its own.');
    for (const s of Array.from(sessions.values())) s.teardown();
    stopScanning?.();
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
      send(snapshot);
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
    unsubLost();
    unsubDisabled();
    unsubError();
    unsubChange();
    scroller.removeEventListener('scroll', relayout);
    window.removeEventListener('scroll', relayout, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', relayout);
    overlay.destroy();
    client.close();
  };

  sessions.set(sessionKey, { handle, client, overlay, hiddenScans: 0, carry: () => ({ open: overlay.isOpen() }), teardown });
  log.info(`session ${sessionKey} opened on ${adapter.id} composer ${handle.key}${carry ? ` (carried: open=${carry.open})` : ''}`);
  send(handle.getSnapshot());
}

/** One line on why a composer no longer qualifies, for the page console. */
function describeComposer(handle: ComposerHandle): string {
  const el = handle.element;
  const r = el.getBoundingClientRect();
  let display = '?';
  try {
    display = getComputedStyle(el).display;
  } catch {
    /* detached */
  }
  return `alive=${handle.isAlive()} connected=${el.isConnected} size=${Math.round(r.width)}x${Math.round(r.height)} display=${display} contenteditable=${el.getAttribute('contenteditable')}`;
}

function rememberCarry(s: Session): void {
  carried.set(s.handle.key, { carry: s.carry(), at: Date.now() });
}

function takeCarry(key: string): Carry | undefined {
  const c = carried.get(key);
  carried.delete(key);
  return c && Date.now() - c.at <= CARRY_TTL_MS ? c.carry : undefined;
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
  // Drop sessions whose composer went away or stayed hidden. A single hidden scan is a host re-render, not a close.
  for (const s of Array.from(sessions.values())) {
    const ok = s.handle.isAlive() && isVisibleComposer(s.handle);
    if (ok) {
      s.hiddenScans = 0;
      continue;
    }
    s.hiddenScans += 1;
    if (s.hiddenScans === 1) log.info(`composer ${s.handle.key} not visible (${describeComposer(s.handle)}); closing if it stays that way`);
    if (s.hiddenScans < HIDDEN_SCANS_TO_CLOSE) continue;
    log.info(`composer ${s.handle.key} gone or hidden, closing its session (${describeComposer(s.handle)})`);
    rememberCarry(s);
    s.teardown();
  }
  for (const handle of adapter.findComposers(document)) {
    if (!isVisibleComposer(handle)) continue;
    if (sessionForHandle(handle)) continue;
    // One session per composer key. Gmail swaps the body element under the same compose window;
    // when that happens the old session is closed and a fresh one starts on the new element with the same UI state.
    const dup = sessionForKey(handle.key);
    if (dup) {
      if (dup.handle.isAlive() && isVisibleComposer(dup.handle)) {
        // Two live elements under one key is an adapter bug (two editors in one compose window); never flap between them.
        if (dup.hiddenScans === 0) log.warn(`composer ${handle.key}: a second editor matched (${describeComposer(handle)}); keeping the current one`);
        continue;
      }
      log.info(`composer ${handle.key} was replaced (old: ${describeComposer(dup.handle)}), restarting its session`);
      rememberCarry(dup);
      dup.teardown();
    }
    startSession(adapter, handle, takeCarry(handle.key));
  }
}

function sessionForKey(key: string): Session | undefined {
  for (const s of sessions.values()) if (s.handle.key === key) return s;
  return undefined;
}

let running: HostAdapter | null = null;

function run(adapter: HostAdapter): void {
  running = adapter;
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
  stopScanning = () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
    stopScanning = null;
  };
  window.addEventListener('pagehide', () => {
    for (const s of Array.from(sessions.values())) s.teardown();
  });
}

/**
 * Switch the generic adapter on for this page (any long enough textarea or contenteditable). Called when the popup
 * says so, or on load when the background says the origin is always on. A second call rescans, nothing more.
 */
export function activateHere(why: string): number {
  if (running) {
    if (running === genericAdapter) scan(genericAdapter);
    return sessions.size;
  }
  activateGeneric();
  log.info(`active on ${location.hostname} with the generic adapter (${why})`);
  run(genericAdapter);
  return sessions.size;
}

export function main(): void {
  const adapter = adapterFor(new URL(location.href));
  if (adapter) {
    log.info(`active on ${location.hostname} with the ${adapter.id} adapter`);
    run(adapter);
    return;
  }
  // Not Gmail, X or LinkedIn: WordSnap runs here only when asked to. The toolbar popup asks through tabs.sendMessage
  // right after injecting this script (the listener below); on an origin the user set to always on, the background
  // says so now.
  sendToBackground({ type: 'site/registered', origin: location.origin })
    .then((r) => {
      if (r.type === 'site' && r.site.status === 'registered') activateHere('always on');
    })
    .catch((err: Error) => log.warn('could not ask whether this site is always on:', err.message));
}

if (typeof document !== 'undefined' && !(globalThis as { __WORDSNAP_NO_AUTOSTART__?: boolean }).__WORDSNAP_NO_AUTOSTART__) {
  // Guard against running twice in one world (manifest injection plus scripting.executeScript on install).
  const g = globalThis as { __wordsnapStarted?: boolean };
  if (!g.__wordsnapStarted) {
    g.__wordsnapStarted = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => main(), { once: true });
    else main();
    // The popup's "Use WordSnap here" lands here right after injection. Registered at once, before the DOM is ready,
    // so the message is never missed; the answer waits for the DOM when it must.
    chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, respond: (r: ContentResponse) => void) => {
      if (!msg || msg.type !== 'generic/activate') return false;
      const answer = () => respond({ type: 'generic/active', composers: activateHere('toolbar') });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', answer, { once: true });
        return true;
      }
      answer();
      return false;
    });
  }
}
