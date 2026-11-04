import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useRefresh } from "../context/RefreshContext";
import { useActiveWorkspace } from "../context/ActiveWorkspaceContext";
import { getWorkspaces, createWorkspace, deleteWorkspace } from "../services/workspacesService";
import Modal from "./Modal";
import WorkspaceForm from "./WorkspaceForm";
import { clearDraft } from "../utils/draftStash";

// New top-level workspace — no parent, so its draft key is fixed.
const NEW_WORKSPACE_DRAFT_KEY = "ws-new:root";

// Row styling + active state live on the NavLink itself (flex space-between per
// the vocabulary), matching the mock's flat <a> rows.
const rowClass = ({ isActive }) => `side-row${isActive ? " active" : ""}`;

// Workspace rows also light up from ActiveWorkspaceContext: project/roadmap/board
// routes live outside /workspaces/:id, so NavLink's own path match can't catch
// them — those pages report the owning workspace id there once loaded.
const workspaceRowClass = (workspaceId, activeWorkspaceId) => ({ isActive }) =>
  `side-row${isActive || (activeWorkspaceId && String(workspaceId) === String(activeWorkspaceId)) ? " active" : ""}`;

// Same active check, .side-home treatment instead of .side-row — the pinned
// default workspace never sits in the plain owned-rows list.
const homeRowClass = (workspaceId, activeWorkspaceId) => ({ isActive }) =>
  `side-home${isActive || (activeWorkspaceId && String(workspaceId) === String(activeWorkspaceId)) ? " active" : ""}`;

// Trail rows carry their own depth via --depth (TreePicker convention) rather
// than nesting indent on a wrapper, so a deep chain (top-level ancestor already
// shown above) can step in further per level.
const trailRowClass = (nodeId, activeWorkspaceId) => ({ isActive }) =>
  `side-trail-row${isActive || (activeWorkspaceId && String(nodeId) === String(activeWorkspaceId)) ? " active" : ""}`;

// The indented "you are here" path under a top-level workspace: everything in
// the trail after its root (the root itself is already rendered as the normal
// sidebar row above it) — one row per level, deepest is the active workspace.
function Trail({ rows, activeWorkspaceId, onNavigate }) {
  return (
    <div className="side-trail">
      {rows.map((node, i) => (
        <NavLink
          key={node._id}
          to={`/workspaces/${node._id}`}
          className={trailRowClass(node._id, activeWorkspaceId)}
          style={{ "--depth": i }}
          onClick={onNavigate}
          title={node.name}
        >
          {node.name}
        </NavLink>
      ))}
    </div>
  );
}

