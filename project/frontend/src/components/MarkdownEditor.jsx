import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, EditorSelection, StateField, StateEffect, Annotation, Transaction } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { history, defaultKeymap, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { locateAnchor } from "../utils/commentAnchor";
import { computeHunkRanges, spliceHunkAtRange, refineWords } from "../utils/noteDiff";
import { livePreviewExtensions, readOnlyCompartment } from "../utils/livePreview";

// Token-driven HighlightStyle (P56 §2): CSS variables, not literal colors,
// so both themes (data-theme stamped on <html>, no media queries) work with
// this one instantiation. --accent/azure is reserved for "you are here"
// (tokens.css spend rule) — links use --suggester-text instead.
// Heading fontSize dropped (P60 §3) — the live-preview engine's line classes
// (cm-lp-h1..h6, src/utils/livePreview.js) own heading size now; keeping it
// here too would double-apply and drift out of sync with the line-class values.
const appHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: "var(--navy)", fontWeight: "bold" },
  { tag: tags.heading2, color: "var(--navy)", fontWeight: "bold" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: "var(--navy)", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.monospace, background: "var(--bg)" },
  { tag: [tags.link, tags.url], color: "var(--suggester-text)", textDecoration: "underline" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  // GFM base (P60) is the first time this token exists — without an entry the
  // hidden ~~ marks would leave struck text looking like ordinary text.
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.processingInstruction, tags.list], color: "var(--muted)" },
]);

// Gold decoration StateField (P56 §2, re-locate design). The field's Value
// is a DecorationSet (what EditorView.decorations.from needs); recompute
// needs the LAST {items, activeId} pushed via setHighlightsEffect, which
// isn't derived from doc/selection the way a normal field's value is, so it
// lives in a closure variable instead (captured per-mount inside the effect
// below, not module-level — each editor instance gets its own).
const setHighlightsEffect = StateEffect.define();

function buildDecorationSet(doc, items, activeId) {
  const text = doc.toString();
  const ranges = [];
  for (const { id, anchor } of items) {
    const located = locateAnchor(text, anchor);
    if (!located) continue; // re-locate ruling: a destroyed quote just drops its highlight
    ranges.push(
      Decoration.mark({
        class: "hl-comment" + (id === activeId ? " active" : ""),
        attributes: { "data-comment-id": id },
      }).range(located.start, located.end)
    );
  }
  return Decoration.set(ranges, true); // sort: true — RangeSet requires sorted ranges
}

// Suggestion decoration StateField (P57 §2, POSITIONAL-MAPPING design — the
// deliberate opposite of the gold field above). Comments re-locate on every
// keystroke because a comment's anchor is meant to re-attach to its quoted
// text wherever that text now lives; a suggestion's hunk targets a REGION
// TO BE REPLACED, and Samuel's Google-Docs ruling is that region should ride
// along with edits like a live selection — locate ONCE when the suggestion
// enters the editor, then track it through tr.changes forever after. Typing
// before it shifts it; typing inside it grows/shrinks it; re-locating on
// every doc change would instead make it snap onto whatever now happens to
// match the hunk's old text, which is exactly the re-locate behavior this
// layer must NOT have. See suggestionsField below (inside the mount effect)
// for the map-vs-locate split this produces.
const setSuggestionsEffect = StateEffect.define();

// P60 §3: applySuggestion's own dispatch (approve, incl. each sequential call
// in a bulk-approve loop) collapses its range exactly like a user "destroy"
// edit would — most visibly for a pure-delete hunk, where the whole range
// vanishes with nothing appearing to replace it. Without a marker, the
// destroy-scan below can't tell "user deleted the highlighted text" (a real
// destroy — fire the callback) apart from "the suggestion was just approved"
// (not a destroy — the server-side apply already happened through the
// approve action, not through this edit). Tagging ONLY applySuggestion's
// programmatic dispatch with this annotation lets the scan skip exactly
// those transactions and nothing else — genuine user edits carry no
// annotation and are never mistaken for an approve.
const suggestionApplyAnnotation = Annotation.define();

