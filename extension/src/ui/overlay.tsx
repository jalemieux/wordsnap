// Overlay entry: a closed Shadow DOM on document.documentElement hosting the Preact app.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComposerHandle } from '../adapters/types';
import type { SessionState, Span } from '../shared/types';
import { emptySession } from '../shared/types';
import css from './styles.css';
import { bodyText } from './format';
import { ChallengesPanel } from './components/ChallengesPanel';
import { ExportBar } from './components/ExportBar';
import { HighlightLayer, type HighlightItem, type HighlightStatus, type RectLike } from './components/HighlightLayer';
import { HoverCard, type CardFinding } from './components/HoverCard';
import { PreviewModal, type PreviewTab } from './components/PreviewModal';
import { Toast } from './components/Toast';
import type { MountOverlay, OverlayCallbacks, OverlayController } from './types';

const PANEL_W = 336;
const PANEL_GAP = 14;
const EXPORT_H = 40;

interface Layout {
  anchor: RectLike;
  viewport: { width: number; height: number };
  rects: Record<string, RectLike[]>;
  panel: Record<string, string>;
  exportStyle: Record<string, string> | null; // null -> render inside the panel
}

interface Store {
  state: SessionState;
  layout: Layout;
  text: string;
}

type Listener = () => void;

function toRects(range: Range | null): RectLike[] {
  if (!range) return [];
  const out: RectLike[] = [];
  const rs = range.getClientRects();
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    if (r.width === 0 && r.height === 0) continue;
    out.push({ top: r.top, left: r.left, width: r.width, height: r.height });
  }
  return out;
}

function highlightStatusFor(kind: 'clarity' | 'claim' | 'challenge', verdict?: string): HighlightStatus | null {
  if (kind === 'clarity') return 'clarity';
  if (kind === 'challenge') return 'challenge';
  if (verdict === 'contradicted' || verdict === 'needs_precision' || verdict === 'supported' || verdict === 'unverifiable') return verdict;
  return null;
}

/** Everything that gets a box in the highlight layer, computed from state alone (rects are added in layout). */
export function highlightTargets(state: SessionState): Omit<HighlightItem, 'rects'>[] {
  const out: Omit<HighlightItem, 'rects'>[] = [];
  for (const c of state.clarity) {
    if (c.status !== 'open' || !c.span) continue;
    out.push({ id: c.id, status: 'clarity', span: c.span, label: `Clarity note: ${c.quote}` });
  }
  for (const c of state.claims) {
    if (c.status !== 'open' || !c.span) continue;
    const st = highlightStatusFor('claim', c.data.verdict?.status);
    if (!st) continue;
    out.push({ id: c.id, status: st, span: c.span, label: `${st.replace('_', ' ')}: ${c.quote}` });
  }
  for (const ch of state.challenges) {
    if (ch.status === 'dropped') continue;
    ch.spans.forEach((sp, i) => out.push({ id: `${ch.id}#${i}`, status: 'challenge', span: sp, label: '' }));
  }
  return out;
}

function computeLayout(handle: ComposerHandle, state: SessionState): Layout {
  const a = handle.anchorRect();
  const anchor = { top: a.top, left: a.left, width: a.width, height: a.height };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const rects: Record<string, RectLike[]> = {};
  for (const t of highlightTargets(state)) rects[t.id] = toRects(handle.rangeFor(t.span));

  const roomRight = viewport.width - (anchor.left + anchor.width);
  const docked = roomRight >= PANEL_W + PANEL_GAP + 8 && anchor.height >= 240;
  const panel: Record<string, string> = docked
    ? {
        left: `${anchor.left + anchor.width + PANEL_GAP}px`,
        top: `${Math.max(8, anchor.top)}px`,
        maxHeight: `${Math.min(anchor.height, viewport.height - Math.max(8, anchor.top) - 16)}px`,
      }
    : { right: '16px', bottom: '16px', maxHeight: '70vh' };

  const belowFits = viewport.height - (anchor.top + anchor.height) >= EXPORT_H + 8;
  const exportStyle = belowFits
    ? { left: `${anchor.left}px`, top: `${anchor.top + anchor.height + 6}px`, width: `${anchor.width}px` }
    : null;
  return { anchor, viewport, rects, panel, exportStyle };
}

