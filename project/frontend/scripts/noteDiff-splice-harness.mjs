// Phase 57 (W-A) verification harness for src/utils/noteDiff.js's additive
// computeHunkRanges/spliceHunkAtRange exports — plain Node, no test
// framework (commentAnchor-harness.mjs style/precedent). Two sections: the
// §1 unit vectors (all three cases + the four named edge cases, exact
// values), then a >=10k-case parity fuzz proving spliceHunkAtRange's
// char-space edit matches backend applyHunk's line-space one exactly.
//
// Phase 58 §1 additions: divergence unit vectors proving the now-unified
// internal locateHunk (computeHunkStarts/renderSegments/computeHunkRanges'
// shared anchor) picks the BACKEND's position on ambiguous/edge context, not
// the old loose approximation's; and a display-parity fuzz (folded into the
// same >=10k-case loop) checking computeHunkStarts' char offset against
// backend locateHunk's line index on every generated case.
//
// Run: node scripts/noteDiff-splice-harness.mjs

import assert from "node:assert/strict";
import { computeHunks, computeHunkRanges, computeHunkStarts, refineWords, spliceHunkAtRange } from "../src/utils/noteDiff.js";
import { applyHunk, locateHunk as backendLocateHunk } from "../../backend/utils/contentHunk.js";

// Backend join("\n") line-index -> char-offset convention, ported locally
// (charOffsetOfLine in noteDiff.js isn't exported) — used to check
// computeHunkStarts' char offset against backend locateHunk's line index.
function offsetOfLine(content, lineIndex) {
  const lines = content === "" ? [] : content.split("\n");
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1;
  return Math.min(offset, content.length);
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`ok - ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${label}`);
    console.error(err);
  }
}

// Applies the {from, to, insert} change spliceHunkAtRange returns to a plain
// string doc — the same shape CM6's `dispatch({ changes })` expects.
function applyChange(doc, change) {
  return doc.slice(0, change.from) + change.insert + doc.slice(change.to);
}

// ---- §1 unit vectors (all three cases, exact values) ----
const vectors = [
  {
    name: "update (mid-doc, single line)",
    content: "a\nb\nc",
    hunk: { before: "a", old: "b", new: "X", after: "c" },
    range: { from: 2, to: 3 },
    result: "a\nX\nc",
  },
  {
    name: "pure delete (mid-doc, single line)",
    content: "a\nb\nc",
    hunk: { before: "a", old: "b", new: "", after: "c" },
    range: { from: 2, to: 3 },
    result: "a\nc",
  },
  {
    name: "pure insert (mid-doc junction)",
    content: "a\nc",
    hunk: { before: "a", old: "", new: "b", after: "c" },
    range: { from: 2, to: 2 },
    result: "a\nb\nc",
  },
  {
    name: "EOF-no-trailing-newline (insert after final line)",
    content: "foo",
    hunk: { before: "foo", old: "", new: "bar", after: "" },
    range: { from: 3, to: 3 },
    result: "foo\nbar",
  },
  {
    name: "insert-at-offset-0 (before the first line)",
    content: "bar",
    hunk: { before: "", old: "", new: "foo", after: "bar" },
    range: { from: 0, to: 0 },
    result: "foo\nbar",
  },
  {
    name: "delete-last-line",
    content: "a\nb\nc",
    hunk: { before: "b", old: "c", new: "", after: "" },
    range: { from: 4, to: 5 },
    result: "a\nb",
  },
  {
    name: "delete-only-line",
    content: "onlyline",
    hunk: { before: "", old: "onlyline", new: "", after: "" },
    range: { from: 0, to: 8 },
    result: "",
  },
  {
    name: "insert into an empty document (docLen === 0)",
    content: "",
    hunk: { before: "", old: "", new: "X", after: "" },
    range: { from: 0, to: 0 },
    result: "X",
  },
];

for (const v of vectors) {
  check(`computeHunkRanges: ${v.name}`, () => {
    const ranges = computeHunkRanges(v.content, [v.hunk]);
    assert.deepEqual(ranges.get(0), v.range);
  });
  check(`spliceHunkAtRange: ${v.name}`, () => {
    const change = spliceHunkAtRange(v.content, v.range, v.hunk);
    assert.equal(applyChange(v.content, change), v.result);
  });
  check(`spliceHunkAtRange matches backend applyHunk: ${v.name}`, () => {
    const change = spliceHunkAtRange(v.content, v.range, v.hunk);
    assert.equal(applyChange(v.content, change), applyHunk(v.content, v.hunk));
  });
}

