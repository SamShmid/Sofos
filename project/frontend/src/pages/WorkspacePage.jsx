import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { canSuggest, canWrite } from "../utils/roles";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useActiveWorkspace } from "../context/ActiveWorkspaceContext";
import { getWorkspace, updateWorkspace } from "../services/workspacesService";
import { archiveProject, createProject, getProjects, restoreProject } from "../services/projectsService";
import { createTask, deleteTask, getTasksByWorkspace, updateTask } from "../services/tasksService";
import { getNotes } from "../services/notesService";
import { createSuggestion } from "../services/suggestionsService";
import ProjectCard from "../components/ProjectCard";
import ProjectForm from "../components/ProjectForm";
import WorkspaceForm from "../components/WorkspaceForm";
import TaskForm from "../components/TaskForm";
import TaskItem from "../components/TaskItem";
import LinksSection from "../components/LinksSection";
import FilesSection from "../components/FilesSection";
import SuggestionsPanel from "../components/SuggestionsPanel";
import Modal from "../components/Modal";
import Breadcrumbs from "../components/Breadcrumbs";
import { clearDraft } from "../utils/draftStash";

function idOf(ref) {
  return ref && typeof ref === "object" ? String(ref._id) : ref ? String(ref) : null;
}

function taskTree(tasks) {
  const byParent = new Map();
  for (const task of tasks) {
    const key = idOf(task.parentTask) || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(task);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const rows = [];
  const visit = (task, depth) => {
    rows.push({ task, depth, childCount: (byParent.get(String(task._id)) || []).length });
    for (const child of byParent.get(String(task._id)) || []) visit(child, depth + 1);
  };
  for (const root of byParent.get("root") || []) visit(root, 0);
  return rows;
}

export default function WorkspacePage() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const { setActiveWorkspaceId } = useActiveWorkspace();
  const [workspace, setWorkspace] = useState(null);
  const [projects, setProjects] = useState([]);
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState("loading");
  const [tab, setTab] = useState("active");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [subtaskParent, setSubtaskParent] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [includeReferenceSubprojects, setIncludeReferenceSubprojects] = useState(false);
  const [activeTags, setActiveTags] = useState([]);

  const loadWorkspace = () => getWorkspace(id).then(setWorkspace);
  const loadProjects = () => Promise.all([
    getProjects(id),
    getProjects({ workspace: id, deep: true, archived: "only" }),
  ]).then(([active, archived]) => {
    setProjects(active);
    const archivedIds = new Set(archived.map((p) => String(p._id)));
    setArchivedProjects(archived.filter((p) => !p.parentProject || !archivedIds.has(String(p.parentProject))));
  });
  const loadTasks = () => getTasksByWorkspace(id).then(setTasks);
  const loadNotes = () => getNotes({ workspace: id, includeSubprojects: includeReferenceSubprojects }).then(setNotes);

  useEffect(() => {
    let ignore = false;
    setStatus("loading");
    Promise.all([
      getWorkspace(id),
      getProjects(id),
      getProjects({ workspace: id, deep: true, archived: "only" }),
      getTasksByWorkspace(id),
      getNotes({ workspace: id }),
    ]).then(([ws, active, archived, loadedTasks, loadedNotes]) => {
      if (ignore) return;
      setWorkspace(ws);
      setProjects(active);
      const archivedIds = new Set(archived.map((p) => String(p._id)));
      setArchivedProjects(archived.filter((p) => !p.parentProject || !archivedIds.has(String(p.parentProject))));
      setTasks(loadedTasks);
      setNotes(loadedNotes);
      setStatus("ready");
    }).catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
  }, [id]);

  useEffect(() => {
    if (status !== "ready") return;
    loadNotes().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeReferenceSubprojects]);

  useEffect(() => {
    if (!workspace) return;
    setActiveWorkspaceId({ id: workspace._id, name: workspace.name, ancestors: [] });
    return () => setActiveWorkspaceId(null);
  }, [workspace, setActiveWorkspaceId]);

  const writable = workspace && canWrite(workspace.effectiveRole);
  const suggestible = workspace && !writable && canSuggest(workspace.effectiveRole);
  const allTags = useMemo(() => [...new Set(projects.flatMap((p) => p.tags || []))].sort(), [projects]);
  const visibleProjects = projects.filter((p) => activeTags.length === 0 || (p.tags || []).some((tag) => activeTags.includes(tag)));
  const taskRows = useMemo(() => taskTree(tasks), [tasks]);

  async function handleCreateProject(data) {
    if (suggestible) {
      await createSuggestion({ resourceType: "Project", op: "create", workspace: id, payload: data });
      toast.success("Suggested for review");
    } else {
      await createProject({ ...data, workspace: id });
      await loadProjects();
    }
    setShowProjectForm(false);
  }

  async function handleArchive(project) {
    const ok = await confirm({
      title: "Archive project",
      message: `Archive "${project.name}" and all of its subprojects?`,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    try {
      await archiveProject(project._id);
      await Promise.all([loadProjects(), loadTasks(), loadNotes()]);
      toast.success("Project tree archived");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRestore(project) {
    try {
      await restoreProject(project._id);
      await Promise.all([loadProjects(), loadTasks(), loadNotes()]);
      toast.success("Project tree restored");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSaveWorkspace(data) {
    await updateWorkspace(id, data, workspace.__v);
    setShowWorkspaceForm(false);
    await loadWorkspace();
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

  async function handleCreateTask(data) {
    const parent = subtaskParent;
    const container = parent && idOf(parent.project) ? { project: idOf(parent.project) } : { workspace: id };
    if (suggestible) {
      await createSuggestion({
        resourceType: "Task",
        op: "create",
        ...container,
        payload: { ...data, ...(parent ? { parentTask: parent._id } : {}) },
      });
      toast.success("Suggested for review");
    } else {
      await createTask({ ...data, ...container, ...(parent ? { parentTask: parent._id } : {}) });
      await loadTasks();
    }
    setShowTaskForm(false);
    setSubtaskParent(null);
  }

  async function handleUpdateTask(data) {
    if (suggestible) {
      await createSuggestion({ resourceType: "Task", op: "update", resource: editingTask._id, payload: data });
      toast.success("Suggested for review");
    } else {
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
      await loadTasks();
    }
    setEditingTask(null);
  }

  async function handleDeleteTask(task) {
    const ok = await confirm({
      title: "Move task tree to trash",
      message: `Move "${task.title}" and its subtasks to Trash?`,
      confirmLabel: "Move to Trash",
      danger: true,
    });
    if (!ok) return;
    await deleteTask(task._id);
    await loadTasks();
  }

  if (status === "loading") return <p className="loading">Loading…</p>;
  if (status === "error") return <p>Could not load workspace. <Link to="/">Return to Overview</Link></p>;

  return (
    <section>
      <Breadcrumbs ancestors={[]} current={workspace.name} />
      <div className="page-head">
        <div>
          <h1>{workspace.name}</h1>
          {workspace.description && <p className="page-desc content-readable">{workspace.description}</p>}
        </div>
        {writable && <button className="btn btn-ghost" onClick={() => setShowWorkspaceForm(true)}>Edit workspace</button>}
      </div>

      <div className="views-row">
        <span className="views-caption">Views</span>
        <Link className="views-link" to={`/workspaces/${id}/roadmap`}>Roadmap</Link>
        <span className="views-sep" />
        <Link className="views-link" to={`/workspaces/${id}/board`}>Board</Link>
      </div>

      <div className="tab-row" role="tablist" aria-label="Project visibility">
        <button className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>Projects · {projects.length}</button>
        <button className={tab === "archived" ? "active" : ""} onClick={() => setTab("archived")}>Archived · {archivedProjects.length}</button>
      </div>

      {tab === "active" ? (
        <>
          {allTags.length > 0 && (
            <div className="tag-filter-bar">
              <span className="tag-filter-label">Filter by tag</span>
              {allTags.map((tag) => (
                <button key={tag} className={`tag-chip tag-chip-toggle${activeTags.includes(tag) ? " active" : ""}`} onClick={() => setActiveTags((current) => current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag])}>{tag}</button>
              ))}
            </div>
          )}
          <div className="grid">
            {visibleProjects.map((project) => <ProjectCard key={project._id} project={project} onArchive={handleArchive} />)}
            {(writable || suggestible) && <button className="pcard pcard-new" onClick={() => setShowProjectForm(true)}>+ New project</button>}
          </div>
        </>
      ) : (
        <div className="grid">
          {archivedProjects.map((project) => <ProjectCard key={project._id} project={project} onRestore={handleRestore} />)}
          {archivedProjects.length === 0 && <p className="empty">No archived projects.</p>}
        </div>
      )}

      <div className="section-label">Tasks · {tasks.length}</div>
      <ul className="task-list task-tree">
        {taskRows.map(({ task, depth, childCount }) => (
          <TaskItem
            key={task._id}
            task={task}
            depth={depth}
            subtaskCount={childCount}
            canWrite={writable}
            canSuggest={suggestible}
            dragDisabled
            onToggle={handleToggle}
            onDelete={handleDeleteTask}
            onEdit={setEditingTask}
            onAddSubtask={(parent) => { setSubtaskParent(parent); setShowTaskForm(true); }}
          />
        ))}
      </ul>
      {(writable || suggestible) && <button className="add-inline" onClick={() => { setSubtaskParent(null); setShowTaskForm(true); }}>+ Task</button>}

      <div className="section-label">Notes · {notes.length}</div>
      <label className="inline-toggle">
        <input type="checkbox" checked={includeReferenceSubprojects} onChange={(event) => setIncludeReferenceSubprojects(event.target.checked)} />
        Include subprojects
      </label>
      <ul className="row-list">
        {notes.map((note) => <li key={note._id}><span className="glyph">◇</span><Link to={`/notes/${note._id}`}>{note.title}</Link></li>)}
      </ul>
      {(writable || suggestible) && <Link className="add-inline" to="/notes/new" state={{ workspace: id }}>+ Note</Link>}

      <div className="panel-band">
        <div className="panel-section twocol">
          <LinksSection container={{ workspace: id, includeSubprojects: includeReferenceSubprojects }} canWrite={writable && !includeReferenceSubprojects} canSuggest={suggestible && !includeReferenceSubprojects} />
          <FilesSection container={{ workspace: id, includeSubprojects: includeReferenceSubprojects }} canWrite={writable && !includeReferenceSubprojects} canSuggest={suggestible && !includeReferenceSubprojects} />
        </div>
        <div className="panel-section">
          <SuggestionsPanel container={{ workspace: id }} effectiveRole={workspace.effectiveRole} onChange={() => Promise.all([loadWorkspace(), loadProjects(), loadTasks(), loadNotes()])} />
        </div>
      </div>

      {showProjectForm && (
        <Modal title="New project" onClose={() => setShowProjectForm(false)} onDeliberateClose={() => { clearDraft(`project-new:${id}`); setShowProjectForm(false); }}>
          <ProjectForm draftKey={`project-new:${id}`} suggestMode={suggestible} onSubmit={handleCreateProject} onCancel={() => setShowProjectForm(false)} />
        </Modal>
      )}
      {showWorkspaceForm && (
        <Modal title="Edit workspace" onClose={() => setShowWorkspaceForm(false)}>
          <WorkspaceForm initial={workspace} submitLabel="Save" onSubmit={handleSaveWorkspace} onCancel={() => setShowWorkspaceForm(false)} />
        </Modal>
      )}
      {showTaskForm && (
        <Modal title={subtaskParent ? `New subtask of ${subtaskParent.title}` : "New task"} onClose={() => { setShowTaskForm(false); setSubtaskParent(null); }}>
          <TaskForm suggestMode={suggestible} onSubmit={handleCreateTask} onCancel={() => { setShowTaskForm(false); setSubtaskParent(null); }} />
        </Modal>
      )}
      {editingTask && (
        <Modal title="Edit task" onClose={() => setEditingTask(null)}>
          <TaskForm initial={editingTask} suggestMode={suggestible} onSubmit={handleUpdateTask} onCancel={() => setEditingTask(null)} />
        </Modal>
      )}
    </section>
  );
}
