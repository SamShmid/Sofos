import { useEffect, useId, useRef, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import { canWrite, canSuggest } from "../utils/roles";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useActiveWorkspace } from "../context/ActiveWorkspaceContext";
import Modal from "../components/Modal";
import Breadcrumbs from "../components/Breadcrumbs";
import RoadmapTrack from "../components/RoadmapTrack";
import Dropdown from "../components/Dropdown";
import { getWorkspace } from "../services/workspacesService";
import { getProject } from "../services/projectsService";
import { getGoals, createGoal, updateGoal, reorderGoals, deleteGoal } from "../services/goalsService";
import { getTasks, getTasksByWorkspace, createTask, updateTask } from "../services/tasksService";
import { createSuggestion } from "../services/suggestionsService";
import FirstVisitTip from "../components/FirstVisitTip";
import { toDueAt, fromDueAt } from "../utils/due";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";

const PRIORITY_OPTIONS = [
  { value: "", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// One roadmap for either container type; the route decides which via
// containerType ("workspace" | "project"). Goals are immovable between
// containers, so a single :id + containerField is all that's ever needed.
export default function RoadmapPage({ containerType }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const containerField = containerType === "workspace" ? "workspace" : "project";
  const toast = useToast();
  const confirm = useConfirm();
  const { setActiveWorkspaceId } = useActiveWorkspace();

  const [container, setContainer] = useState(null);
  const [goals, setGoals] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState("loading");
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  // P46/P49: wraps <RoadmapTrack> so a Cmd-K goal arrival can find its .gcard
  // via its data-goal-id, without plumbing a ref through RoadmapTrack/GoalNode.
  const trackWrapRef = useRef(null);
  // P52 (ruling 12): a writer's own choice to propose instead of writing
  // directly. Reset alongside the rest of this page's state on a roadmap
  // switch — see the `[id, containerType]` load effect below.
  const [mode, setMode] = useState("editing");

  const loadGoals = () => getGoals({ [containerField]: id }).then(setGoals);
  // A workspace goal reaches tasks across every project in the workspace;
  // a project goal only its own project's tasks.
  const loadTasks = () =>
    (containerType === "workspace" ? getTasksByWorkspace(id) : getTasks(id)).then(setTasks);

  useEffect(() => {
    let ignore = false;
    setStatus("loading");
    setMode("editing");
    Promise.all([
      containerType === "workspace" ? getWorkspace(id) : getProject(id),
      getGoals({ [containerField]: id }),
      containerType === "workspace" ? getTasksByWorkspace(id) : getTasks(id),
    ])
      .then(([c, g, t]) => {
        if (ignore) return;
        setContainer(c);
        setGoals(g);
        setTasks(t);
        setStatus("ready");
      })
      .catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, containerType]);

  // /projects/:id/roadmap sits outside /workspaces/:id, so Sidebar has no path
  // match of its own here — tell it which workspace owns this page via context
  // (workspace mode: container IS the workspace, with its populated root-first
  // `ancestors` — pass the full { id, name, ancestors } payload so Sidebar can
  // render the trail, not just highlight; project mode: only its populated
  // `workspace` {_id, name} is available, no ancestors, so a bare id is all
  // there is — highlight only, same as before).
  const ownerWorkspaceId = containerType === "workspace" ? container?._id : container?.workspace?._id;
  useEffect(() => {
    if (!ownerWorkspaceId) return;
    setActiveWorkspaceId(
      containerType === "workspace"
        ? { id: container._id, name: container.name, ancestors: container.ancestors || [] }
        : { id: container.workspace._id, name: container.workspace.name, ancestors: container.workspace.ancestors || [] }
    );
    return () => setActiveWorkspaceId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerWorkspaceId, containerType, setActiveWorkspaceId]);

  // P46: Cmd-K arrival focus (goal case only — task/note focus is consumed on
  // ProjectPage). Same consume-once mechanism as ProjectPage: router state is
  // cleared with a `replace` navigate the instant it's read, so a refresh (no
  // router state) or a later re-render (goals reloading after an edit) reads
  // null and bails, and can't re-trigger.
  useEffect(() => {
    if (status !== "ready") return;
    const focus = location.state?.focus;
    if (!focus) return;
    navigate(location.pathname, { replace: true, state: null });

    if (focus.kind === "goal") {
      // P49: a direct data-goal-id lookup — decoupled from layout/DOM order
      // for good (free-canvas cards no longer render in a positional grid).
      const el = trackWrapRef.current?.querySelector(`[data-goal-id="${focus.id}"]`);
      if (el) {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        el.classList.add("focus-flash");
        setTimeout(() => el.classList.remove("focus-flash"), reduced ? 2000 : 1600);
      }
      // else: deleted between search and click — silent no-op, normal page load.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, location.key]);

  async function handleCreateGoal(data) {
    if (suggestable) {
      await createSuggestion({ resourceType: "Goal", op: "create", [containerField]: id, payload: data });
      setShowGoalForm(false);
      toast.success("Suggested — awaiting a writer's approval");
      return;
    }
    await createGoal({ ...data, [containerField]: id });
    setShowGoalForm(false);
    await loadGoals();
  }

  async function handleSaveEdit(data) {
    if (suggestable) {
      await createSuggestion({ resourceType: "Goal", op: "update", resource: editingGoal._id, payload: data });
      setEditingGoal(null);
      toast.success("Suggested — awaiting a writer's approval");
      return;
    }
    await updateGoal(editingGoal._id, data, editingGoal.__v);
    setEditingGoal(null);
    await loadGoals();
  }

  async function handleToggleGoal(goal) {
    try {
      await updateGoal(goal._id, { completed: !goal.completed }, goal.__v);
      await loadGoals();
    } catch (err) {
      if (err.status === 409) {
        toast.error(err.message);
        await loadGoals();
      } else {
        toast.error(err.message);
      }
    }
  }

  // P49: canvas-save — the handleToggleGoal idiom above, but unlike a toggle
  // the card is already showing the dropped position optimistically
  // (RoadmapTrack's `overrides`), so ANY failure (not just 409) needs a
  // reload to resolve the card back to the true saved/default position.
  async function handleCanvasSave(goal, canvas) {
    try {
      await updateGoal(goal._id, { canvas }, goal.__v);
      await loadGoals();
    } catch (err) {
      toast.error(err.message);
      await loadGoals();
    }
  }

  async function handleResetLayout() {
    const ok = await confirm({
      title: "Reset layout",
      message: "Reset the roadmap layout to the default arrangement?",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    try {
      for (const goal of goals) {
        if (goal.canvas) await updateGoal(goal._id, { canvas: null }, goal.__v);
      }
    } catch (err) {
      toast.error(err.message);
    }
    await loadGoals();
  }

  async function handleToggleTask(task) {
    try {
      await updateTask(task._id, { completed: !task.completed }, task.__v);
      await Promise.all([loadGoals(), loadTasks()]);
    } catch (err) {
      if (err.code !== "INCOMPLETE_SUBTASKS") {
        toast.error(err.message);
        if (err.status === 409) await Promise.all([loadGoals(), loadTasks()]);
        return;
      }
      const ok = await confirm({
        title: "Complete every subtask?",
        message: `${err.message} Complete all of them with the parent task?`,
        confirmLabel: "Yes, complete all",
        cancelLabel: "No",
      });
      if (!ok) return;
      await updateTask(task._id, { completed: true, completeSubtasks: true }, task.__v);
      await Promise.all([loadGoals(), loadTasks()]);
    }
  }

  async function handleAddTaskInline(goal, title) {
    const goalProject = goal.project && typeof goal.project === "object" ? goal.project._id : goal.project;
    await createTask({
      title,
      goal: goal._id,
      ...(goalProject ? { project: goalProject } : { workspace: goal.workspace?._id || goal.workspace }),
    });
    await Promise.all([loadGoals(), loadTasks()]);
  }

  async function handleAssignTask(goalId, taskId) {
    try {
      const current = tasks.find((t) => t._id === taskId);
      await updateTask(taskId, { goal: goalId }, current?.__v);
      await Promise.all([loadGoals(), loadTasks()]);
    } catch (err) {
      toast.error(err.message);
      await loadTasks();
    }
  }

  async function handleDeleteGoal(goal) {
    const ok = await confirm({ title: "Move to trash", message: `Move "${goal.title}" to trash?`, confirmLabel: "Move to trash", danger: true });
    if (!ok) return;
    try {
      await deleteGoal(goal._id);
      await loadGoals();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleReorder(newIds) {
    const byId = new Map(goals.map((g) => [g._id, g]));
    setGoals(newIds.map((gid) => byId.get(gid)));
    try {
      await reorderGoals({ [containerField]: id }, newIds);
    } catch (err) {
      toast.error(err.message);
      await loadGoals();
    }
  }

  if (status === "loading") return <p className="loading">Loading…</p>;
  if (status === "error") return <p>Could not load roadmap. <Link to="/">← Overview</Link></p>;

  // P52 (ruling 12): `rawWritable` is the role's real permission, independent
  // of `mode` — Reset layout (structural) gates on this, not `writable`.
  const rawWritable = canWrite(container.effectiveRole);
  const writable = rawWritable && mode === "editing";
  const suggestable = !writable && canSuggest(container.effectiveRole);
  const unassignedTasks = tasks.filter((t) => !t.goal);
  const reachedCount = goals.filter((g) => g.completed).length;
  const nextGoal = goals.find((g) => !g.completed);

  return (
    <>
      {/* Ancestors end with the container itself (it's a link — Roadmap, not
          the container, is the current page) — mirrors ProjectPage's own
          workspace/project-ancestors construction for project mode. */}
      <Breadcrumbs
        ancestors={
          containerType === "workspace"
            ? [
                ...(container.ancestors || []).map((a) => ({ ...a, kind: "workspace" })),
                { _id: container._id, name: container.name, kind: "workspace" },
              ]
            : [
                { _id: container.workspace._id, name: container.workspace.name, kind: "workspace" },
                ...(container.ancestors || []).map((a) => ({ ...a, kind: "project" })),
                { _id: container._id, name: container.name, kind: "project" },
              ]
        }
        current="Roadmap"
      />
      <div className="page-head">
        <h1>Roadmap</h1>
        {(writable || suggestable) && (
          <button type="button" className="btn btn-primary" onClick={() => setShowGoalForm(true)}>+ Goal</button>
        )}
        {rawWritable && (
          <button type="button" className="btn btn-ghost" title="Reset layout" onClick={handleResetLayout}>Reset layout</button>
        )}
      </div>

      <FirstVisitTip tipId="roadmap">Goals are waypoints on a trail — azure marks where you are.</FirstVisitTip>

      <div className="journey">
        {reachedCount} of {goals.length} waypoints reached
        {nextGoal && <> · next: <b>{nextGoal.title}</b></>}
      </div>

      {rawWritable && (
        <div className="mode-strip">
          <span className="mode-toggle">
            <button type="button" className={mode === "editing" ? "on" : undefined} aria-pressed={mode === "editing"} onClick={() => setMode("editing")}>Editing</button>
            <button type="button" className={mode === "suggesting" ? "on" : undefined} aria-pressed={mode === "suggesting"} onClick={() => setMode("suggesting")}>Suggesting</button>
          </span>
          <span className="mode-note">
            {mode === "editing"
              ? "You have edit access — flip to Suggesting and your changes become cards below instead of landing directly."
              : "Suggesting — your changes become cards for review instead of landing directly. Flip back to Editing to edit directly."}
          </span>
        </div>
      )}

      <div ref={trackWrapRef}>
        <RoadmapTrack
          goals={goals}
          writable={writable}
          canSuggest={suggestable}
          unassignedTasks={unassignedTasks}
          onToggle={handleToggleGoal}
          onToggleTask={handleToggleTask}
          onAddTask={handleAddTaskInline}
          onAssignTask={handleAssignTask}
          onEdit={setEditingGoal}
          onDelete={handleDeleteGoal}
          onReorder={handleReorder}
          onCanvasSave={handleCanvasSave}
        />
      </div>

      {showGoalForm && (
        <Modal
          title="New goal"
          onClose={() => setShowGoalForm(false)}
          onDeliberateClose={() => { clearDraft(`goal-new:${id}`); setShowGoalForm(false); }}
        >
          <GoalForm draftKey={`goal-new:${id}`} onSubmit={handleCreateGoal} onCancel={() => setShowGoalForm(false)} />
        </Modal>
      )}

      {editingGoal && (
        <Modal
          title="Edit goal"
          onClose={() => setEditingGoal(null)}
          onDeliberateClose={() => { clearDraft(`goal-edit:${editingGoal._id}`); setEditingGoal(null); }}
        >
          <GoalForm
            initial={editingGoal}
            draftKey={`goal-edit:${editingGoal._id}`}
            submitLabel="Save"
            onSubmit={handleSaveEdit}
            onCancel={() => setEditingGoal(null)}
          />
        </Modal>
      )}
    </>
  );
}

// Shared create/edit form. draftKey (ruling 10): optional — when absent this
// form behaves exactly as before.
function GoalForm({ initial = {}, submitLabel = "Create", onSubmit, onCancel, draftKey = null }) {
  const priorityLabelId = useId();
  const draft = draftKey ? getDraft(draftKey) : undefined;
  const [title, setTitle] = useState(draft?.title ?? initial.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? initial.description ?? "");
  const initialDue = fromDueAt(initial.dueAt, initial.dueHasTime);
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? initialDue.dateStr);
  const [dueTime, setDueTime] = useState(draft?.dueTime ?? initialDue.timeStr);
  const [priority, setPriority] = useState(draft?.priority ?? initial.priority ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!draftKey) return;
    setDraft(draftKey, { title, description, dueDate, dueTime, priority });
  }, [draftKey, title, description, dueDate, dueTime, priority]);

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
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    const payload = {
      title: title.trim(),
      description: description.trim(),
      ...toDueAt(dueDate, dueTime),
      priority: priority || null,
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
      if (draftKey) clearDraft(draftKey);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Due date
        <input type="date" value={dueDate} onChange={handleDateChange} />
      </label>
      <label>
        Due time
        <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
      </label>
      <label>
        <span id={priorityLabelId}>Priority</span>
        <Dropdown labelledBy={priorityLabelId} value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>{submitLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
      </div>
    </form>
  );
}