// unlocatable hunks are absent from the map, not present with a null value.
check("computeHunkRanges: unlocatable hunk is absent from the map", () => {
  const ranges = computeHunkRanges("a\nb\nc", [{ before: "", old: "nonexistent", new: "X", after: "" }]);
  assert.equal(ranges.has(0), false);
  assert.equal(ranges.size, 0);
});

// ---- Phase 58 §1 divergence unit vectors ----
// Before Phase 58, the internal locateHunk (computeHunkStarts/renderSegments'
// anchor) scored context with a flat +1 per matching side and treated empty
// before/after as a match at ANY position. These vectors are built so that
// loose scoring picks a DIFFERENT position than the backend's weighted,
// edge-exact algorithm would — the unified locator must now agree with the
// backend (checked directly via backendLocateHunk, not a hardcoded guess).

// (a) Duplicated `old` with ambiguous context: two literal matches of `old`,
// one flanked by a full 2-line `before` match (weight 2) but no `after`
// match, the other flanked only by a 1-line `after` match (weight 1) but no
// `before` match. Flat scoring (old algorithm) ties both candidates at 1 and
// resolves to the FIRST (lower) index; weighted scoring uniquely favors the
// higher-context candidate at the LATER index — the backend's actual choice.
check("divergence: duplicated old, weighted context beats flat tie (picks backend's position)", () => {
  const content = "m0\nm1\nOLD\nr\np\nq\nOLD\nzzz";
  const hunk = { before: "p\nq", old: "OLD", new: "NEW", after: "r" };
  const backendLine = backendLocateHunk(content, hunk);
  assert.notEqual(backendLine, 2, "sanity: backend should NOT pick the loose algorithm's tie-break winner");
  const starts = computeHunkStarts(content, [hunk]);
  assert.equal(starts.get(0), offsetOfLine(content, backendLine));
});

// (b) Empty-before: the backend requires literal document start (i === 0)
// for an empty `before` to count as context; the old loose algorithm treated
// empty `before` as matching at ANY position, so it would anchor a pure
// insertion on a mid-doc `after` match that isn't actually at the doc start.
check("divergence: empty-before agrees at the true document start", () => {
  const content = "X\ny\nz";
  const hunk = { before: "", old: "", new: "INS", after: "X" };
  const backendLine = backendLocateHunk(content, hunk);
  assert.equal(backendLine, 0);
  const starts = computeHunkStarts(content, [hunk]);
  assert.equal(starts.get(0), offsetOfLine(content, backendLine));
});
check("divergence: empty-before rejects a mid-doc junction (backend: unlocatable)", () => {
  const content = "y\nX\nz";
  const hunk = { before: "", old: "", new: "INS", after: "X" };
  const backendLine = backendLocateHunk(content, hunk);
  assert.equal(backendLine, null, "backend requires the literal doc start, not just an `after` match");
  const starts = computeHunkStarts(content, [hunk]);
  assert.equal(starts.has(0), false, "old loose algorithm would have wrongly anchored at line 1");
});

// (c) Empty-after: symmetric — the backend requires literal document end
// (afterStart === N); the old loose algorithm matched empty `after` anywhere.
check("divergence: empty-after agrees at the true document end", () => {
  const content = "z\nX";
  const hunk = { before: "X", old: "", new: "INS", after: "" };
  const backendLine = backendLocateHunk(content, hunk);
  assert.equal(backendLine, 2);
  const starts = computeHunkStarts(content, [hunk]);
  assert.equal(starts.get(0), offsetOfLine(content, backendLine));
});
check("divergence: empty-after rejects a mid-doc junction (backend: unlocatable)", () => {
  const content = "X\nz\nw";
  const hunk = { before: "X", old: "", new: "INS", after: "" };
  const backendLine = backendLocateHunk(content, hunk);
  assert.equal(backendLine, null, "backend requires the literal doc end, not just a `before` match");
  const starts = computeHunkStarts(content, [hunk]);
  assert.equal(starts.has(0), false, "old loose algorithm would have wrongly anchored at line 1");
});

// ---- Phase 66 §2 hunk-granularity unit vectors ----
// The bridge-merge fold is retired: edits separated by ANY unchanged line
// are separate hunks (Samuel's Google-Docs-granularity ruling). Each split
// hunk must still locate and apply cleanly — including sequentially, in
// EITHER order, reaching the full new text.

