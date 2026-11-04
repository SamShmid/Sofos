// Phase 49: pure canvas-geometry math for the roadmap trail — no React/DOM
// deps, so it can be unit-verified by a standalone node script as well as
// imported by RoadmapTrack. Mirrors docs/design/mock4-roadmap-canvas.html's
// inline JS (defaultPos / markerPoint / draw), the reference implementation.

export const CARD_WIDTH = 290; // matches mock's .gcard width
export const MARKER_OFFSET_X = 34; // marker rides the card's top edge, near the left corner
// Left bound for a card. The "you are here" pill is ~117px wide and centred on
// the marker (card left + MARKER_OFFSET_X), so a card parked hard against the
// left edge loses the pill's leading edge to the canvas's own overflow:hidden.
// 32 puts the marker at 66 and the pill's edge ~7px clear, leaving room for the
// label to render a little wider. Horizontal twin of RoadmapTrack's DRAG_MIN_Y,
// which guards the top edge; the mobile stack spends it as canvas padding.
export const CANVAS_MIN_X = 32;

const MARGIN = 40;
const COL_W = 330;
const ROW_H = 290;
const ROW_OFFSET = 60; // row-1 cards nudge right, creating the staggered look
const BAND_H = ROW_H * 2;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Staggered pairs (col = floor(i/2), row = i%2), wrapping to a new 2-row
// "band" (stacked below the previous one) when the next column would run
// past the canvas width. containerWidth <= 0 (not yet measured) never wraps.
export function defaultPositions(count, containerWidth) {
  const maxX = containerWidth > 0 ? containerWidth - CARD_WIDTH - MARGIN : Infinity;
  const positions = [];
  let band = 0;
  let col = 0;
  for (let i = 0; i < count; i += 2) {
    let x = MARGIN + col * COL_W;
    if (x > maxX) {
      band += 1;
      col = 0;
      x = MARGIN;
    }
    const y = 60 + band * BAND_H;
    positions.push({ x, y });
    if (i + 1 < count) positions.push({ x: x + ROW_OFFSET, y: y + ROW_H });
    col += 1;
  }
  return positions;
}

// Display clamp for a stored canvas position — keeps a card on-screen if the
// window narrowed since it was saved, WITHOUT touching the stored value.
export function clampCanvasX(x, containerWidth) {
  if (!(containerWidth > 0)) return x;
  return clamp(x, CANVAS_MIN_X, Math.max(CANVAS_MIN_X, containerWidth - CARD_WIDTH - 8));
}

// Combines saved positions with the default staggered flow for everything
// else. Unpositioned goals get their own index sequence (position among
// unpositioned goals only) — positioned goals don't consume a slot.
export function resolvePositions(goals, containerWidth) {
  const unpositionedIds = goals.filter((g) => !g.canvas).map((g) => g._id);
  const defaults = defaultPositions(unpositionedIds.length, containerWidth);
  const defaultById = new Map(unpositionedIds.map((id, i) => [id, defaults[i]]));
  const map = {};
  for (const g of goals) {
    map[g._id] = g.canvas
      ? { x: clampCanvasX(g.canvas.x, containerWidth), y: Math.max(16, g.canvas.y) }
      : defaultById.get(g._id);
  }
  return map;
}

// One cubic bezier per consecutive marker pair (mock's `M a C mid,a mid,b b`)
// — a continuous trail wherever the cards are, no whole-path smoothing.
// Segment i is "done" (solid) iff i < currentIndex; currentIndex === -1
// (every goal complete) means the whole route was walked, so every segment
// is done. Same contiguous-prefix semantics as the old smoothed rail.
export function buildSegments(points, currentIndex) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const mx = (a.x + b.x) / 2;
    segments.push({
      d: `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`,
      done: currentIndex === -1 || i < currentIndex,
    });
  }
  return segments;
}
