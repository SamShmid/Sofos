import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import GoalNode, { GoalMarker } from "./GoalNode";
import { CANVAS_MIN_X, MARKER_OFFSET_X, clamp, resolvePositions, buildSegments } from "../utils/roadmapLayout";

// 800px is the app's one documented responsive breakpoint (tokens.css) —
// every CSS rule hardcodes it, so this JS-side check mirrors that literal.
const MOBILE_QUERY = "(max-width: 800px)";
// Sub-pixel jitter tolerance for measured positions — prevents a
// measure -> setState -> re-render -> re-measure loop from float noise.
const POSITION_TOLERANCE = 0.5;
// Live-drag lower bound: leaves room for the "you are here" pill (which
// floats 22px above the marker) so it never clips the canvas top edge.
const DRAG_MIN_Y = 40;

function pointsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every(
    (p, i) => Math.abs(p.x - b[i].x) < POSITION_TOLERANCE && Math.abs(p.y - b[i].y) < POSITION_TOLERANCE
  );
}

// Phase 49: goals render as cards on a free canvas (desktop) or a static
// vertical stack (mobile); either way ONE trail is drawn marker-to-marker
// wherever the cards actually are, measured off the live DOM the same way
// for both layouts — no more grid-column math, no more preserveAspectRatio
// scaling. Dragging a card body changes its saved position only (never
// sequence); the ⠿ grip still reorders via plain useDraggable/useDroppable
// (replacing SortableContext, which assumed a linear list layout that no
// longer exists).
export default function RoadmapTrack({
  goals, writable, canSuggest, unassignedTasks,
  onToggle, onToggleTask, onAddTask, onAssignTask, onEdit, onDelete, onReorder, onCanvasSave,
}) {
  const canvasRef = useRef(null);
  // Active body-drag is imperative (direct DOM mutation, like mock4's own
  // pointer handlers) so dragging stays smooth — React state only gets
  // touched on drop, not on every pointermove.
  const dragRef = useRef(null);

  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [points, setPoints] = useState([]);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [contentBottom, setContentBottom] = useState(0);
  // Optimistic-keep: the dropped position for a goal whose canvas save is
  // still in flight, so the card doesn't snap back to its old/default spot
  // while waiting on the round trip. Cleared once that save settles either
  // way (loadGoals() will have already produced the true position by then).
  const [overrides, setOverrides] = useState({});
  // The goal id whose grip is mid-drag, so that card never shows its own
  // drop-target highlight when the pointer passes back over itself.
  const [dragActiveId, setDragActiveId] = useState(null);

  const goalKey = goals.map((g) => g._id).join(",");

  useLayoutEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Reads every .gcard's actual rendered position (desktop: wherever we put
  // it via left/top; mobile: wherever normal flow put it) — one measurement
  // path for both layouts, mirroring mock4's markerPoint(): card left+34,
  // card top. Also tracks the lowest card bottom, for the desktop canvas's
  // own height (mobile ignores it — height comes from its own flow).
  const measure = useCallback(() => {
    const container = canvasRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cards = container.querySelectorAll(".gcard");
    let maxBottom = 0;
    const nextPoints = Array.from(cards).map((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left - containerRect.left;
      const y = r.top - containerRect.top;
      maxBottom = Math.max(maxBottom, y + r.height);
      return { x: x + MARKER_OFFSET_X, y };
    });

    setPoints((prev) => (pointsEqual(prev, nextPoints) ? prev : nextPoints));
    setContentBottom((prev) => (Math.abs(prev - maxBottom) < POSITION_TOLERANCE ? prev : maxBottom));
    setContainerSize((prev) =>
      Math.abs(prev.width - containerRect.width) < POSITION_TOLERANCE &&
      Math.abs(prev.height - containerRect.height) < POSITION_TOLERANCE
        ? prev
        : { width: containerRect.width, height: containerRect.height }
    );
  }, []);

  // Re-measure whenever the goal set changes, or the desktop/mobile layout
  // mode flips (every card's position changes at once when that happens).
  useLayoutEffect(() => {
    measure();
  }, [measure, goalKey, isMobile]);

  // Re-measure on container resize (window resize, sidebar toggle, a card's
  // own content growing, live drag mutating a card's left/top, etc).
  useLayoutEffect(() => {
    const container = canvasRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  // First incomplete goal is "current" (you are here); -1 once every goal is
  // done — no waypoint is "current" after the whole route is walked.
  const currentIndex = useMemo(() => goals.findIndex((g) => !g.completed), [goals]);

  // One cubic bezier per consecutive marker pair — solid (done) for the
  // contiguous completed prefix, dashed ahead. currentIndex === -1 means the
  // whole route was walked, so every segment is done.
  const segments = useMemo(() => buildSegments(points, currentIndex), [points, currentIndex]);

  // Desktop only: saved canvas position (clamped to the current width) or
  // the default staggered layout for anything unpositioned. Mobile ignores
  // canvas positions entirely (static flow), so skip the work.
  const basePositions = useMemo(
    () => (isMobile ? {} : resolvePositions(goals, containerSize.width)),
    [isMobile, goals, containerSize.width]
  );

  function positionFor(goal) {
    if (isMobile) return undefined;
    return overrides[goal._id] || basePositions[goal._id];
  }

  async function commitDrag(goal, canvas) {
    setOverrides((o) => ({ ...o, [goal._id]: canvas }));
    // onCanvasSave (RoadmapPage) always resolves — it toasts + reloads goals
    // on failure rather than throwing, so this always runs and the override
    // hands off cleanly to whatever loadGoals() settled on.
    await onCanvasSave(goal, canvas);
    setOverrides((o) => {
      if (!(goal._id in o)) return o;
      const next = { ...o };
      delete next[goal._id];
      return next;
    });
  }

  // Canvas-level pointer delegation, mirroring mock4's own drag mechanics.
  // Excluded from the start (so these stay clickable under a draggable
  // body): the ⠿ grip (owns its own dnd-kit drag gesture), .tools, buttons,
  // inputs, selects, task rows, and links.
  function handlePointerDown(e) {
    if (isMobile || !writable) return;
    if (e.target.closest(".goal-drag-handle, .tools, button, input, select, label.task, a")) return;
    const card = e.target.closest(".gcard");
    if (!card) return;
    const goal = goals.find((g) => g._id === card.dataset.goalId);
    if (!goal) return;
    dragRef.current = { goal, el: card, dx: e.clientX - card.offsetLeft, dy: e.clientY - card.offsetTop };
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const container = canvasRef.current;
    const x = clamp(e.clientX - d.dx, CANVAS_MIN_X, Math.max(CANVAS_MIN_X, container.clientWidth - d.el.offsetWidth - 8));
    const y = clamp(e.clientY - d.dy, DRAG_MIN_Y, Infinity);
    d.el.style.left = `${x}px`;
    d.el.style.top = `${y}px`;
    measure();
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return d;
    d.el.classList.remove("dragging");
    return d;
  }

  function handlePointerUp() {
    const d = endDrag();
    if (!d) return;
    const x = Math.round(parseFloat(d.el.style.left));
    const y = Math.round(parseFloat(d.el.style.top));
    commitDrag(d.goal, { x, y });
  }

  // Cancelled gesture (e.g. touch interrupted) — snap back to the resolved
  // position rather than saving wherever the pointer happened to leave off.
  function handlePointerCancel() {
    const d = endDrag();
    if (!d) return;
    const pos = overrides[d.goal._id] || basePositions[d.goal._id];
    if (pos) {
      d.el.style.left = `${pos.x}px`;
      d.el.style.top = `${pos.y}px`;
    }
    measure();
  }

  function handleReorderDragStart(event) {
    setDragActiveId(event.active.id);
  }

  function handleReorderDragEnd(event) {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = goals.map((g) => g._id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  if (goals.length === 0) {
    return (
      <div className="empty">
        <div className="glyph">◎</div>
        <p>No waypoints on this route yet. Chart the first goal and the trail draws itself.</p>
      </div>
    );
  }

  const canvasHeight = isMobile ? undefined : Math.max(640, contentBottom + 80);
  const markersReady = points.length === goals.length;

  return (
    <div
      className="canvas"
      ref={canvasRef}
      style={{ height: canvasHeight }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {segments.length > 0 && (
        <svg className="rail" width={containerSize.width} height={containerSize.height} aria-hidden="true">
          {segments.map((s, i) => (
            <path key={i} d={s.d} className={s.done ? "done" : "base"} />
          ))}
        </svg>
      )}

      {markersReady &&
        goals.map((goal, i) => (
          <GoalMarker
            key={goal._id}
            goal={goal}
            writable={writable}
            canSuggest={canSuggest}
            isCurrent={i === currentIndex}
            point={points[i]}
            onToggle={onToggle}
          />
        ))}

      <DndContext collisionDetection={closestCenter} onDragStart={handleReorderDragStart} onDragEnd={handleReorderDragEnd}>
        {goals.map((goal, i) => (
          <GoalNode
            key={goal._id}
            goal={goal}
            writable={writable}
            canSuggest={canSuggest}
            unassignedTasks={unassignedTasks}
            isCurrent={i === currentIndex}
            position={positionFor(goal)}
            dragActiveId={dragActiveId}
            onToggleTask={onToggleTask}
            onAddTask={onAddTask}
            onAssignTask={onAssignTask}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </DndContext>
    </div>
  );
}
