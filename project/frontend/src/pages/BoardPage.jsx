import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import {
  DndContext, DragOverlay, closestCenter, useDraggable, useDroppable,
  useSensor, useSensors, PointerSensor, KeyboardSensor,
} from "@dnd-kit/core";
import { canWrite, canSuggest } from "../utils/roles";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useActiveWorkspace } from "../context/ActiveWorkspaceContext";
import Breadcrumbs from "../components/Breadcrumbs";
import Modal from "../components/Modal";
import TaskForm from "../components/TaskForm";
import { clearDraft } from "../utils/draftStash";
import { getWorkspace, updateWorkspace } from "../services/workspacesService";
import { getProject, getProjects, updateProject } from "../services/projectsService";
import { getTasks, createTask, updateTask } from "../services/tasksService";
import { createSuggestion } from "../services/suggestionsService";
import FirstVisitTip from "../components/FirstVisitTip";
import { formatDue, dueState } from "../utils/due";
import { sortByBoardOrder, moveInSequence } from "../utils/boardOrder";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

// One board for either container type; the route decides which via
// containerType ("workspace" | "project") — mirrors RoadmapPage's dual mount.
// Project mode: this project's own tasks. Workspace mode: the workspace's
// tasks (its own plus its projects') labeled by project
// name — the deep project list supplies those names.
export default function BoardPage({ containerType }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { setActiveWorkspaceId } = useActiveWorkspace();

  const [container, setContainer] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [projectsById, setProjectsById] = useState(new Map());
  const [status, setStatus] = useState("loading");
  // Which container `tasks` actually belongs to. `status` alone can't say: the
  // load effect's setStatus("loading") is queued, so on the render where the
  // route has already changed the arrival effect below still sees the PREVIOUS
  // board's "ready" + task list. Consuming a focus against that stale pair
  // threw it away before the new board's data landed (no flash on any
  // cross-board jump), so arrival is gated on the data matching the route.
  const [loadedFor, setLoadedFor] = useState(null);
  // Project mode always fetches the subtree (deep=1); this only toggles the
  // CLIENT-side view of it — no refetch on flip.
  const [includeSubProjects, setIncludeSubProjects] = useState(true);
  // The dragged task's own data, for the DragOverlay's presentation-only copy
  // (P45) — cleared on DragEnd/DragCancel so the overlay unmounts.
  const [activeTask, setActiveTask] = useState(null);
  // Card click → edit modal (P45), mirrors ProjectPage's editingTask idiom.
  const [editingTask, setEditingTask] = useState(null);
  // P50: a Cmd-K task arrival that lands on a currently rollup-filtered-out
  // card auto-enables the checkbox first — this holds the target id across
  // that re-render so the follow-up effect can focus it once the card exists.
  const [pendingFocusTaskId, setPendingFocusTaskId] = useState(null);
  // P50: query root for the Cmd-K arrival's data-task-id lookup (mirrors
  // RoadmapPage's trackWrapRef).
  const boardRef = useRef(null);
  // P52 (ruling 12): a writer's own choice to propose instead of writing
  // directly. Reset alongside the rest of this page's state on a board switch
  // — see the `[id, containerType]` load effect below.
  const [mode, setMode] = useState("editing");
  // Distance-based (not delay-based like Organize's press-and-hold) so a plain
  // click still fires: dnd-kit only stops propagating the click event once the
  // pointer has actually crossed the threshold and a real drag activates.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  const loadTasks = () =>
    (containerType === "workspace" ? getTasks({ workspace: id }) : getTasks({ project: id, deep: 1 })).then(setTasks);
  const loadContainer = () =>
    (containerType === "workspace" ? getWorkspace(id) : getProject(id)).then(setContainer);

  useEffect(() => {
    let ignore = false;
    setStatus("loading");
    setMode("editing");
    // Workspace mode: unchanged three-way parallel fetch. Project mode: the
    // label fetch needs the project's OWNING workspace id (not `id`, which is
    // the project itself), so it has to wait on the container first — same
    // { workspace, deep: 1 } call workspace-mode boards already use to label
    // sub-project cards.
    const load = containerType === "workspace"
      ? Promise.all([getWorkspace(id), getTasks({ workspace: id }), getProjects({ workspace: id, deep: 1 })])
      : getProject(id).then((c) =>
          Promise.all([
            c,
            getTasks({ project: id, deep: 1 }),
            getProjects({ workspace: c.workspace._id, deep: 1 }),
          ])
        );
    load
      .then(([c, t, pr]) => {
        if (ignore) return;
        setContainer(c);
        setTasks(t);
        setProjectsById(new Map(pr.map((p) => [p._id, p])));
        setLoadedFor(`${containerType}:${id}`);
        setStatus("ready");
      })
      .catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, containerType]);

  // /projects/:id/board sits outside /workspaces/:id, so Sidebar has no path
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

  // Client-side rollup filter (P34), hoisted above the loading/error early
  // return below so the Cmd-K focus effect (which needs it before `container`
  // is guaranteed non-null) can read it safely — it only ever touches `tasks`/
  // `containerType`/`includeSubProjects`, never `container` itself.
  const visibleTasks = containerType === "project" && !includeSubProjects
    ? tasks.filter((t) => t.project === id)
    : tasks;

  // P50/P51 (ruling 17 + Samuel's 2026-08-19 Cmd-K ruling): Cmd-K arrival
  // focus, board branch. Same consume-once mechanism as RoadmapPage/
  // ProjectPage: router state is cleared with a `replace` navigate the
  // instant it's read, so a refresh or a later re-render can't re-trigger it.
  // Card lookup goes through a data-task-id attribute (RoadmapPage's
  // data-goal-id pattern), not DOM index — a card's position isn't stable the
  // way a goal's isn't either. `location.key` rides the dep array alongside
  // `status`/`loadedFor` — a "stay on this board" jump (QuickSwitcher's rowPath
  // returning the CURRENT pathname) doesn't change `id`/`containerType`, so it
  // never re-triggers the load effect that flips status through "loading"; only
  // `location`'s own identity changes on that navigate, and that's what has
  // to re-arm this effect for it to see the new focus at all. `loadedFor` is
  // the counterweight: it keeps that same re-arming from firing EARLY on a
  // cross-board jump, where the route changes a render before the data does.
  useEffect(() => {
    if (status !== "ready" || loadedFor !== `${containerType}:${id}`) return;
    const focus = location.state?.focus;
    if (!focus) return;
    navigate(location.pathname, { replace: true, state: null });
    if (focus.kind !== "task") return;

    if (!tasks.some((t) => t._id === focus.id)) {
      // Not this board's own task (or, on the second hop below, genuinely
      // deleted between search and click) — bounce to its home board. One
      // hop max: the stripped-down focus this bounce carries has no
      // project/workspace, so a still-missing task there just falls through
      // to the silent no-op instead of bouncing again.
      if (focus.project != null || focus.workspace != null) {
        navigate(
          focus.project ? `/projects/${focus.project}/board` : `/workspaces/${focus.workspace}/board`,
          { state: { focus: { kind: "task", id: focus.id } } }
        );
      }
      return;
    }
    if (!visibleTasks.some((t) => t._id === focus.id)) {
      // Rollup off and the target lives in a sub-project — enable it first,
      // then focus once the card exists (next effect, keyed on the toggle).
      setIncludeSubProjects(true);
      setPendingFocusTaskId(focus.id);
      return;
    }
    focusCard(focus.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, loadedFor, location.key]);

  // Fires once the auto-enable above actually flips includeSubProjects (a
  // real value change re-renders with the sub-project card now present) — the
  // "next paint" the pending focus needs. A no-op on every other toggle since
  // pendingFocusTaskId is null then.
  useEffect(() => {
    if (!pendingFocusTaskId) return;
    focusCard(pendingFocusTaskId);
    setPendingFocusTaskId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeSubProjects]);

  function focusCard(taskId) {
    const el = boardRef.current?.querySelector(`[data-task-id="${taskId}"]`);
    if (!el) return; // deleted between search and click — silent no-op
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // inline matters here (unlike RoadmapPage's block-only scroll): .board
    // scrolls horizontally at mobile widths (index.css :863/:901), and the
    // target column has to come into view too, not just the row.
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest", inline: "nearest" });
    el.classList.add("focus-flash");
    setTimeout(() => el.classList.remove("focus-flash"), reduced ? 2000 : 1600);
  }

  function handleDragStart(event) {
    setActiveTask(tasks.find((t) => t._id === event.active.id) || null);
  }

  function handleDragCancel() {
    setActiveTask(null);
  }

  // P50: one saved order, board-only (list order — Task.order via
  // POST /tasks/reorder — is now fully independent; board drags never touch
  // it). Every writable board (project or workspace, rollup on or off) works
  // the same way: over.id is `card:<taskId>` (insert before that card) or a
  // column key (append to that column's end); fullSequence spans ALL fetched
  // tasks (not just the visible ones) so a filtered-out card keeps its place
  // in line for when it's shown again.
  async function handleDragEnd(event) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const task = tasks.find((t) => t._id === active.id);
    if (!task) return;

    const overIsCard = typeof over.id === "string" && over.id.startsWith("card:");
    const targetCardId = overIsCard ? over.id.slice(5) : null;
    if (targetCardId === task._id) return; // dropped on itself

    const newStatus = overIsCard ? tasks.find((t) => t._id === targetCardId)?.status : over.id;
    if (!newStatus) return; // defensive: target card no longer among the fetched tasks

    const fullSequence = sortByBoardOrder(tasks, container.boardOrder);
    const newSequence = moveInSequence(fullSequence, task._id, { targetCardId, targetColumnKey: newStatus });
    const crossColumn = task.status !== newStatus;

    const prevTasks = tasks;
    const prevContainer = container;
    // Optimistic: status flips immediately (cross-column), and the container's
    // order is set to the freshly computed sequence right away so the render
    // (which sorts by container.boardOrder) reflects the drop instantly
    // instead of waiting on the round trip.
    if (crossColumn) setTasks((ts) => ts.map((t) => (t._id === task._id ? { ...t, status: newStatus } : t)));
    setContainer((c) => ({ ...c, boardOrder: newSequence.map((t) => t._id) }));

    try {
      if (crossColumn) {
        try {
          await updateTask(task._id, { status: newStatus }, task.__v);
        } catch (err) {
          if (err.code !== "INCOMPLETE_SUBTASKS") throw err;
          const ok = await confirm({
            title: "Complete every subtask?",
            message: `${err.message} Complete all of them with the parent task?`,
            confirmLabel: "Yes, complete all",
            cancelLabel: "No",
          });
          if (!ok) {
            setContainer(prevContainer);
            setTasks(prevTasks);
            await loadTasks();
            return;
          }
          await updateTask(task._id, { status: newStatus, completeSubtasks: true }, task.__v);
        }
      }
      const patch = { boardOrder: newSequence.map((t) => t._id) };
      const updated = containerType === "workspace"
        ? await updateWorkspace(container._id, patch, container.__v)
        : await updateProject(container._id, patch, container.__v);
      // Reconcile __v (and the persisted order) from the response — only
      // these two fields, never the whole doc: the PATCH response isn't
      // populated the way GET is, so a wholesale merge would clobber
      // container.workspace/ancestors with bare unpopulated ids.
      setContainer((c) => ({ ...c, __v: updated.__v, boardOrder: updated.boardOrder }));
      // 949c3cf: reconcile task __v after any drag that PATCHed a task — the
      // optimistic copy above keeps the old version, and click-to-edit (P45)
      // reads it: without this, editing the dragged card false-409s as
      // "changed by someone else". A pure in-column reorder never PATCHes a
      // task (only the container), so no task reconcile is needed there.
      if (crossColumn) await loadTasks();
    } catch (err) {
      toast.error(err.message);
      if (err.status === 409) {
        await Promise.all([loadContainer(), loadTasks()]);
      } else {
        setContainer(prevContainer);
        setTasks(prevTasks);
        await loadTasks();
      }
    }
  }

  // Click-to-edit (P45): mirrors ProjectPage's handleUpdateTask exactly —
  // writable edits directly, suggesters propose, readers never reach this
  // (onClick isn't wired for them at all).
  async function handleUpdateTask(data) {
    if (suggestible) {
      await createSuggestion({ resourceType: "Task", op: "update", resource: editingTask._id, payload: data });
      toast.success("Suggested — awaiting a writer's approval");
      setEditingTask(null);
      return;
    }
    try {
      await updateTask(editingTask._id, data, editingTask.__v);
    } catch (err) {
      if (err.code !== "INCOMPLETE_SUBTASKS") throw err;
      const ok = await confirm({
        title: "Complete every subtask?",
        message: `${err.message} Complete all of them with the parent task?`,
        confirmLabel: "Yes, complete all",
        cancelLabel: "No",
      });
      if (!ok) return;
      await updateTask(editingTask._id, { ...data, completeSubtasks: true }, editingTask.__v);
    }
    setEditingTask(null);
    await loadTasks();
  }

  // Quick-add (P45): project boards only, writable only — always lands in
  // THIS board's own project (ownProjectId), never a sub-project, regardless
  // of the rollup toggle.
  async function handleQuickAdd(columnStatus, title) {
    const created = await createTask({ project: ownProjectId, title, status: columnStatus });
    setTasks((prev) => [...prev, created]);
    await loadTasks();
  }

  // A board-to-board jump (P50's Cmd-K branch made workspace→project reachable)
  // swaps `id`/`containerType` one render BEFORE the load effect can reset
  // status, so the previous container is still in state — rendering a workspace
  // doc as a project blows up on container.workspace._id below. Anything that
  // isn't the container this route asked for reads as still loading.
  if (status === "error") return <p>Could not load board. <Link to="/">← Overview</Link></p>;
  if (status === "loading" || container?._id !== id) return <p className="loading">Loading…</p>;

  // P52 (ruling 12): `rawWritable` is the role's real permission, independent
  // of `mode` — drag (structural, boardOrder is never suggestable) gates on
  // this, not `writable`, so it stays direct through the toggle.
  const rawWritable = canWrite(container.effectiveRole);
  const writable = rawWritable && mode === "editing";
  const suggestible = !writable && canSuggest(container.effectiveRole);
  // Own-project tasks never get a project label, even though the label fetch
  // (workspace deep list) includes the board's own project too.
  const ownProjectId = containerType === "project" ? container._id : null;
  // P50: checkbox is pointless (and hidden) on a project with no sub-projects
  // — every fetched task is already this project's own either way. `pr` in
  // the deep workspace list rides unpopulated ancestors (raw ObjectIds, hence
  // the String() compare) — see projectsService/projectController :92-98.
  const hasSubProjects = containerType === "project" &&
    Array.from(projectsById.values()).some(
      (p) => p._id !== container._id && (p.ancestors || []).some((a) => String(a) === String(container._id))
    );
  // P50: one saved order, two filters — column contents are the same sorted
  // sequence every time, rollup only changes which of visibleTasks are kept.
  const orderedVisible = sortByBoardOrder(visibleTasks, container.boardOrder);

  return (
    <>
      {/* Ancestors end with the container itself (it's a link — Board, not
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
        current="Board"
      />
      <div className="page-head">
        <h1>Board</h1>
        {containerType === "project" && hasSubProjects && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeSubProjects}
              onChange={(e) => setIncludeSubProjects(e.target.checked)}
            />
            Include sub-projects
          </label>
        )}
      </div>

      <FirstVisitTip tipId="board">Drag cards between columns to change their status.</FirstVisitTip>

      {rawWritable && (
        <div className="mode-strip">
          <span className="mode-toggle">
            <button type="button" className={mode === "editing" ? "on" : undefined} aria-pressed={mode === "editing"} onClick={() => setMode("editing")}>Editing</button>
            <button type="button" className={mode === "suggesting" ? "on" : undefined} aria-pressed={mode === "suggesting"} onClick={() => setMode("suggesting")}>Suggesting</button>
          </span>
          <span className="mode-note">
            {mode === "editing"
              ? "You have edit access — flip to Suggesting and your changes become cards below instead of landing directly."
              : "Suggesting — your changes become cards for review instead of landing directly. Flip back to Editing to edit directly. Drag still moves cards directly."}
          </span>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="board" ref={boardRef}>
          {COLUMNS.map((col) => (
            <BoardColumn
              key={col.key}
              column={col}
              tasks={orderedVisible.filter((t) => t.status === col.key)}
              projectsById={projectsById}
              writable={writable}
              suggestible={suggestible}
              dragWritable={rawWritable}
              ownProjectId={ownProjectId}
              showQuickAdd={containerType === "project" && writable}
              onQuickAdd={handleQuickAdd}
              onOpen={setEditingTask}
            />
          ))}
        </div>
        {/* Presentation-only copy (P45): dnd-kit's overlay is rendered fixed to
            the viewport, so it escapes .board-cards' internal scroll clipping —
            that clipping is what made the dragged card vanish mid-drag before. */}
        <DragOverlay>
          {activeTask ? (
            <div className="board-card board-card-overlay">
              <BoardCardFace task={activeTask} project={projectsById.get(activeTask.project)} ownProjectId={ownProjectId} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {editingTask && (
        <Modal
          title="Edit task"
          onClose={() => setEditingTask(null)}
          onDeliberateClose={() => { clearDraft(`task-edit:${editingTask._id}`); setEditingTask(null); }}
        >
          <TaskForm initial={editingTask} draftKey={`task-edit:${editingTask._id}`} suggestMode={suggestible} onSubmit={handleUpdateTask} onCancel={() => setEditingTask(null)} />
        </Modal>
      )}
    </>
  );
}

function BoardColumn({ column, tasks, projectsById, writable, suggestible, dragWritable, ownProjectId, showQuickAdd, onQuickAdd, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !dragWritable });
  return (
    <div ref={setNodeRef} className={`board-column${isOver ? " drag-over" : ""}`}>
      <div className="board-column-head">
        <h3>{column.label}</h3>
        <span className="mini-label">{tasks.length}</span>
      </div>
      <div className="board-cards">
        {tasks.map((t) => (
          <BoardCard
            key={t._id}
            task={t}
            project={projectsById.get(t.project)}
            writable={writable}
            suggestible={suggestible}
            dragWritable={dragWritable}
            ownProjectId={ownProjectId}
            onOpen={onOpen}
          />
        ))}
        {tasks.length === 0 && <p className="hint">No tasks</p>}
        {showQuickAdd && <BoardQuickAdd status={column.key} onAdd={onQuickAdd} />}
      </div>
    </div>
  );
}

// Presentation-only face (title + chips) shared by the live card and the
// DragOverlay's copy — the overlay copy carries no draggable/droppable hooks.
function BoardCardFace({ task, project, ownProjectId }) {
  // Direct workspace tasks have no project label. Board's own project
  // (project mode) is unlabeled too, even when it's a
  // named project riding along in the deep workspace list for other cards' labels.
  const label = project && task.project !== ownProjectId ? project.name : null;
  const state = dueState(task.dueAt, task.dueHasTime);
  return (
    <>
      <h4>{task.title}</h4>
      {label && <span className="board-card-project">{label}</span>}
      {task.priority && <span className={"prio-chip " + task.priority}>{PRIORITY_LABEL[task.priority]}</span>}
      {task.dueAt && <span className={"due-chip" + (state ? " " + state : "")}>{formatDue(task.dueAt, task.dueHasTime)}</span>}
    </>
  );
}

function BoardCard({ task, project, writable, suggestible, dragWritable, ownProjectId, onOpen }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: task._id,
    disabled: !dragWritable,
  });
  // P50: a card is also a drop target (id `card:<taskId>`) whenever the board
  // is writable — dnd-kit allows a node to be both draggable and droppable,
  // merging the two refs on one node — so hovering it means "insert before
  // this card" in every writable mode now, not just project+rollup-off.
  // P52: drag gates on `dragWritable` (raw role, ignores `mode`) — boardOrder
  // is structural and stays direct in suggesting mode (ruling 12).
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `card:${task._id}`, disabled: !dragWritable });
  const setNodeRef = (node) => { setDragRef(node); setDropRef(node); };
  // No transform/translate on the source anymore (P45) — DragOverlay now
  // renders the moving copy, so the source just sits in place and fades
  // (opacity, via .dragging) instead of following the pointer itself.
  const clickable = writable || suggestible;

  return (
    <div
      ref={setNodeRef}
      data-task-id={task._id}
      className={`board-card${isDragging ? " dragging" : ""}${!dragWritable ? " static" : ""}${isOver ? " board-card-insert" : ""}`}
      title={dragWritable ? "Drag to move · click to open" : undefined}
      onClick={clickable ? () => onOpen(task) : undefined}
      {...(dragWritable ? { ...attributes, ...listeners } : {})}
    >
      <BoardCardFace task={task} project={project} ownProjectId={ownProjectId} />
    </div>
  );
}

// Quick-add (P45): project boards only, writable only (BoardColumn already
// gates that). Enter submits, Esc cancels — no blur-cancel, so a stray click
// elsewhere (e.g. Enter's own async submit settling) can't race the input away.
function BoardQuickAdd({ status, onAdd }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function cancel() {
    setAdding(false);
    setTitle("");
  }

  async function submit() {
    const t = title.trim();
    if (!t) { cancel(); return; }
    setSubmitting(true);
    try {
      await onAdd(status, t);
      setTitle("");
      setAdding(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!adding) {
    return <button className="add-inline" onClick={() => setAdding(true)}>+ Add</button>;
  }
  return (
    <input
      autoFocus
      aria-label="New task title"
      placeholder="Task title"
      value={title}
      disabled={submitting}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      }}
    />
  );
}
