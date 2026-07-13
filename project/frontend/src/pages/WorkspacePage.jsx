import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getWorkspace } from "../services/workspacesService";
import { getProjects, createProject, deleteProject } from "../services/projectsService";
import ProjectCard from "../components/ProjectCard";
import Modal from "../components/Modal";
import ProjectForm from "../components/ProjectForm";

export default function WorkspacePage() {
  const { id } = useParams();
  const { isWriter } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState("loading");

  const loadProjects = () => getProjects(id).then(setProjects);

  useEffect(() => {
    setStatus("loading");
    Promise.all([getWorkspace(id), getProjects(id)])
      .then(([ws, pr]) => { setWorkspace(ws); setProjects(pr); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, [id]);

  async function handleCreate(data) {
    await createProject({ ...data, workspace: id });
    setShowForm(false);
    loadProjects();
  }

  async function handleDelete(pid) {
    if (!window.confirm("Delete this project and everything in it?")) return;
    await deleteProject(pid);
    loadProjects();
  }

  if (status === "loading") return <p>Loading…</p>;
  if (status === "error") return <p>Could not load workspace.</p>;

  return (
    <section>
      <h2>{workspace.name}</h2>
      {workspace.description && <p>{workspace.description}</p>}

      <div className="project-grid">
        {projects.map((p) => (
          <ProjectCard key={p._id} project={p} onDelete={handleDelete} />
        ))}
      </div>

      {isWriter && (
        <button className="add-btn" onClick={() => setShowForm(true)}>+ New project</button>
      )}

      {showForm && (
        <Modal title="New project" onClose={() => setShowForm(false)}>
          <ProjectForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </Modal>
      )}
    </section>
  );
}