check("granularity: paragraph edit + list edit 2 unchanged lines apart -> TWO hunks", () => {
  const oldText = "Alpha paragraph\n\n- first item\n- second item";
  const newText = "Alpha paragraph edited\n\n- first item\n- second item done";
  const hunks = computeHunks(oldText, newText);
  assert.equal(hunks.length, 2, "the old fold would have merged these into one hunk");
  assert.deepEqual(hunks[0], { before: "", old: "Alpha paragraph", new: "Alpha paragraph edited", after: "\n- first item" });
  assert.deepEqual(hunks[1], { before: "\n- first item", old: "- second item", new: "- second item done", after: "" });

  // Each hunk applies on its own, and sequential application in either
  // order reaches the full new text (order-independence of split hunks).
  for (const order of [[0, 1], [1, 0]]) {
    let doc = oldText;
    for (const idx of order) {
      const range = computeHunkRanges(doc, [hunks[idx]]).get(0);
      assert.notEqual(range, undefined, `hunk ${idx} must stay locatable (order ${order})`);
      doc = applyChange(doc, spliceHunkAtRange(doc, range, hunks[idx]));
    }
    assert.equal(doc, newText, `sequential apply order ${order}`);
  }
});

check("granularity: one unchanged line separates two hunks", () => {
  const hunks = computeHunks("aa\nkeep\nbb", "AA\nkeep\nBB");
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0], { before: "", old: "aa", new: "AA", after: "keep\nbb" });
  assert.deepEqual(hunks[1], { before: "aa\nkeep", old: "bb", new: "BB", after: "" });
});

// Overlap guard: normalizeBlock can GROW a block over a lone blank line, so
// two now-unmerged neighbors can grow into each other. Here the blank-line
// insert (second edit) normalizes backward over the existing single blank
// line and into line 0 — right into the first edit's block. The guard must
// merge exactly that overlapping pair; two hunks may NEVER cover
// overlapping old-line ranges (that breaks locate/apply).
check("overlap guard: two edits either side of a single blank line merge instead of overlapping", () => {
  const oldText = "x\n\ny";
  const newText = "X\n\n\ny";
  const hunks = computeHunks(oldText, newText);
  assert.equal(hunks.length, 1, "grown-into-overlap neighbors must merge");
  assert.deepEqual(hunks[0], { before: "", old: "x\n", new: "X\n\n", after: "y" });
  const range = computeHunkRanges(oldText, [hunks[0]]).get(0);
  assert.notEqual(range, undefined);
  assert.equal(applyChange(oldText, spliceHunkAtRange(oldText, range, hunks[0])), newText);
});

// Structural invariant, checked over every fuzz case below as well: no two
// hunks' old texts may overlap when located. Cheap proxy usable here without
// exported line indices: locate every hunk and assert located [from, to)
// char ranges are pairwise disjoint.
function assertDisjointRanges(content, hunks, label) {
  const located = [];
  hunks.forEach((hunk, i) => {
    const range = computeHunkRanges(content, [hunk]).get(0);
    if (range) located.push({ i, ...range });
  });
  located.sort((a, b) => a.from - b.from);
  for (let k = 0; k + 1 < located.length; k++) {
    assert.ok(
      located[k].to <= located[k + 1].from,
      `${label}: hunks ${located[k].i} and ${located[k + 1].i} cover overlapping char ranges`
    );
  }
}

check("overlap guard: split hunks locate to disjoint ranges (repro shape)", () => {
  const oldText = "Alpha paragraph\n\n- first item\n- second item";
  const newText = "Alpha paragraph edited\n\n- first item\n- second item done";
  assertDisjointRanges(oldText, computeHunks(oldText, newText), "repro shape");
});

// ---- parity fuzz (>=10k generated hunk cases) ----
// Deterministic PRNG (mulberry32), commentAnchor-harness precedent — a
// failure is reproducible from the printed seed.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xd15c0ff;
const rand = mulberry32(SEED);
function randInt(n) { return Math.floor(rand() * n); }
function pick(arr) { return arr[randInt(arr.length)]; }

const WORDS = ["the", "quick", "brown", "fox", "jumps", "lazy", "dog", "note", "task", "foo", "bar", "baz", "qux", ""];

// Random line array, occasionally including a blank line ("") and
// occasionally a trailing blank (a trailing "\n" in the joined text) — both
// real shapes note content takes.
function randomLines(maxLines) {
  const n = randInt(maxLines + 1);
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(pick(WORDS) + (rand() < 0.3 ? " " + pick(WORDS) : ""));
  if (n > 0 && rand() < 0.15) lines.push(""); // trailing "\n"
  return lines;
}

