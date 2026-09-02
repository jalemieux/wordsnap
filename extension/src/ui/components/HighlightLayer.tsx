import type { Span } from '../../shared/types';

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type HighlightStatus = 'contradicted' | 'needs_precision' | 'supported' | 'unverifiable' | 'clarity' | 'challenge';

export interface HighlightItem {
  id: string;
  status: HighlightStatus;
  span: Span;
  rects: RectLike[];
  /** Short accessible description, e.g. "Contradicted: not a single company went back to five days" */
  label: string;
}

export interface HighlightLayerProps {
  items: HighlightItem[];
  hot: ReadonlySet<string>;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
}

export function HighlightLayer({ items, hot, pinnedId, onHover, onPin }: HighlightLayerProps) {
  return (
    <div class="ws-hl-layer">
      {items.map((it) =>
        it.rects.map((r, i) => {
          const interactive = it.status !== 'challenge';
          const cls = `ws-hl${hot.has(it.id) ? ' is-hot' : ''}${pinnedId === it.id ? ' is-pinned' : ''}`;
          return (
            <div
              key={`${it.id}:${i}`}
              class={cls}
              data-status={it.status}
              data-id={it.id}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? it.label : undefined}
              aria-describedby={interactive ? `ws-card-${it.id}` : undefined}
              style={{ top: `${r.top}px`, left: `${r.left}px`, width: `${Math.max(2, r.width)}px`, height: `${r.height}px` }}
              onMouseEnter={interactive ? () => onHover(it.id) : undefined}
              onMouseLeave={interactive ? () => onHover(null) : undefined}
              onFocus={interactive ? () => onHover(it.id) : undefined}
              onBlur={interactive ? () => onHover(null) : undefined}
              onClick={interactive ? () => onPin(it.id) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPin(it.id);
                      }
                    }
                  : undefined
              }
            />
          );
        }),
      )}
    </div>
  );
}
