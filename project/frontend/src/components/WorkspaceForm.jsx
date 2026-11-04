import { useState, useRef, useEffect } from "react";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";

// Shared by "new workspace" (and later editing). Name required, description optional.
// suggestMode (P33) overrides submitLabel with its suggest-mode counterpart —
// mirrors ProjectForm's own initial._id edit/create signal.
// draftKey (ruling 10): optional — when absent this form behaves exactly as
// before. When present, a backdrop/Escape close (which unmounts this form
// without clearing the stash) leaves the typed values behind for the next
// mount of the SAME key to pick back up.
export default function WorkspaceForm({ initial = {}, submitLabel = "Create", suggestMode = false, draftKey = null, onSubmit, onCancel }) {
  const draft = draftKey ? getDraft(draftKey) : undefined;
  const [name, setName] = useState(draft?.name ?? initial.name ?? "");
  const [description, setDescription] = useState(draft?.description ?? initial.description ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-submit guard (a ref beats a same-tick double click that
  // `disabled={submitting}` can't, since disable only applies after re-render).
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!draftKey) return;
    setDraft(draftKey, { name, description });
  }, [draftKey, name, description]);

  function handleCancel() {
    if (draftKey) clearDraft(draftKey);
    onCancel();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
      if (draftKey) clearDraft(draftKey);
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {suggestMode ? (initial._id ? "Suggest changes" : "Suggest") : submitLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
      </div>
    </form>
  );
}
