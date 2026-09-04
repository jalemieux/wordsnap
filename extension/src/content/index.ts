// Content script entry. Finds composers on the host page, opens a session per composer, streams snapshots
// to the background, and mounts the overlay. Nothing here talks to a model or holds a credential.
import { adapterFor, type ComposerHandle, type HostAdapter } from '../adapters';
import { countWords } from '../adapters/base';
import { mountOverlay } from '../ui/overlay';
import type { OverlayController } from '../ui/types';
import type { TextSnapshot } from '../shared/types';
import { SessionClient } from './session-client';
import { log } from '../shared/log';

const MIN_WORDS = 40; // auto mode
const MIN_WORDS_MANUAL = 8; // after the user clicks the badge
const EDIT_DEBOUNCE_MS = 800;
const SCAN_THROTTLE_MS = 250;
/** A composer must be missing or hidden on this many consecutive scans before its session closes. Hosts re-render. */
const HIDDEN_SCANS_TO_CLOSE = 3;
/** How long a closed session's UI state (panel open, analysis armed) survives for a composer with the same key. */
const CARRY_TTL_MS = 15_000;

/** UI state that survives a session restart on the same composer, so a host re-render does not collapse the panel. */
interface Carry {
  open: boolean;
  armed: boolean;
}

interface Session {
  handle: ComposerHandle;
  client: SessionClient;
  overlay: OverlayController;
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
  const client = new SessionClient({ type: 'session/open', sessionKey, host: adapter.id, platform: handle.platform });
  let sentInitial = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  // Analysis is armed by the user clicking the badge, or by the autoAnalyze setting (delivered via session/config).
  let armed = carry?.armed ?? false;
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
      onOpenChange(open) {
        if (!open) return;
        if (!armed) log.info(`composer ${handle.key}: analysis armed by the user`);
        armed = true;
        if (debounce) clearTimeout(debounce);
        send(handle.getSnapshot(), sentInitial ? 'edit' : 'initial');
      },
      onAnalyze() {
        // Flush whatever is in the editor right now, then ask. Port messages are ordered.
        if (debounce) clearTimeout(debounce);
        debounce = null;
        armed = true;
        const snapshot = handle.getSnapshot();
        if (!sentInitial) {
          send(snapshot, 'initial');
          return;
        }
        log.info(`composer ${handle.key}: re-analyze (snapshot v${snapshot.version})`);
        client.sendSnapshot(snapshot, 'edit');
        client.analyze();
      },
    },
    minWords: MIN_WORDS_MANUAL,
    startOpen: carry?.open ?? false,
  });

  const unsubState = client.onState((state) => {
    const p = state.passes;
    log.info(`state v${state.snapshotVersion}: A=${p.A.state} B=${p.B.state} C=${p.C.state}`, p.A.error ?? p.B.error ?? p.C.error ?? '');
    overlay.update(state);
  });
  const unsubLost = client.onLost(() => {
    log.warn('WordSnap was reloaded or updated; removing this stale overlay. The new version attaches on its own.');
    for (const s of Array.from(sessions.values())) s.teardown();
    stopScanning?.();
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
    unsubLost();
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

  sessions.set(sessionKey, { handle, client, overlay, hiddenScans: 0, carry: () => ({ open: overlay.isOpen(), armed }), teardown });
  log.info(`session ${sessionKey} opened on ${adapter.id} composer ${handle.key}${carry ? ` (carried: open=${carry.open}, armed=${carry.armed})` : ''}`);
  send(handle.getSnapshot(), 'initial');
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
  stopScanning = () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
    stopScanning = null;
  };
  window.addEventListener('pagehide', () => {
    for (const s of Array.from(sessions.values())) s.teardown();
  });
}

if (typeof document !== 'undefined' && !(globalThis as { __WORDSNAP_NO_AUTOSTART__?: boolean }).__WORDSNAP_NO_AUTOSTART__) {
  // Guard against running twice in one world (manifest injection plus scripting.executeScript on install).
  const g = globalThis as { __wordsnapStarted?: boolean };
  if (!g.__wordsnapStarted) {
    g.__wordsnapStarted = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => main(), { once: true });
    else main();
  }
}
