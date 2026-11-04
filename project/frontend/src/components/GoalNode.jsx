import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { createSuggestion } from "../services/suggestionsService";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { formatDue, dueState } from "../utils/due";
import Dropdown from "./Dropdown";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

// Phase 49: the marker + "you are here" pill are no longer part of the
// card's flow (RoadmapTrack renders them as their own absolutely-positioned
// overlay, anchored at the measured marker point) — split out so GoalNode
// stays the card only. Toggle-complete is the marker's one affordance, so
// its writer/suggester branching lives here now instead of in GoalNode.
export function GoalMarker({ goal, writable, canSuggest, isCurrent, point, onToggle }) {
  const toast = useToast();

  const markerClass = ["goal-marker", goal.completed && "completed", isCurrent && "current"]
    .filter(Boolean)
    .join(" ");

  async function handleToggleGoal() {
    if (writable) {
      onToggle(goal);
      return;
    }
    if (canSuggest) {
      try {
        await createSuggestion({
          resourceType: "Goal",
          op: "update",
          resource: goal._id,
          payload: { completed: !goal.completed },
        });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className={markerClass}
        style={{ left: point.x + "px", top: point.y + "px" }}
        disabled={!writable && !canSuggest}
        aria-label={goal.completed ? "Mark goal incomplete" : "Mark goal complete"}
        title={goal.completed ? "Mark goal incomplete" : "Mark goal complete"}
        onClick={handleToggleGoal}
      >
        {goal.completed ? "✓" : isCurrent ? "●" : ""}
      </button>
      {isCurrent && (
        <span className="pill" style={{ left: point.x + "px", top: (point.y - 22) + "px" }}>you are here</span>
      )}
    </>
  );
}

// One roadmap card. Drag listeners live only on the grip handle so the
// card's buttons/inputs/select stay clickable. canSuggest (pure suggesters)
// reuses the toggle/delete/add-task/assign-task affordances as suggestions
// instead of direct writes; the edit ✎ opens the page-owned form, which
// routes its submit to a suggestion. Reorder stays writable-only (order is
// not suggestable). isCurrent (first-incomplete) is computed once by
// RoadmapTrack from the full goals list and passed down.
//
// Phase 49: no more SortableContext — reorder is a plain useDraggable (grip)
// + useDroppable (card) pair; RoadmapTrack's DndContext does closestCenter +
// arrayMove on drop. `position` is the card's absolute {x,y} on the desktop
// canvas (undefined on mobile, where CSS puts cards back in normal flow).
// `dropTargetId` is the id of the card currently under a grip drag, if any —
// used only to know whether *this* card should show the drop-target
// highlight (never on the card whose own grip is being dragged).
export default function GoalNode({
  goal, writable, canSuggest, unassignedTasks, isCurrent, position, dragActiveId,
  onToggleTask, onAddTask, onAssignTask, onEdit, onDelete,
}) {
  const {
    attributes: dragAttributes, listeners: dragListeners, setNodeRef: setDragRef, transform, isDragging,
  } = useDraggable({ id: goal._id, disabled: !writable });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: goal._id });

  const toast = useToast();
  const confirm = useConfirm();

  const [addingTask, setAddingTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskError, setTaskError] = useState(null);

  const isDropTarget = isOver && dragActiveId !== goal._id;

  const cardStyle = {
    ...(position ? { left: position.x + "px", top: position.y + "px" } : null),
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  const tasks = goal.tasks || [];
  const compatibleUnassignedTasks = unassignedTasks.filter((task) => {
    const taskProject = task.project && typeof task.project === "object" ? task.project._id : task.project;
    const goalProject = goal.project && typeof goal.project === "object" ? goal.project._id : goal.project;
    if (goalProject) return String(taskProject || "") === String(goalProject);
    const taskWorkspace = task.workspace && typeof task.workspace === "object" ? task.workspace._id : task.workspace;
    const goalWorkspace = goal.workspace && typeof goal.workspace === "object" ? goal.workspace._id : goal.workspace;
    return String(taskWorkspace) === String(goalWorkspace);
  });
  const doneCount = tasks.filter((t) => t.completed).length;
  const goalDueState = dueState(goal.dueAt, goal.dueHasTime);

  const cardClass = [
    "gcard",
    goal.completed && "done",
    !goal.completed && isCurrent && "current",
    isDropTarget && "drop-target",
    writable && "draggable", // grab cursor only where a body-drag is actually possible
  ]
    .filter(Boolean)
    .join(" ");

  async function handleAddTaskSubmit(e) {
    e.preventDefault();
    if (!taskTitle.trim()) {
      setTaskError("Title is required");
      return;
    }
    try {
      if (writable) {
        await onAddTask(goal, taskTitle.trim());
      } else if (canSuggest) {
        const container = goal.project ? { project: goal.project } : { workspace: goal.workspace };
        await createSuggestion({
          resourceType: "Task",
          op: "create",
          ...container,
          payload: { title: taskTitle.trim(), goal: goal._id },
        });
        toast.success("Suggested — awaiting a writer's approval");
      }
      setTaskTitle("");
      setTaskError(null);
      setAddingTask(false);
    } catch (err) {
      setTaskError(err.message);
    }
  }

  async function handleSuggestAssign(taskId) {
    try {
      await createSuggestion({ resourceType: "Task", op: "update", resource: taskId, payload: { goal: goal._id } });
      toast.success("Suggested — awaiting a writer's approval");
    } catch (err) {
      toast.error(err.message);
    }
  }

  function handleAssignSelect(taskId) {
    if (writable) onAssignTask(goal._id, taskId);
    else if (canSuggest) handleSuggestAssign(taskId);
  }

  async function handleDeleteGoal() {
    if (writable) {
      onDelete(goal);
      return;
    }
    if (canSuggest) {
      const ok = await confirm({
        title: "Suggest deletion",
        message: `Suggest deleting "${goal.title}"?`,
        confirmLabel: "Suggest",
        danger: true,
      });
      if (!ok) return;
      try {
        await createSuggestion({ resourceType: "Goal", op: "delete", resource: goal._id });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  async function handleToggleTaskRow(t) {
    if (writable) {
      onToggleTask(t);
      return;
    }
    if (canSuggest) {
      try {
        await createSuggestion({
          resourceType: "Task",
          op: "update",
          resource: t._id,
          payload: { completed: !t.completed },
        });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      style={cardStyle}
      className={cardClass}
      data-goal-id={goal._id}
    >
      <h3>
        {goal.title}
        {goal.priority && <span className={"prio-chip " + goal.priority}>{PRIORITY_LABEL[goal.priority]}</span>}
        {(writable || canSuggest) && (
          <span className="tools">
            {writable && (
              <span className="goal-drag-handle" aria-label="Drag to reorder" title="Drag to reorder" {...dragAttributes} {...dragListeners}>
                ⠿
              </span>
            )}
            <button
              type="button"
              className="goal-edit-btn"
              aria-label={writable ? "Edit goal" : "Suggest an edit"}
              title={writable ? "Edit goal" : "Suggest an edit"}
              onClick={() => onEdit(goal)}
            >
              ✎
            </button>
            <button
              type="button"
              className="delete-x"
              aria-label={writable ? "Delete goal" : "Suggest removal"}
              title={writable ? "Delete goal" : "Suggest removal"}
              onClick={handleDeleteGoal}
            >
              ×
            </button>
          </span>
        )}
      </h3>

      {goal.description && <p>{goal.description}</p>}
      {goal.sourceProject && <span className="status-chip" title={`From ${goal.sourceProject.name}`}>{goal.sourceProject.name}</span>}

      {tasks.length > 0 ? (
        <>
          <div className="mini-route">
            {tasks.map((t) => (
              <i key={t._id} className={t.completed ? "done" : ""} />
            ))}
          </div>
          <span className="mini-label">{doneCount}/{tasks.length} tasks</span>
          {tasks.map((t) => (
            <label key={t._id} className={`task ${t.completed ? "donetask" : ""}`}>
              <input
                type="checkbox"
                checked={t.completed}
                disabled={!writable && !canSuggest}
                onChange={() => handleToggleTaskRow(t)}
              />
              {t.title}
            </label>
          ))}
        </>
      ) : (
        <span className="mini-label">no tasks yet</span>
      )}

      {goal.dueAt && (
        <span className={"due-chip" + (goalDueState ? " " + goalDueState : "")}>
          {formatDue(goal.dueAt, goal.dueHasTime)}
        </span>
      )}

      {(writable || canSuggest) && (
        addingTask ? (
          <form className="task-form" onSubmit={handleAddTaskSubmit}>
            {taskError && <p role="alert">{taskError}</p>}
            <input
              placeholder="Task title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">{writable ? "Add" : "Suggest"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setAddingTask(false); setTaskError(null); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="addtask" onClick={() => setAddingTask(true)}>
            {writable ? "+ Task" : "+ Suggest task"}
          </button>
        )
      )}

      {(writable || canSuggest) && compatibleUnassignedTasks.length > 0 && (
        <Dropdown
          action
          onSelect={handleAssignSelect}
          options={compatibleUnassignedTasks.map((t) => ({ value: t._id, label: t.title }))}
          ariaLabel="Assign task"
          placeholder="Assign task…"
        />
      )}
    </div>
  );
}
