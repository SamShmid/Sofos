import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getWorkspaces, createWorkspace, deleteWorkspace } from "../services/workspacesService";
import Modal from "./Modal";
import WorkspaceForm from "./WorkspaceForm";

export default function Sidebar() {
  const { isWriter } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    getWorkspaces().then(setWorkspaces).catch(() => setError("Could not load workspaces"));
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(data) {
    await createWorkspace(data);
    setShowForm(false);
    load();
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this workspace and everything in it?")) return;
    await deleteWorkspace(id);
    load();
  }

  return (
    <nav className="sidebar">
      {error && <p role="alert">{error}</p>}
      <ul className="workspace-list">
        {workspaces.map((w) => (
          <li key={w._id} className="workspace-bubble">
            <NavLink to={`/workspaces/${w._id}`}>{w.name}</NavLink>
            {isWriter && !w.isDefault && (
              <button className="delete-x" onClick={() => handleDelete(w._id)} aria-label="Delete workspace">×</button>
            )}
          </li>
        ))}
      </ul>

      {isWriter && (
        <button className="add-btn" onClick={() => setShowForm(true)} aria-label="Add workspace">+</button>
      )}

      {showForm && (
        <Modal title="New workspace" onClose={() => setShowForm(false)}>
          <WorkspaceForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </Modal>
      )}
    </nav>
  );
}
