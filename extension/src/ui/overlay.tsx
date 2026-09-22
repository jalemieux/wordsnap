// Overlay entry: a closed Shadow DOM on document.documentElement hosting the Preact app.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComposerHandle } from '../adapters/types';
import type { SessionState, Span } from '../shared/types';
import { emptySession } from '../shared/types';
import css from './styles.css';
import { bodyText, structureGuiding, structureOpen } from './format';
import { mapStructure, outlineFill, type SlotFill, type StructureMap } from '../shared/structure-map';
import { ChallengesPanel } from './components/ChallengesPanel';
import { CompareView, outlineParagraphs, type CompareGeometry } from './components/CompareView';
import { HighlightLayer, type HighlightItem, type HighlightStatus, type RectLike } from './components/HighlightLayer';
import { HoverCard, type CardFinding } from './components/HoverCard';
import { Launcher } from './components/Launcher';
import { Toast } from './components/Toast';
import type { MountOverlay, OverlayCallbacks, OverlayController } from './types';

const PANEL_W = 336;
const PANEL_GAP = 14;
/** The compare pane sits beside the draft from this editor width; narrower, it sits over it. */
const COMPARE_MIN_WIDE = 720;
const COMPARE_GAP = 20;
const COMPARE_MIN_W = 320;
const COMPARE_MAX_W = 560;

interface Layout {
  anchor: RectLike;
  viewport: { width: number; height: number };
  rects: Record<string, RectLike[]>;
  panel: Record<string, string>;
  /** Panel box in viewport coordinates, so other pieces can stay out of its way. */
  panelBox: RectLike;
  docked: boolean;
  /** The structure proposal beside (or over) the draft, while one is open and the overlay is showing. */
  compare?: CompareGeometry;
  map?: StructureMap;
}

