import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

// Live-preview engine (P60 §2) — Obsidian's "Live Preview" line model: the
// line(s) the caret/selection touches show raw markdown source; every other
// line renders styled, syntax characters hidden. Ported from the pattern in
// kenforthewin/atomic-editor (inline-preview.ts + read-only.ts) into plain
// JS/house style — not a verbatim TS port; our node set and simplifications
// (no cursor-scoped link reveal, no mid-typing emphasis supplement, no
// nested-list depth math) are per PHASE_SPEC.md §2, which overrides the
// reference where the two differ. See the bottom of this file for the single
// factory + the exported Compartment handle W-B reconfigures on role change.

// ---- line classes (unconditional — zero layout shift on the raw/rendered
// flip, since the class never toggles, only the hidden-mark decorations do) ----
const LINE_CLASS_BY_BLOCK = {
  ATXHeading1: "cm-lp-h1",
  ATXHeading2: "cm-lp-h2",
  ATXHeading3: "cm-lp-h3",
  ATXHeading4: "cm-lp-h4",
  ATXHeading5: "cm-lp-h5",
  ATXHeading6: "cm-lp-h6",
  SetextHeading1: "cm-lp-h1",
  SetextHeading2: "cm-lp-h2",
  Blockquote: "cm-lp-quote",
  FencedCode: "cm-lp-code",
  Table: "cm-lp-table", // styled-raw deferral (§2) — pipes stay visible, mono+bg only
};

// Hidden iff their OWN line is inactive (plain per-line rule — no
// cursor-inside-link scoping, simplified vs. the reference on purpose).
const HIDEABLE_MARK = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "LinkMark",
  "LinkTitle",
  "QuoteMark",
  "StrikethroughMark",
]);

// HeaderMark/QuoteMark swallow one trailing space too (spec: "+trailing
// space") — hiding just "#"/">" would leave a stray leading space before the
// heading/quote text. Bullet/checkbox marks do NOT swallow theirs (see
// ListMark/TaskMarker handling below) — the CM6 "no horizontal padding on
// inline widgets" rule means marker-to-text spacing has to come from a real
// space character left in the document, not CSS.
const TRAILING_SPACE_MARK = new Set(["HeaderMark", "QuoteMark"]);

// ViewPlugin-sourced Decoration.replace ranges may not cross a line break
// (CM6 throws "Decorations that replace line breaks may not be specified via
// plugins" at build time) — Lezer happily emits line-crossing tokens anyway
// (a wrapped LinkTitle, for instance), so every replace goes through this
// splitter first. The newline between segments stays visible; only the first
// segment carries the widget (if any), so a multi-line hide doesn't stack
// duplicate widgets on line 2+.
function pushReplace(ranges, doc, from, to, spec = {}) {
  if (from >= to) return;
  const startLine = doc.lineAt(from);
  if (to <= startLine.to) {
    ranges.push(Decoration.replace(spec).range(from, to));
    return;
  }
  let cursor = from;
  let firstSegment = true;
  while (cursor < to) {
    const line = doc.lineAt(cursor);
    const segEnd = Math.min(to, line.to);
    if (segEnd > cursor) {
      ranges.push(Decoration.replace(firstSegment ? spec : {}).range(cursor, segEnd));
      firstSegment = false;
    }
    cursor = line.to + 1;
  }
}

// A Link node can hold two URL children when the visible label is itself a
// URL (`[https://label](https://dest)`) — only the one after the closing
// "]" is destination syntax to hide/open; the other is visible label text.
function linkDestinationUrl(linkNode, doc) {
  const closeBracket = linkNode.getChildren("LinkMark").find((m) => doc.sliceString(m.from, m.to) === "]");
  if (!closeBracket) return null;
  const urls = linkNode.getChildren("URL");
  return urls.find((u) => u.from >= closeBracket.to) ?? urls[0] ?? null;
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
  ignoreEvent() {
    return false; // let a click on the dot still place the caret normally
  }
}
const BULLET_WIDGET = new BulletWidget();

// `pos` is the position of the single toggle character (the space/x inside
// "[ ]"/"[x]") captured at decoration-build time — decorations rebuild in
// lockstep with doc state (see previewPlugin.update below), so a widget
// instance's captured pos always matches the doc it was built against;
// no posAtDOM lookup needed.
class TaskCheckboxWidget extends WidgetType {
  constructor(pos, checked) {
    super();
    this.pos = pos;
    this.checked = checked;
  }
  eq(other) {
    return other.pos === this.pos && other.checked === this.checked;
  }
  toDOM(view) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-lp-checkbox";
    input.setAttribute("contenteditable", "false");
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation(); // never let the click bubble into CM6's own caret/reveal handling
    };
    input.addEventListener("mousedown", stop);
    input.addEventListener("click", (e) => {
      stop(e);
      const from = this.pos;
      const current = view.state.doc.sliceString(from, from + 1);
      const next = /x/i.test(current) ? " " : "x";
      if (current === next) return;
      view.dispatch({ changes: { from, to: from + 1, insert: next } });
    });
    return input;
  }
  ignoreEvent(event) {
    return event.type === "mousedown" || event.type === "click"; // our own handlers own these
  }
}

