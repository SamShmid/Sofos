// Line-based diff for Note content (Phase 52 shared contentHunk contract —
// PHASE_SPEC.md's "shared contract — the content hunk"). Pure, no React, no
// backend dependency: the frontend needs its own locate logic for the margin's
// highlight view, since it renders against whatever the note's CURRENT content
// is, independent of the backend's own utils/contentHunk.js.
//
// computeHunks(oldText, newText) -> [{ before, old, new, after }], LCS-based,
// up to 2 lines of context on each side. Every contiguous change block is its
// own hunk — edits separated by ANY unchanged line are separate suggestions
// (P66, Samuel's Google-Docs-granularity ruling; the old bridge-merge fold is
// retired). Two hunks never cover overlapping old-line ranges.

const MAX_CONTEXT = 2;

// "" means zero lines — the shared contract's convention for before/old/new/
// after AND for a document body, matching the backend's utils/contentHunk.js
// `linesOf` exactly. Modelling an empty note as one blank line instead would
// desync the two sides: the backend would locate hunks against zero lines
// while this side diffed against one.
function splitOrEmpty(text) {
  return text === "" ? [] : text.split("\n");
}

// Classic LCS diff (O(n*m) DP + backtrack) — note bodies are short enough
// that this is plenty fast; no external diff dependency per CLAUDE.md.
function diffOps(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ tag: "equal", line: oldLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ tag: "del", line: oldLines[i] });
      i++;
    } else {
      ops.push({ tag: "ins", line: newLines[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ tag: "del", line: oldLines[i] }); i++; }
  while (j < m) { ops.push({ tag: "ins", line: newLines[j] }); j++; }
  return ops;
}

// Groups the flat per-line op list into equal/change runs, tracking old/new
// line-index spans (not the lines themselves — computeHunks re-slices from
// the original arrays, so a merge just needs the start/end indices).
function groupOps(ops) {
  const blocks = [];
  let oldIdx = 0, newIdx = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k].tag === "equal") {
      const oldStart = oldIdx, newStart = newIdx;
      while (k < ops.length && ops[k].tag === "equal") { oldIdx++; newIdx++; k++; }
      blocks.push({ type: "equal", oldStart, oldEnd: oldIdx, newStart, newEnd: newIdx });
    } else {
      const oldStart = oldIdx, newStart = newIdx;
      while (k < ops.length && ops[k].tag !== "equal") {
        if (ops[k].tag === "del") oldIdx++; else newIdx++;
        k++;
      }
      blocks.push({ type: "change", oldStart, oldEnd: oldIdx, newStart, newEnd: newIdx });
    }
  }
  return blocks;
}

export function computeHunks(oldText, newText) {
  const oldLines = splitOrEmpty(oldText);
  const newLines = splitOrEmpty(newText);
  const changes = groupOps(diffOps(oldLines, newLines)).filter((b) => b.type === "change");
  if (changes.length === 0) return [];

  // No bridge-merging (P66): each contiguous change block is its own hunk —
  // any unchanged line separates two suggestions. MAX_CONTEXT now only sizes
  // the before/after context slices.
  const blocks = changes
    .map((block) => normalizeBlock(block, oldLines, newLines))
    .filter(Boolean);

  // normalizeBlock can GROW a block over a lone blank line, so two unmerged
  // neighbors can grow into each other — and overlapping old-line ranges
  // break locate/apply (each hunk's `old` must be its own exclusive slice).
  // Merge exactly the overlapping consecutive pair (union of both spans),
  // re-normalize the union, and re-check until stable; a union may in turn
  // overlap ITS left neighbor, hence the step back.
  for (let i = 0; i + 1 < blocks.length; ) {
    const a = blocks[i];
    const b = blocks[i + 1];
    if (b.oldStart < a.oldEnd) {
      const union = normalizeBlock(
        {
          oldStart: Math.min(a.oldStart, b.oldStart),
          oldEnd: Math.max(a.oldEnd, b.oldEnd),
          newStart: Math.min(a.newStart, b.newStart),
          newEnd: Math.max(a.newEnd, b.newEnd),
        },
        oldLines,
        newLines
      );
      blocks.splice(i, 2, ...(union ? [union] : []));
      if (i > 0) i--;
    } else {
      i++;
    }
  }

  return blocks
    .map((block) => {
      const beforeStart = Math.max(0, block.oldStart - MAX_CONTEXT);
      const afterEnd = Math.min(oldLines.length, block.oldEnd + MAX_CONTEXT);
      return {
        before: oldLines.slice(beforeStart, block.oldStart).join("\n"),
        old: oldLines.slice(block.oldStart, block.oldEnd).join("\n"),
        new: newLines.slice(block.newStart, block.newEnd).join("\n"),
        after: oldLines.slice(block.oldEnd, afterEnd).join("\n"),
      };
    });
}

