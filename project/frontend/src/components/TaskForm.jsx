import { useState } from "react";

// Inline "new task" form shown in the project stack.
export default function TaskForm({ onSubmit, onCancel }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    try {
      await onSubmit({ title: title.trim(), content: content.trim() });
      setTitle("");
      setContent("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder="Description (optional)" value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="form-actions">
        <button type="submit">Add</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
