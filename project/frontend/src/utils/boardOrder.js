// P50: board order — one saved rank list per container (project/workspace),
// shared by BOTH modes (rollup on/off) and BOTH container types. `boardOrder`
// is a loose rank list (may omit tasks, may contain stale ids of deleted/moved
// tasks — renderers just ignore unknown ids). Pure functions only, no React or
// service imports, so they're unit-testable head-on with a plain node script.

// Map of taskId -> rank (position in `boardOrder`). null/undefined/[] -> empty
// map, so every task falls back to the "no rank" tie-break below.
export function rankMapFor(boardOrder) {
  const map = new Map();
  (boardOrder || []).forEach((id, i) => map.set(String(id), i));
  return map;
}

// Ranked tasks first (by boardOrder position), then unranked tasks in fetch
// order (the array's own incoming order — the server's `order, createdAt`).
// Explicit index tie-break rather than relying on engine sort stability.
export function sortByBoardOrder(tasks, boardOrder) {
  const rank = rankMapFor(boardOrder);
  return tasks
    .map((t, i) => ({ t, i, r: rank.has(String(t._id)) ? rank.get(String(t._id)) : Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

// Removes the dragged task from `fullSequence` and reinserts it either before
// `targetCardId`'s current position, or (no target card — a column-body drop)
// after `targetColumnKey`'s last member. An insert-before-card ignores
// targetColumnKey/statusOf — the target card's own position already puts the
// dragged task in the right column.
export function moveInSequence(fullSequence, draggedId, { targetCardId, targetColumnKey, statusOf = (t) => t.status }) {
  const dragged = fullSequence.find((t) => t._id === draggedId);
  if (!dragged) return fullSequence;
  const withoutDragged = fullSequence.filter((t) => t._id !== draggedId);

  let insertAt;
  if (targetCardId) {
    insertAt = withoutDragged.findIndex((t) => t._id === targetCardId);
    if (insertAt === -1) insertAt = withoutDragged.length; // defensive: target vanished mid-drag
  } else {
    insertAt = withoutDragged.length; // column-body drop: after the column's last card, or list end if empty
    withoutDragged.forEach((t, i) => { if (statusOf(t) === targetColumnKey) insertAt = i + 1; });
  }
  return [...withoutDragged.slice(0, insertAt), dragged, ...withoutDragged.slice(insertAt)];
}