// In the shared contract "" means ZERO lines, so a field holding exactly one
// BLANK line is indistinguishable from an absent one — and blank lines are
// everywhere in a markdown note (paragraph breaks, trailing newline). Left
// alone that ambiguity produces three different failures downstream:
//   old === new === ""  -> backend 400 ("must add or remove something")
//   old or new === [""] -> the blank line is silently dropped on apply
//   before/after [""]   -> reads as "document start/end", so an insertion
//                          hunk anchors nowhere and applyHunk returns null
// Growing the block over the offending blank line fixes all three: the line
// then appears in BOTH old and new (a no-op on it), and the context shrinks
// back to a real document boundary. Correctness is untouched — applyHunk still
// yields the same text — the hunk just carries one more line of it.
function normalizeBlock(block, oldLines, newLines) {
  const b = { ...block };
  // A slice is faithful unless it is exactly one blank line.
  const lossy = (arr) => arr.length === 1 && arr[0] === "";
  const oldSlice = () => oldLines.slice(b.oldStart, b.oldEnd);
  const newSlice = () => newLines.slice(b.newStart, b.newEnd);
  const beforeSlice = () => oldLines.slice(Math.max(0, b.oldStart - MAX_CONTEXT), b.oldStart);
  const afterSlice = () => oldLines.slice(b.oldEnd, Math.min(oldLines.length, b.oldEnd + MAX_CONTEXT));
  const growBack = () => (b.oldStart > 0 && b.newStart > 0 ? (b.oldStart--, b.newStart--, true) : false);
  const growFwd = () => (b.oldEnd < oldLines.length && b.newEnd < newLines.length ? (b.oldEnd++, b.newEnd++, true) : false);

  for (;;) {
    if (lossy(beforeSlice())) { if (growBack()) continue; return null; }
    if (lossy(afterSlice())) { if (growFwd()) continue; return null; }
    if (lossy(oldSlice()) || lossy(newSlice()) || (oldSlice().length === 0 && newSlice().length === 0)) {
      if (growBack() || growFwd()) continue;
      return null; // an all-blank document: unrepresentable, drop rather than propose a 400
    }
    return b;
  }
}

function linesMatchAt(lines, start, target) {
  if (start < 0 || start + target.length > lines.length) return false;
  for (let k = 0; k < target.length; k++) {
    if (lines[start + k] !== target[k]) return false;
  }
  return true;
}

