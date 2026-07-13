import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Header from "../components/Header";
import Footer from "../components/Footer";
import TaskItem from "../components/TaskItem";
import TaskForm from "../components/TaskForm";
import NoteEditor from "../components/NoteEditor";
import NoteView from "../components/NoteView";
import { getProject } from "../services/projectsService";
import { getWorkspace } from "../services/workspacesService";
import { getTasks, createTask, updateTask, deleteTask } from "../services/tasksService";
import { getNotes, createNote, updateNote, deleteNote } from "../services/notesService";

export default function ProjectPage() {
  const { id } = useParams();
  const { isWriter } = useAuth();

  const [project, setProject] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState("loading");

  // What the right pane shows: the project description, a note, or a blank new note.
  const [view, setView] = useState({ kind: "description" });
  const [editing, setEditing] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);

  const loadTasks = () => getTasks(id).then(setTasks);
  const loadNotes = () => getNotes(id).then(setNotes);

  useEffect(() => {
    setStatus("loading");
    setView({ kind: "description" });
    setEditing(false);
    Promise.all([getProject(id), getTasks(id), getNotes(id)])
      .then(async ([p, t, n]) => {
        setProject(p);
        setTasks(t);
        setNotes(n);
        setWorkspace(await getWorkspace(p.workspace));
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [id]);

  async function handleToggle(task) {
    await updateTask(task._id, { completed: !task.completed });
    loadTasks();
  }
  async function handleAddTask(data) {
    await createTask({ ...data, project: id });
    setShowTaskForm(false);
    loadTasks();
  }
  async function handleDeleteTask(tid) {
    if (!window.confirm("Delete this task?")) return;
    await deleteTask(tid);
    loadTasks();
  }

  async function handleCreateNote(data) {
    const created = await createNote({ ...data, project: id });
    await loadNotes();
    setView({ kind: "note", id: created._id });
  }
  async function handleUpdateNote(data) {
    const updated = await updateNote(view.id, data);
    await loadNotes();
    setView({ kind: "note", id: updated._id });
    setEditing(false);
  }
  async function handleDeleteNote(nid) {
    if (!window.confirm("Delete this note?")) return;
    await deleteNote(nid);
    await loadNotes();
    if (view.kind === "note" && view.id === nid) setView({ kind: "description" });
  }

  if (status === "loading") return <p>Loading…</p>;
  if (status === "error") return <p>Could not load project.</p>;

  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);
  const selectedNote = view.kind === "note" ? notes.find((n) => n._id === view.id) : null;

  return (
    <div className="app">
      <Header />
      <div className="app-body">
        <aside className="project-stack">
          <Link to={`/workspaces/${project.workspace}`}>← {workspace?.name || "Back"}</Link>

          <button
            className={`project-title-btn ${view.kind === "description" ? "selected" : ""}`}
            onClick={() => { setView({ kind: "description" }); setEditing(false); }}
          >
            {project.name}
          </button>

          <h3>Tasks</h3>
          {isWriter &&
            (showTaskForm ? (
              <TaskForm onSubmit={handleAddTask} onCancel={() => setShowTaskForm(false)} />
            ) : (
              <button className="add-btn" onClick={() => setShowTaskForm(true)}>+ Task</button>
            ))}
          <ul className="task-list">
            {incomplete.map((t) => (
              <TaskItem key={t._id} task={t} onToggle={handleToggle} onDelete={handleDeleteTask} />
            ))}
          </ul>
          {completed.length > 0 && (
            <>
              <h4>Completed</h4>
              <ul className="task-list">
                {completed.map((t) => (
                  <TaskItem key={t._id} task={t} onToggle={handleToggle} onDelete={handleDeleteTask} />
                ))}
              </ul>
            </>
          )}

          <h3>Notes</h3>
          <ul className="note-list">
            {notes.map((n) => (
              <li key={n._id} className="note-list-item">
                <button
                  className={selectedNote?._id === n._id ? "selected" : ""}
                  onClick={() => { setView({ kind: "note", id: n._id }); setEditing(false); }}
                >
                  {n.title}
                </button>
                {isWriter && (
                  <button className="delete-x" aria-label="Delete note" onClick={() => handleDeleteNote(n._id)}>×</button>
                )}
              </li>
            ))}
          </ul>
          {isWriter && (
            <button className="add-btn" onClick={() => { setView({ kind: "new-note" }); setEditing(false); }}>+ Note</button>
          )}
        </aside>

        <main className="project-main">
          {view.kind === "description" && (
            <>
              <h2>{project.name}</h2>
              <p>{project.description || "No description."}</p>
            </>
          )}

          {view.kind === "new-note" && (
            <NoteEditor onSave={handleCreateNote} onCancel={() => setView({ kind: "description" })} />
          )}

          {view.kind === "note" && selectedNote &&
            (editing ? (
              <NoteEditor initial={selectedNote} onSave={handleUpdateNote} onCancel={() => setEditing(false)} />
            ) : (
              <NoteView note={selectedNote} onEdit={() => setEditing(true)} />
            ))}
          {view.kind === "note" && !selectedNote && <p>Note not found.</p>}
        </main>
      </div>
      <Footer />
    </div>
  );
}