// Mutates a copy of `lines` with 1-3 random line-level edits (insert/delete/
// replace) so computeHunks(oldText, newText) has real edits to find.
function editLines(lines) {
  const out = lines.slice();
  const edits = 1 + randInt(3);
  for (let e = 0; e < edits; e++) {
    const op = randInt(3);
    const at = out.length === 0 ? 0 : randInt(out.length + (op === 1 ? 0 : 1));
    if (op === 0 && out.length > 0) out.splice(at % out.length, 1); // delete
    else if (op === 1 && out.length > 0) out.splice(at % out.length, 1, pick(WORDS) + randInt(999)); // replace
    else out.splice(at, 0, pick(WORDS) + randInt(999)); // insert
  }
  return out;
}

let casesRun = 0;
let fuzzFailures = 0;
let displayCasesRun = 0;
let displayFuzzFailures = 0;
const TARGET_CASES = 12000;
let guard = 0;
while (casesRun < TARGET_CASES && guard < 200000) {
  guard++;
  const oldLines = randomLines(8);
  const newLines = editLines(oldLines);
  const oldText = oldLines.join("\n");
  const newText = newLines.join("\n");
  if (oldText === newText) continue;

  const hunks = computeHunks(oldText, newText);
  if (hunks.length === 0) continue;

  // P66 §2 overlap invariant, on every generated multi-hunk case.
  try {
    assertDisjointRanges(oldText, hunks, "fuzz");
  } catch (err) {
    fuzzFailures++;
    if (fuzzFailures <= 5) console.error(`fuzz overlap seed=${SEED}`, { oldText, newText, err: err.message });
  }

  for (const hunk of hunks) {
    const ranges = computeHunkRanges(oldText, [hunk]);
    const range = ranges.get(0);
    const expected = applyHunk(oldText, hunk);
    casesRun++;

    if (range === undefined) {
      // computeHunkRanges couldn't locate a hunk computeHunks itself just
      // derived from this exact content — a real bug, not a skip.
      fuzzFailures++;
      if (fuzzFailures <= 5) console.error(`fuzz: hunk unlocatable by computeHunkRanges seed=${SEED}`, { oldText, hunk });
      continue;
    }
    const change = spliceHunkAtRange(oldText, range, hunk);
    const actual = applyChange(oldText, change);
    if (expected === null || actual !== expected) {
      fuzzFailures++;
      if (fuzzFailures <= 5) {
        console.error(`fuzz mismatch seed=${SEED}`, { oldText, hunk, range, change, actual, expected });
      }
    }

    // Display parity (Phase 58 §1b): computeHunkStarts' char offset must
    // land on the SAME line the backend's own locateHunk chose, converted to
    // a char offset with the identical join("\n") convention.
    displayCasesRun++;
    const backendLine = backendLocateHunk(oldText, hunk);
    const starts = computeHunkStarts(oldText, [hunk]);
    const displayOffset = starts.get(0);
    const expectedOffset = backendLine === null ? undefined : offsetOfLine(oldText, backendLine);
    if (displayOffset !== expectedOffset) {
      displayFuzzFailures++;
      if (displayFuzzFailures <= 5) {
        console.error(`display-parity mismatch seed=${SEED}`, { oldText, hunk, backendLine, displayOffset, expectedOffset });
      }
    }

    if (casesRun >= TARGET_CASES) break;
  }
}
check(`spliceHunkAtRange parity fuzz vs backend applyHunk (${casesRun} cases, seed=${SEED})`, () => {
  assert.ok(casesRun >= TARGET_CASES, `only generated ${casesRun} cases`);
  assert.equal(fuzzFailures, 0, `${fuzzFailures} fuzz failures out of ${casesRun}`);
});
check(`computeHunkStarts display parity vs backend locateHunk (${displayCasesRun} cases, seed=${SEED})`, () => {
  assert.ok(displayCasesRun >= TARGET_CASES, `only generated ${displayCasesRun} cases`);
  assert.equal(displayFuzzFailures, 0, `${displayFuzzFailures} display-parity failures out of ${displayCasesRun}`);
});

// ---- Phase 60.1 §1.4 refineWords whitespace-coalescing unit vectors ----
// A pure-whitespace `same` run bounded by changed (del/add) runs on BOTH
// sides folds away into its neighbours (invariant-preserving); a same run
// that's an array EDGE (leading/trailing) or carries real word text is not
// eligible and passes through untouched. `checkInvariants` is the same
// concat(same+del)===oldText / concat(same+add)===newText contract the
// function's own doc comment states, verified directly rather than just
// asserting the exact segment shape, so a passing check is a real
// correctness proof, not just a snapshot match.
function checkInvariants(oldText, newText, segments) {
  const oldRebuilt = segments.filter((s) => s.type !== "add").map((s) => s.text).join("");
  const newRebuilt = segments.filter((s) => s.type !== "del").map((s) => s.text).join("");
  assert.equal(oldRebuilt, oldText, "concat(same+del) must equal oldText");
  assert.equal(newRebuilt, newText, "concat(same+add) must equal newText");
}