// Edge-glyph widget (P60 §3, kept through P66's word-level restore): a small
// non-editable "±" marker at a suggestion's `from`, side -1, so it renders
// just before the affected text — the stable tap anchor for every located
// range, coexisting with the word-level decorations below (side -1 vs the
// add widget's side 1). Carries only `id` — unlike HunkAddWidget it renders
// no text of its own, so active/hunk content never affect its identity.
class HunkGlyphWidget extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }
  eq(other) {
    return other.id === this.id;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "hunk-glyph";
    span.dataset.suggestionId = this.id;
    span.contentEditable = "false";
    span.textContent = "±"; // "±" — Samuel vetoes on sight if this ever changes
    return span;
  }
}

// Google-Docs-fidelity inline widget (P59 §1, restored P66 §1): renders an
// ADDED word-run's actual text, navy and non-editable, in place. Used both
// for a collapsed range's whole hunk.new and for each individual "add" run
// inside a non-collapsed range's word walk.
class HunkAddWidget extends WidgetType {
  constructor(id, active, text) {
    super();
    this.id = id;
    this.active = active;
    this.text = text;
  }
  eq(other) {
    return other.id === this.id && other.active === this.active && other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "hunk-add-inline" + (this.active ? " active" : "");
    span.dataset.suggestionId = this.id;
    span.contentEditable = "false";
    span.textContent = this.text;
    return span;
  }
}

// Locates every id in `items` that isn't already in `prevRanges`, keeping
// already-tracked ids (even ones tracked as null — a hunk unlocatable at
// entry stays unlocatable, never gets a second chance) untouched. Ids
// missing from `items` are dropped.
function reconcileSuggestionRanges(prevRanges, items, doc) {
  const prevById = new Map(prevRanges.map((r) => [r.id, r]));
  const text = doc.toString();
  return items.map(({ id, hunk }) => {
    const existing = prevById.get(id);
    if (existing) return existing;
    const located = computeHunkRanges(text, [hunk]).get(0);
    return { id, from: located ? located.from : null, to: located ? located.to : null };
  });
}

// Boundary-exact insertions may legitimately go either side (writer's call,
// PHASE_SPEC.md §2); an insertion strictly before/inside a range must shift/
// grow it regardless. A currently-empty range (pure-insert junction, or a
// range collapsed by a full deletion) maps both ends with the SAME assoc so
// they can never diverge into an inverted from>to — an insertion exactly at
// a point has no "inside" to grow into. Non-empty ranges map `from` forward
// past a boundary-exact insertion and `to` before one, so typing exactly at
// an edge shifts the whole range rather than silently growing it.
function mapSuggestionRange(r, changes) {
  if (r.from === null) return r;
  if (r.from === r.to) {
    const pos = changes.mapPos(r.from, -1);
    return { id: r.id, from: pos, to: pos };
  }
  const from = changes.mapPos(r.from, 1);
  const to = changes.mapPos(r.to, -1);
  // A change that REPLACES a span containing the whole range maps `from` past
  // the inserted text and `to` before it, i.e. from > to — an inverted range
  // that Decoration.mark rejects outright. Collapse to the change's start, the
  // same point a plain deletion of that span produces.
  if (from > to) return { id: r.id, from: to, to };
  return { id: r.id, from, to };
}