interface Store {
  state: SessionState;
  layout: Layout;
  text: string;
  open: boolean;
  minWords: number;
  /** Auto mode starts on its own; the panel then has no Start block. */
  autoAnalyze: boolean;
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

/** Width reserved in each editor for the compare pane, so a relayout only touches the host when it changes. */
const insets = new WeakMap<ComposerHandle, number>();
function applyInset(handle: ComposerHandle, px: number): void {
  if ((insets.get(handle) ?? 0) === px) return;
  insets.set(handle, px);
  handle.setInset?.(px);
}

const mapCache = new WeakMap<ComposerHandle, { key: string; map: StructureMap }>();
function structureMap(handle: ComposerHandle, text: string, paragraphs: string[]): StructureMap {
  const key = `${text}\u0000${paragraphs.join('\u0000')}`;
  const hit = mapCache.get(handle);
  if (hit && hit.key === key) return hit.map;
  const map = mapStructure(text, paragraphs);
  mapCache.set(handle, { key, map });
  return map;
}

/**
 * Where the compare pane goes. Beside the draft when the editor is wide enough for two columns: the editor gives up
 * its right half (a padding on the host element, restored when the proposal closes) and the pane is drawn there,
 * clipped to the editor's scroll frame. Otherwise over the draft, full width.
 */
function computeCompare(handle: ComposerHandle, map: StructureMap, viewport: { width: number; height: number }, guiding: boolean): CompareGeometry {
  const el = handle.element;
  const er = el.getBoundingClientRect();
  const sp = handle.scrollParent();
  const doc = el.ownerDocument;
  const frame = sp === doc.body || sp === doc.documentElement ? handle.anchorRect() : sp.getBoundingClientRect();
  const wide = er.width >= COMPARE_MIN_WIDE;
  // A guide must leave the editor free to type into: beside the draft it takes a narrower column, over it, nothing.
  const share = guiding ? 0.4 : 0.5;
  const width = wide ? Math.min(COMPARE_MAX_W, Math.max(COMPARE_MIN_W, Math.round(er.width * share))) : Math.round(er.width);
  applyInset(handle, wide ? width + COMPARE_GAP : 0);
  const top = Math.max(er.top, frame.top, 0);
  const bottom = Math.min(frame.bottom, viewport.height);
  const box: RectLike = { left: Math.round(wide ? er.right - width : er.left), top, width, height: Math.max(120, bottom - top) };
  let font = { family: '', size: '', lineHeight: '' };
  try {
    const cs = doc.defaultView?.getComputedStyle(el);
    if (cs) font = { family: cs.fontFamily, size: cs.fontSize, lineHeight: cs.lineHeight };
  } catch {
    /* no layout */
  }
  const sentences = wide ? map.draft.map((d) => toRects(handle.rangeFor(d.span))) : [];
  const trims = wide ? map.draft.map((d) => (d.trim ? toRects(handle.rangeFor(d.trim)) : null)) : [];
  return { box, wide, font, sentences, trims };
}

function computeLayout(handle: ComposerHandle, state: SessionState, open: boolean): Layout {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  // The compare pane first: it changes the editor's width, and every other rect is measured after that.
  let compare: CompareGeometry | undefined;
  let map: StructureMap | undefined;
  const st = state.structure;
  if (open && st && (structureOpen(state) || structureGuiding(state))) {
    // An outline maps each slot's fragments as one paragraph; the tags then say which slot a fragment feeds.
    map = structureMap(handle, safeText(handle), st.verdict === 'outline' ? (st.slots ?? []).map((s) => s.from.join(' ')) : st.paragraphs);
    compare = computeCompare(handle, map, viewport, structureGuiding(state));
  } else {
    applyInset(handle, 0);
  }
  const a = handle.anchorRect();
  const anchor = { top: a.top, left: a.left, width: a.width, height: a.height };
  const rects: Record<string, RectLike[]> = {};
  for (const t of highlightTargets(state)) rects[t.id] = toRects(handle.rangeFor(t.span));

  const roomRight = viewport.width - (anchor.left + anchor.width);
  const docked = roomRight >= PANEL_W + PANEL_GAP + 8 && anchor.height >= 240;
  let panel: Record<string, string>;
  let panelBox: RectLike;
  if (docked) {
    const top = Math.max(8, anchor.top);
    const maxH = Math.min(anchor.height, viewport.height - top - 16);
    panel = { left: `${anchor.left + anchor.width + PANEL_GAP}px`, top: `${top}px`, maxHeight: `${maxH}px` };
    panelBox = { left: anchor.left + anchor.width + PANEL_GAP, top, width: PANEL_W, height: maxH };
  } else {
    const maxH = Math.round(viewport.height * 0.7);
    panel = { right: '16px', bottom: '16px', maxHeight: `${maxH}px` };
    panelBox = { left: viewport.width - 16 - PANEL_W, top: viewport.height - 16 - maxH, width: PANEL_W, height: maxH };
  }

  return { anchor, viewport, rects, panel, panelBox, docked, compare, map };
}

/** Index of the draft sentence under a point, from the compare geometry's rects. */
function sentenceAt(geo: CompareGeometry, x: number, y: number): number | null {
  for (let i = 0; i < geo.sentences.length; i++) {
    for (const r of geo.sentences[i]!) {
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return i;
    }
  }
  return null;
}

function App({ store, subscribe, handle, callbacks, setOpen }: { store: Store; subscribe: (l: Listener) => () => void; handle: ComposerHandle; callbacks: OverlayCallbacks; setOpen: (o: boolean) => void }) {
  const [, tick] = useState(0);
  useEffect(() => subscribe(() => tick((n) => n + 1)), [subscribe]);
  const { state, layout, text, open } = store;

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [cardHover, setCardHover] = useState(false);
  const [hot, setHot] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // Compare pane: the lit proposed paragraph and, within it, the one sentence under the pointer.
  const [hotStructure, setHotStructure] = useState<{ group: number | null; sentence: number | null }>({ group: null, sentence: null });
  const compare = open ? layout.compare : undefined;
  const map = open ? layout.map : undefined;
  const guiding = structureGuiding(state);
  const slots = state.structure?.slots ?? [];
  const fills: SlotFill[] | undefined = useMemo(() => (guiding && map ? outlineFill(text, map, slots.length) : undefined), [guiding, map, text, slots.length]);
  // The guide over a narrow draft would cover what the user is writing: the panel carries the checklist instead.
  const showPane = !!compare && !!map && !!state.structure && (compare.wide || !guiding);

  // Pointing at a sentence in the editor lights its paragraph in the pane. The editor keeps every event: this only
  // watches the pointer from the window and hit-tests the rects already measured for the tags.
  useEffect(() => {
    if (!compare?.wide || !map) return;
    let raf = 0;
    let last: { group: number | null; sentence: number | null } = { group: null, sentence: null };
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = sentenceAt(compare, e.clientX, e.clientY);
        const next = i === null ? { group: null, sentence: null } : { group: map.draft[i]!.dest?.para ?? null, sentence: i };
        if (next.group === last.group && next.sentence === last.sentence) return;
        // Only the draft side reports here; the pane reports through its own handlers and wins while hovered.
        if (i === null && last.sentence === null) return;
        last = next;
        setHotStructure(next);
      });
    };
    window.addEventListener('mousemove', onMove, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [compare, map]);

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

  const anchorRect = active ? layout.rects[active.f.id]?.[0] : undefined;

  const launcher = <Launcher state={state} anchor={layout.anchor} avoid={open ? layout.panelBox : undefined} open={open} onToggle={() => setOpen(!open)} />;
  if (!open) return <div class="ws-root">{launcher}</div>;

