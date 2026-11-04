import { useState, useRef, useEffect } from "react";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";

// Shared create/edit form for links. `url` is type="text", not type="url" —
// the backend normalizes protocol-less input, so the browser must not block it.
// draftKey (ruling 10): optional — when absent this form behaves exactly as
// before. The inline create instance (LinksSection's own "+ Link" row) never
// gets one — it's not modal-hosted.
export default function LinkForm({ initial, onSubmit, onCancel, draftKey = null }) {
  const draft = draftKey ? getDraft(draftKey) : undefined;
  const [title, setTitle] = useState(draft?.title ?? initial?.title ?? "");
  const [url, setUrl] = useState(draft?.url ?? initial?.url ?? "");
  const [description, setDescription] = useState(draft?.description ?? initial?.description ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-submit guard (beats a same-tick double click that
  // `disabled={submitting}` misses because disable applies only after re-render).
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!draftKey) return;
    setDraft(draftKey, { title, url, description });
  }, [draftKey, title, url, description]);

  function handleCancel() {
    if (draftKey) clearDraft(draftKey);
    onCancel();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), url: url.trim(), description: description.trim() });
      if (draftKey) clearDraft(draftKey);
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <input placeholder="Link title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="text" placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
      <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>{initial ? "Save" : "Add"}</button>
        <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
      </div>
    </form>
  );
}
