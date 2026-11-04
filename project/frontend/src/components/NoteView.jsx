import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import MarkdownEditor from "./MarkdownEditor";
import NoteMargin, { ReviewBar } from "./NoteMargin";
import CommentSheet from "./CommentSheet";
import {
  createSuggestion,
  getSuggestions,
  approveSuggestion,
  unapproveSuggestion,
  rejectSuggestion,
  unrejectSuggestion,
  retractSuggestion,
  unretractSuggestion,
  onProposal,
} from "../services/suggestionsService";
import {
  listComments,
  createComment,
  replyToComment,
  resolveComment,
  unresolveComment,
  deleteComment,
  undeleteComment,
  deleteReply,
  onCommentChange,
} from "../services/commentsService";
import { updateNote } from "../services/notesService";
import { computeHunks } from "../utils/noteDiff";
import { locateAnchor, captureSelectionAnchor } from "../utils/commentAnchor";
import { canWrite as roleCanWrite, canSuggest as roleCanSuggest } from "../utils/roles";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

// 800px is the app's one documented responsive breakpoint (tokens.css) —
// RoadmapTrack.jsx's own literal, reused here for the mobile gold-tap ->
// sheet swap (Phase 55 ruling).
const MOBILE_QUERY = "(max-width: 800px)";
// How much surrounding text to hand captureSelectionAnchor for
// disambiguating which occurrence of a selection landed on — it re-derives
// the FINAL before/after from source text itself, this is only context.
const CAPTURE_CONTEXT = 300;
// WRITER AUTOSAVE (PHASE_SPEC.md §5): debounce after the last doc/title
// change, thread the LAST RESPONSE's __v as ifVersion, never round-trip
// loadNote for it.
const AUTOSAVE_DEBOUNCE_MS = 2000;
// P61 §3.3: cap on each side of the per-note action-undo timeline, both the
// live stacks and what gets persisted below — oldest entries drop first.
const UNDO_STACK_CAP = 50;
function undoStorageKey(noteId) {
  return `p61-undo:${noteId}`;
}
function capped(arr) {
  return arr.length > UNDO_STACK_CAP ? arr.slice(arr.length - UNDO_STACK_CAP) : arr;
}