function App({ store, subscribe, handle, callbacks }: { store: Store; subscribe: (l: Listener) => () => void; handle: ComposerHandle; callbacks: OverlayCallbacks }) {
  const [, tick] = useState(0);
  useEffect(() => subscribe(() => tick((n) => n + 1)), [subscribe]);
  const { state, layout, text } = store;

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [cardHover, setCardHover] = useState(false);
  const [hot, setHot] = useState<ReadonlySet<string>>(new Set());
  const [modal, setModal] = useState<PreviewTab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  // Drop pins/hover for findings that are no longer open.
  const findById = (id: string | null): CardFinding | null => {
    if (!id) return null;
    const cl = state.clarity.find((c) => c.id === id);
    if (cl) return { kind: 'clarity', f: cl };
    const cm = state.claims.find((c) => c.id === id);
    if (cm) return { kind: 'claim', f: cm };
    return null;
  };
  const activeId = pinnedId ?? (cardHover ? hoverId ?? null : hoverId);
  const active = findById(activeId);
  useEffect(() => {
    if (pinnedId && !findById(pinnedId)) setPinnedId(null);
  }, [state]);

  const items: HighlightItem[] = useMemo(
    () => highlightTargets(state).map((t) => ({ ...t, rects: layout.rects[t.id] ?? [] })),
    [state, layout],
  );
  const hotIds = useMemo(() => {
    const s = new Set<string>();
    for (const chId of hot) state.challenges.find((c) => c.id === chId)?.spans.forEach((_, i) => s.add(`${chId}#${i}`));
    return s;
  }, [hot, state]);

  const doCopy = async (t: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(t);
      setToast(msg);
    } catch {
      setToast('Copy failed. Select the text and copy it yourself.');
    }
  };

  const exportBar = (
    <ExportBar
      state={state}
      text={text}
      style={layout.exportStyle ?? undefined}
      inPanel={!layout.exportStyle}
      onCopy={() => {
        void callbacks.onCopy().then(() => setToast('Copied to clipboard'), () => setToast('Copy failed'));
      }}
      onShare={(t) => callbacks.onShare(t)}
      onPreview={() => setModal('email')}
    />
  );

  const anchorRect = active ? layout.rects[active.f.id]?.[0] : undefined;

  return (
    <div class="ws-root">
      <HighlightLayer
        items={items}
        hot={hotIds}
        pinnedId={pinnedId}
        onHover={(id) => setHoverId(id)}
        onPin={(id) => setPinnedId((cur) => (cur === id ? null : id))}
      />
      {active && anchorRect ? (
        <HoverCard
          finding={active}
          anchor={anchorRect}
          pinned={pinnedId === active.f.id}
          viewport={layout.viewport}
          onEnter={() => setCardHover(true)}
          onLeave={() => setCardHover(false)}
          onApply={(id, span: Span, replacement) => {
            setPinnedId(null);
            setHoverId(null);
            callbacks.onApply(id, span, replacement);
            setToast('Applied. Your words, one phrase tightened.');
          }}
          onKeep={(id) => {
            setPinnedId(null);
            setHoverId(null);
            callbacks.onKeep(id);
            setToast('Kept as written.');
          }}
        />
      ) : null}
      <ChallengesPanel state={state} style={layout.panel} onHot={(ids) => setHot(new Set(ids))} footer={layout.exportStyle ? null : exportBar} now={now} />
      {layout.exportStyle ? exportBar : null}
      {modal ? (
        <PreviewModal
          state={state}
          text={text}
          tab={modal}
          onTab={setModal}
          onClose={() => setModal(null)}
          onCopy={(t, msg) => void doCopy(t, msg)}
          onShare={(t) => {
            setModal(null);
            callbacks.onShare(t);
          }}
        />
      ) : null}
      <Toast text={toast} />
    </div>
  );
}

export const mountOverlay: MountOverlay = ({ handle, callbacks, initial }) => {
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

  const state0 = initial ?? emptySession(handle.key, 'generic');
  const store: Store = { state: state0, text: safeText(handle), layout: computeLayout(handle, state0) };
  const listeners = new Set<Listener>();
  const subscribe = (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const notify = () => listeners.forEach((l) => l());

  render(<App store={store} subscribe={subscribe} handle={handle} callbacks={callbacks} />, mount);

  let raf = 0;
  const relayout = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      store.text = safeText(handle);
      store.layout = computeLayout(handle, store.state);
      notify();
    });
  };
  const onScroll = () => relayout();
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => relayout()) : null;
  ro?.observe(handle.element);

  return {
    update(state) {
      store.state = state;
      store.text = safeText(handle);
      store.layout = computeLayout(handle, state);
      notify();
    },
    relayout,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
      render(null, mount);
      host.remove();
    },
  } satisfies OverlayController;
};

function safeText(handle: ComposerHandle): string {
  try {
    return handle.getSnapshot().text;
  } catch {
    return '';
  }
}

export { bodyText };
