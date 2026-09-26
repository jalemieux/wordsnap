// src/ui/cowriter/overlay.tsx
// The co-writer overlay: badge, panel (draggable), the shape pane beside the draft, source marks, and the Tweak pill
// and card. Mounted in a closed shadow root (open in dev builds). Renders state; every action goes out as a callback.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ComposerHandle } from '../../adapters/types';
import type { CowriterState } from '../../shared/cowriter';
import type { Span } from '../../shared/types';
import type { RectLike } from '../components/HighlightLayer';
import { launcherStyle } from '../components/Launcher';
import { Toast } from '../components/Toast';
import css from '../styles.css';
import type { Stage } from './copy';
import { paneGeometry, releasePane, sourceRects, toRects } from './geometry';
import { busy, Panel } from './Panel';
import { PANEL_W, placePanel } from './place';
import { RevisePane } from './RevisePane';
import { ShapePane, type PaneGeometry } from './ShapePane';
import { TweakCard, TweakPill, type TweakAsk } from './TweakCard';
import type { CowriterCallbacks, CowriterOverlay, MountCowriter } from './types';

type Pos = { left: number; top: number };

interface Store {
  state: CowriterState;
  open: boolean;
  panelPos: Pos | null;
  viewport: { width: number; height: number };
  anchor: RectLike;
  pane?: PaneGeometry;
  text: string;
}

function measure(handle: ComposerHandle, store: Store): void {
  store.viewport = { width: window.innerWidth, height: window.innerHeight };
  const a = handle.anchorRect();
  store.anchor = { left: a.left, top: a.top, width: a.width, height: a.height };
  const showPane = store.open && (store.state.shape?.status === 'open' || store.state.revise?.status === 'open');
  store.pane = showPane ? paneGeometry(handle, store.viewport) : undefined;
  if (!showPane) releasePane(handle);
  try {
    store.text = handle.getSnapshot().text;
  } catch {
    store.text = '';
  }
}

function panelStyle(store: Store): { style: Record<string, string>; box: RectLike } {
  const vp = store.viewport;
  if (store.panelPos) {
    const at = placePanel(store.panelPos, vp);
    return { style: { left: `${at.left}px`, top: `${at.top}px`, maxHeight: `${at.maxHeight}px` }, box: { left: at.left, top: at.top, width: PANEL_W, height: at.maxHeight } };
  }
  const maxH = Math.round(vp.height * 0.7);
  return { style: { right: '16px', bottom: '16px', maxHeight: `${maxH}px` }, box: { left: vp.width - 16 - PANEL_W, top: vp.height - 16 - maxH, width: PANEL_W, height: maxH } };
}

function cardPosition(handle: ComposerHandle, store: Store, tweakSpan: { start: number; end: number } | undefined, fallback: Pos | undefined): Pos {
  if (fallback) return fallback;
  // A draft-wide change sits at the top of the draft, not under its last line.
  const r = tweakSpan && !(tweakSpan.start === 0 && tweakSpan.end >= store.text.length) ? toRects(handle.rangeFor(tweakSpan)).pop() : undefined;
  return r ? { left: Math.max(8, r.left), top: r.top + r.height + 6 } : { left: store.anchor.left + 20, top: store.anchor.top + 40 };
}

