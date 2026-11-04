import { useSortable } from "@dnd-kit/sortable";
import { createSuggestion } from "../services/suggestionsService";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { formatDue, dueState } from "../utils/due";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

// canWrite comes from the containing page's effectiveRole — capability is
// per-resource now, so it arrives as a prop, not from global auth state.
// canSuggest (pure suggesters only) reuses the same checkbox/button but
// routes the submission through a suggestion instead of a direct write.
// Drag reorder (mirrors LinkRow in LinksSection.jsx) is writer-only and only
// meaningful for the incomplete list — a completed task is never wrapped in
// the page's DndContext, so it stays a plain, non-sortable row.
export default function TaskItem({ task, canWrite, canSuggest, onToggle, onDelete, onEdit, onAddSubtask, depth = 0, subtaskCount = 0, dragDisabled = false }) {
  const toast = useToast();
  const confirm = useConfirm();
  const sortable = canWrite && !task.completed && !dragDisabled;
  const state = dueState(task.dueAt, task.dueHasTime);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task._id,
    disabled: !sortable,
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  async function handleToggle() {
    if (canWrite) {
      await onToggle(task);
      return;
    }
    if (canSuggest) {
      try {
        await createSuggestion({
          resourceType: "Task",
          op: "update",
          resource: task._id,
          payload: { completed: !task.completed },
        });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  async function handleDelete() {
    if (canWrite) {
      onDelete(task);
      return;
    }
    if (canSuggest) {
      const ok = await confirm({
        title: "Suggest deletion",
        message: `Suggest deleting "${task.title}"?`,
        confirmLabel: "Suggest",
        danger: true,
      });
      if (!ok) return;
      try {
        await createSuggestion({ resourceType: "Task", op: "delete", resource: task._id });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  return (
    <li ref={setNodeRef} style={{ ...style, "--task-depth": depth }} className={`task-item ${task.completed ? "completed" : ""}${depth ? " subtask" : ""}`}>
      {sortable && (
        <span className="goal-drag-handle" aria-label="Drag to reorder" title="Drag to reorder" {...attributes} {...listeners}>
          ⠿
        </span>
      )}
      <label className="task-check" aria-label={task.title}>
        <input
          type="checkbox"
          checked={task.completed}
          disabled={!canWrite && !canSuggest}
          onChange={handleToggle}
        />
      </label>
      <div className="task-body">
        <h4>
          {/* Phase 44: title text truncates on its own line; chips stay put
              (index.css's .task-item h4 .task-title). Phase 48: writers/
              suggesters get a real button (same target as ✎ — onEdit) so the
              title itself opens the edit modal; pure readers keep the plain
              span. Safe alongside drag: the sortable listeners above are only
              ever spread onto .goal-drag-handle, never onto the title or row,
              so there's no click-vs-drag ambiguity to resolve here. */}
          {canWrite || canSuggest ? (
            <button
              type="button"
              className="task-title task-title-btn"
              title={task.title}
              onClick={() => onEdit(task)}
            >
              {task.title}
            </button>
          ) : (
            <span className="task-title" title={task.title}>{task.title}</span>
          )}
          {task.status === "in_progress" && <span className="status-chip">In progress</span>}
          {task.sourceProject && <span className="status-chip" title={`From ${task.sourceProject.name}`}>{task.sourceProject.name}</span>}
          {subtaskCount > 0 && <span className="status-chip">{subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}</span>}
          {task.priority && <span className={"prio-chip " + task.priority}>{PRIORITY_LABEL[task.priority]}</span>}
          {task.dueAt && <span className={"due-chip" + (state ? " " + state : "")}>{formatDue(task.dueAt, task.dueHasTime)}</span>}
        </h4>
        {task.content && <p>{task.content}</p>}
      </div>
      {(canWrite || canSuggest) && (
        <>
          {(canWrite || canSuggest) && onAddSubtask && (
            <button className="goal-edit-btn" aria-label="Add subtask" title="Add subtask" onClick={() => onAddSubtask(task)}>+</button>
          )}
          <button
            className="goal-edit-btn"
            aria-label={canWrite ? "Edit task" : "Suggest an edit"}
            title={canWrite ? "Edit task" : "Suggest an edit"}
            onClick={() => onEdit(task)}
          >
            ✎
          </button>
          <button
            className="delete-x"
            aria-label={canWrite ? "Delete task" : "Suggest removal"}
            title={canWrite ? "Delete task" : "Suggest removal"}
            onClick={handleDelete}
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}
