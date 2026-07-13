import { useState } from "react";

// Used for both "new note" and editing. Content stays raw markdown (not trimmed).
export default function NoteEditor({ initial = {}, onSave, onCancel }) {
  const [title, setTitle] = useState(initial.title || "");
  const [content, setContent] = useState(initial.content || "");
  const [error, setError] = useState(null);

  async function handleSave() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    try {
      await onSave({ title: title.trim(), content });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="note-editor">
      {error && <p role="alert">{error}</p>}
      <input
        className="note-title-input"
        placeholder="Note title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="note-content-input"
        placeholder="Write markdown…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="form-actions">
        <button onClick={handleSave}>✓ Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
