// Where the panel sits once the user has dragged it.
/** Width of the panel; matches `.ws-panel` in styles.css. */
export const PANEL_W = 336;
const EDGE = 8;
const SNAP = 24;
const MIN_VISIBLE_H = 160;

/**
 * Where a panel the user dragged sits: the whole width and at least 160px of height on screen, snapped to an edge
 * dropped within 24px of it, as tall as the room below allows up to 80% of the viewport.
 */
export function placePanel(pos: { left: number; top: number }, viewport: { width: number; height: number }) {
  const maxLeft = viewport.width - PANEL_W - EDGE;
  const maxTop = viewport.height - MIN_VISIBLE_H - EDGE;
  let left = Math.round(Math.min(Math.max(pos.left, EDGE), Math.max(EDGE, maxLeft)));
  let top = Math.round(Math.min(Math.max(pos.top, EDGE), Math.max(EDGE, maxTop)));
  if (left - EDGE < SNAP) left = EDGE;
  else if (maxLeft - left < SNAP) left = maxLeft;
  if (top - EDGE < SNAP) top = EDGE;
  const maxHeight = Math.min(viewport.height - top - EDGE, Math.round(viewport.height * 0.8));
  return { left, top, maxHeight };
}