// The set of line numbers touched by any selection range, while focused and
// editable — read-only/unfocused means no active lines, which (by the hide
// rules below) means the whole doc renders fully styled for free. While
// frozen (see freezeField), the CAPTURED pre-click ranges are used instead of
// the live selection, so a mousedown-triggered caret move can't jitter the
// layout under the pointer before release.
function computeActiveLines(view, frozen) {
  const { state } = view;
  const activeLines = new Set();
  if (state.readOnly) return activeLines;

  if (frozen && frozen.frozen && frozen.ranges) {
    for (const r of frozen.ranges) {
      const from = Math.max(0, Math.min(r.from, state.doc.length));
      const to = Math.max(0, Math.min(r.to, state.doc.length));
      const firstLine = state.doc.lineAt(Math.min(from, to)).number;
      const lastLine = state.doc.lineAt(Math.max(from, to)).number;
      for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
    }
    return activeLines;
  }

  if (!view.hasFocus) return activeLines;
  for (const r of state.selection.ranges) {
    const firstLine = state.doc.lineAt(r.from).number;
    const lastLine = state.doc.lineAt(r.to).number;
    for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
  }
  return activeLines;
}

function buildDecorations(view, frozen) {
  const { state } = view;
  const doc = state.doc;
  const ranges = [];
  const activeLines = computeActiveLines(view, frozen);

  // Whole-tree walk, not the viewport — viewport-walking rebuilds on every
  // scroll and breaks long-note iOS momentum scrolling (anchor conflicts
  // with lines newly entering the top of the viewport). ensureSyntaxTree
  // guarantees the tree actually reaches doc.length before the walk; without
  // it, content past the incremental parser's first pass would render as
  // raw "##"/"**" until something else happens to trigger a rebuild.
  const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);

  tree.iterate({
    enter(node) {
      // Clicking anywhere inside a fenced block should reveal the whole
      // fence (backticks + info string) together, not just whichever exact
      // line the caret lands on — FencedCode is entered before its
      // CodeMark/CodeInfo children, so expanding here makes those children's
      // own line-based hide check agree with the rest of the block.
      if (node.name === "FencedCode") {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        let anyActive = false;
        for (let n = firstLine; n <= lastLine; n++) {
          if (activeLines.has(n)) {
            anyActive = true;
            break;
          }
        }
        if (anyActive) {
          for (let n = firstLine; n <= lastLine; n++) activeLines.add(n);
        }
      }

      const lineClass = LINE_CLASS_BY_BLOCK[node.name];
      if (lineClass) {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        for (let n = firstLine; n <= lastLine; n++) {
          ranges.push(Decoration.line({ class: lineClass }).range(doc.line(n).from));
        }
      }

      if (node.name === "ListItem") {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        for (let n = firstLine; n <= lastLine; n++) {
          ranges.push(Decoration.line({ class: "cm-lp-li" }).range(doc.line(n).from));
        }
        // Only the line that CARRIES the marker takes the hanging indent —
        // lazy-continuation lines of the same item must NOT (that is what
        // pulled them flush-left before). CSS alone cannot tell the two
        // apart: a raw active line has no marker widget to select on.
        const headLine = doc.line(firstLine);
        ranges.push(Decoration.line({ class: "cm-lp-li-head" }).range(headLine.from));

        // Task lines (P61 §4.3): same taskLead detection the ListMark branch
        // below uses to decide whether to hide the bullet. Gated by
        // activeLines like the checkbox widget itself — cm-lp-li-head's own
        // -2ch hang is pixel-neutral on a RAW active line (the raw "- "
        // prefix really is 2 mono chars), but the checkbox's rendered
        // footprint is deliberately NOT 2ch (index.css positions it into the
        // hang via width/margin, not char-count), so this extra class must
        // NOT apply while the line shows raw "- [ ] " text — that would
        // shift the raw line instead of leaving it untouched.
        if (!activeLines.has(firstLine) && /^(\s*[-*+]\s+)\[[ xX]\]/.test(headLine.text)) {
          ranges.push(Decoration.line({ class: "cm-lp-task-head" }).range(headLine.from));
        }
      }

      if (HIDEABLE_MARK.has(node.name) && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        if (!activeLines.has(lineNum)) {
          let hideTo = node.to;
          if (TRAILING_SPACE_MARK.has(node.name) && node.to < doc.length && doc.sliceString(node.to, node.to + 1) === " ") {
            hideTo = node.to + 1;
          }
          pushReplace(ranges, doc, node.from, hideTo);
        }
      }

      // Links: render text, hide the ()/[] syntax. The destination URL
      // itself isn't a *Mark node, but leaving it visible would render
      // "label(url)" with only the brackets gone — hidden here under the
      // same per-line rule as the marks, scoped to Link (not Autolink/bare
      // GFM URLs, which are visible content, not syntax to collapse).
      if (node.name === "Link" && node.from < node.to) {
        const dest = linkDestinationUrl(node.node, doc);
        if (dest && dest.from < dest.to) {
          const lineNum = doc.lineAt(dest.from).number;
          if (!activeLines.has(lineNum)) {
            pushReplace(ranges, doc, dest.from, dest.to);
          }
        }
      }

      // ListMark: unordered -> bullet widget, gated by the SAME active-line
      // rule as every other hidden mark (PHASE_SPEC.md §60.1 ruling —
      // bullets/checkboxes are not an exception: caret on the line shows raw
      // "- "/"- [ ]", caret elsewhere shows the widget). Ordered markers keep
      // their numbers always — hide nothing, ever.
      if (node.name === "ListMark" && node.from < node.to) {
        const markText = doc.sliceString(node.from, node.to);
        if (markText === "-" || markText === "*" || markText === "+") {
          const line = doc.lineAt(node.from);
          if (!activeLines.has(line.number)) {
            const taskLead = line.text.match(/^(\s*[-*+]\s+)\[[ xX]\]/);
            if (taskLead) {
              // Task line: the checkbox widget below (from the sibling
              // TaskMarker node) already carries the marker glyph — hide the
              // bullet's own "- " so the line doesn't show bullet+checkbox.
              pushReplace(ranges, doc, node.from, line.from + taskLead[1].length);
            } else {
              pushReplace(ranges, doc, node.from, node.to, { widget: BULLET_WIDGET });
            }
          }
        }
      }

      if (node.name === "TaskMarker" && node.from < node.to) {
        const lineNum = doc.lineAt(node.from).number;
        if (!activeLines.has(lineNum)) {
          const checked = /\[x\]/i.test(doc.sliceString(node.from, node.to));
          pushReplace(ranges, doc, node.from, node.to, {
            widget: new TaskCheckboxWidget(node.from + 1, checked),
          });
        }
      }
    },
  });

  return Decoration.set(ranges, true); // sort: true — RangeSet requires sorted ranges
}