// Word-level suggestion decorations (P59 §1, restored P66 §1 — replaces P60's
// whole-range hunk-suggest mark, which regressed the P52.1 bug class: a
// pure-append suggestion struck the entire old line). For each tracked,
// located range: the P60 glyph widget stays at `from` (side -1, the stable
// tap anchor — for a collapsed range it's the only guaranteed marker); then
// slice the range's CURRENT text (`doc`, not the stored hunk.old — so display
// stays truthful if the user edits inside the range) and diff it word-grain
// against hunk.new via refineWords (existing P52.1 export). Walk the runs
// cumulatively from `from`: "same" advances the cursor with no decoration
// (plain, unstyled text — the whole point of the P59 ruling); "del" marks the
// consumed span red-strike; "add" doesn't exist in the current doc, so it's a
// widget at the cursor (not consumed, side 1) carrying its own text inline in
// navy. A collapsed range (pure-insert junction, or a range some other edit
// fully deleted) has no old text to walk — render hunk.new whole, one widget.
function buildSuggestionDecorationSet(doc, ranges, items, activeId) {
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const decos = [];
  for (const r of ranges) {
    if (r.from === null) continue; // unlocatable, or destroy-nulled — no decoration, ever
    const item = itemsById.get(r.id);
    const hunkNew = item ? item.hunk.new : "";
    const active = r.id === activeId;
    decos.push(Decoration.widget({ widget: new HunkGlyphWidget(r.id), side: -1 }).range(r.from));

    if (r.from === r.to) {
      if (hunkNew !== "") {
        decos.push(Decoration.widget({ widget: new HunkAddWidget(r.id, active, hunkNew), side: 1 }).range(r.from));
      }
      continue;
    }

    const rangeText = doc.sliceString(r.from, r.to);
    const runs = refineWords(rangeText, hunkNew);
    let pos = r.from;
    for (const run of runs) {
      if (run.type === "same") {
        pos += run.text.length; // plain — no decoration
      } else if (run.type === "del") {
        const end = pos + run.text.length;
        decos.push(
          Decoration.mark({
            class: "hunk-del" + (active ? " active" : ""),
            attributes: { "data-suggestion-id": r.id },
          }).range(pos, end)
        );
        pos = end;
      } else {
        // "add" text isn't in the doc at `pos` — a widget there, cursor unmoved.
        if (run.text !== "") {
          decos.push(Decoration.widget({ widget: new HunkAddWidget(r.id, active, run.text), side: 1 }).range(pos));
        }
      }
    }
  }
  return Decoration.set(decos, true);
}

