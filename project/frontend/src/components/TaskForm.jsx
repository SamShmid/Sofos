import { useState, useRef, useEffect } from "react";
import { toDueAt, fromDueAt } from "../utils/due";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";
import Dropdown from "./Dropdown";

const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];
const PRIORITY_OPTIONS = [
  { value: "", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// Shared create/edit form for tasks (mirrors LinkForm). In edit mode
// (`initial` set) fields prefill and the submit button reads "Save"; only
// the create flow clears its fields after submit. suggestMode (P33) swaps
// the submit label for its suggest-mode counterpart — the page passing it in
// already knows whether this submit routes to a suggestion or a direct write.
// draftKey (ruling 10): optional — when absent this form behaves exactly as
// before. The inline create instance (ProjectPage's own "+ Task" row) never
// gets one — it's not modal-hosted.
export default function TaskForm({ initial, onSubmit, onCancel, suggestMode = false, draftKey = null }) {
  const draft = draftKey ? getDraft(draftKey) : undefined;
  const [title, setTitle] = useState(draft?.title ?? initial?.title ?? "");
  const [content, setContent] = useState(draft?.content ?? initial?.content ?? "");
  const [status, setStatus] = useState(draft?.status ?? initial?.status ?? "todo");
  const initialDue = fromDueAt(initial?.dueAt, initial?.dueHasTime);
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? initialDue.dateStr);
  const [dueTime, setDueTime] = useState(draft?.dueTime ?? initialDue.timeStr);
  const [priority, setPriority] = useState(draft?.priority ?? initial?.priority ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard: `disabled={submitting}` can't stop two clicks in the
  // same tick (React re-renders after), but a ref bails the second call at once.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!draftKey) return;
    setDraft(draftKey, { title, content, status, dueDate, dueTime, priority });
  }, [draftKey, title, content, status, dueDate, dueTime, priority]);

  function handleCancel() {
    if (draftKey) clearDraft(draftKey);
    onCancel();
  }

  // Clearing the date clears the time with it — a bare time with no date is
  // meaningless (contract 2's all-day/timed split is keyed off the date).
  function handleDateChange(e) {
    const v = e.target.value;
    setDueDate(v);
    if (!v) setDueTime("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        status,
        ...toDueAt(dueDate, dueTime),
        priority: priority || null,
      });
      if (draftKey) clearDraft(draftKey);
      if (!initial) {
        setTitle("");
        setContent("");
        setStatus("todo");
        setDueDate("");
        setDueTime("");
        setPriority("");
      }
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
      <input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder="Description (optional)" value={content} onChange={(e) => setContent(e.target.value)} />
      <Dropdown ariaLabel="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      <input type="date" aria-label="Due date" value={dueDate} onChange={handleDateChange} />
      <input type="time" aria-label="Due time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
      <Dropdown ariaLabel="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {suggestMode ? (initial ? "Suggest changes" : "Suggest") : (initial ? "Save" : "Add")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
      </div>
    </form>
  );
}