// Phase 60 (ONE SURFACE — PHASE_SPEC.md §0/§5): the note is always editable,
// live-preview, single CM6 surface for every role — writers autosave,
// suggesters draft-and-Propose, readers get the same editor reconfigured
// read-only (W-A's compartment trick: unfocusable -> fully rendered, no
// raw-source flicker). The old 4-pane ternary (direct-edit pane / suggest-
// edit pane / source-review pane / ReactMarkdown pane), its `editing`/
// `suggestingEdit` state, and the render-view selection/highlight plumbing
// are gone — there is exactly one MarkdownEditor mount per note, and role
// only changes what's WIRED to it (autosave vs draft-stash vs nothing) plus
// which buttons render around it.
//
// AUTOSAVE STATE MACHINE (writer, canWrite): every doc/title change buffers
// into `autosaveRef.current.pending` and (re)arms a 2s debounce timer.
// COMMIT points (editor-surface blur, note-id swap/route-unmount, tab
// hidden, flipping to Suggesting, right before a comment is created) flush
// immediately with `commit: true`; the plain debounce always sends `commit`
// unset. A flush success updates local `note` state via `onNoteSaved`
// (content/title/__v) — NEVER `loadNote` — and only a COMMIT success
// re-fetches comments (to pick up a server-side drift-prune; PHASE_SPEC.md
// §4 prunes only at commit). A 409 pauses autosave for the rest of this
// mount (buffer stays intact, non-blocking notice shown) — resuming needs a
// reload. An empty title mid-edit is skipped silently and retried on the
// next change. Every flush snapshots `autosaveRef.current` (a bundle
// object, REPLACED not mutated on a note switch — isolates an in-flight
// request for the note you just left from ever writing into the note you
// switched to) and is serialized through `flushChainRef` so a blur landing
// while a debounce PATCH is still in flight queues instead of racing it.
const NoteView = forwardRef(function NoteView(
  { note, canWrite, canSuggest, effectiveRole, container, containerName, pendingCount, openCommentCount, onHistory, onChange, onNoteSaved },
  ref
) {
  const { user } = useAuth();
  const toast = useToast();
  const isReader = !canWrite && !canSuggest;

  const [title, setTitle] = useState(note.title);
  const [resetNonce, setResetNonce] = useState(0);
  const editorRef = useRef(null);
  const titleRef = useRef(note.title);
  const contentRef = useRef(note.content);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;
  const canSuggestRef = useRef(canSuggest);
  canSuggestRef.current = canSuggest;

  const [hunkSuggestions, setHunkSuggestions] = useState([]);
  const [hunksLoaded, setHunksLoaded] = useState(false);
  const [cardErrors, setCardErrors] = useState({});
  const [activeSuggestionId, setActiveSuggestionId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  // Which pending-hunk ids MarkdownEditor's mapping field managed to locate
  // against the live doc — pushed via onSuggestionsLocated.
  const [draftLocatedIds, setDraftLocatedIds] = useState(new Set());
  // A failed draft merge has to be said OUTSIDE the card: approving resolves
  // the suggestion, and P52.1 drops resolved cards the moment the refetch
  // lands, so a card-scoped error would unmount before it ever painted.
  const [mergeNotice, setMergeNotice] = useState(null);

  const [comments, setComments] = useState([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [commentErrors, setCommentErrors] = useState({});
  const [composer, setComposer] = useState(null); // { anchor } | null
  const [commentCaptureError, setCommentCaptureError] = useState(null);
  const [sheetThreadId, setSheetThreadId] = useState(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [editorSelection, setEditorSelection] = useState({ from: 0, to: 0, text: "" });

  const [autosavePaused, setAutosavePaused] = useState(false);
  const [autosaveNotice, setAutosaveNotice] = useState(null);

  // UNIFIED UNDO TIMELINE (P61 §3.3): seqRef is the page-shared monotonic
  // counter both sides (MarkdownEditor's text seqs, this component's action
  // entries) pull from via nextSeq, so recency comparison across the two
  // sides is just "bigger seq wins" — reset per note (identity-gate effect
  // below), not per component-mount. actionUndoStack/actionRedoStack hold
  // {seq, kind, id, hunk?} entries for approve/reject/retract/resolve/
  // deleteComment; `tick` forces a re-render after a text-side change (a
  // keystroke never itself re-renders NoteView — content lives in
  // contentRef, not React state) so the Undo/Redo buttons' disabled state,
  // which reads editorRef.current.topText{Undo,Redo}Seq() imperatively,
  // recomputes.
  const seqRef = useRef(0);
  const nextSeq = () => ++seqRef.current;
  const [actionUndoStack, setActionUndoStack] = useState([]);
  const [actionRedoStack, setActionRedoStack] = useState([]);
  const [tick, setTick] = useState(0);
  const bumpTick = () => setTick((t) => t + 1);
  const unifiedUndoRef = useRef(null);
  const unifiedRedoRef = useRef(null);

  const cardNodeRefs = useRef({});
  const commentCardRefs = useRef({});

  const debounceTimerRef = useRef(null);
  // Autosave bookkeeping lives in one BUNDLE OBJECT, replaced (not mutated
  // in place) on every note switch — a flush for the note we just navigated
  // AWAY from can still be in flight (it's how the route-unmount COMMIT
  // point works), and its completion must never write into the NEW note's
  // version/content/pending state. `flush()` snapshots `autosaveRef.current`
  // synchronously at call time; once a switch replaces the ref, that
  // snapshot is an orphaned object whose later mutations (from the still-
  // running request) touch nothing the live render reads.
  const autosaveRef = useRef({
    pending: null, // { title, content } | null — unsent buffer
    requestId: 0,
    savedVersion: note.__v,
    lastSavedContent: note.content,
    lastSavedTitle: note.title,
    uncommitted: false, // saved content the server has not been told to COMMIT yet
    paused: false,
  });
  const flushChainRef = useRef(Promise.resolve(null));
  const prevCanWriteRef = useRef(canWrite);
  const onNoteSavedRef = useRef(onNoteSaved);
  onNoteSavedRef.current = onNoteSaved;

  const loadHunks = () =>
    getSuggestions(container).then((data) =>
      setHunkSuggestions(
        data.filter((s) => s.resourceType === "Note" && s.resource && String(s.resource._id) === String(note._id) && s.payload?.contentHunk)
      )
    );

  const loadComments = () => listComments(note._id).then(setComments).catch(() => {});

  // Identity gate (note switch, not a re-render of the same note): resets
  // every fetched/derived list AND the autosave/draft-stash bookkeeping.
  // `resetNonce` also lands here (Propose forces the same fresh-start —
  // suggestion cards are pending server review, so the draft goes back to
  // the saved note, same as a switch would show).
  useEffect(() => {
    let ignore = false;
    setHunksLoaded(false);
    setActiveSuggestionId(null);
    setCardErrors({});
    setBulkError(null);
    setDraftLocatedIds(new Set());
    setMergeNotice(null);
    setCommentsLoaded(false);
    setActiveCommentId(null);
    setComposer(null);
    setCommentCaptureError(null);
    setCommentErrors({});
    setSheetThreadId(null);
    setEditorSelection({ from: 0, to: 0, text: "" });

    // P61 §3.3 restore: text seqs never persist (CM6 history dies with the
    // editor remount below regardless), so only the action side comes back —
    // oldest-first, same relative order it had before. seqRef seeds ABOVE
    // the highest restored seq so this session's new pushes (text or action)
    // always sort as more recent than anything restored, never colliding
    // with pre-reload numbers that could otherwise be numerically smaller.
    let restoredUndo = [];
    let restoredRedo = [];
    try {
      const raw = sessionStorage.getItem(undoStorageKey(note._id));
      if (raw) {
        const parsed = JSON.parse(raw);
        restoredUndo = Array.isArray(parsed.undo) ? capped(parsed.undo) : [];
        restoredRedo = Array.isArray(parsed.redo) ? capped(parsed.redo) : [];
      }
    } catch {}
    seqRef.current = [...restoredUndo, ...restoredRedo].reduce((m, e) => Math.max(m, e.seq), 0);
    setActionUndoStack(restoredUndo);
    setActionRedoStack(restoredRedo);

    const suggestDraft = !canWriteRef.current ? getDraft(`note-suggest:${note._id}`) : undefined;
    const initTitle = suggestDraft?.title ?? note.title;
    setTitle(initTitle);
    titleRef.current = initTitle;
    contentRef.current = suggestDraft?.content ?? note.content;
    // A fresh bundle OBJECT, not a mutation — see the autosaveRef comment
    // above for why this matters (isolates any still-in-flight flush for
    // the note we're switching away from).
    autosaveRef.current = {
      pending: null,
      requestId: 0,
      savedVersion: note.__v,
      lastSavedContent: note.content,
      lastSavedTitle: note.title,
      uncommitted: false,
      paused: false,
    };
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    setAutosavePaused(false);
    setAutosaveNotice(null);
    prevCanWriteRef.current = canWriteRef.current;

    getSuggestions(container)
      .then((data) => {
        if (ignore) return;
        setHunkSuggestions(
          data.filter((s) => s.resourceType === "Note" && s.resource && String(s.resource._id) === String(note._id) && s.payload?.contentHunk)
        );
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setHunksLoaded(true); });
    listComments(note._id)
      .then((data) => { if (!ignore) setComments(data); })
      .catch(() => {})
      .finally(() => { if (!ignore) setCommentsLoaded(true); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note._id, container.project, container.workspace, resetNonce]);

  // P61 §3.3 persistence: mirrors the action stacks into sessionStorage on
  // every change — per-tab (multi-tab stacks are independently keyed by
  // nothing beyond sessionStorage's own per-tab scope, §3.5). A note switch
  // can fire this once against the NEW note's key still holding the OLD
  // note's (pre-restore) stacks, within the same React commit as the
  // identity-gate effect's own setActionUndoStack/setActionRedoStack calls —
  // harmless: those calls' re-render re-fires this effect immediately after
  // (same synchronous batch, nothing else reads sessionStorage in between)
  // and overwrites it with the restored value.
  useEffect(() => {
    try {
      sessionStorage.setItem(undoStorageKey(note._id), JSON.stringify({ undo: actionUndoStack, redo: actionRedoStack }));
    } catch {}
  }, [note._id, actionUndoStack, actionRedoStack]);

  // A decision taken in the SuggestionsPanel resolves the very hunks this
  // margin is rendering (P52.1) — without this the approved card lingered here
  // with live buttons pointing at an already-applied suggestion. An approval
  // can also prune comments server-side (drift auto-delete), so refetch both.
  useEffect(() => onProposal(() => { loadHunks(); loadComments(); }), [note._id, container.project, container.workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onCommentChange(() => { loadComments(); }), [note._id, container.project, container.workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  // External content/title drift (a suggestion approval, or a history
  // restore — both refetch `note` via the page's own `onChange`/`onRestored`
  // paths) vs. OUR OWN autosave/commit: only the former should re-pull hunks/
  // comments here (a server-side drift-prune or a stale hunk range needs to
  // surface). Guarded by comparing against the content/title WE last saved —
  // an autosave success always sets those refs first, so this effect simply
  // never fires for a self-save (the P60 "no refetch storm" rule) and still
  // catches everything else, same as the pre-P60 effect did.
  const lastNoteRef = useRef({ id: note._id, content: note.content, title: note.title });
  useEffect(() => {
    const prev = lastNoteRef.current;
    lastNoteRef.current = { id: note._id, content: note.content, title: note.title };
    if (prev.id !== note._id) return; // the identity-gate effect's own job
    const contentChanged = prev.content !== note.content;
    const titleChanged = prev.title !== note.title;
    if (!contentChanged && !titleChanged) return;
    const isSelfSave = note.content === autosaveRef.current.lastSavedContent && note.title === autosaveRef.current.lastSavedTitle;
    autosaveRef.current.savedVersion = note.__v; // always resync — an external save bumps __v too
    if (isSelfSave) return;
    if (titleChanged) { setTitle(note.title); titleRef.current = note.title; }
    if (contentChanged) { loadHunks(); loadComments(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note._id, note.content, note.title, note.__v]);

  // Mode flip mid-typing (PHASE_SPEC.md §5): a writer flipping TO Suggesting
  // has their already-typed text committed first (it's theirs, saved) —
  // flipping back keeps whatever's in the buffer and simply resumes
  // autosave, no special-casing needed there.
  useEffect(() => {
    const was = prevCanWriteRef.current;
    prevCanWriteRef.current = canWrite;
    if (was && !canWrite && canSuggest) flush(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite]);

  // A resolved/deleted thread can vanish out from under an open mobile sheet.
  useEffect(() => {
    if (sheetThreadId && !comments.some((c) => c._id === sheetThreadId)) setSheetThreadId(null);
  }, [comments, sheetThreadId]);

  useLayoutEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChangeMq = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChangeMq);
    return () => mq.removeEventListener("change", onChangeMq);
  }, []);

  // COMMIT: tab hidden. Empty deps would freeze `note._id` in doFlush's
  // closure forever (this component never remounts on a note switch — see
  // the identity-gate effect above) — re-subscribing on note._id keeps it
  // current at the (rare) cost of one re-add per switch.
  useEffect(() => {
    function onVisibility() { if (document.hidden) flush(true); }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note._id]);

  // RELOAD GUARD (P61 §3.4): a silent flush on unload — no confirmation
  // dialog, no preventDefault, ever (Samuel: yes to the guard, no to an "are
  // you sure" popup). Both fire on a real close/navigate; pagehide ALSO
  // fires on bfcache eviction, which beforeunload doesn't reliably cover on
  // mobile Safari — belt and suspenders, not a double-send (flush() is a
  // no-op once `state.pending` is already drained).
  useEffect(() => {
    function onUnload() { flush(true, { keepalive: true }); }
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note._id]);

  // COMMIT: note-id swap or true unmount (route away). Fire-and-forget — the
  // request completes in the background regardless of the unmount.
  useEffect(() => {
    return () => { flush(true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note._id]);

  // `state` is the bundle SNAPSHOT `flush()` captured synchronously — never
  // re-reads `autosaveRef.current` (which may have moved on to a different
  // note by the time this resolves). `autosaveRef.current === state` gates
  // every side effect that touches THIS render's live UI (React state,
  // loadComments); mutating `state` itself is always safe even when stale —
  // an orphaned bundle nothing else reads.
  async function doFlush(state, payload, commit, targetNoteId, keepalive) {
    const myId = ++state.requestId;
    try {
      const saved = await updateNote(targetNoteId, { title: payload.title, content: payload.content }, { ifVersion: state.savedVersion, commit, keepalive });
      if (state.requestId !== myId) return null; // superseded by a later flush on this same note
      state.savedVersion = saved.__v;
      state.lastSavedContent = saved.content;
      state.lastSavedTitle = saved.title;
      state.uncommitted = !commit;
      if (autosaveRef.current === state) {
        onNoteSavedRef.current?.(saved, { commit });
        if (commit) await loadComments(); // catch a drift-prune THIS commit may have caused
      }
      return saved;
    } catch (err) {
      if (state.requestId === myId) {
        state.pending = payload; // buffer intact — nothing typed is ever lost
        if (err.status === 409) {
          state.paused = true;
          if (autosaveRef.current === state) {
            setAutosavePaused(true);
            setAutosaveNotice("This note changed somewhere else — reload to sync.");
          }
        }
      }
      return null;
    }
  }

  // Serializes every flush (debounce tick, blur, unmount, mode flip,
  // pre-comment) through one chain so a commit landing mid-debounce-PATCH
  // queues instead of racing it — QuickSwitcher.jsx:105-129's staleness
  // guard (`state.requestId` above) is the second, defense-in-depth net.
  // The payload/bundle/note-id are snapshotted HERE, synchronously, before
  // any async gap — critical when this runs from a note-switch's cleanup
  // (route-unmount COMMIT point), where the identity-gate effect's own
  // (new) setup replaces `autosaveRef.current` with a fresh bundle right
  // after every effect's cleanup has run.
  // `keepalive` (P61 §3.4): the reload-guard's unload-time flush ONLY — lets
  // the PATCH survive past the page unload (browsers otherwise abort an
  // in-flight fetch the instant the document goes away).
  function flush(commit, { keepalive } = {}) {
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    const state = autosaveRef.current;
    if (state.paused) return Promise.resolve(null);
    // A commit point with nothing buffered still has to REACH the server when
    // the last write was a plain autosave: commit:true is what runs the
    // drift-prune (§4), so re-sending the already-saved content is the only
    // way an edit that orphaned a comment mid-typing ever gets pruned. The
    // flag clears on the first such commit, so repeated blurs don't re-PATCH.
    const payload =
      state.pending ||
      (commit && state.uncommitted ? { title: state.lastSavedTitle, content: state.lastSavedContent } : null);
    if (!payload || !payload.title.trim()) return Promise.resolve(null); // nothing buffered, or empty title mid-edit
    state.pending = null;
    const targetNoteId = note._id;
    const next = flushChainRef.current.then(
      () => doFlush(state, payload, commit, targetNoteId, keepalive),
      () => doFlush(state, payload, commit, targetNoteId, keepalive)
    );
    flushChainRef.current = next;
    return next;
  }

  function scheduleAutosave() {
    if (autosaveRef.current.paused) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { debounceTimerRef.current = null; flush(false); }, AUTOSAVE_DEBOUNCE_MS);
  }

  function handleEditorDocChange(newContent) {
    contentRef.current = newContent;
    if (canWriteRef.current) {
      autosaveRef.current.pending = { title: titleRef.current, content: newContent };
      scheduleAutosave();
    } else if (canSuggestRef.current) {
      // SUGGESTER / writer-in-Suggesting: never autosaved — draft stash only
      // (same-session nav-away-and-back survives; a reload does not).
      setDraft(`note-suggest:${note._id}`, { title: titleRef.current, content: newContent });
    }
    // P61 §3.3: a keystroke (or a text undo/redo) never itself re-renders
    // NoteView — force one so the Undo/Redo buttons' disabled state, which
    // reads editorRef.current.topText{Undo,Redo}Seq() imperatively, recomputes.
    bumpTick();
  }

  function handleTitleChange(e) {
    const value = e.target.value;
    setTitle(value);
    titleRef.current = value;
    if (canWriteRef.current) {
      autosaveRef.current.pending = { title: value, content: contentRef.current };
      scheduleAutosave();
    } else if (canSuggestRef.current) {
      setDraft(`note-suggest:${note._id}`, { title: value, content: contentRef.current });
    }
  }

  // COMMIT: editor-surface blur (title input or the CM6 shell) — but only
  // when focus actually LEAVES the surface (moving from title -> content
  // inside it is not a blur worth flushing over).
  function handleSurfaceBlur(e) {
    if (!canWriteRef.current) return;
    if (e.currentTarget.contains(e.relatedTarget)) return;
    flush(true);
  }

  async function propose() {
    const doc = editorRef.current?.getDoc() ?? "";
    const currentTitle = titleRef.current.trim();
    const hunks = computeHunks(note.content, doc);
    const titleChanged = currentTitle !== note.title;
    if (hunks.length === 0 && !titleChanged) {
      toast.info("No changes to suggest");
      return;
    }
    const failures = [];
    for (let i = 0; i < hunks.length; i++) {
      try {
        await createSuggestion({ resourceType: "Note", op: "update", resource: note._id, payload: { contentHunk: hunks[i] } });
      } catch (err) {
        failures.push(`edit ${i + 1}: ${err.message}`);
      }
    }
    if (titleChanged) {
      try {
        await createSuggestion({ resourceType: "Note", op: "update", resource: note._id, payload: { title: currentTitle } });
      } catch (err) {
        failures.push(`title: ${err.message}`);
      }
    }
    if (failures.length === 0) {
      toast.success("Suggested — awaiting a writer's approval");
    } else {
      toast.error(`Some suggestions failed to send: ${failures.join("; ")}`);
    }
    clearDraft(`note-suggest:${note._id}`);
    // Bumps the identity-gate effect's own dep array — remounts the editor
    // fresh from the saved note AND refetches hunks (picks up the cards
    // just created), so no separate loadHunks() call is needed here.
    setResetNonce((n) => n + 1);
  }

  useImperativeHandle(ref, () => ({ propose }));

  function focusSuggestion(id, scrollTo) {
    setActiveSuggestionId(id);
    if (scrollTo === "hunk") { editorRef.current?.revealRange(id); return; }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target = scrollTo === "card" ? cardNodeRefs.current[id] : null;
    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }

  // "gold" re-locates the anchor against the LIVE editor doc (re-locate
  // ruling) and moves the caret there; a vanished (unlocatable) highlight is
  // simply a no-op, same as its gold not being visible in the first place.
  function focusComment(id, scrollTo) {
    setActiveCommentId(id);
    if (scrollTo === "gold") {
      const thread = comments.find((c) => c._id === id);
      const doc = editorRef.current?.getDoc() ?? "";
      const located = thread?.anchor ? locateAnchor(doc, thread.anchor) : null;
      if (located) editorRef.current?.setSelection(located.start);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target = scrollTo === "card" ? commentCardRefs.current[id] : null;
    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }

  // Gold-span tap: desktop focuses+scrolls the margin card, mobile opens the
  // bottom sheet instead (Phase 55 ruling).
  function handleGoldTap(id) {
    if (isMobile) { setSheetThreadId(id); return; }
    focusComment(id, "card");
  }

  // P61 §3.3: push a new action-timeline entry on a forward action's
  // success and clear the redo branch (a new action, like a new text edit,
  // kills redo). Capped/persisted the same way for undo and redo pushes.
  function pushUndoEntry(entry) {
    setActionUndoStack((s) => capped([...s, entry]));
    setActionRedoStack([]);
  }

  function pushRedoEntry(entry) {
    setActionRedoStack((s) => capped([...s, entry]));
  }

  // Standard redo rule (Samuel's post-P61 ruling): new typing discards the
  // action redo branch too, not just CM6's own — otherwise Redo could reach
  // past fresh edits and replay an old review action. Identity short-circuit
  // because this fires on every user keystroke.
  function handleNewTextEdit() {
    setActionRedoStack((s) => (s.length ? [] : s));
  }

  // Approve, server-side then client-merge (spec §3): the server-apply is the
  // unchanged endpoint/checks; the merge step replaces the suggestion's
  // CURRENT MAPPED RANGE in the live doc with the hunk's replacement text —
  // dispatched SYNCHRONOUSLY right after the await (the mapping field only
  // tracks the id until the refetch below pushes a new suggestion list
  // without it). A merge failure (stale/unlocatable range) doesn't undo the
  // server-side approve — it just surfaces on the card. Shared by the single
  // Approve button (handleApprove) and the bulk "Approve remaining" loop —
  // `recordUndo` is false for the bulk loop (P61 §3.3: bulk approve is out
  // of scope for undo this phase, only the single-card/button path is).
  // `refresh` is likewise false for the bulk loop (P62 §7: N calls each
  // doing onChange+loadHunks was a ~2N+2 refetch storm) — the loop does ONE
  // refresh itself after every item has landed, not per item.
  async function approveOne(id, { recordUndo = true, refresh = true } = {}) {
    setCardErrors((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    setMergeNotice(null);
    try {
      await approveSuggestion(id);
      const s = displayed.find((x) => x._id === id);
      const ok = s ? editorRef.current?.applySuggestion(id, s.payload.contentHunk) : false;
      if (!ok) {
        setMergeNotice("Applied to the saved note, but couldn't be placed in your draft — review before saving.");
      }
      if (recordUndo) pushUndoEntry({ seq: nextSeq(), kind: "approve", id, hunk: s?.payload.contentHunk });
      if (refresh) { await onChange?.(); await loadHunks(); }
    } catch (err) {
      setCardErrors((m) => ({ ...m, [id]: err.message }));
      return err.message;
    }
  }

  async function handleApprove(id) {
    await approveOne(id);
  }

  // No merge step — rejecting never touches the draft. Same shared-by-bulk
  // shape as approveOne for the "Reject remaining" loop; same recordUndo/
  // refresh opt-outs for the same reasons (bulk reject is not undoable this
  // phase, and the loop does its own single refresh at the end).
  async function rejectOne(id, { recordUndo = true, refresh = true } = {}) {
    setCardErrors((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await rejectSuggestion(id);
      if (recordUndo) pushUndoEntry({ seq: nextSeq(), kind: "reject", id });
      if (refresh) { await onChange?.(); await loadHunks(); }
    } catch (err) {
      setCardErrors((m) => ({ ...m, [id]: err.message }));
      return err.message;
    }
  }

  async function handleReject(id) {
    await rejectOne(id);
  }

  async function handleRetract(id) {
    try {
      await retractSuggestion(id);
      pushUndoEntry({ seq: nextSeq(), kind: "retract", id });
      await onChange?.();
      await loadHunks();
    } catch (err) {
      setCardErrors((m) => ({ ...m, [id]: err.message }));
    }
  }

  async function handleApproveRemaining() {
    setBulkBusy(true);
    setBulkError(null);
    let approvedAny = false;
    for (const s of hunkSuggestions) {
      // Bulk actions are not undoable this phase (P61 §3.3 non-goal) — each
      // approveOne call here records nothing onto the timeline. refresh:false
      // (P62 §7) — one refresh below covers the whole batch instead of one
      // per item, on both the completed-run and early-break paths.
      const err = await approveOne(s._id, { recordUndo: false, refresh: false });
      if (err) { setBulkError(err); break; }
      approvedAny = true;
    }
    await onChange?.();
    await loadHunks();
    if (approvedAny) await loadComments(); // approving a hunk can drift-prune a comment server-side
    setBulkBusy(false);
  }

  async function handleRejectRemaining() {
    setBulkBusy(true);
    setBulkError(null);
    for (const s of hunkSuggestions) {
      // Bulk actions are not undoable this phase (P61 §3.3 non-goal).
      // refresh:false (P62 §7) — one refresh below for the whole batch.
      const err = await rejectOne(s._id, { recordUndo: false, refresh: false });
      if (err) { setBulkError(err); break; }
    }
    await onChange?.();
    await loadHunks();
    setBulkBusy(false);
  }

  // DESTROY GESTURE (PHASE_SPEC.md §5): own suggestion -> retract, someone
  // else's -> reject (mirrors the card's own button logic). A 409 means the
  // suggestion was already acted on elsewhere (e.g. mid-apply) — surface via
  // the existing mergeNotice, then refetch via the existing notifiers either
  // way. Fired once per id by MarkdownEditor (approving a pure-delete hunk's
  // own collapse is annotated and skipped there, never reaches here).
  // Destroy-gestures are not undoable this phase (P61 §3.3 non-goal) — pushes
  // nothing onto the timeline.
  async function handleSuggestionDestroyed(id) {
    const s = displayed.find((x) => x._id === id);
    const own = !!s && String(s.proposedBy?._id) === String(user?.id);
    try {
      if (own) await retractSuggestion(id); else await rejectSuggestion(id);
    } catch (err) {
      if (err.status === 409) {
        setMergeNotice("That suggestion was already resolved elsewhere — refreshing.");
      }
    }
    await onChange?.();
    await loadHunks();
  }

  function handleCommentClick() {
    const { from, to, text } = editorSelection;
    if (!text) return;
    const doc = editorRef.current?.getDoc() ?? "";
    const before = doc.slice(Math.max(0, from - CAPTURE_CONTEXT), from);
    const after = doc.slice(to, to + CAPTURE_CONTEXT);
    const anchor = captureSelectionAnchor({ selectionString: text, before, after });
    if (!anchor) { setCommentCaptureError("Couldn't attach a comment to that selection."); return; }
    setCommentCaptureError(null);
    setComposer({ anchor });
    editorRef.current?.setSelection(to);
  }

  // Replaces the old "Save your changes first" pre-check: flush+commit (a
  // writer only — a suggester's draft never lands server-side at all) THEN
  // create the comment against the fresh content. The anchor was captured
  // from the LIVE doc at selection time; it has to locate against whatever
  // note.content is by the time the comment actually posts.
  async function handleCreateComment(body) {
    if (!composer) return;
    setCommentErrors((m) => { const { composer: _drop, ...rest } = m; return rest; });
    if (canWrite && autosavePaused) {
      setCommentErrors((m) => ({ ...m, composer: "Your last edit didn't save — reload to sync before commenting." }));
      return;
    }
    try {
      let freshContent = note.content;
      if (canWrite) {
        const saved = await flush(true);
        if (saved) freshContent = saved.content;
      }
      if (!locateAnchor(freshContent, composer.anchor)) {
        setCommentErrors((m) => ({ ...m, composer: "Couldn't attach a comment there — that text isn't saved yet." }));
        return;
      }
      await createComment({ note: note._id, body, anchor: composer.anchor });
      setComposer(null);
      await loadComments();
    } catch (err) {
      setCommentErrors((m) => ({ ...m, composer: err.message }));
    }
  }

  function handleCancelComposer() {
    setComposer(null);
    setCommentErrors((m) => { const { composer: _drop, ...rest } = m; return rest; });
  }

  async function handleReply(id, body) {
    setCommentErrors((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await replyToComment(id, body);
      await loadComments();
    } catch (err) {
      setCommentErrors((m) => ({ ...m, [id]: err.message }));
    }
  }

  async function handleResolveComment(id) {
    setCommentErrors((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await resolveComment(id);
      pushUndoEntry({ seq: nextSeq(), kind: "resolve", id });
      await loadComments();
    } catch (err) {
      setCommentErrors((m) => ({ ...m, [id]: err.message }));
    }
  }

  async function handleDeleteComment(id) {
    setCommentErrors((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await deleteComment(id); // 204-style response, mirrors DELETE /notes/:id — nothing to unwrap
      pushUndoEntry({ seq: nextSeq(), kind: "deleteComment", id });
      await loadComments();
    } catch (err) {
      setCommentErrors((m) => ({ ...m, [id]: err.message }));
    }
  }

  // Reply deletion is not undoable this phase (P61 §3.3 non-goal) — pushes
  // nothing onto the timeline.
  async function handleDeleteReply(id, replyId) {
    setCommentErrors((m) => { const { [id]: _drop, ...rest } = m; return rest; });
    try {
      await deleteReply(id, replyId);
      await loadComments();
    } catch (err) {
      setCommentErrors((m) => ({ ...m, [id]: err.message }));
    }
  }

  // UNIFIED UNDO ARBITER (P61 §0.1/§3.3): "bigger seq wins" — whichever side
  // (live CM6 text history, or the action timeline) holds the more RECENT
  // entry runs first, so a text edit and a review action interleave by
  // recency regardless of where focus is. Reads actionUndoStack/
  // actionRedoStack directly off this render's closure (not a stale one —
  // unifiedUndoRef/unifiedRedoRef below are reassigned every render).
  function unifiedUndo() {
    const textTop = editorRef.current?.topTextUndoSeq() ?? -1;
    const actionTop = actionUndoStack.length ? actionUndoStack[actionUndoStack.length - 1].seq : -1;
    if (textTop === -1 && actionTop === -1) return;
    if (textTop > actionTop) {
      editorRef.current.runTextUndo();
      bumpTick();
    } else {
      const entry = actionUndoStack[actionUndoStack.length - 1];
      setActionUndoStack((s) => s.slice(0, -1));
      undoAction(entry);
    }
  }

  // NOTE (flagged for the integrator, see final report): opposite polarity
  // from unifiedUndo on purpose, NOT a literal ">" mirror. Both sides push
  // their ORIGINAL creation seq onto the redo stack when undone (unchanged
  // value — see MarkdownEditor's reconcileTextHistory "undo" branch and
  // undoAction's pushRedoEntry here), so undo always pops in DECREASING seq
  // order — meaning by the time several things are undone, the one undone
  // MOST RECENTLY is the one with the SMALLEST remaining seq. Redo has to
  // walk forward through exactly that same order in reverse: smallest
  // preserved seq goes first. Verified against §0.1's own worked example
  // (word seq1/comment seq2/letter seq3, undone letter->comment->word):
  // redoing "bigger wins" would redo comment before word on the very first
  // redo click, even though word was undone more recently — smaller-wins
  // redoes word first, correctly mirroring the undo order in reverse.
  function unifiedRedo() {
    const textTop = editorRef.current?.topTextRedoSeq() ?? -1;
    const actionTop = actionRedoStack.length ? actionRedoStack[actionRedoStack.length - 1].seq : -1;
    if (textTop === -1 && actionTop === -1) return;
    const useText = textTop !== -1 && (actionTop === -1 || textTop < actionTop);
    if (useText) {
      editorRef.current.runTextRedo();
      bumpTick();
    } else {
      const entry = actionRedoStack[actionRedoStack.length - 1];
      setActionRedoStack((s) => s.slice(0, -1));
      redoAction(entry);
    }
  }
  unifiedUndoRef.current = unifiedUndo;
  unifiedRedoRef.current = unifiedRedo;

  // A failed undo/redo names a resource whose card is, by construction, NOT
  // on screen: every forward action removes its own card (an approved or
  // rejected suggestion leaves `hunkSuggestions`, a resolved or deleted
  // comment leaves the open-comment list), so cardErrors/commentErrors —
  // keyed by that id — have no host to render into and the message is
  // invisible. Measured: an unapprove over an edited hunk returned 409 with
  // nothing at all on screen. So the map write stays (it does show for the
  // rare still-carded id) and the message ALSO goes to the page-level
  // .approve-error band under the note head, the existing home of exactly
  // this "the action didn't fully land" class of notice. Still no toast,
  // still no new UI surface.
  function surfaceActionError(entry, message) {
    if (entry.kind === "resolve" || entry.kind === "deleteComment") {
      setCommentErrors((m) => ({ ...m, [entry.id]: message }));
    } else {
      setCardErrors((m) => ({ ...m, [entry.id]: message }));
    }
    setMergeNotice(message);
  }

  // Dispatches the INVERSE of `entry.kind` — the caller has already popped
  // `entry` off actionUndoStack. On success, pushes it onto actionRedoStack
  // (a redo re-performs the forward action, see redoAction below); on 409/
  // 404 the error surfaces through the EXISTING cardErrors/commentErrors maps
  // and the entry is simply dropped — never requeued into either stack.
  async function undoAction(entry) {
    try {
      switch (entry.kind) {
        case "approve": {
          // Threads autosave state exactly like approveOne's own post-approve
          // path relies on (the external-content-drift effect resyncing
          // savedVersion off note.__v) — done explicitly here, before the
          // splice's own onDocChange can buffer a pending autosave, so that
          // eventual debounce PATCHes the CORRECT ifVersion instead of the
          // stale pre-unapprove one (which would 409-pause autosave over
          // content that already matches the server).
          const bundle = autosaveRef.current;
          const { resource } = await unapproveSuggestion(entry.id);
          if (autosaveRef.current === bundle) {
            bundle.savedVersion = resource.__v;
            bundle.lastSavedContent = resource.content;
            bundle.lastSavedTitle = resource.title;
          }
          const ok = editorRef.current?.spliceMirrorHunk(entry.hunk);
          if (!ok) {
            setMergeNotice("Applied to the saved note, but couldn't be placed in your draft — review before saving.");
          }
          await onChange?.();
          await loadHunks();
          await loadComments(); // pruned-comment restores must render
          break;
        }
        case "reject":
          await unrejectSuggestion(entry.id);
          await onChange?.();
          await loadHunks();
          break;
        case "retract":
          await unretractSuggestion(entry.id);
          await onChange?.();
          await loadHunks();
          break;
        case "resolve":
          await unresolveComment(entry.id);
          await loadComments();
          break;
        case "deleteComment":
          await undeleteComment(entry.id);
          await loadComments();
          break;
        default:
          return;
      }
      pushRedoEntry(entry);
    } catch (err) {
      surfaceActionError(entry, err.message);
    }
  }

  // Re-performs `entry.kind`'s FORWARD action via the existing forward
  // service call. Unlike a genuine new action, a redo does NOT clear the
  // (unrelated) redo stack it just popped from — it re-issues its OWN seq
  // via nextSeq() when it lands back on the undo side (mirrors the text-side
  // rule in MarkdownEditor's reconcileTextHistory — a redo is a new "just
  // happened" event, chronologically after everything else).
  async function redoAction(entry) {
    try {
      switch (entry.kind) {
        case "approve": {
          await approveSuggestion(entry.id);
          const ok = editorRef.current?.applySuggestion(entry.id, entry.hunk);
          if (!ok) {
            setMergeNotice("Applied to the saved note, but couldn't be placed in your draft — review before saving.");
          }
          await onChange?.();
          await loadHunks();
          break;
        }
        case "reject":
          await rejectSuggestion(entry.id);
          await onChange?.();
          await loadHunks();
          break;
        case "retract":
          await retractSuggestion(entry.id);
          await onChange?.();
          await loadHunks();
          break;
        case "resolve":
          await resolveComment(entry.id);
          await loadComments();
          break;
        case "deleteComment":
          await deleteComment(entry.id);
          await loadComments();
          break;
        default:
          return;
      }
      setActionUndoStack((s) => capped([...s, { seq: nextSeq(), kind: entry.kind, id: entry.id, hunk: entry.hunk }]));
    } catch (err) {
      surfaceActionError(entry, err.message);
    }
  }

  // GLOBAL KEYS (P61 §3.3): the CM6 keymap already handles Cmd/Ctrl-Z while
  // focus is INSIDE the editor (it calls onUnifiedUndo/onUnifiedRedo props
  // and returns true, which CM6 preventDefaults for) — this listener covers
  // every OTHER focus position (a margin card, a button, nothing focused at
  // all) EXCEPT a genuinely separate input/textarea/contenteditable (the
  // title field, a comment composer), which keeps its own native undo.
  useEffect(() => {
    function onKeyDown(e) {
      const key = e.key.toLowerCase();
      if (!(e.metaKey || e.ctrlKey) || (key !== "z" && key !== "y")) return;
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      const target = e.target;
      const inOurEditor = !!(target.closest && target.closest(".note-content-cm"));
      const inOtherField = !inOurEditor && target.matches && target.matches('input, textarea, [contenteditable="true"]');
      if (inOtherField) return; // native undo for the title input / comment composer, untouched
      if (inOurEditor && e.defaultPrevented) return; // CM6's own keymap already ran this
      e.preventDefault();
      if (isRedo) unifiedRedoRef.current?.(); else unifiedUndoRef.current?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // P61 §3.3: editorRef.current is read imperatively (not through props/
  // state), so `tick` (bumped on every doc change, state above) exists
  // purely to force this component to re-render on a keystroke — once it
  // does, this recomputes for free every render, `tick`'s own value unused.
  const undoDisabled = (editorRef.current?.topTextUndoSeq() ?? -1) === -1 && actionUndoStack.length === 0;
  const redoDisabled = (editorRef.current?.topTextRedoSeq() ?? -1) === -1 && actionRedoStack.length === 0;

  const approver = roleCanWrite(effectiveRole);
  // P52.1: no resolved-in-session persistence — an approve/reject success
  // refetches, and a resolved suggestion simply isn't in `hunkSuggestions`
  // anymore, so it (and its highlight) drops out on the very next render.
  const displayed = hunkSuggestions;
  const hasPendingHunks = hunksLoaded && displayed.length > 0;
  const openComments = commentsLoaded ? comments.filter((c) => c.status === "open") : [];
  // Margin visibility (PHASE_SPEC.md §5): "shows when it has cards/
  // composer, else full width" — the P56/P57 "always show for an editor
  // pane" special case is gone now that there's only ever one pane.
  const showMargin = hasPendingHunks || openComments.length > 0 || !!composer;

  const suggestionIdsKey = displayed.map((s) => s._id).join(",");
  const suggestionItems = useMemo(
    () => displayed.map((s) => ({ id: s._id, hunk: s.payload.contentHunk })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestionIdsKey]
  );

  // MARGIN ORDERING (PHASE_SPEC.md §5): live positions, not the saved note —
  // suggestions via MarkdownEditor's own positional-mapping field
  // (getRangesSnapshot), comments via locateAnchor against the CURRENT
  // editor doc. Recomputed on card-set changes and on draftLocatedIds
  // pushes (onSuggestionsLocated's cadence) — deliberately NOT keyed on
  // `editorSelection`, which changes on every keystroke/caret move and would
  // otherwise turn this into a per-keystroke recompute.
  const marginItems = useMemo(() => {
    const currentDoc = editorRef.current?.getDoc() ?? note.content;
    const suggestionRanges = editorRef.current?.getRangesSnapshot() ?? [];
    const commentLocations = openComments.map((c) => ({ comment: c, located: c.anchor ? locateAnchor(currentDoc, c.anchor) : null }));
    return buildMarginItems(displayed, suggestionRanges, commentLocations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, openComments, draftLocatedIds]);

  const proposerIds = new Set(displayed.map((s) => s.proposedBy?._id));
  const singleProposerName = proposerIds.size === 1 ? displayed[0]?.proposedBy?.username : null;

  const sheetThread = sheetThreadId ? comments.find((c) => c._id === sheetThreadId) : null;

  // Comment creation itself isn't gated by canWrite/canSuggest's mode-gating
  // (a writer stays able to comment while directly editing) — the RAW role
  // check, same as approver above.
  const commentsEnabled = roleCanSuggest(effectiveRole);

  const commentHighlightItems = openComments.filter((c) => c.anchor).map((c) => ({ id: c._id, anchor: c.anchor }));

  const suggestDraft = !canWrite && canSuggest ? getDraft(`note-suggest:${note._id}`) : undefined;
  const mountKey = `${note._id}:${resetNonce}`;
  const initialDoc = suggestDraft?.content ?? note.content;

  const marginEl = (
    <NoteMargin
      marginItems={marginItems}
      locatedIds={draftLocatedIds}
      activeId={activeSuggestionId}
      cardErrors={cardErrors}
      approver={approver}
      userId={user?.id}
      effectiveRole={effectiveRole}
      onFocus={(id) => focusSuggestion(id, "hunk")}
      onApprove={handleApprove}
      onReject={handleReject}
      onRetract={handleRetract}
      registerCardRef={(id, el) => { cardNodeRefs.current[id] = el; }}
      activeCommentId={activeCommentId}
      commentErrors={commentErrors}
      composer={composer}
      noteTitle={note.title}
      onCommentFocus={(id) => focusComment(id, "gold")}
      onCreateComment={handleCreateComment}
      onCancelComposer={handleCancelComposer}
      onReply={handleReply}
      onResolve={handleResolveComment}
      onDeleteComment={handleDeleteComment}
      onDeleteReply={handleDeleteReply}
      registerCommentCardRef={(id, el) => { commentCardRefs.current[id] = el; }}
    />
  );

  return (
    <article className="note-view">
      <div className="review-layout">
        {/* P63 (PHASE_SPEC.md §1): everything that used to sit directly under
            .note-view — head, meta, notice bands, ReviewBar — now nests
            inside .note-page-surface, the whole-note "page" panel. Only
            .review-margin stays a sibling of it (cards live beside the page,
            in .review-layout's own leftover flex space, unchanged from P52). */}
        <div className="note-page-surface">
          <div className="note-view-head">
            {isReader ? (
              <h2>{note.title}</h2>
            ) : (
              <input
                className="note-title-input"
                value={title}
                onChange={handleTitleChange}
                onBlur={handleSurfaceBlur}
                placeholder="Note title"
                aria-label="Note title"
              />
            )}
            <span>
              {commentsEnabled && (
                <button className="btn btn-ghost" disabled={!editorSelection.text} onClick={handleCommentClick}>
                  Comment
                </button>
              )}
              {/* onMouseDown preventDefault (P61 §3.3): a click here must not
                  blur the editor first — a blur is a COMMIT point (handleSurfaceBlur)
                  that flushes autosave, and firing it ahead of the undo itself
                  would race the very state this button is about to change. */}
              <button
                className="btn btn-ghost"
                disabled={undoDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={unifiedUndo}
              >
                Undo
              </button>
              <button
                className="btn btn-ghost"
                disabled={redoDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={unifiedRedo}
              >
                Redo
              </button>
              <button className="btn btn-ghost" onClick={onHistory}>History</button>
            </span>
          </div>
          <p className="note-meta">
            {containerName && <>in {containerName} · </>}
            updated {new Date(note.updatedAt).toLocaleDateString()}
            {note.updatedBy?.username && <> by {note.updatedBy.username}</>}
            {pendingCount > 0 && <> · {pendingCount} pending suggestion{pendingCount === 1 ? "" : "s"}</>}
            {openCommentCount > 0 && <> · {openCommentCount} open comment{openCommentCount === 1 ? "" : "s"}</>}
          </p>
          {commentCaptureError && <p className="approve-error">⚠ {commentCaptureError}</p>}
          {mergeNotice && <p className="approve-error">⚠ {mergeNotice}</p>}
          {autosaveNotice && <p className="approve-error">⚠ {autosaveNotice}</p>}

          {hasPendingHunks && (
            <ReviewBar
              proposerName={singleProposerName}
              pendingCount={displayed.length}
              busy={bulkBusy}
              error={bulkError}
              canAct={approver}
              onApproveRemaining={handleApproveRemaining}
              onRejectRemaining={handleRejectRemaining}
            />
          )}

          <div className="review-text" onBlur={handleSurfaceBlur}>
            <div className={"note-content-cm" + (isReader ? " readonly" : "")}>
              <MarkdownEditor
                key={mountKey}
                ref={editorRef}
                initialDoc={initialDoc}
                onDocChange={handleEditorDocChange}
                onSelectionChange={setEditorSelection}
                readOnly={isReader}
                highlights={commentHighlightItems}
                activeHighlightId={activeCommentId}
                onHighlightTap={handleGoldTap}
                suggestions={suggestionItems}
                activeSuggestionId={activeSuggestionId}
                onSuggestionTap={(id) => focusSuggestion(id, "card")}
                onSuggestionsLocated={setDraftLocatedIds}
                onSuggestionDestroyed={handleSuggestionDestroyed}
                nextSeq={nextSeq}
                onUnifiedUndo={unifiedUndo}
                onUnifiedRedo={unifiedRedo}
                onNewTextEdit={handleNewTextEdit}
                ariaLabel="Note content"
              />
            </div>
          </div>
        </div>
        {showMargin && marginEl}
      </div>

      {/* The thread lookup is the render guard, not just a prop: deleting the
          open thread from inside the sheet refetches first and only clears
          sheetThreadId in a follow-up effect, so for one render there is no
          thread to show. */}
      {isMobile && sheetThread && (
        <CommentSheet
          thread={sheetThread}
          error={commentErrors[sheetThread._id]}
          userId={user?.id}
          effectiveRole={effectiveRole}
          noteTitle={note.title}
          onReply={handleReply}
          onResolve={handleResolveComment}
          onDeleteComment={handleDeleteComment}
          onDeleteReply={handleDeleteReply}
          onClose={() => setSheetThreadId(null)}
        />
      )}
    </article>
  );
});

export default NoteView;

// Single merged margin list (Phase 55 §3, live-position Phase 60): suggestion
// cards ordered by their MAPPED range in the live editor doc
// (getRangesSnapshot), open comments by locateAnchor against that same live
// doc; anything neither side could locate keeps falling back to original
// order, appended after everything that DID locate.
function buildMarginItems(displayedSuggestions, suggestionRanges, commentLocations) {
  const rangeById = new Map(suggestionRanges.map((r) => [r.id, r]));
  const located = [];
  const unlocated = [];
  displayedSuggestions.forEach((s) => {
    const r = rangeById.get(s._id);
    const item = { kind: "suggestion", ...s };
    if (!r || r.from == null) unlocated.push(item); else located.push({ start: r.from, item });
  });
  commentLocations.forEach(({ comment, located: loc }) => {
    const item = { kind: "comment", thread: comment };
    if (!loc) unlocated.push(item); else located.push({ start: loc.start, item });
  });
  located.sort((a, b) => a.start - b.start);
  return [...located.map((x) => x.item), ...unlocated];
}