export default function Sidebar({ open, onNavigate }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshKey, bump } = useRefresh();
  const { activeWorkspaceId, activeWorkspaceTrail } = useActiveWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState({ owned: [], shared: [] });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    getWorkspaces().then(setWorkspaces).catch(() => setError("Could not load workspaces"));
  }
  useEffect(() => { load(); }, [refreshKey]);

  async function handleCreate(data) {
    await createWorkspace(data);
    setShowForm(false);
    load();
    bump(); // HomePage's Overview grid/count are keyed on refreshKey
  }

  async function handleDelete(w) {
    const ok = await confirm({
      title: "Move to trash",
      message: `Move "${w.name}" and everything in it to trash?`,
      confirmLabel: "Move to trash",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteWorkspace(w._id);
      load();
      bump();
      // A trashed workspace's own page would otherwise stay interactive as a ghost.
      if (location.pathname === `/workspaces/${w._id}` || location.pathname.startsWith(`/workspaces/${w._id}/`)) {
        navigate("/");
      }
      toast.success("Moved to Trash — restorable from Trash");
    } catch (err) {
      toast.error(err.message);
    }
  }

  // The default "Home" workspace is pinned separately from the rest of the
  // owned list — find it via isDefault rather than assuming list order.
  const homeWorkspace = workspaces.owned.find((w) => w.isDefault) || null;
  const otherOwned = workspaces.owned.filter((w) => !w.isDefault);

  // activeWorkspaceTrail is root-first, leaf last (the active workspace itself).
  // Its first entry is whichever top-level row (Home, or a plain owned/shared
  // one) the trail nests under; everything after that is the indented path —
  // only present when it has more than the root alone (i.e. actually nested).
  const trailRows = activeWorkspaceTrail && activeWorkspaceTrail.length > 1 ? activeWorkspaceTrail.slice(1) : null;
  const trailRootId = trailRows ? String(activeWorkspaceTrail[0]._id) : null;

  // A shared item that's already rendered as an indented Trail row under its
  // (also-shared) ancestor above must not ALSO render as its own standalone
  // "Shared" entry — bare-fetch shared can carry both a tenant-wide-grant
  // root AND a directly-granted descendant flat in the same list (P45 dedupe).
  const trailRowIds = trailRows ? new Set(trailRows.map((n) => String(n._id))) : null;
  const visibleShared = workspaces.shared.filter((w) => !trailRowIds?.has(String(w._id)));

  return (
    <nav className={`sidebar${open ? " open" : ""}`}>
      {error && <p role="alert">{error}</p>}

      {/* App-level landing link — styled apart from workspace rows so it can't
          be mistaken for the workspace named Home */}
      <NavLink
        to="/"
        end
        className={({ isActive }) => `side-overview${isActive ? " active" : ""}`}
        onClick={onNavigate}
      >
        Overview
      </NavLink>

      {/* Pinned directly beneath Overview, distinct from the rest of the owned
          list — resolves the Overview/Home/"workspace named Home" collision. */}
      {homeWorkspace && (
        <>
          <NavLink
            to={`/workspaces/${homeWorkspace._id}`}
            className={homeRowClass(homeWorkspace._id, activeWorkspaceId)}
            onClick={onNavigate}
            title={homeWorkspace.name}
          >
            {homeWorkspace.name}
          </NavLink>
          {trailRootId === String(homeWorkspace._id) && (
            <Trail rows={trailRows} activeWorkspaceId={activeWorkspaceId} onNavigate={onNavigate} />
          )}
        </>
      )}

      <p className="side-group-label" data-tour="workspaces">Workspaces</p>
      {/* Owned = your own tenant: you're the owner, so delete is always allowed */}
      {otherOwned.map((w) => (
        <div key={w._id}>
          <NavLink to={`/workspaces/${w._id}`} className={workspaceRowClass(w._id, activeWorkspaceId)} onClick={onNavigate} title={w.name}>
            {w.name}
            <button
              className="delete-x"
              aria-label="Delete workspace"
              title="Delete workspace"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(w); }}
            >
              ×
            </button>
          </NavLink>
          {trailRootId === String(w._id) && (
            <Trail rows={trailRows} activeWorkspaceId={activeWorkspaceId} onNavigate={onNavigate} />
          )}
        </div>
      ))}

      {/* Agents own no tenant, so there's nothing for them to create at this level */}
      {!user?.isAgent && (
        <button className="side-add" title="Create a new workspace" onClick={() => setShowForm(true)}>+ Workspace</button>
      )}

      {visibleShared.length > 0 && (
        <>
          <p className="side-group-label">Shared</p>
          {visibleShared.map((w) => (
            <div key={w._id}>
              <NavLink
                to={`/workspaces/${w._id}`}
                className={workspaceRowClass(w._id, activeWorkspaceId)}
                onClick={onNavigate}
                title={w.superWorkspace?.name ? `${w.name} — shared by ${w.superWorkspace.name}` : w.name}
              >
                {w.name}
                <span className="mini">{w.effectiveRole}</span>
              </NavLink>
              {trailRootId === String(w._id) && (
                <Trail rows={trailRows} activeWorkspaceId={activeWorkspaceId} onNavigate={onNavigate} />
              )}
            </div>
          ))}
        </>
      )}

      {showForm && (
        <Modal
          title="New workspace"
          onClose={() => setShowForm(false)}
          onDeliberateClose={() => { clearDraft(NEW_WORKSPACE_DRAFT_KEY); setShowForm(false); }}
        >
          <WorkspaceForm draftKey={NEW_WORKSPACE_DRAFT_KEY} onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </Modal>
      )}

      {/* Agents own no tenant, so there's no trash for them either */}
      {!user?.isAgent && (
        <>
          <p className="side-label">System</p>
          <NavLink to="/trash" className={rowClass} onClick={onNavigate} data-tour="trash" title="View trash">Trash</NavLink>
        </>
      )}
    </nav>
  );
}
