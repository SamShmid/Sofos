import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import { canWrite, canSuggest } from "../utils/roles";
import { resolveTagColor, tenantIdOf } from "../utils/tags";
import { dueBucket, dueState, formatDue } from "../utils/due";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useActiveWorkspace } from "../context/ActiveWorkspaceContext";
import { useTagColors } from "../context/TagColorsContext";
import TaskItem from "../components/TaskItem";
import TaskForm from "../components/TaskForm";
import HistoryModal from "../components/HistoryModal";
import Modal from "../components/Modal";
import Breadcrumbs from "../components/Breadcrumbs";
import LinksSection from "../components/LinksSection";
import FilesSection from "../components/FilesSection";
import SuggestionsPanel from "../components/SuggestionsPanel";
import ProjectForm from "../components/ProjectForm";
import TagColorPopover from "../components/TagColorPopover";
import ProjectMoveModal from "../components/ProjectMoveModal";
import Dropdown from "../components/Dropdown";
import { clearDraft } from "../utils/draftStash";
import { getProject, updateProject, getProjects, createProject, moveProject, archiveProject, restoreProject, deleteProject } from "../services/projectsService";
import { getWorkspaces } from "../services/workspacesService";
import { createSuggestion } from "../services/suggestionsService";
import { getTasks, createTask, updateTask, deleteTask } from "../services/tasksService";
import { getNotes, deleteNote } from "../services/notesService";
import { getGoals } from "../services/goalsService";

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };
const SORT_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "newest", label: "Newest" },
];
const PRIORITY_FILTER_OPTIONS = [
  { value: "all", label: "All priorities" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

// P45-W2: project-scoped "Due & upcoming" row — mirrors HomePage's
// AttentionRow markup/classes exactly (no extraction, per spec). Tasks here
// are already on the page so they never link anywhere; goals may link to
// the roadmap (`href` passed only for goals).
function DueRow({ item, href }) {
  const state = dueState(item.dueAt, item.dueHasTime);
  return (
    <div className="attention-row">
      {href ? (
        <Link to={href}>{item.title}</Link>
      ) : (
        <span className="attention-row-plain" title={item.title}>{item.title}</span>
      )}
      {item.dueAt && <span className={"due-chip" + (state ? " " + state : "")}>{formatDue(item.dueAt, item.dueHasTime)}</span>}
      {item.priority && <span className={"prio-chip " + item.priority}>{PRIORITY_LABEL[item.priority]}</span>}
    </div>
  );
}

// Client-side VIEW only (P39 shared contract 5) — never touches the
// server-side `order`; Array.prototype.sort is stable, so ties fall back to
// whatever order `list` already arrived in (manual order for an unsorted
// pass-through, and for the tie-break within due/priority sorts too).
function applyTaskControls(list, sortMode, priorityFilter) {
  const filtered = list.filter((t) => priorityFilter === "all" || t.priority === priorityFilter);
  if (sortMode === "due") {
    return filtered.sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt) - new Date(b.dueAt);
    });
  }
  if (sortMode === "priority") {
    return filtered.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0));
  }
  if (sortMode === "newest") {
    return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return filtered; // manual — current order preserved
}

function taskTree(list, sortMode, priorityFilter) {
  const byParent = new Map();
  for (const task of list) {
    const parent = task.parentTask && typeof task.parentTask === "object" ? task.parentTask._id : task.parentTask;
    const key = parent ? String(parent) : "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(task);
  }
  for (const [key, siblings] of byParent) {
    byParent.set(key, applyTaskControls(siblings, sortMode, "all"));
  }
  const rows = [];
  const visit = (task, depth) => {
    const children = byParent.get(String(task._id)) || [];
    if (priorityFilter === "all" || task.priority === priorityFilter) {
      rows.push({ task, depth, childCount: children.length });
    }
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of byParent.get("root") || []) visit(root, 0);
  return rows;
}

