// Pure, node-testable apply logic for the P52 content-hunk suggestion contract
// (PHASE_SPEC.md's shared contract). A hunk describes ONE contiguous edit to a
// Note's content: up to 2 lines of context above/below, the removed lines
// (`old`, "" for a pure insertion), and the added lines (`new`, "" for a pure
// deletion) — all "\n"-joined. `before`/`after` are "" only at the document's
// literal start/end (never "no context wanted").

// "" means zero lines, not one empty line — "".split("\n") would be [""].
function linesOf(s) {
  return s === "" ? [] : s.split("\n");
}

function linesEqual(contentLines, start, target) {
  if (start < 0 || start + target.length > contentLines.length) return false;
  for (let k = 0; k < target.length; k++) {
    if (contentLines[start + k] !== target[k]) return false;
  }
  return true;
}

// Finds the line index in `content` where `hunk.old` begins (or, for a pure
// insertion, the junction index to insert `hunk.new` at). Returns null when no
// candidate exists. When several candidates exist (old's lines recur, or —
// for an insertion — several before/after junctions match), ranks them by how
// much of the before/after context agrees; a unique top score wins, ties fall
// to the first (lowest-index) candidate.
function locateHunk(content, hunk) {
  const contentLines = linesOf(content);
  const beforeLines = linesOf(hunk.before);
  const oldLines = linesOf(hunk.old);
  const afterLines = linesOf(hunk.after);
  const N = contentLines.length;

  let candidates;
  if (oldLines.length > 0) {
    candidates = [];
    for (let i = 0; i + oldLines.length <= N; i++) {
      if (linesEqual(contentLines, i, oldLines)) candidates.push(i);
    }
  } else {
    // Pure insertion: there is no `old` to anchor on, so the junction itself
    // (before immediately followed by after) IS the candidate criterion.
    candidates = [];
    for (let i = 0; i <= N; i++) {
      const beforeOk = beforeLines.length > 0 ? linesEqual(contentLines, i - beforeLines.length, beforeLines) : i === 0;
      const afterOk = afterLines.length > 0 ? linesEqual(contentLines, i, afterLines) : i === N;
      if (beforeOk && afterOk) candidates.push(i);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Rank the (necessarily old-text-duplicated) candidates by context agreement.
  let bestScore = -1;
  let bestIndices = [];
  for (const i of candidates) {
    let score = 0;
    if (beforeLines.length > 0 && linesEqual(contentLines, i - beforeLines.length, beforeLines)) {
      score += beforeLines.length;
    } else if (beforeLines.length === 0 && i === 0) {
      score += 1;
    }
    const afterStart = i + oldLines.length;
    if (afterLines.length > 0 && linesEqual(contentLines, afterStart, afterLines)) {
      score += afterLines.length;
    } else if (afterLines.length === 0 && afterStart === N) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndices = [i];
    } else if (score === bestScore) {
      bestIndices.push(i);
    }
  }

  return bestIndices[0]; // candidates were built in ascending order -> ties -> first
}

// Returns the new content with the hunk applied, or null when the hunk can't
// be confidently located (locateHunk returned null).
function applyHunk(content, hunk) {
  const anchor = locateHunk(content, hunk);
  if (anchor === null) return null;
  const contentLines = linesOf(content);
  const oldLines = linesOf(hunk.old);
  const newLines = linesOf(hunk.new);
  const result = [...contentLines.slice(0, anchor), ...newLines, ...contentLines.slice(anchor + oldLines.length)];
  return result.join("\n");
}

// True when the hunk's effect is already present: `new` sits at the anchor
// flanked by the same before/after context, and `old` is not there instead.
// Implemented as locating the MIRROR hunk (old<->new swapped) — finding it
// means `new` is anchored in place of `old`, which is exactly "already applied".
function hunkAlreadyApplied(content, hunk) {
  const mirror = { before: hunk.before, old: hunk.new, new: hunk.old, after: hunk.after };
  return locateHunk(content, mirror) !== null;
}

module.exports = { locateHunk, applyHunk, hunkAlreadyApplied };
