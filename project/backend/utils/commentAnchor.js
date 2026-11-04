// Pure, node-testable phrase-anchor locator — PHASE_SPEC.md §1, a two-writer
// SHARED CONTRACT with the frontend's src/utils/commentAnchor.js. Both sides
// implement this algorithm from the spec text alone (never share code), then
// pass the same 8 vectors plus an adversarial cross-fuzz (integrator, P52
// seam lesson) — so this file stays free of imports, contentHunk.js style.

function suffixOverlap(b, left) {
  let n = 0;
  while (n < b.length && n < left.length && b[b.length - 1 - n] === left[left.length - 1 - n]) n++;
  return n;
}

function prefixOverlap(a, right) {
  let n = 0;
  while (n < a.length && n < right.length && a[n] === right[n]) n++;
  return n;
}

// locateAnchor(content, anchor) -> {start, end} | null (char offsets, end
// exclusive). Every exact occurrence of quote is a candidate; the one whose
// before/after context best matches at capture time wins — ties go to the
// lowest index (candidates are visited in ascending order, and only a
// STRICTLY better score replaces the incumbent).
function locateAnchor(content, anchor) {
  const { quote, before, after } = anchor;

  const candidates = [];
  let i = content.indexOf(quote);
  while (i !== -1) {
    candidates.push(i);
    i = content.indexOf(quote, i + 1);
  }
  if (candidates.length === 0) return null;

  let bestScore = -1;
  let bestIndex = candidates[0];
  for (const idx of candidates) {
    const score = suffixOverlap(before, content.slice(0, idx)) + prefixOverlap(after, content.slice(idx + quote.length));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  }
  return { start: bestIndex, end: bestIndex + quote.length };
}

// Auto-delete-on-drift (PHASE_SPEC.md ruling): every OPEN comment of `noteId`
// whose anchor no longer locates against `newContent` is soft-deleted (P61 —
// a stamp, not a hard delete, so an approve that caused the drift can be
// undone back to it); resolved comments are left alone. Comment is passed in
// (not required at module scope) so this file stays import-free — load docs,
// filter in JS, since locate can't run inside a query. `prunedBySuggestion` is
// set only when the drift came from a suggestion approve (suggestionController's
// unapprove uses it to restore exactly the comments IT pruned).
async function pruneOrphanedComments(Comment, noteId, newContent, prunedBySuggestion = null) {
  const openComments = await Comment.find({ note: noteId, status: "open" });
  const orphanIds = openComments.filter((c) => locateAnchor(newContent, c.anchor) === null).map((c) => c._id);
  if (orphanIds.length) {
    await Comment.updateMany(
      { _id: { $in: orphanIds } },
      { $set: { deletedAt: new Date(), deletedVia: "prune", prunedBySuggestion } }
    );
  }
}

module.exports = { locateAnchor, pruneOrphanedComments };