// Faithful line-space port of backend utils/contentHunk.js's locateHunk
// (Phase 58 unification — this used to be a looser approximation, scoring a
// flat +1 per matching context side and treating empty before/after as a
// match at ANY position; that let ambiguous/duplicated context pick a
// different candidate than the backend actually applies the hunk at, which
// desynced the margin/review-pane display from what approve does server-side.
// Now: `old` match is primary (or, for a pure insertion, the before/after
// junction); context ranks/disambiguates ties weighted by matched line count,
// and empty context only scores at the document's literal start/end. Unique
// best wins; ties -> first (lowest-index); none -> null (caller renders no
// highlight for that hunk).
function locateHunk(lines, hunk) {
  const beforeLines = splitOrEmpty(hunk.before);
  const oldLines = splitOrEmpty(hunk.old);
  const afterLines = splitOrEmpty(hunk.after);
  const N = lines.length;

  let candidates;
  if (oldLines.length > 0) {
    candidates = [];
    for (let i = 0; i + oldLines.length <= N; i++) {
      if (linesMatchAt(lines, i, oldLines)) candidates.push(i);
    }
  } else {
    // Pure insertion: there is no `old` to anchor on, so the junction itself
    // (before immediately followed by after) IS the candidate criterion.
    candidates = [];
    for (let i = 0; i <= N; i++) {
      const beforeOk = beforeLines.length > 0 ? linesMatchAt(lines, i - beforeLines.length, beforeLines) : i === 0;
      const afterOk = afterLines.length > 0 ? linesMatchAt(lines, i, afterLines) : i === N;
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
    if (beforeLines.length > 0 && linesMatchAt(lines, i - beforeLines.length, beforeLines)) {
      score += beforeLines.length;
    } else if (beforeLines.length === 0 && i === 0) {
      score += 1;
    }
    const afterStart = i + oldLines.length;
    if (afterLines.length > 0 && linesMatchAt(lines, afterStart, afterLines)) {
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

function charOffsetOfLine(lines, lineIndex) {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1; // +1 for the "\n"
  return offset;
}

// Additive (Phase 55, PHASE_SPEC.md §3): the note margin merges suggestion
// cards with comment cards by document position, which needs each located
// hunk's SOURCE CHAR offset — locateHunk only ever worked in line space.
// Unlocated hunks are simply absent from the map (an unlocatable hunk's card
// renders the "text has changed" state instead — see NoteView.jsx).
export function computeHunkStarts(content, hunks) {
  const lines = splitOrEmpty(content);
  const starts = new Map();
  hunks.forEach((hunk, hunkIndex) => {
    const lineIndex = locateHunk(lines, hunk);
    if (lineIndex === null) return;
    starts.set(hunkIndex, Math.min(charOffsetOfLine(lines, lineIndex), content.length));
  });
  return starts;
}

// Splits on whitespace boundaries into alternating word/whitespace-run
// tokens (P52.1) — whitespace gets its OWN tokens rather than merging into
// the neighboring word specifically so a word at a line's end still matches
// across old/new even when trailing whitespace differs (e.g. appending a
// sentence turns a line-final "baz." into a mid-line "baz. "). Every
// character of `text` lands in exactly one token, so join(tokens) === text.
function tokenizeWords(text) {
  return text.match(/\S+|\s+/g) || [];
}

// P60.1 §1.4 de-fragmentation pass: a `same` run that is PURE WHITESPACE
// WITHOUT A LINE BREAK and has both a previous AND a next segment (i.e.
// bounded by changed runs on BOTH sides — raw.forEach type-merge above
// already guarantees consecutive segments never share a type, so any
// interior `same` is automatically flanked by del/add, never by another
// `same`) gets folded away into an open
// "cluster": del text accumulates in order into one del run, add text
// accumulates in order into one add run, and the whitespace itself is
// appended to BOTH accumulators (it's common text — part of both oldText and
// newText at this point). A real same-TEXT run (not pure whitespace), an
// EDGE same-whitespace run (no prev, or no next — leading/trailing), or a
// whitespace run carrying a LINE BREAK (P66 §3.2: folding a "\n" into the
// accumulators moves the break INTO the struck/added runs, so the card's
// line structure garbles — measured live as a del run's tail jammed against
// an add run's head on one visual line, reading as eaten whitespace) is not
// eligible: it closes out and flushes any open cluster, then passes through
// untouched. This is why a genuine one-word edit (bounded by same-text on
// both sides, with no interior whitespace-only run to fold) never changes:
// there's nothing eligible between its lone del and add to coalesce, so the
// cluster it forms is already exactly {del, add}, same as before this pass.
// A wholesale rewrite (no shared words anywhere) is one giant eligible
// cluster end to end, collapsing to exactly one del + one add. Invariants:
// concat(same+del) === oldText and concat(same+add) === newText still hold —
// within a cluster, delAccum/addAccum are built by walking `raw` in its
// original order and only appending each segment's own text into ITS side
// (del -> delAccum, add -> addAccum, eligible same-whitespace -> both), so
// each side's relative order and content are exactly what the pre-coalesce
// segments would have reconstructed; clusters themselves are never
// reordered relative to the surrounding untouched (real-same/edge) segments.
const WHITESPACE_ONLY_RE = /^\s+$/;

function coalesceWhitespaceRuns(raw) {
  const out = [];
  let delAccum = null;
  let addAccum = null;
  const flushCluster = () => {
    if (delAccum !== null) out.push({ type: "del", text: delAccum });
    if (addAccum !== null) out.push({ type: "add", text: addAccum });
    delAccum = null;
    addAccum = null;
  };
  for (let idx = 0; idx < raw.length; idx++) {
    const seg = raw[idx];
    const eligible =
      seg.type === "same" && idx > 0 && idx < raw.length - 1 && WHITESPACE_ONLY_RE.test(seg.text) && !seg.text.includes("\n");
    if (eligible) {
      if (delAccum === null) delAccum = "";
      if (addAccum === null) addAccum = "";
      delAccum += seg.text;
      addAccum += seg.text;
    } else if (seg.type === "del") {
      delAccum = (delAccum ?? "") + seg.text;
    } else if (seg.type === "add") {
      addAccum = (addAccum ?? "") + seg.text;
    } else {
      // real same-text run, or an edge (leading/trailing) same-whitespace
      // run — neither is eligible; close the open cluster, then pass through.
      flushCluster();
      out.push(seg);
    }
  }
  flushCluster();
  return out;
}

// Word-level refinement of one hunk's old/new text (P52.1) — reuses the same
// LCS engine as the line diff, run at token granularity instead of line
// granularity, so a small in-line edit surfaces as del/add on just the
// changed words instead of striking the whole old line and re-adding the
// whole new one (Samuel: appending a sentence "showed the whole old line
// struck-through plus the whole new line added ... simply isn't correct").
// Render-level only — computeHunks and the stored hunk are untouched;
// callers run this on a hunk's old/new AFTER locating it.
// concat(same+del) === oldText and concat(same+add) === newText always hold,
// since equal/del preserve old-token order and equal/ins preserve new-token
// order (diffOps' own guarantee, just at word instead of line grain) — the
// coalescing pass below preserves this (see its own comment).
export function refineWords(oldText, newText) {
  const ops = diffOps(tokenizeWords(oldText), tokenizeWords(newText));
  const raw = [];
  for (const op of ops) {
    const type = op.tag === "equal" ? "same" : op.tag === "del" ? "del" : "add";
    const last = raw[raw.length - 1];
    if (last && last.type === type) last.text += op.line;
    else raw.push({ type, text: op.line });
  }
  return coalesceWhitespaceRuns(raw);
}

// Additive (Phase 57 §1): the editor's live decoration layer needs each
// hunk's target region as a CHAR RANGE (not just a start offset, like
// computeHunkStarts) so CM6 can mark [from,to) directly. `to = from +
// hunk.old.length` reuses the locate-once anchor — `old` is the exact
// "\n"-joined slice matched at that anchor, so its raw string length IS the
// span width in char space, internal newlines and all. Pure-insert hunks
// (old === "") collapse to from === to, the junction point.
export function computeHunkRanges(content, hunks) {
  const lines = splitOrEmpty(content);
  const ranges = new Map();
  hunks.forEach((hunk, hunkIndex) => {
    const lineIndex = locateHunk(lines, hunk);
    if (lineIndex === null) return;
    const from = Math.min(charOffsetOfLine(lines, lineIndex), content.length);
    ranges.set(hunkIndex, { from, to: from + hunk.old.length });
  });
  return ranges;
}

// `doc` may be a plain string (harness/fuzz) or a CM6 Text instance (editor
// callers) — both implement `.length` and `.slice(a, b)` (String's returns a
// string, Text's returns a Text whose toString() is that string), so a single
// implementation serves both without importing CM6.
function charAt(doc, i) {
  return String(doc.slice(i, i + 1));
}

// Additive (Phase 57 §1): the char-space twin of backend applyHunk
// (utils/contentHunk.js) — reproduces its line-space edit as one CM6-style
// {from, to, insert} change over `doc`, applied at `range` (the hunk's
// current, possibly user-mapped, located range — see MarkdownEditor's
// mapping field). Pure function, no imports; the parity fuzz below is the
// contract that keeps it a faithful char-space mirror of the backend.
export function spliceHunkAtRange(doc, { from, to }, hunk) {
  if (hunk.old === "") {
    // Pure insert: `to` is a mapped range's end and is ignored here — the
    // insertion point is always `from` (see spec's "insert at `from`").
    const docLen = doc.length;
    let insert;
    if (docLen === 0) {
      insert = hunk.new; // no lines exist yet — nothing to separate from
    } else if (from >= docLen) {
      insert = "\n" + hunk.new; // EOF after a final line with no trailing "\n"
    } else {
      insert = hunk.new + "\n"; // line start, content following — push it down
    }
    return { from, to: from, insert };
  }

  if (hunk.new === "") {
    // Pure delete: drop one adjacent "\n" too, or the line count creeps up
    // by one every delete (the backend's join("\n") absorbs it for free;
    // char space has to do it by hand). Prefer the newline AT `to` (the one
    // that used to separate `old` from what follows); only reach for
    // `from - 1` when `to` is at EOF and there's nothing there to take.
    const docLen = doc.length;
    let delFrom = from, delTo = to;
    if (delTo < docLen && charAt(doc, delTo) === "\n") {
      delTo += 1;
    } else if (delTo >= docLen && delFrom > 0 && charAt(doc, delFrom - 1) === "\n") {
      delFrom -= 1;
    }
    return { from: delFrom, to: delTo, insert: "" };
  }

  // Update: old and new both non-empty — plain verbatim replace.
  return { from, to, insert: hunk.new };
}