export default function ProjectPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { setActiveWorkspaceId } = useActiveWorkspace();

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [subProjects, setSubProjects] = useState([]);
  const [showSubProjectForm, setShowSubProjectForm] = useState(false);
  const [status, setStatus] = useState("loading");
  // Due & upcoming panel (P45-W2): the page doesn't otherwise hold goals, so
  // fetch just for that panel — optional, never blocks the page like
  // HomePage's goalsSummary.
  const [goals, setGoals] = useState([]);
  // P46: incomplete/completed <ul>s — a Cmd-K task arrival locates its row by
  // index into whichever list rendered it (DOM order mirrors applyTaskControls'
  // sorted output, so index lookup is exact).
  const incompleteListRef = useRef(null);
  const completedListRef = useRef(null);

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [subtaskParent, setSubtaskParent] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editingProject, setEditingProject] = useState(false);
  // Which resource's history modal is open, if any: { resourceType, resourceId, canWrite }
  const [historyTarget, setHistoryTarget] = useState(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveNodes, setMoveNodes] = useState(null);
  const [includeReferenceSubprojects, setIncludeReferenceSubprojects] = useState(false);
  // Sort/filter are page state only, client-side over the already-loaded
  // task list (P23 idiom, no refetch) — see applyTaskControls above.
  const [sortMode, setSortMode] = useState("manual");
  const [priorityFilter, setPriorityFilter] = useState("all");
  // Which tag's color popover is open, if any (P43).
  const [colorPopoverTag, setColorPopoverTag] = useState(null);
  const { maps } = useTagColors();
  // P52 (ruling 12): a writer's own choice to propose instead of writing
  // directly. Reset in the load effect below on a project switch — a mode
  // flipped on one project shouldn't silently carry into another.
  const [mode, setMode] = useState("editing");

  const loadProject = () => getProject(id).then(setProject);
  const loadTasks = () => getTasks(id).then(setTasks);
  const loadNotes = () => getNotes({ project: id, includeSubprojects: includeReferenceSubprojects }).then(setNotes);
  const loadSubProjects = () => getProjects({ parent: id }).then(setSubProjects);

  useEffect(() => {
    let ignore = false;
    setStatus("loading");
    setMode("editing");
    // The project arrives with effectiveRole + its workspace's name populated,
    // so no separate workspace fetch is needed.
    Promise.all([getProject(id), getTasks(id), getNotes({ project: id }), getProjects({ parent: id })])
      .then(([p, t, n, sp]) => {
        if (ignore) return;
        setProject(p);
        setTasks(t);
        setNotes(n);
        setSubProjects(sp);
        setStatus("ready");
      })
      .catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
  }, [id]);

  useEffect(() => {
    let ignore = false;
    getGoals({ project: id })
      .then((g) => { if (!ignore) setGoals(g); })
      .catch(() => { if (!ignore) setGoals([]); });
    return () => { ignore = true; };
  }, [id]);

  // P46: Cmd-K arrival focus. Router state only (`location.state.focus`), and
  // cleared with a `replace` navigate the instant it's read — a refresh carries
  // no router state at all, and any later re-render of this effect (tasks/notes
  // reloading after an edit) reads the now-null state and bails, so it cannot
  // re-trigger.
  //
  // P52: keyed on `location.key` as well as `status`. Arriving at the project
  // you are ALREADY on changes neither `id` nor `status`, so a `[status]`-only
  // effect never re-fired and the arrival was silently dropped (the long-known
  // Cmd-K same-page-jump gap) — e.g. a Cmd-K task jump to a task already on
  // this page. `location.key` changes on every navigation including a
  // same-path push; the consume-once guard above makes the extra run from the
  // clearing `replace` a no-op.
  // P54: the note branch this effect used to carry is retired — a note
  // arrival (Cmd-K, or a suggestion card's View changes) now lands on
  // /notes/:id directly, its own route, never a same-page focus state here.
  useEffect(() => {
    if (status !== "ready") return;
    const focus = location.state?.focus;
    if (!focus) return;
    navigate(location.pathname, { replace: true, state: null });

    if (focus.kind === "task") {
      const rowsNow = taskTree(tasks, sortMode, priorityFilter);
      const incompleteNow = rowsNow.filter(({ task }) => !task.completed);
      const completedNow = rowsNow.filter(({ task }) => task.completed);
      const idxIncomplete = incompleteNow.findIndex(({ task }) => task._id === focus.id);
      const idxCompleted = idxIncomplete === -1 ? completedNow.findIndex(({ task }) => task._id === focus.id) : -1;
      const list = idxIncomplete !== -1 ? incompleteListRef.current : idxCompleted !== -1 ? completedListRef.current : null;
      const idx = idxIncomplete !== -1 ? idxIncomplete : idxCompleted;
      const el = idx !== -1 ? list?.children[idx] : null;
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

  // /projects/:id sits outside /workspaces/:id, so Sidebar has no path match of
  // its own here — tell it which workspace owns this project via context. The
  // workspace now populates its own `ancestors` (names), so pass the object
  // form so the sidebar renders the full nesting trail, not just a highlight.
  useEffect(() => {
    if (!project?.workspace?._id) return;
    setActiveWorkspaceId({
      id: project.workspace._id,
      name: project.workspace.name,
      ancestors: project.workspace.ancestors || [],
    });
    return () => setActiveWorkspaceId(null);
    // name/ancestors travel with the same workspace id — re-run on id change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.workspace?._id, setActiveWorkspaceId]);

  async function handleUpdateProject(data) {
    if (suggestible) {
      await createSuggestion({ resourceType: "Project", op: "update", resource: project._id, payload: data });
      toast.success("Suggested — awaiting a writer's approval");
      setEditingProject(false);
      return;
    }
    await updateProject(project._id, data, project.__v);
    setEditingProject(false);
    await loadProject();
  }

  async function openMoveModal() {
    const workspaceResult = await getWorkspaces();
    const projectTenantId = tenantIdOf(project.superWorkspace);
    const workspaces = [...workspaceResult.owned, ...workspaceResult.shared]
      .filter((workspace) => tenantIdOf(workspace.superWorkspace) === projectTenantId);
    const projectLists = await Promise.all(
      workspaces.map((workspace) => getProjects({ workspace: workspace._id, deep: true }))
    );
    setMoveNodes({
      workspaces,
      projects: projectLists.flat(),
    });
    setShowMoveModal(true);
  }

  async function handleMoveProject(destination) {
    await moveProject(id, destination);
    setShowMoveModal(false);
    setMoveNodes(null);
    await loadProject();
  }

  async function handleArchiveProject() {
    if (project.archivedAt) {
      await restoreProject(project._id);
      toast.success("Project tree restored");
      await loadProject();
      return;
    }
    const ok = await confirm({
      title: "Archive project",
      message: `Archive "${project.name}" and all of its subprojects?`,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    await archiveProject(project._id);
    toast.success("Project tree archived");
    navigate(`/workspaces/${project.workspace._id}`);
  }

  // Ruling 12/21: delete now lives on the project's own page. Lands on
  // whatever contains this project — its parent project, or (top-level) the
  // owning workspace — the same trail Breadcrumbs already renders above.
  async function handleDeleteProject() {
    const ok = await confirm({
      title: "Move to trash",
      message: `Move "${project.name}" and everything in it to trash?`,
      confirmLabel: "Move to trash",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(project._id);
      toast.success("Moved to Trash — restorable from Trash");
      navigate(
        project.ancestors?.length
          ? `/projects/${project.ancestors[project.ancestors.length - 1]._id}`
          : `/workspaces/${project.workspace._id}`
      );
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleCreateSubProject(data) {
    if (suggestible) {
      await createSuggestion({ resourceType: "Project", op: "create", project: id, payload: data });
      setShowSubProjectForm(false);
      toast.success("Suggested — awaiting a writer's approval");
      return;
    }
    await createProject({ ...data, parentProject: id });
    setShowSubProjectForm(false);
    await loadSubProjects();
  }

  async function handleToggle(task) {
    try {
      await updateTask(task._id, { completed: !task.completed }, task.__v);
    } catch (err) {
      if (err.code !== "INCOMPLETE_SUBTASKS") {
        toast.error(err.message);
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
    }
    await loadTasks();
  }
  async function handleAddTask(data) {
    const parent = subtaskParent;
    const destinationProject = parent?.project
      ? (typeof parent.project === "object" ? parent.project._id : parent.project)
      : id;
    if (suggestible) {
      await createSuggestion({ resourceType: "Task", op: "create", project: destinationProject, payload: { ...data, ...(parent ? { parentTask: parent._id } : {}) } });
      setShowTaskForm(false);
      setSubtaskParent(null);
      toast.success("Suggested — awaiting a writer's approval");
      return;
    }
    await createTask({ ...data, project: destinationProject, ...(parent ? { parentTask: parent._id } : {}) });
    setShowTaskForm(false);
    setSubtaskParent(null);
    await loadTasks();
  }
  async function handleDeleteTask(task) {
    const ok = await confirm({ title: "Move to trash", message: `Move "${task.title}" to trash?`, confirmLabel: "Move to trash", danger: true });
    if (!ok) return;
    try {
      await deleteTask(task._id);
      loadTasks();
    } catch (err) {
      toast.error(err.message);
    }
  }
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

  // P54: create/edit moved to NotePage — this list only still needs delete
  // (both roles, unchanged behavior).
  async function handleDeleteNote(note) {
    if (writable) {
      const ok = await confirm({ title: "Move to trash", message: `Move "${note.title}" to trash?`, confirmLabel: "Move to trash", danger: true });
      if (!ok) return;
      try {
        await deleteNote(note._id);
        await loadNotes();
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    if (suggestible) {
      const ok = await confirm({ title: "Suggest deletion", message: `Suggest deleting "${note.title}"?`, confirmLabel: "Suggest", danger: true });
      if (!ok) return;
      try {
        await createSuggestion({ resourceType: "Note", op: "delete", resource: note._id });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  if (status === "loading") return <p className="loading">Loading…</p>;
  if (status === "error") return <p>Could not load project. <Link to="/">← Overview</Link></p>;

  // P52 (ruling 12): `rawWritable` is the role's real permission, independent
  // of `mode` — the strip and the structural affordances that stay DIRECT in
  // suggesting mode (Move, Delete, tag colors) gate on this, not `writable`.
  const rawWritable = canWrite(project.effectiveRole);
  const writable = rawWritable && mode === "editing";
  // Pure suggesters AND a writer who's flipped to Suggesting: no direct write
  // right now, but content edits can still be proposed. Threaded down to the
  // same children that receive `writable` (W4 consumes it inside them).
  const suggestible = !writable && canSuggest(project.effectiveRole);
  // effectiveRole "owner" only fires when the caller owns THIS project's own
  // tenant (withEffectiveRole's short-circuit) — the same signal getMe's
  // ownsTenant answers, already in scope here without a second read.
  const ownsTenant = project.effectiveRole === "owner";
  const tenantId = tenantIdOf(project.superWorkspace);
  const taskRows = taskTree(tasks, sortMode, priorityFilter);
  const incomplete = taskRows.filter(({ task }) => !task.completed);
  const completed = taskRows.filter(({ task }) => task.completed);

  // Due & upcoming panel (P45-W2): same candidate rule as the backend's
  // /me/attention (not completed, and either due-bucketed or high priority)
  // over the already-loaded `tasks` list — sort/filter controls above are a
  // view-only concern and don't touch this. Goals mirror the same rule.
  const dueCandidateTasks = tasks.filter(
    (t) => !t.completed && (dueBucket(t.dueAt, t.dueHasTime) !== null || t.priority === "high")
  );
  const dueTaskGroups = [
    { key: "overdue", label: "Overdue", items: dueCandidateTasks.filter((t) => dueBucket(t.dueAt, t.dueHasTime) === "overdue") },
    { key: "today", label: "Due today", items: dueCandidateTasks.filter((t) => dueBucket(t.dueAt, t.dueHasTime) === "today") },
    { key: "week", label: "This week", items: dueCandidateTasks.filter((t) => dueBucket(t.dueAt, t.dueHasTime) === "week") },
    { key: "high", label: "High priority", items: dueCandidateTasks.filter((t) => t.priority === "high") },
  ];
  const dueGoals = goals.filter(
    (g) => !g.completed && (dueBucket(g.dueAt, g.dueHasTime) !== null || g.priority === "high")
  );
  const hasDueContent = dueTaskGroups.some((g) => g.items.length > 0) || dueGoals.length > 0;

  return (
    <>
      <Breadcrumbs
        ancestors={[
          { _id: project.workspace._id, name: project.workspace.name, kind: "workspace" },
          ...(project.ancestors || []).map((a) => ({ ...a, kind: "project" })),
        ]}
        current={project.name}
      />

      <div className="page-head">
        <h1>{project.name}</h1>
        <span>
          <button
            className="btn btn-ghost"
            title="View this project's revision history"
            onClick={() => setHistoryTarget({ resourceType: "Project", resourceId: project._id, canWrite: writable })}
          >
            History
          </button>
          {(writable || suggestible) && (
            <button
              className="btn btn-ghost"
              title={suggestible ? "Suggest a change to this project" : "Edit project details"}
              onClick={() => setEditingProject(true)}
            >
              Edit
            </button>
          )}
          {rawWritable && (
            <button className="btn btn-ghost" title="Move to a different project" onClick={openMoveModal}>Move</button>
          )}
          {rawWritable && (
            <button className="btn btn-ghost" onClick={handleArchiveProject}>{project.archivedAt ? "Restore" : "Archive"}</button>
          )}
          {rawWritable && (
            <button className="btn btn-danger" title="Move this project to trash" onClick={handleDeleteProject}>Delete</button>
          )}
        </span>
      </div>

      {project.tags?.length > 0 && (
        <div className="pcard-tags">
          {project.tags.map((t) => (
            <span key={t} className={`tag-chip c${resolveTagColor(t, tenantId, maps)}`}>
              {ownsTenant ? (
                <button
                  type="button"
                  className="tag-chip-label"
                  title="Change this tag's color"
                  onClick={() => setColorPopoverTag(colorPopoverTag === t ? null : t)}
                >
                  {t}
                </button>
              ) : (
                <span className="tag-chip-label">{t}</span>
              )}
              {ownsTenant && colorPopoverTag === t && (
                <TagColorPopover tag={t} tenantId={tenantId} onClose={() => setColorPopoverTag(null)} />
              )}
            </span>
          ))}
        </div>
      )}
      {project.effectiveRole !== "owner" && (
        <p className="shared-meta">
          in {project.workspace.name} · shared by {project.superWorkspace?.name} · your
          access: <span className={`role-chip ${project.effectiveRole}`}>{project.effectiveRole}</span>
        </p>
      )}
      <p className="page-desc content-readable">{project.description || "No description."}</p>
      <p><span className={`status-chip project-${project.status || "active"}`}>{project.archivedAt ? "Archived" : project.status || "active"}</span></p>

      <div className="views-row">
        <span className="views-caption">Views</span>
        <Link to={`/projects/${id}/roadmap`} className="views-link">
          Roadmap <span className="mini-label">Plan this project's goals</span>
        </Link>
        <span className="views-sep" />
        <Link to={`/projects/${id}/board`} className="views-link">
          Board <span className="mini-label">See tasks by status</span>
        </Link>
      </div>

      {suggestible && (
        <p className="propose-banner">You're suggesting — a writer reviews your changes.</p>
      )}

      <div className="section-label">Tasks · {incomplete.length}</div>
      <div className="projects-controls">
        <Dropdown ariaLabel="Sort tasks" value={sortMode} onChange={setSortMode} options={SORT_OPTIONS} />
        <Dropdown ariaLabel="Filter by priority" value={priorityFilter} onChange={setPriorityFilter} options={PRIORITY_FILTER_OPTIONS} />
      </div>
      <ul className="task-list" ref={incompleteListRef}>
        {incomplete.map(({ task, depth, childCount }) => (
          <TaskItem key={task._id} task={task} depth={depth} subtaskCount={childCount} canWrite={writable} canSuggest={suggestible} dragDisabled onToggle={handleToggle} onDelete={handleDeleteTask} onEdit={setEditingTask} onAddSubtask={(parent) => { setSubtaskParent(parent); setShowTaskForm(true); }} />
        ))}
      </ul>
      {(writable || suggestible) &&
        (showTaskForm ? (
          <TaskForm suggestMode={suggestible} onSubmit={handleAddTask} onCancel={() => { setShowTaskForm(false); setSubtaskParent(null); }} />
        ) : (
          <button className="add-inline" title={suggestible ? "Suggest a new task" : "Add a new task"} onClick={() => { setSubtaskParent(null); setShowTaskForm(true); }}>{suggestible ? "+ Suggest task" : "+ Task"}</button>
        ))}
      {completed.length > 0 && (
        <>
          <div className="section-label">Completed · {completed.length}</div>
          <ul className="task-list" ref={completedListRef}>
            {completed.map(({ task, depth, childCount }) => (
              <TaskItem key={task._id} task={task} depth={depth} subtaskCount={childCount} canWrite={writable} canSuggest={suggestible} dragDisabled onToggle={handleToggle} onDelete={handleDeleteTask} onEdit={setEditingTask} onAddSubtask={(parent) => { setSubtaskParent(parent); setShowTaskForm(true); }} />
            ))}
          </ul>
        </>
      )}

      <div className="section-label">Sub-projects{subProjects.length > 0 ? ` · ${subProjects.length}` : ""}</div>
      {subProjects.length > 0 && (
        <ul className="row-list">
          {subProjects.map((sp) => (
            <li key={sp._id}>
              <span className="glyph">▸</span>
              <Link to={`/projects/${sp._id}`} title={sp.name}>{sp.name}</Link>
            </li>
          ))}
        </ul>
      )}
      {(writable || suggestible) && (
        <button
          className="add-inline"
          title={suggestible ? "Suggest a new sub-project" : "Add a nested sub-project"}
          onClick={() => setShowSubProjectForm(true)}
        >
          {suggestible ? "+ Suggest sub-project" : "+ Sub-project"}
        </button>
      )}

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

      <div className="panel-band">
        {hasDueContent && (
          <div className="panel-section">
            <div className="section-label">Due &amp; upcoming</div>
            {dueTaskGroups.map((g) => g.items.length > 0 && (
              <div key={g.key}>
                <div className="section-label">{g.label}</div>
                {g.items.map((t) => <DueRow key={t._id} item={t} />)}
              </div>
            ))}
            {dueGoals.length > 0 && (
              <div>
                <div className="section-label">Goals</div>
                {dueGoals.map((g) => <DueRow key={g._id} item={g} href={`/projects/${id}/roadmap`} />)}
              </div>
            )}
          </div>
        )}
        <div className="panel-section">
          <SuggestionsPanel
            container={{ project: id }}
            effectiveRole={project.effectiveRole}
            onChange={() => { loadProject(); loadTasks(); loadNotes(); loadSubProjects(); }}
          />
        </div>
        <div className="panel-section">
          <div className="threecol">
            {/* P54: notes moved to their own page — this column is now a pure
                link list, same row styling as Links/Files below (glyph +
                .meta date, matching LinksSection's rows). */}
            <div>
              <div className="section-label">Notes · {notes.length}</div>
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={includeReferenceSubprojects}
                  onChange={async (event) => {
                    const include = event.target.checked;
                    setIncludeReferenceSubprojects(include);
                    setNotes(await getNotes({ project: id, includeSubprojects: include }));
                  }}
                />
                Include subprojects
              </label>
              <ul className="row-list">
                {notes.map((n) => (
                  <li key={n._id}>
                    <span className="glyph">▤</span>
                    <Link to={`/notes/${n._id}`} title={n.title}>{n.title}</Link>
                    <span className="meta">updated {new Date(n.updatedAt).toLocaleDateString()}</span>
                    {(writable || suggestible) && (
                      <button
                        className="delete-x"
                        aria-label={writable ? "Delete note" : "Suggest removal"}
                        title={writable ? "Delete note" : "Suggest removal"}
                        onClick={() => handleDeleteNote(n)}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {(writable || suggestible) && (
                <Link
                  className="add-inline"
                  to="/notes/new"
                  state={{ project: id }}
                  title={suggestible ? "Suggest a new note" : "Create a new note"}
                >
                  {suggestible ? "+ Suggest note" : "+ Note"}
                </Link>
              )}
            </div>
            <div>
              <LinksSection container={{ project: id, includeSubprojects: includeReferenceSubprojects }} canWrite={writable && !includeReferenceSubprojects} canSuggest={suggestible && !includeReferenceSubprojects} />
            </div>
            <div>
              <FilesSection container={{ project: id, includeSubprojects: includeReferenceSubprojects }} canWrite={writable && !includeReferenceSubprojects} canSuggest={suggestible && !includeReferenceSubprojects} />
            </div>
          </div>
        </div>
      </div>

      {editingTask && (
        <Modal
          title="Edit task"
          onClose={() => setEditingTask(null)}
          onDeliberateClose={() => { clearDraft(`task-edit:${editingTask._id}`); setEditingTask(null); }}
        >
          <TaskForm initial={editingTask} draftKey={`task-edit:${editingTask._id}`} suggestMode={suggestible} onSubmit={handleUpdateTask} onCancel={() => setEditingTask(null)} />
        </Modal>
      )}

      {editingProject && (
        <Modal
          title="Edit project"
          onClose={() => setEditingProject(false)}
          onDeliberateClose={() => { clearDraft(`project-edit:${project._id}`); setEditingProject(false); }}
        >
          <ProjectForm
            initial={project}
            draftKey={`project-edit:${project._id}`}
            submitLabel="Save"
            suggestMode={suggestible}
            tenantId={tenantId}
            canManageColors={ownsTenant}
            onSubmit={handleUpdateProject}
            onCancel={() => setEditingProject(false)}
          />
        </Modal>
      )}

      {showSubProjectForm && (
        <Modal
          title="New sub-project"
          onClose={() => setShowSubProjectForm(false)}
          onDeliberateClose={() => { clearDraft(`project-sub:${id}`); setShowSubProjectForm(false); }}
        >
          <ProjectForm
            draftKey={`project-sub:${id}`}
            suggestMode={suggestible}
            tenantId={tenantId}
            canManageColors={ownsTenant}
            onSubmit={handleCreateSubProject}
            onCancel={() => setShowSubProjectForm(false)}
          />
        </Modal>
      )}

      {historyTarget && (
        <HistoryModal
          resourceType={historyTarget.resourceType}
          resourceId={historyTarget.resourceId}
          canWrite={historyTarget.canWrite}
          onRestored={loadProject}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {showMoveModal && moveNodes && (
        <ProjectMoveModal
          project={project}
          workspaces={moveNodes.workspaces}
          projects={moveNodes.projects}
          onMove={handleMoveProject}
          onClose={() => setShowMoveModal(false)}
        />
      )}
    </>
  );
}