function App({ store, subscribe, handle, callbacks, setOpen, movePanel }: { store: Store; subscribe: (l: () => void) => () => void; handle: ComposerHandle; callbacks: CowriterCallbacks; setOpen: (o: boolean) => void; movePanel: (p: Pos | null, done: boolean) => void }) {
  const [, tick] = useState(0);
  useEffect(() => subscribe(() => tick((n) => n + 1)), []);
  const { state, open } = store;
  const sh = state.shape;
  const [stage, setStage] = useState<Stage>(sh?.status === 'applied' || sh?.status === 'kept' ? 'tweak' : 'tune');
  const [marks, setMarks] = useState<RectLike[]>([]);
  const [hotQuote, setHotQuote] = useState<string | null>(null);
  const [pill, setPill] = useState<(TweakAsk & { at: Pos }) | null>(null);
  const [ask, setAsk] = useState<(TweakAsk & { at: Pos }) | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hotComment, setHotComment] = useState<string | null>(null);
  const rv = state.revise;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Shape running or open: the Shape stage is where the user is.
  useEffect(() => {
    if (sh?.status === 'running' || sh?.status === 'open') setStage('shape');
  }, [sh?.status]);
  useEffect(() => {
    if (rv?.status === 'running' || rv?.status === 'open') setStage('tweak');
  }, [rv?.status]);

  // Selection in the editor → the ✎ Tweak pill, below the end of the selection. Not while a shape is open or a card is up.
  useEffect(() => {
    const onSel = () => {
      if (!open || store.state.shape?.status === 'open' || store.state.revise?.status === 'open' || ask || store.state.tweak) return setPill(null);
      const span = handle.selectionSpan?.() ?? null;
      if (!span || span.end - span.start < 3) return setPill(null);
      const rects = toRects(handle.rangeFor(span));
      const last = rects[rects.length - 1] ?? { left: store.anchor.left + 20, top: store.anchor.top + 20, width: 0, height: 0 };
      setPill({ quote: store.text.slice(span.start, span.end), span, at: { left: Math.max(8, last.left + last.width - 40), top: last.top + last.height + 6 } });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [open, ask]);

  // Pointer over the draft while the pane is open → light the pane sentences that use that fragment.
  useEffect(() => {
    if (!store.pane || !sh?.view) return;
    const quotes = [...new Set(sh.view.paragraphs.flatMap((p) => p.sentences.flatMap((s) => s.from)))];
    const boxes = quotes.map((q) => ({ q, rects: sourceRects(handle, store.text, [q]) }));
    const onMove = (e: MouseEvent) => {
      const hit = boxes.find((b) => b.rects.some((r) => e.clientX >= r.left && e.clientX <= r.left + r.width && e.clientY >= r.top && e.clientY <= r.top + r.height));
      setHotQuote(hit?.q ?? null);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [store.pane, sh?.view]);

  const panel = panelStyle(store);
  const dragPanel = (e: PointerEvent) => {
    const head = e.currentTarget as HTMLElement | null;
    const el = head?.closest('.ws-panel') as HTMLElement | null;
    if (!head || !el) return;
    e.preventDefault();
    const box = el.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    head.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => movePanel({ left: ev.clientX - dx, top: ev.clientY - dy }, false);
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      movePanel(store.panelPos, true);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  };

  const tweak = state.tweak;
  const cardAt = cardPosition(handle, store, tweak?.span, ask?.at ?? pill?.at);
  const leaveComment = (c: { text: string; quote?: string; span?: Span }) => {
    callbacks.onComment({ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...c });
    setStage('tweak');
  };
  // Margin marks: one amber run per commented passage, numbered at its start. Drawn from the live DOM each render.
  const commentMarks = open
    ? state.comments.flatMap((c, i) => {
        if (!c.span || c.stale) return [];
        const rects = toRects(handle.rangeFor(c.span));
        return rects.map((r, ri) => ({ id: c.id, n: i + 1, first: ri === 0, r }));
      })
    : [];

  return (
    <div class="ws-root">
      {/* While the shaped draft is beside the dump, or a draft-wide change sits over it, the panel is up and the badge would sit on the card. */}
      {store.pane || tweak?.scope === 'draft' ? null : <button class={`ws-launcher${open ? ' open' : ''}${busy(state) ? ' running' : ''}`} style={launcherStyle(store.anchor, open ? panel.box : undefined)} onClick={() => setOpen(!open)} title={open ? 'Hide WordSnap' : 'Open WordSnap'} aria-label={open ? 'Hide WordSnap' : 'Open WordSnap'} aria-pressed={open}>
        <span class="ws-launcher-mark">W</span>
        {busy(state) ? <span class="ws-launcher-ring" /> : null}
      </button>}
      {open && store.pane && sh?.status === 'open' && sh.view ? (
        <ShapePane
          shape={sh}
          tuneNow={state.tune}
          geo={store.pane}
          hotQuote={hotQuote}
          onHover={(from) => setMarks(from ? sourceRects(handle, store.text, from) : [])}
          onFlip={callbacks.onFlip}
          onFill={callbacks.onFill}
          onApply={(text) => {
            setMarks([]);
            const ok = callbacks.onApplyShape(text);
            if (ok) setStage('tweak');
            setToast(ok ? 'Applied. Select any passage to tweak it.' : 'The editor did not accept the change.');
          }}
          onKeep={() => {
            setMarks([]);
            callbacks.onKeepShape();
            setStage('tweak');
          }}
          onReshape={callbacks.onShape}
        />
      ) : null}
      {marks.map((r) => (
        <div class="cw-mark" style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }} />
      ))}
      {commentMarks.map((m) => (
        <div class={`cw-cmark${hotComment === m.id ? ' hot' : ''}`} data-comment={m.id} style={{ left: `${m.r.left}px`, top: `${m.r.top}px`, width: `${Math.max(2, m.r.width)}px`, height: `${m.r.height}px` }} onMouseEnter={() => setHotComment(m.id)} onMouseLeave={() => setHotComment(null)}>
          {m.first ? <span class="cw-cnum">{m.n}</span> : null}
        </div>
      ))}
      {open && store.pane && rv?.status === 'open' && sh?.status !== 'open' ? (
        <RevisePane
          revise={rv}
          geo={store.pane}
          onHover={(span) => setMarks(span ? toRects(handle.rangeFor(span)) : [])}
          onApply={(text, changes) => {
            setMarks([]);
            const ok = callbacks.onApplyRevise(text, changes);
            setToast(ok ? `Applied ${changes.length} change${changes.length === 1 ? '' : 's'}. Undo in the editor takes them back.` : 'Your draft changed; revise again.');
          }}
          onKeep={() => {
            setMarks([]);
            callbacks.onKeepRevise();
          }}
          onRevise={callbacks.onRevise}
        />
      ) : null}
      {open ? (
        <Panel
          state={state}
          stage={stage}
          onStage={setStage}
          onTune={callbacks.onTune}
          onShape={callbacks.onShape}
          onCommentDraft={(text) => leaveComment({ text })}
          onRemoveComment={callbacks.onRemoveComment}
          onRevise={callbacks.onRevise}
          hotComment={hotComment}
          onHotComment={setHotComment}
          onClose={() => setOpen(false)}
          compact={(sh?.status === 'open' && stage === 'shape') || (rv?.status === 'open' && !!store.pane)}
          style={panel.style}
          onDragStart={dragPanel}
          onResetPlace={store.panelPos ? () => movePanel(null, true) : undefined}
        />
      ) : null}
      {open && pill && !ask && !tweak ? (
        <TweakPill
          at={pill.at}
          onOpen={() => {
            setAsk(pill);
            setPill(null);
          }}
        />
      ) : null}
      {open ? (
        <TweakCard
          ask={ask}
          tweak={tweak}
          tune={state.tune}
          at={cardAt}
          onSend={(instruction, mode) => {
            const base = tweak ?? (ask ? { id: `t${Date.now().toString(36)}`, quote: ask.quote, span: ask.span, scope: ask.scope } : null);
            if (!base) return;
            callbacks.onTweak({ id: base.id, quote: base.quote, span: base.span, instruction, mode, ...(base.scope ? { scope: base.scope } : {}) });
            setAsk(null);
          }}
          onComment={
            ask && !tweak
              ? (text) => {
                  leaveComment({ text, quote: ask.quote, span: ask.span });
                  setAsk(null);
                  setToast('Comment added. Press Revise in the panel when you have left them all.');
                }
              : undefined
          }
          onApply={() => {
            if (!tweak) return;
            const text = tweak.steps[tweak.steps.length - 1]?.text;
            if (!text) return;
            const ok = callbacks.onApplyTweak(tweak.id, tweak.quote, tweak.span.start, text);
            setToast(ok ? 'Applied. Undo in the editor takes it back.' : tweak.scope === 'draft' ? 'The draft changed; ask again.' : 'The passage moved; select it again.');
            if (ok) setStage('tweak');
          }}
          onKeep={() => {
            setAsk(null);
            if (tweak) callbacks.onKeepTweak(tweak.id);
          }}
        />
      ) : null}
      <Toast text={toast} />
    </div>
  );
}

export const mountCowriter: MountCowriter = ({ handle, callbacks, initial, startOpen }) => {
  const host = document.createElement('wordsnap-overlay');
  host.setAttribute('data-wordsnap', '');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: __WORDSNAP_DEV__ ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const mount = document.createElement('div');
  shadow.appendChild(mount);
  document.documentElement.appendChild(host);

  const store: Store = { state: initial, open: !!startOpen, panelPos: null, viewport: { width: 0, height: 0 }, anchor: { left: 0, top: 0, width: 0, height: 0 }, text: '' };
  measure(handle, store);
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  const notify = () => listeners.forEach((l) => l());
  const setOpen = (open: boolean) => {
    if (store.open === open) return;
    store.open = open;
    measure(handle, store);
    notify();
    callbacks.onOpenChange?.(open);
  };
  const movePanel = (pos: Pos | null, done: boolean) => {
    store.panelPos = pos ? (() => {
      const at = placePanel(pos, store.viewport);
      return { left: at.left, top: at.top };
    })() : null;
    notify();
    if (done) callbacks.onPanelMove?.(store.panelPos);
  };

  render(<App store={store} subscribe={subscribe} handle={handle} callbacks={callbacks} setOpen={setOpen} movePanel={movePanel} />, mount);

  let raf = 0;
  const relayout = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      measure(handle, store);
      notify();
    });
  };
  window.addEventListener('scroll', relayout, true);
  window.addEventListener('resize', relayout);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null;
  ro?.observe(handle.element);

  const controller: CowriterOverlay = {
    update(state) {
      store.state = state;
      measure(handle, store);
      notify();
    },
    relayout,
    setOpen,
    isOpen: () => store.open,
    setPanelPos(pos) {
      store.panelPos = pos;
      notify();
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', relayout, true);
      window.removeEventListener('resize', relayout);
      ro?.disconnect();
      releasePane(handle);
      render(null, mount);
      host.remove();
    },
  };
  return controller;
};
