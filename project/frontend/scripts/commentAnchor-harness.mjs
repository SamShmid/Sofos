// Phase 55 (F2) verification harness for src/utils/commentAnchor.js — plain
// Node, no test framework (matches the noteDiff-harness style referenced in
// PHASE_SPEC.md).
//
// Phase 60 re-baseline: the rendered-markdown view (and stripMd/
// applyRenderHighlights, which only ever served it) is retired along with
// ReactMarkdown — dropped the stripMd unit cases, the map-fidelity check,
// and the render-view captureSelectionAnchor cases (heading/bold/partial/
// not-found all fed `view: "render"`). What's left: the 8 shared
// locateAnchor vectors (§1, exact values — the seam the integrator still
// cross-fuzzes against the backend twin), the two source-view
// captureSelectionAnchor cases (passthrough + empty-selection), and the
// >=20k-case locateAnchor fuzz. New baseline: 11 checks (was 21).
//
// Run: node scripts/commentAnchor-harness.mjs

import assert from "node:assert/strict";
import { locateAnchor, captureSelectionAnchor } from "../src/utils/commentAnchor.js";

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

// ---- §1 shared vectors (exact values, both sides must match these) ----
const vectors = [
  { name: "V1", content: "hello world", anchor: { quote: "world", before: "hello ", after: "" }, expected: { start: 6, end: 11 } },
  { name: "V2", content: "hello", anchor: { quote: "x", before: "", after: "" }, expected: null },
  { name: "V3", content: "abc X def X ghi", anchor: { quote: "X", before: " def ", after: "" }, expected: { start: 10, end: 11 } },
  { name: "V4", content: "X and X", anchor: { quote: "X", before: "", after: "" }, expected: { start: 0, end: 1 } },
  { name: "V5", content: "# Heading\nbody", anchor: { quote: "# Heading", before: "", after: "\nbody" }, expected: { start: 0, end: 9 } },
  { name: "V6", content: "a\nb\nc", anchor: { quote: "b\nc", before: "a\n", after: "" }, expected: { start: 2, end: 5 } },
  { name: "V7", content: "X1 X2", anchor: { quote: "X", before: "", after: "2" }, expected: { start: 3, end: 4 } },
  { name: "V8", content: "abc", anchor: { quote: "abc", before: "", after: "" }, expected: { start: 0, end: 3 } },
];
for (const v of vectors) {
  check(`locateAnchor ${v.name}`, () => {
    assert.deepEqual(locateAnchor(v.content, v.anchor), v.expected);
  });
}

// ---- captureSelectionAnchor unit cases (§3, source-view only post-P60) ----
check("captureSelectionAnchor: source view is a direct passthrough, no expansion", () => {
  const anchor = captureSelectionAnchor({
    sourceText: "# Heading\nbody",
    view: "source",
    selectionString: "# Heading",
    before: "",
    after: "\nbody",
  });
  assert.deepEqual(anchor, { quote: "# Heading", before: "", after: "\nbody" });
});

check("captureSelectionAnchor: empty selectionString -> null", () => {
  assert.equal(captureSelectionAnchor({ sourceText: "abc", view: "source", selectionString: "", before: "", after: "" }), null);
});

// ---- locateAnchor fuzz (>=20k cases) ----
// Deterministic PRNG (mulberry32) so a failure is reproducible from the
// printed seed, without relying on Node's non-seedable Math.random.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const rand = mulberry32(SEED);
function randInt(n) { return Math.floor(rand() * n); }
function pick(arr) { return arr[randInt(arr.length)]; }

const WORDS = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "X", "foo", "bar", "baz", "note", "comment", "anchor"];
const MD_TOKENS = ["# ", "## ", "**", "__", "*", "_", "`", "[", "](url)", "![", "](img.png)", "> ", "- ", "1. ", "\n", "\n\n"];

function randomContent(minLen) {
  let out = "";
  while (out.length < minLen) {
    out += rand() < 0.35 ? pick(MD_TOKENS) : pick(WORDS) + (rand() < 0.5 ? " " : "");
  }
  return out;
}

const FUZZ_CASES = 22000;
let fuzzFailures = 0;
for (let i = 0; i < FUZZ_CASES; i++) {
  const content = randomContent(20 + randInt(80));
  if (content.length < 3) continue;
  const start = randInt(content.length - 1);
  const maxLen = Math.min(content.length - start, 1 + randInt(15));
  const len = Math.max(1, maxLen);
  const quote = content.slice(start, start + len);
  if (!quote) continue;
  const before = content.slice(Math.max(0, start - randInt(20)), start);
  const after = content.slice(start + len, start + len + randInt(20));
  const anchor = { quote, before, after };

  // Case A: locate against the UNCHANGED content -> must find A range whose
  // slice equals quote (candidates can tie with the true range on ambiguous
  // repeats, so assert the CONTRACT — a valid, quote-matching hit — not
  // necessarily the exact {start,len} planted, except when disambiguating
  // context makes the true range provably unique to check separately below).
  const hit = locateAnchor(content, anchor);
  if (!hit || content.slice(hit.start, hit.end) !== quote) {
    fuzzFailures++;
    if (fuzzFailures <= 5) {
      console.error(`fuzz mismatch (unchanged content) seed=${SEED} i=${i}`, { content, anchor, hit });
    }
    continue;
  }

  // Case B: destroy the quote everywhere in the content -> must return
  // null. Guard against the rare case where the replacement itself
  // reintroduces the quote (e.g. quote is entirely whitespace) -- skip
  // rather than assert a contradiction.
  const destroyed = content.split(quote).join("");
  if (destroyed.includes(quote)) continue;
  const missHit = locateAnchor(destroyed, anchor);
  if (missHit !== null) {
    fuzzFailures++;
    if (fuzzFailures <= 5) {
      console.error(`fuzz mismatch (destroyed content should be null) seed=${SEED} i=${i}`, { content, destroyed, anchor, missHit });
    }
  }
}
check(`locateAnchor fuzz (${FUZZ_CASES} cases, seed=${SEED})`, () => {
  assert.equal(fuzzFailures, 0, `${fuzzFailures} fuzz failures`);
});

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
