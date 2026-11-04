import { useMemo, useState } from "react";
import Modal from "./Modal";

function idOf(ref) {
  return ref && typeof ref === "object" ? String(ref._id) : String(ref);
}

export default function ProjectMoveModal({ project, workspaces, projects, onMove, onClose }) {
  const [destination, setDestination] = useState(`workspace:${idOf(project.workspace)}`);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState(null);
  const blocked = useMemo(
    () => new Set([String(project._id), ...(projects.filter((p) => (p.ancestors || []).some((id) => String(id) === String(project._id))).map((p) => String(p._id)))]),
    [project, projects]
  );

  async function submit(event) {
    event.preventDefault();
    setMoving(true);
    setError(null);
    try {
      const [kind, id] = destination.split(":");
      await onMove(kind === "workspace" ? { parentProject: null, workspace: id } : { parentProject: id });
    } catch (err) {
      setError(err.message);
      setMoving(false);
    }
  }

  return (
    <Modal title="Move project" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <p role="alert">{error}</p>}
        <label>
          Destination
          <select value={destination} onChange={(event) => setDestination(event.target.value)}>
            {workspaces.map((workspace) => (
              <optgroup key={workspace._id} label={workspace.name}>
                <option value={`workspace:${workspace._id}`}>{workspace.name} root</option>
                {projects
                  .filter((candidate) => idOf(candidate.workspace) === String(workspace._id) && !blocked.has(String(candidate._id)) && !candidate.archivedAt)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((candidate) => <option key={candidate._id} value={`project:${candidate._id}`}>{candidate.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={moving}>Move project tree</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
