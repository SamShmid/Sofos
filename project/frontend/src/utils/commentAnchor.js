// Frontend twin of the backend's utils/commentAnchor.js (Phase 55 shared
// contract — PHASE_SPEC.md §1 "THE ANCHOR CONTRACT"). Deliberately a
// separate implementation, not a shared module (noteDiff.js's own rationale
// applies here too): this side needs its own locate logic for the margin's
// highlight view and selection capture, independent of the backend's copy
// (used for create-time validation and drift-pruning). `locateAnchor` MUST
// stay byte-for-byte identical in behavior to the backend twin — see the
// shared vectors in the spec and the integrator's adversarial cross-fuzz
// (§6).
//
// Phase 60: the rendered-markdown view (ReactMarkdown) is retired — the note
// is now one live CodeMirror surface (source text throughout, styled or raw
// per line), so `captureSelectionAnchor` no longer needs a render-view
// branch. stripMd/applyPass/expandSyntax/the DOM-walk highlight pass
// (applyRenderHighlights) are deleted; captureSelectionAnchor becomes a
// source-only passthrough (same export name/signature — `view` is accepted
// but ignored, so no call site needed to change shape).

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

// locate(content, anchor) -> { start, end } | null — §1 verbatim: every
// occurrence of `quote` is a candidate, scored by how much of `before`/
// `after` agrees with what's actually adjacent at that candidate. Highest
// score wins; ties -> lowest index (candidates arrive in ascending order
// from the indexOf loop, and `>` below only replaces on a STRICT improvement).
export function locateAnchor(content, anchor) {
  const { quote, before = "", after = "" } = anchor;
  const candidates = [];
  let idx = content.indexOf(quote);
  while (idx !== -1) {
    candidates.push(idx);
    idx = content.indexOf(quote, idx + 1);
  }
  if (candidates.length === 0) return null;

  let bestScore = -1;
  let bestIndex = candidates[0];
  for (const i of candidates) {
    const score = suffixOverlap(before, content.slice(0, i)) + prefixOverlap(after, content.slice(i + quote.length));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return { start: bestIndex, end: bestIndex + quote.length };
}

const CAPTURE_CONTEXT = 300;

// captureSelectionAnchor (§3, slimmed Phase 60): `before`/`after` are SOURCE
// context text already extracted by the caller from around the live CM6
// selection — the selection already IS a source substring, so this is now a
// straight passthrough (clamped to CAPTURE_CONTEXT either side). Callers may
// still pass `sourceText`/`view` (old call shape) — same export name/
// signature, those keys are just no longer read.
export function captureSelectionAnchor({ selectionString, before = "", after = "" }) {
  if (!selectionString) return null;
  return {
    quote: selectionString,
    before: before.slice(-CAPTURE_CONTEXT),
    after: after.slice(0, CAPTURE_CONTEXT),
  };
}