check("refineWords: wholesale-rewrite coalescing collapses to one del + one add", () => {
  const oldText = "Hello world foo";
  const newText = "Bye there bar";
  const segments = refineWords(oldText, newText);
  checkInvariants(oldText, newText, segments);
  assert.deepEqual(segments, [
    { type: "del", text: "Hello world foo" },
    { type: "add", text: "Bye there bar" },
  ]);
});

// The P52.1 landmine this phase must NOT reopen: a genuine one-word edit,
// bounded by real same-TEXT runs on both sides (no interior pure-whitespace
// run to fold), stays EXACTLY the fragmented same/del/add/same shape it had
// before this phase's coalescing pass existed.
check("refineWords: one-word-edit preservation (untouched by coalescing)", () => {
  const oldText = "The quick brown fox jumps";
  const newText = "The quick red fox jumps";
  const segments = refineWords(oldText, newText);
  checkInvariants(oldText, newText, segments);
  assert.deepEqual(segments, [
    { type: "same", text: "The quick " },
    { type: "del", text: "brown" },
    { type: "add", text: "red" },
    { type: "same", text: " fox jumps" },
  ]);
});

check("refineWords: leading/trailing whitespace edges are not coalesced (no next/prev neighbour)", () => {
  const leading = refineWords(" Hello", " Bye");
  checkInvariants(" Hello", " Bye", leading);
  assert.deepEqual(leading, [
    { type: "same", text: " " },
    { type: "del", text: "Hello" },
    { type: "add", text: "Bye" },
  ]);

  const trailing = refineWords("Hello ", "Bye ");
  checkInvariants("Hello ", "Bye ", trailing);
  assert.deepEqual(trailing, [
    { type: "del", text: "Hello" },
    { type: "add", text: "Bye" },
    { type: "same", text: " " },
  ]);
});

// P66 §3.2 (measured live): folding a line break into the del/add
// accumulators moves the break INTO the struck/added runs, so the card's
// line structure garbles (a del run's tail rendered jammed against an add
// run's head on one visual line). An interior same-whitespace run that
// carries a "\n" must stay in the neutral flow instead.
check("refineWords: interior newline same-run is NOT folded (line structure preserved)", () => {
  const oldText = "one A\nB two";
  const newText = "one X\nY two";
  const segments = refineWords(oldText, newText);
  checkInvariants(oldText, newText, segments);
  assert.deepEqual(segments, [
    { type: "same", text: "one " },
    { type: "del", text: "A" },
    { type: "add", text: "X" },
    { type: "same", text: "\n" },
    { type: "del", text: "B" },
    { type: "add", text: "Y" },
    { type: "same", text: " two" },
  ]);
});

check("refineWords: multi-space runs coalesce like single spaces", () => {
  const oldText = "Hello  world";
  const newText = "Bye  there";
  const segments = refineWords(oldText, newText);
  checkInvariants(oldText, newText, segments);
  assert.deepEqual(segments, [
    { type: "del", text: "Hello  world" },
    { type: "add", text: "Bye  there" },
  ]);
});

// Randomized invariant proof, same PRNG precedent as the fuzz above — every
// case run through refineWords must satisfy the concat invariant, whatever
// shape the coalescing produces.
let refineCasesRun = 0;
let refineFailures = 0;
const REFINE_TARGET_CASES = 3000;
let refineGuard = 0;
while (refineCasesRun < REFINE_TARGET_CASES && refineGuard < 60000) {
  refineGuard++;
  const oldLines = randomLines(1); // single "line" of space-joined words — refineWords operates on hunk.old/new text, not multi-line
  const newLines = editLines(oldLines);
  const oldText = oldLines.join(" ");
  const newText = newLines.join(" ");
  if (oldText === newText) continue;
  refineCasesRun++;
  try {
    checkInvariants(oldText, newText, refineWords(oldText, newText));
  } catch (err) {
    refineFailures++;
    if (refineFailures <= 5) console.error(`refineWords invariant fuzz mismatch`, { oldText, newText, err: err.message });
  }
}
check(`refineWords invariant fuzz (${refineCasesRun} cases)`, () => {
  assert.ok(refineCasesRun >= REFINE_TARGET_CASES, `only generated ${refineCasesRun} cases`);
  assert.equal(refineFailures, 0, `${refineFailures} invariant failures out of ${refineCasesRun}`);
});

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