// Hand-rolled CM6 mount (P56 §2): uncontrolled after mount, exactly like the
// textarea it replaces — initialDoc is read ONCE; parents remount via `key`
// to reset (NoteEditor/NoteView, W-B's side of the seam).
export default forwardRef(function MarkdownEditor(
  {
    initialDoc,
    onDocChange,
    onSelectionChange,
    highlights = [],
    activeHighlightId = null,
    onHighlightTap,
    suggestions = [],
    activeSuggestionId = null,
    onSuggestionTap,
    onSuggestionsLocated,
    onSuggestionDestroyed,
    nextSeq,
    onUnifiedUndo,
    onUnifiedRedo,
    onNewTextEdit,
    readOnly = false,
    autoFocus = false,
    ariaLabel,
  },
  ref
) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  // Stashed per-mount so the ref methods (outside the mount effect's own
  // closure) can reach the closure-built field via state.field(...).
  const suggestionsFieldRef = useRef(null);
  // P61 §3.3: the unified-timeline seq arrays live here (mutated in place by
  // the mount effect's updateListener), not in React state — a keystroke
  // must not re-render this component, only bump NoteView's own tick so its
  // Undo/Redo buttons recompute. historyOpInFlightRef disambiguates OUR OWN
  // runTextUndo/runTextRedo calls from a genuine new edit inside the same
  // updateListener (both move undoDepth the same direction) — set only
  // around the CM6 undo()/redo() call, read synchronously since dispatch
  // fires the listener before those calls return.
  const textUndoSeqsRef = useRef([]);
  const textRedoSeqsRef = useRef([]);
  const historyOpInFlightRef = useRef(null);

  // Refs so the mount-once effect's closures always call the LATEST callback
  // props without needing those props in the effect's own dependency array.
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onHighlightTapRef = useRef(onHighlightTap);
  onHighlightTapRef.current = onHighlightTap;
  const onSuggestionTapRef = useRef(onSuggestionTap);
  onSuggestionTapRef.current = onSuggestionTap;
  const onSuggestionsLocatedRef = useRef(onSuggestionsLocated);
  onSuggestionsLocatedRef.current = onSuggestionsLocated;
  const onSuggestionDestroyedRef = useRef(onSuggestionDestroyed);
  onSuggestionDestroyedRef.current = onSuggestionDestroyed;
  // NoteEditor.jsx (the bare "new note" form) mounts this component with NO
  // nextSeq/onUnifiedUndo/onUnifiedRedo — there's no NoteView arbiter wired
  // up there. localSeqRef is a self-contained fallback counter so
  // reconcileTextHistory below never crashes calling an absent nextSeq; its
  // numbers are meaningless without a NoteView on the other end (nothing
  // ever queries topTextUndoSeq()/topTextRedoSeq() for that mount), but the
  // tracking itself has to stay crash-safe regardless of who's listening.
  const localSeqRef = useRef(0);
  const nextSeqRef = useRef(nextSeq);
  nextSeqRef.current = nextSeq ?? (() => ++localSeqRef.current);
  const onUnifiedUndoRef = useRef(onUnifiedUndo);
  onUnifiedUndoRef.current = onUnifiedUndo;
  const onUnifiedRedoRef = useRef(onUnifiedRedo);
  onUnifiedRedoRef.current = onUnifiedRedo;
  const onNewTextEditRef = useRef(onNewTextEdit);
  onNewTextEditRef.current = onNewTextEdit;

  useEffect(() => {
    // Mutable, per-mount — updated by setHighlightsEffect, read by the
    // field's update() on every docChanged recompute.
    let current = { items: highlights, activeId: activeHighlightId };

    // P61 §3.3: fresh history per mount (remount wipes CM6 history — §3.5
    // accepts that text seqs die with it), so 0/0 is always the correct
    // starting point regardless of initialDoc.
    let prevUndoDepth = 0;
    let prevRedoDepth = 0;

    // Reconciles textUndoSeqsRef/textRedoSeqsRef to the transaction's actual
    // new depths rather than assuming a move of exactly 1 (history merging
    // can move either depth by more) — trims/pads with nextSeq() when a
    // depth grew without historyOpInFlightRef saying why (defensive; should
    // only happen for a genuine new edit).
    function reconcileTextHistory(state) {
      const newUndoDepth = undoDepth(state);
      const newRedoDepth = redoDepth(state);
      if (newUndoDepth === prevUndoDepth && newRedoDepth === prevRedoDepth) return;
      const undoSeqs = textUndoSeqsRef.current;
      const redoSeqs = textRedoSeqsRef.current;
      if (historyOpInFlightRef.current === "undo") {
        // Moved from undo -> redo: reuse the SAME seq (§3.3 — an undone
        // entry keeps its original chronological position on the redo side).
        while (undoSeqs.length > newUndoDepth) redoSeqs.push(undoSeqs.pop());
        while (undoSeqs.length < newUndoDepth) undoSeqs.push(nextSeqRef.current());
        while (redoSeqs.length > newRedoDepth) redoSeqs.pop();
        while (redoSeqs.length < newRedoDepth) redoSeqs.push(nextSeqRef.current());
      } else if (historyOpInFlightRef.current === "redo") {
        // Moved from redo -> undo: MINTS a fresh seq (§3.3 — a redo is a new
        // "just happened" event, chronologically after everything else).
        while (redoSeqs.length > newRedoDepth) { redoSeqs.pop(); undoSeqs.push(nextSeqRef.current()); }
        while (redoSeqs.length < newRedoDepth) redoSeqs.push(nextSeqRef.current());
        while (undoSeqs.length > newUndoDepth) undoSeqs.pop();
        while (undoSeqs.length < newUndoDepth) undoSeqs.push(nextSeqRef.current());
      } else {
        // A genuine new edit — undo grows, the redo branch is discarded.
        while (undoSeqs.length < newUndoDepth) undoSeqs.push(nextSeqRef.current());
        while (undoSeqs.length > newUndoDepth) undoSeqs.pop();
        redoSeqs.length = 0;
      }
      prevUndoDepth = newUndoDepth;
      prevRedoDepth = newRedoDepth;
    }

    const highlightsField = StateField.define({
      create(state) {
        return buildDecorationSet(state.doc, current.items, current.activeId);
      },
      update(deco, tr) {
        let touched = false;
        for (const e of tr.effects) {
          if (e.is(setHighlightsEffect)) {
            current = e.value;
            touched = true;
          }
        }
        if (!tr.docChanged && !touched) return deco;
        return buildDecorationSet(tr.state.doc, current.items, current.activeId); // recompute, never map
      },
      provide: (f) => EditorView.decorations.from(f),
    });

    // Same closure pattern as highlightsField above, but the field's OWN
    // value carries the tracked ranges (mapped forward every docChanged,
    // never recomputed from `current.items` the way highlightsField is) —
    // `current` here only ever supplies activeId for redecoration and the
    // hunk payloads needed to locate a NEWLY tracked id. See the field
    // comment block above setSuggestionsEffect for why.
    let currentSuggestions = { items: suggestions, activeId: activeSuggestionId };

    const suggestionsField = StateField.define({
      create(state) {
        const ranges = reconcileSuggestionRanges([], currentSuggestions.items, state.doc);
        return {
          ranges,
          deco: buildSuggestionDecorationSet(state.doc, ranges, currentSuggestions.items, currentSuggestions.activeId),
        };
      },
      update(value, tr) {
        let ranges = value.ranges;
        if (tr.docChanged) {
          // P60 §3 DESTROY DETECTION: a range that was genuinely expanded
          // (from < to) and maps to a collapsed point this transaction was
          // just destroyed by an edit — UNLESS this transaction is
          // applySuggestion's own dispatch (see suggestionApplyAnnotation
          // above), which collapses its own range on approve and must not
          // be read as a destroy. A destroyed range is set to {from: null,
          // to: null} rather than removed from the array — reusing the
          // existing "unlocatable" convention (mapSuggestionRange no-ops on
          // null forever, reconcileSuggestionRanges never re-locates a null
          // entry) so the id can never render or resurrect again, including
          // via Cmd-Z mapping the collapsed point back open (P60 ruling: the
          // server-side destroy already fired, undo doesn't reverse it).
          const skipDestroy = !!tr.annotation(suggestionApplyAnnotation);
          ranges = value.ranges.map((prev) => {
            const mapped = mapSuggestionRange(prev, tr.changes);
            if (!skipDestroy && prev.from !== null && prev.from < prev.to && mapped.from === mapped.to) {
              return { id: prev.id, from: null, to: null };
            }
            return mapped;
          });
        }
        let pushed = false;
        for (const e of tr.effects) {
          if (e.is(setSuggestionsEffect)) {
            currentSuggestions = e.value;
            pushed = true;
          }
        }
        if (pushed) {
          ranges = reconcileSuggestionRanges(ranges, currentSuggestions.items, tr.state.doc);
        }
        if (!tr.docChanged && !pushed) return value;
        // Word-runs recompute here on every docChanged (not just a pushed
        // effect) — cheap at note scale, and the only way in-progress edits
        // around/inside a suggestion stay truthful live (P59 §1).
        return {
          ranges,
          deco: buildSuggestionDecorationSet(tr.state.doc, ranges, currentSuggestions.items, currentSuggestions.activeId),
        };
      },
      provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
    });
    suggestionsFieldRef.current = suggestionsField;

    function handleTapEvent(e) {
      const commentEl = e.target.closest && e.target.closest("[data-comment-id]");
      if (commentEl && onHighlightTapRef.current) onHighlightTapRef.current(commentEl.dataset.commentId);
      // Matches the hunk-del marks, hunk-add-inline widgets, and the
      // hunk-glyph widget alike — all carry data-suggestion-id, so no
      // per-decoration handling needed here.
      const suggestionEl = e.target.closest && e.target.closest("[data-suggestion-id]");
      if (suggestionEl && onSuggestionTapRef.current) onSuggestionTapRef.current(suggestionEl.dataset.suggestionId);
      // no preventDefault — caret placement inside CM6 must proceed
    }

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          ...livePreviewExtensions({ readOnly }),
          EditorView.lineWrapping, // mandatory — textareas soft-wrap, CM6 doesn't by default
          history(),
          // P61 §3.3: historyKeymap is REPLACED, not augmented — Mod-z/
          // Mod-Shift-z/Mod-y hand off to NoteView's unified arbiter instead
          // of running CM6's own undo/redo directly, so a text edit and a
          // review action interleave into one chronological timeline. CM6
          // still preventDefaults the DOM event on a `true` return (the
          // document-level listener's defaultPrevented check relies on
          // this). `history()` itself stays — runTextUndo/runTextRedo below
          // still call CM6's own undo()/redo() commands directly. Falls back
          // to plain undo()/redo() when no onUnifiedUndo/onUnifiedRedo is
          // wired (NoteEditor.jsx's bare "new note" form — no NoteView
          // arbiter there) so Cmd-Z still works standalone instead of
          // silently no-op'ing.
          keymap.of([
            ...defaultKeymap,
            {
              key: "Mod-z",
              run: (view) => {
                if (!onUnifiedUndoRef.current) return undo(view);
                onUnifiedUndoRef.current();
                return true;
              },
            },
            {
              key: "Mod-Shift-z",
              run: (view) => {
                if (!onUnifiedRedoRef.current) return redo(view);
                onUnifiedRedoRef.current();
                return true;
              },
            },
            {
              key: "Mod-y",
              run: (view) => {
                if (!onUnifiedRedoRef.current) return redo(view);
                onUnifiedRedoRef.current();
                return true;
              },
            },
          ]),
          syntaxHighlighting(appHighlightStyle),
          EditorView.theme({
            "&": { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)" },
            ".cm-content": { caretColor: "var(--text)" },
          }),
          highlightsField,
          suggestionsField,
          // mousedown, not click: CM6 resolves the caret position from
          // mousedown, so this must run at that point for "don't
          // preventDefault, let caret placement proceed" to mean anything.
          EditorView.domEventHandlers({ mousedown: handleTapEvent }),
          EditorView.updateListener.of((u) => {
            reconcileTextHistory(u.state);
            if (u.docChanged) onDocChangeRef.current?.(u.state.doc.toString());
            // Standard redo rule (Samuel's post-P61 ruling): any genuine user
            // edit discards BOTH redo branches, so this must also notify the
            // action side. Fired here, not in reconcileTextHistory's new-edit
            // branch — a keystroke merging into the current undo group moves
            // neither depth, so the reconciler never sees it. Excludes our own
            // undo/redo (historyOpInFlightRef) and history-exempt programmatic
            // splices (addToHistory false).
            if (
              u.docChanged &&
              !historyOpInFlightRef.current &&
              u.transactions.some((tr) => tr.docChanged && tr.annotation(Transaction.addToHistory) !== false)
            ) {
              onNewTextEditRef.current?.();
            }
            if (u.selectionSet) {
              const { from, to } = u.state.selection.main;
              onSelectionChangeRef.current?.({ from, to, text: u.state.sliceDoc(from, to) });
            }
            // Fired after each setSuggestionsEffect push (not on plain
            // docChanged maps) — NoteView drives per-card stale-state off it.
            if (u.transactions.some((tr) => tr.effects.some((e) => e.is(setSuggestionsEffect)))) {
              const { ranges } = u.state.field(suggestionsField);
              onSuggestionsLocatedRef.current?.(new Set(ranges.filter((r) => r.from !== null).map((r) => r.id)));
            }
            // Destroy detection fires here, not inside the field: comparing
            // the field's value across u.startState/u.state (rather than
            // stashing a "destroyed" list on the field's own value) sidesteps
            // a staleness trap — a non-docChanged transaction returns the
            // SAME value object from the field, so a stashed list would echo
            // stale ids on unrelated later transactions. Reading the actual
            // before/after field state instead only ever sees a given id's
            // from!==null -> null transition on the one transaction where it
            // truly happens (it can't happen twice — once null, always null).
            if (u.docChanged) {
              const prevRanges = u.startState.field(suggestionsField).ranges;
              const nextRanges = u.state.field(suggestionsField).ranges;
              const prevById = new Map(prevRanges.map((r) => [r.id, r]));
              for (const r of nextRanges) {
                const prev = prevById.get(r.id);
                if (prev && prev.from !== null && r.from === null) {
                  onSuggestionDestroyedRef.current?.(r.id);
                }
              }
            }
          }),
          ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
        ],
      }),
    });

    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy(); // HMR orphan trap — mandatory
      viewRef.current = null;
    };
    // uncontrolled mount: initialDoc/autoFocus/ariaLabel/readOnly's INITIAL
    // value read ONCE, per contract — later readOnly changes go through the
    // compartment reconfigure effect below, not a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push highlights/activeHighlightId prop changes into the live field
  // (recompute, not map — see field comment above).
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setHighlightsEffect.of({ items: highlights, activeId: activeHighlightId }) });
  }, [highlights, activeHighlightId]);

  // Push suggestions/activeSuggestionId prop changes into the live field —
  // this only changes WHICH ids are tracked (add/drop) and the active flag;
  // already-tracked ranges are left exactly where tr.changes has mapped them
  // (see suggestionsField.update above — this dispatch never re-locates).
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setSuggestionsEffect.of({ items: suggestions, activeId: activeSuggestionId }) });
  }, [suggestions, activeSuggestionId]);

  // Reconfigure (not remount) the read-only compartment on role change —
  // W-A's contract (PHASE_SPEC.md §2): unfocusable + non-editable turns off
  // active-line detection in the preview engine, so the whole doc renders
  // fully styled for free.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(
        readOnly ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : []
      ),
    });
  }, [readOnly]);

  useImperativeHandle(
    ref,
    () => ({
      getDoc: () => viewRef.current?.state.doc.toString() ?? "",
      // scrollIntoView: the card-click flow (NoteView.focusComment) relies on
      // this to REVEAL the caret — a 70vh-capped editor scrolls internally, so
      // moving the selection alone can leave the target off-screen.
      // view.focus() alongside the dispatch: CM6 only renders its selection
      // while focused, so a card click that merely moves the selection would
      // leave it invisible until the user clicks into the text (P56/P57).
      setSelection: (pos) => {
        viewRef.current?.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
        viewRef.current?.focus();
      },
      focus: () => viewRef.current?.focus(),
      // Suggestion mapping-layer ref methods (P57 §2) — all read the field's
      // CURRENT mapped range via the per-mount fieldRef stash, never re-locate.
      getMappedRange: (id) => {
        const view = viewRef.current;
        if (!view || !suggestionsFieldRef.current) return null;
        const r = view.state.field(suggestionsFieldRef.current).ranges.find((x) => x.id === id);
        return r && r.from !== null ? { from: r.from, to: r.to } : null;
      },
      // P60 §5: NoteView rebuilds margin ordering off live editor positions
      // rather than the stored (possibly stale) hunk anchors.
      getRangesSnapshot: () => {
        const view = viewRef.current;
        if (!view || !suggestionsFieldRef.current) return [];
        return view.state
          .field(suggestionsFieldRef.current)
          .ranges.filter((r) => r.from !== null)
          .map((r) => ({ id: r.id, from: r.from, to: r.to }));
      },
      applySuggestion: (id, hunk) => {
        const view = viewRef.current;
        if (!view || !suggestionsFieldRef.current) return false;
        const r = view.state.field(suggestionsFieldRef.current).ranges.find((x) => x.id === id);
        if (!r || r.from === null) return false;
        const change = spliceHunkAtRange(view.state.doc, { from: r.from, to: r.to }, hunk);
        // scrollIntoView mandatory (P56 fix); the updateListener's onDocChange
        // fires from this same dispatch — draft stash + content sync for free.
        // suggestionApplyAnnotation: see the destroy-detection comment above
        // suggestionsField.update — without it, approving (esp. a pure-delete
        // hunk) reads as the user destroying their own just-approved range.
        // Transaction.addToHistory.of(false) (P61 §3.2): review actions are
        // ACTION-timeline entries, not text-timeline ones — without this,
        // Cmd-Z could textually revert an approval into P60's dead end.
        view.dispatch({
          changes: change,
          scrollIntoView: true,
          annotations: [suggestionApplyAnnotation.of(true), Transaction.addToHistory.of(false)],
        });
        return true;
      },
      // P61 §3.3: the undo-side counterpart to topTextUndoSeq's arbiter —
      // last of textUndoSeqs, or -1 when the text side has nothing to undo.
      topTextUndoSeq: () => {
        const arr = textUndoSeqsRef.current;
        return arr.length ? arr[arr.length - 1] : -1;
      },
      topTextRedoSeq: () => {
        const arr = textRedoSeqsRef.current;
        return arr.length ? arr[arr.length - 1] : -1;
      },
      // historyOpInFlightRef around the CM6 command call: reconcileTextHistory
      // (inside the mount effect's updateListener, fired synchronously by
      // this same dispatch) reads it to tell "this is our own undo/redo call"
      // apart from a genuine new edit — both move undoDepth the same way.
      runTextUndo: () => {
        const view = viewRef.current;
        if (!view) return false;
        historyOpInFlightRef.current = "undo";
        const ok = undo(view);
        historyOpInFlightRef.current = null;
        return ok;
      },
      runTextRedo: () => {
        const view = viewRef.current;
        if (!view) return false;
        historyOpInFlightRef.current = "redo";
        const ok = redo(view);
        historyOpInFlightRef.current = null;
        return ok;
      },
      // Undo side of an approve (P61 §3.3): the suggestion is no longer
      // tracked by suggestionsField once it resolved out of the suggestions
      // prop, so this re-locates fresh — the mirror hunk (old/new swapped,
      // same before/after context — matches backend's hunkAlreadyApplied)
      // finds where `hunk.new` now sits and replaces it with `hunk.old`.
      // History-exempt + annotated for the same reason applySuggestion is.
      spliceMirrorHunk: (hunk) => {
        const view = viewRef.current;
        if (!view) return false;
        const mirror = { before: hunk.before, old: hunk.new, new: hunk.old, after: hunk.after };
        const range = computeHunkRanges(view.state.doc.toString(), [mirror]).get(0);
        if (!range) return false;
        const change = spliceHunkAtRange(view.state.doc, range, mirror);
        view.dispatch({
          changes: change,
          scrollIntoView: true,
          annotations: [suggestionApplyAnnotation.of(true), Transaction.addToHistory.of(false)],
        });
        return true;
      },
      revealRange: (id) => {
        const view = viewRef.current;
        if (!view || !suggestionsFieldRef.current) return;
        const r = view.state.field(suggestionsFieldRef.current).ranges.find((x) => x.id === id);
        if (!r || r.from === null) return;
        view.dispatch({ selection: EditorSelection.range(r.from, r.to), scrollIntoView: true });
        view.focus();
      },
    }),
    []
  );

  // .note-content-cm / .readonly wrapper classes are applied by the parent
  // (NoteEditor.jsx today; W-D's wiring per PHASE_SPEC.md §3/§5) — this stays
  // the same bare mount div it always was.
  return <div ref={containerRef} />;
});
