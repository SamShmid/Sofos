import { useState, useRef, useEffect } from "react";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";
import MarkdownEditor from "./MarkdownEditor";

// Used for both "new note" and editing. Content stays raw markdown (not trimmed).
// draftKey (P51 pattern, P54 adoption): optional — when absent this behaves
// exactly as before (NoteView's own inline suggest-edit instance never gets
// one). NotePage's two instances (note-edit:<id>, note-new:<containerId>) do.
// Semantics extend the P51 ruling-10 contract for a route instead of a modal:
// navigating away leaves the draft in the Map untouched (there's no backdrop/
// Escape to hang a "deliberate close" off — an unmount alone never clears it),
// Cancel discards it, a successful save discards it, and a reload clears the
// whole in-memory Map regardless.
// Phase 56: content editing moved from a plain textarea to CodeMirror 6
// (MarkdownEditor, the W-A seam component). `editorExtras` is the optional
// editing-with-comments pass-through NoteView drives (gold highlights,
// selection capture, the imperative ref) — absent for /notes/new (no note
// yet, nothing to highlight), which just renders a plain editor.
export default function NoteEditor({ initial = {}, onSave, onCancel, draftKey = null, editorExtras = null }) {
  const draft = draftKey ? getDraft(draftKey) : undefined;
  const [title, setTitle] = useState(draft?.title ?? initial.title ?? "");
  const [content, setContent] = useState(draft?.content ?? initial.content ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-submit guard (a same-tick double click slips past
  // `disabled={submitting}`, which only applies after React re-renders).
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!draftKey) return;
    setDraft(draftKey, { title, content });
  }, [draftKey, title, content]);

  function handleCancel() {
    if (draftKey) clearDraft(draftKey);
    onCancel();
  }

  async function handleSave() {
    if (submittingRef.current) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSave({ title: title.trim(), content });
      if (draftKey) clearDraft(draftKey);
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // `ref` isn't a regular prop — React special-cases it in createElement, so
  // it has to land as a literal JSX attribute rather than ride along inside
  // the `{...extras}` spread (a plain `editorRef` key in the spread object
  // would just become an inert prop named "editorRef" on MarkdownEditor).
  const { editorRef, ...extras } = editorExtras || {};

  return (
    <div className="note-editor">
      {error && <p role="alert">{error}</p>}
      <input
        className="note-title-input"
        placeholder="Note title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="note-content-cm">
        <MarkdownEditor
          ref={editorRef}
          initialDoc={content}
          onDocChange={setContent}
          ariaLabel="Note content"
          {...extras}
        />
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={submitting}>Save</button>
        <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
      </div>
    </div>
  );
}