// ---- freeze plumbing (click-jitter prevention) ----
// Spec: freeze the ACTIVE-LINE SET, not the decoration set — a naive
// skip-the-whole-rebuild approach (recomputing fresh selection-derived
// active lines only once unfrozen) would let a docChanged mid-drag rebuild
// against the CURRENT (possibly mid-drag) selection instead of the
// pre-freeze one. Storing the frozen SELECTION RANGES (not raw line
// numbers) and mapping them through tr.changes on every docChanged keeps
// them valid positions even while frozen — stale, unmapped positions would
// otherwise desync from the edited doc and crash on the next rebuild.
const setFrozen = StateEffect.define();

const freezeField = StateField.define({
  create: () => ({ frozen: false, ranges: null }),
  update(value, tr) {
    let { frozen, ranges } = value;
    let changed = false;
    if (ranges && tr.docChanged) {
      ranges = ranges.map((r) => ({ from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to) }));
      changed = true;
    }
    for (const e of tr.effects) {
      if (e.is(setFrozen)) {
        frozen = e.value;
        // Captured from tr.startState — the selection as it was BEFORE this
        // click's own caret-placement change, which is the whole point
        // (freeze the pre-click reveal state, not the just-clicked one).
        ranges = frozen ? tr.startState.selection.ranges.map((r) => ({ from: r.from, to: r.to })) : null;
        changed = true;
      }
    }
    return changed ? { frozen, ranges } : value;
  },
});

const FREEZE_TAIL_MS = 100;