  const applyStructure = callbacks.onApplyStructure
    ? (paragraphs: string[]) => {
        setPinnedId(null);
        setHoverId(null);
        setHotStructure({ group: null, sentence: null });
        const ok = callbacks.onApplyStructure?.(paragraphs) !== false;
        setToast(ok ? 'Structure applied. Undo in the editor puts it back.' : 'The editor did not accept the change.');
      }
    : undefined;
  const keepStructure = callbacks.onKeepStructure
    ? () => {
        setHotStructure({ group: null, sentence: null });
        callbacks.onKeepStructure?.();
      }
    : undefined;
  const applyOutline = callbacks.onApplyOutline
    ? (paragraphs: string[], fragments: string[]) => {
        setHotStructure({ group: null, sentence: null });
        const ok = callbacks.onApplyOutline?.(paragraphs, fragments) !== false;
        setToast(ok ? 'Your fragments are in place. Write into the skeleton; press Done when the message is written.' : 'The editor did not accept the change.');
      }
    : undefined;
  const outlineDone = callbacks.onOutlineDone
    ? () => {
        setHotStructure({ group: null, sentence: null });
        callbacks.onOutlineDone?.();
        setToast('Checking what you wrote.');
      }
    : undefined;

  return (
    <div class="ws-root">
      {launcher}
      {showPane && compare && map && state.structure ? (
        <CompareView
          structure={state.structure}
          fromParagraphs={Math.max(1, text.split(/\n{2,}/).filter((p) => p.trim()).length)}
          map={map}
          geo={compare}
          fills={fills}
          hotGroup={hotStructure.group}
          hotSentence={hotStructure.sentence}
          onHot={(group, sentence) => setHotStructure({ group, sentence })}
          onApply={applyStructure}
          onKeep={keepStructure}
          onApplyOutline={applyOutline}
          onDone={outlineDone}
        />
      ) : null}
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
          onApply={(id, span: Span, replacement, source) => {
            setPinnedId(null);
            setHoverId(null);
            const ok = callbacks.onApply(id, span, replacement) !== false;
            setToast(!ok ? 'The editor did not accept the change.' : source === 'rewrite' ? 'Applied your wording. Re-checking this passage.' : 'Applied. Re-checking this passage.');
          }}
          onRewriteStart={(id) => setPinnedId(id)}
          onKeep={(id) => {
            setPinnedId(null);
            setHoverId(null);
            callbacks.onKeep(id);
            setToast('Kept as written.');
          }}
        />
      ) : null}
      <ChallengesPanel
        state={state}
        style={layout.panel}
        onHot={(ids) => setHot(new Set(ids))}
        now={now}
        onClose={() => setOpen(false)}
        onAnalyze={callbacks.onAnalyze ? () => callbacks.onAnalyze?.() : undefined}
        onChecks={callbacks.onChecks ? (c) => callbacks.onChecks?.(c) : undefined}
        onApplyStructure={applyStructure}
        onKeepStructure={keepStructure}
        compare={!!compare}
        outlineGuide={guiding && !showPane && fills ? { slots, fills, onDone: outlineDone } : undefined}
        wordCount={text.split(/\s+/).filter(Boolean).length}
        minWords={store.minWords}
        draftText={text}
        onStart={callbacks.onAnalyze && !store.autoAnalyze ? () => callbacks.onAnalyze?.() : undefined}
      />
      <Toast text={toast} />
    </div>
  );
}

export const mountOverlay: MountOverlay = ({ handle, callbacks, initial, startOpen, minWords }) => {
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
  const store: Store = { state: state0, text: safeText(handle), layout: computeLayout(handle, state0, !!startOpen), open: !!startOpen, minWords: minWords ?? 8, autoAnalyze: false };
  const listeners = new Set<Listener>();
  const subscribe = (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const notify = () => listeners.forEach((l) => l());
  const setOpen = (open: boolean) => {
    if (store.open === open) return;
    store.open = open;
    store.text = safeText(handle);
    store.layout = computeLayout(handle, store.state, open);
    notify();
    callbacks.onOpenChange?.(open);
  };

  render(<App store={store} subscribe={subscribe} handle={handle} callbacks={callbacks} setOpen={setOpen} />, mount);

  let raf = 0;
  const relayout = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      store.text = safeText(handle);
      store.layout = computeLayout(handle, store.state, store.open);
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
      store.layout = computeLayout(handle, state, store.open);
      notify();
    },
    relayout,
    setOpen,
    setAutoAnalyze(on) {
      if (store.autoAnalyze === on) return;
      store.autoAnalyze = on;
      notify();
    },
    isOpen: () => store.open,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
      applyInset(handle, 0);
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