// Capture-phase pointerdown on view.dom so this fires BEFORE CM6's own
// pointerdown handler runs its selection logic — without capture, CM6 can
// win the ordering race and reveal syntax before the freeze effect lands.
// pointerup/pointercancel listen on window (not the content DOM) since a
// drag can end with the pointer released outside the editor entirely.
const freezeMousePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.down = false;
      this.releaseTimer = null;
      this.onDown = (event) => {
        if (event.button !== 0) return;
        if (view.state.readOnly) return; // read-only never reveals — nothing to freeze
        const target = event.target;
        if (!(target instanceof Node) || !view.contentDOM.contains(target)) return;
        this.down = true;
        if (this.releaseTimer != null) {
          window.clearTimeout(this.releaseTimer);
          this.releaseTimer = null;
        }
        if (!view.state.field(freezeField).frozen) {
          view.dispatch({ effects: setFrozen.of(true) });
        }
      };
      this.onUp = () => {
        if (!this.down) return;
        this.down = false;
        if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
        this.releaseTimer = window.setTimeout(() => {
          this.releaseTimer = null;
          if (!view.state.field(freezeField).frozen) return;
          try {
            view.dispatch({ effects: setFrozen.of(false) });
          } catch {
            // view destroyed while the tail timer was pending
          }
        }, FREEZE_TAIL_MS);
      };
      view.dom.addEventListener("pointerdown", this.onDown, true);
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onUp);
    }
    update() {
      // no-op — freeze is driven by the DOM pointer listeners above, not by doc/selection updates
    }
    destroy() {
      this.view.dom.removeEventListener("pointerdown", this.onDown, true);
      window.removeEventListener("pointerup", this.onUp);
      window.removeEventListener("pointercancel", this.onUp);
      if (this.releaseTimer != null) window.clearTimeout(this.releaseTimer);
    }
  }
);

// ---- preview ViewPlugin (decorations — a ViewPlugin, not a StateField, so
// it gets hasFocus/focusChanged, which a StateField cannot see) ----
const previewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view, view.state.field(freezeField));
    }
    update(update) {
      if (update.view.composing) return; // IME mid-composition — never rebuild

      const prevFrozen = update.startState.field(freezeField);
      const nextFrozen = update.state.field(freezeField);
      const justUnfroze = prevFrozen.frozen && !nextFrozen.frozen;

      // Frozen: only a doc change forces a rebuild. Selection/focus churn
      // during the drag is exactly what freeze exists to ignore; a doc
      // change still has to rebuild (stale decorations = position crashes
      // once the doc has moved on).
      if (nextFrozen.frozen && !justUnfroze && !update.docChanged) return;

      const readOnlyChanged = update.startState.readOnly !== update.state.readOnly;
      // "Tree grew": the incremental parser advanced independent of a doc
      // edit (its background pass finally reached content the first
      // ensureSyntaxTree call above timed out short of). Comparing parsed
      // length before/after, gated to non-docChanged updates, catches this
      // without a dedicated tree-progress extension (no new deps).
      const treeGrew = !update.docChanged && syntaxTree(update.state).length !== syntaxTree(update.startState).length;

      if (justUnfroze || update.docChanged || update.selectionSet || update.focusChanged || treeGrew || readOnlyChanged) {
        this.decorations = buildDecorations(update.view, nextFrozen);
      }
      // deliberately NOT reacting to update.viewportChanged — scrolling
      // alone must never rebuild (iOS momentum-halt regression, §2).
    }
  },
  { decorations: (p) => p.decorations }
);

// ---- Cmd/Ctrl-click to open a link; plain click = caret placement ----
function findLinkUrl(view, pos) {
  const tree = syntaxTree(view.state);
  let node = tree.resolveInner(pos, 1);
  while (node && node.name !== "Link") node = node.parent;
  if (!node) return null;
  const dest = linkDestinationUrl(node, view.state.doc);
  return dest ? view.state.doc.sliceString(dest.from, dest.to) : null;
}

const linkClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const url = findLinkUrl(view, pos);
    if (!url) return false;
    event.preventDefault();
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // window.open can throw in sandboxed contexts — silent no-op
    }
    return true;
  },
});

// ---- read-only pair, in a Compartment so W-B can reconfigure (not remount)
// on a role change. Always present in the returned extension list (with its
// content set per the `readOnly` arg) — a Compartment absent from the
// state's own config can't later be reconfigured, which would defeat the
// entire point of using one here. `EditorView.editable` is the UX lever (no
// contentDOM caret, no focus, no reveal); `EditorState.readOnly` is
// defense-in-depth (blocks paste/drop/IME — does not block our own
// programmatic dispatches, so the task checkbox keeps working in read-only
// notes by design, matching "readers can still tap a checkbox" if a future
// phase wants that). Unfocusable + state.readOnly true together mean
// computeActiveLines always returns empty -> the whole document renders
// fully styled for free. ----
export const readOnlyCompartment = new Compartment();

function readOnlyExtension(ro) {
  return [EditorView.editable.of(!ro), EditorState.readOnly.of(ro)];
}

// Single factory (§2 contract). Order: language, preview ViewPlugin (+ its
// link-click handler), freeze plugin, read-only pair.
export function livePreviewExtensions({ readOnly = false } = {}) {
  return [
    markdown({ base: markdownLanguage }), // GFM base (Strikethrough/Table/TaskList tokens) — bare markdown() is CommonMark only
    previewPlugin,
    linkClickHandler,
    freezeField,
    freezeMousePlugin,
    readOnlyCompartment.of(readOnlyExtension(readOnly)),
  ];
}
