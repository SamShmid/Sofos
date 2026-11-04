import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useRefresh } from "../context/RefreshContext";
import { useMe } from "../context/MeContext";
import {
  getMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
  getMyInvites,
  acceptInvite,
  declineInvite,
} from "../services/membershipsService";
import { getWorkspaces } from "../services/workspacesService";
import { deleteAccount } from "../services/authService";
import { clearRevisions } from "../services/revisionsService";
import { getNotes, ackMe } from "../services/meService";
import { getStoredPref, applyPref } from "../theme";
import Modal from "../components/Modal";
import WhatsNewModal from "../components/WhatsNewModal";
import Dropdown from "../components/Dropdown";

// Matches Layout's REPLAY_TOUR_KEY — no shared constants module for a single
// sessionStorage flag, so the literal is repeated on both sides.
const REPLAY_TOUR_KEY = "sofos.replayTour";

const EMPTY_FORM = { shareCode: "", role: "reader", scope: "workspace", target: "" };

const MEMBER_ROLE_OPTIONS = [
  { value: "reader", label: "reader" },
  { value: "suggester", label: "suggester" },
  { value: "writer", label: "writer" },
];
const ACCESS_ROLE_OPTIONS = [
  { value: "reader", label: "reader — can view" },
  { value: "suggester", label: "suggester — can view and propose" },
  { value: "writer", label: "writer — can view and edit" },
];
const SCOPE_OPTIONS = [
  { value: "workspace", label: "one workspace" },
  { value: "none", label: "everything I own" },
];

// Human description of what a grant covers, reused by rows and the confirm step.
function scopeLabel(m) {
  if (m.workspace) return `workspace "${m.workspace.name}"`;
  return "everything you own";
}

// Same idea from the recipient's side — the "everything" case belongs to the owner, not "you".
function inviteScopeLabel(inv) {
  if (inv.workspace) return `workspace "${inv.workspace.name}"`;
  return "everything they own";
}

function formatDate(d) {
  return new Date(d).toLocaleDateString();
}

export default function SettingsPage() {
  const accessLabelId = useId();
  const scopeLabelId = useId();
  const workspaceTargetLabelId = useId();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { bump } = useRefresh();
  const { me, setMe } = useMe(); // Layout's getMe payload (P32 — no more duplicate fetch here)
  const [copied, setCopied] = useState(false);
  const [whatsNewNotes, setWhatsNewNotes] = useState(null); // full history, fetched on demand

  const [memberships, setMemberships] = useState([]);
  const [invites, setInvites] = useState([]);
  const [ownedWorkspaces, setOwnedWorkspaces] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(null); // grant awaiting the confirm step
  const [expiresDate, setExpiresDate] = useState(""); // optional "Expires" input for the confirm step
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null); // share-form-only feedback, rendered next to Share…
  const [confirmingGrant, setConfirmingGrant] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadMemberships = () => getMemberships().then(setMemberships);
  const loadInvites = () => getMyInvites().then(setInvites);

  useEffect(() => {
    if (user?.isAgent) return; // agents own no tenant — nothing to manage
    Promise.all([loadMemberships(), loadInvites(), getWorkspaces()])
      .then(([, , ws]) => {
        setOwnedWorkspaces(ws.owned);
      })
      .catch(() => setError("Could not load sharing settings"));
  }, [user]);

  // Fetches the full notes history (not getMe's since-lastSeen whatsNew, which
  // is empty once acked) the first time the button is pressed, then opens it.
  function openWhatsNew() {
    getNotes()
      .then((data) => setWhatsNewNotes(data))
      .catch(() => setWhatsNewNotes([]));
  }

  function replayTour() {
    sessionStorage.setItem(REPLAY_TOUR_KEY, "true");
    navigate("/");
  }

  const currentTheme = me?.themePref ?? getStoredPref();

  // Optimistic: paint immediately, then persist server-side; a failed ack
  // reverts the paint and surfaces a toast rather than leaving the UI ahead
  // of what the server actually has.
  function handleThemeChange(next) {
    const previous = currentTheme;
    applyPref(next);
    ackMe({ themePref: next })
      .then(() => setMe({ ...me, themePref: next }))
      .catch((err) => {
        applyPref(previous);
        toast.error(err.message);
      });
  }

  function flashCopied() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Classic hidden-textarea + execCommand copy. Used both when the async
  // Clipboard API is absent (real insecure origins) AND when it's present but
  // rejects the write (localhost is a "secure context" so the API exists, yet
  // writeText can still be denied when the permission isn't granted) — the
  // rejection path must fall through here, not just error out.
  function legacyCopy() {
    const textarea = document.createElement("textarea");
    textarea.value = user.shareCode;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const ok = document.execCommand("copy");
      if (ok) flashCopied();
      else toast.error("Could not copy share code");
    } catch {
      toast.error("Could not copy share code");
    } finally {
      textarea.remove();
    }
  }

  function copyCode() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(user.shareCode)
        .then(flashCopied)
        .catch(legacyCopy); // API present but write denied → fall back, don't just fail
      return;
    }
    legacyCopy();
  }

  // Step 1: the form only STAGES the grant; nothing is created yet. The submit
  // button stays disabled while invalid (see shareFormMissing below), so this
  // guard is a defensive fallback, not the primary validation path.
  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    if (shareFormMissing) return;
    setPending(form);
  }

  // Step 2: only the explicit confirmation actually creates it.
  async function confirmGrant() {
    setConfirmingGrant(true);
    setFormError(null);
    try {
      const { shareCode, role, scope, target } = pending;
      // Date input gives "YYYY-MM-DD"; pin it to midnight UTC of that day for a
      // consistent, timezone-independent ISO instant.
      const expiresAt = expiresDate ? new Date(`${expiresDate}T00:00:00.000Z`).toISOString() : undefined;
      await createMembership({
        shareCode: shareCode.trim().toUpperCase(),
        role,
        scope,
        ...(scope !== "none" ? { target } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
      setPending(null);
      setForm(EMPTY_FORM);
      setExpiresDate("");
      await loadMemberships();
    } catch (err) {
      setPending(null);
      setExpiresDate("");
      setFormError(err.message);
    } finally {
      setConfirmingGrant(false);
    }
  }

  async function handleRoleChange(m, role) {
    try {
      await updateMembership(m._id, role);
      loadMemberships();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRevoke(m) {
    const ok = await confirm({
      title: "Revoke access",
      message: `Revoke ${m.user.username}'s access to ${scopeLabel(m)}?`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMembership(m._id);
      loadMemberships();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Accepting flips a grant live: it now affects the sidebar's shared-workspace list,
  // which only fetches on mount — bump() tells RefreshContext consumers to reload.
  async function handleAcceptInvite(inv) {
    try {
      await acceptInvite(inv._id);
      setInvites((prev) => prev.filter((i) => i._id !== inv._id));
      bump();
      toast.success("Invite accepted");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDeclineInvite(inv) {
    try {
      await declineInvite(inv._id);
      setInvites((prev) => prev.filter((i) => i._id !== inv._id));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleClearRevisions() {
    const ok = await confirm({
      title: "Clear revision history",
      message: "Permanently delete all edit history? Documents themselves are untouched.",
      confirmLabel: "Clear history",
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await clearRevisions();
      toast.success(`Cleared ${result.deleted} revisions`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function closeDeleteModal() {
    setShowDeleteModal(false);
    setDeletePassword("");
    setDeleteError(null);
  }

  async function handleDeleteAccount() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAccount(deletePassword);
      logout();
      navigate("/login");
    } catch (err) {
      setDeleting(false);
      if (err.status === 401) {
        setDeletePassword("");
        setDeleteError("Wrong password");
      } else {
        setDeleteError(err.message);
      }
    }
  }

  // Drives both the disabled state and the .hint copy — "what's missing" is
  // always visible, not just after a failed submit attempt.
  const shareFormMissing = !form.shareCode.trim()
    ? "Enter their share code."
    : form.scope !== "none" && !form.target
    ? "Pick what to share."
    : null;

  const pendingTargetName = pending && ownedWorkspaces.find((w) => w._id === pending.target)?.name;

  return (
    <section>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="section-label">Your share code</div>
      <p>
        Others use this code to share their workspaces with you — and
        you'll ask for theirs to share yours. It identifies your account and never
        changes; it can't be used to log in.
      </p>
      <p>
        <span className="share-code">{user.shareCode}</span>{" "}
        <button className="btn btn-ghost" onClick={copyCode}>{copied ? "Copied!" : "Copy"}</button>
      </p>

      <div className="section-label">Appearance</div>
      <p>
        <button
          type="button"
          className={`btn ${currentTheme === "light" ? "btn-primary" : "btn-ghost"}`}
          aria-pressed={currentTheme === "light"}
          onClick={() => handleThemeChange("light")}
        >
          Light
        </button>{" "}
        <button
          type="button"
          className={`btn ${currentTheme === "dark" ? "btn-primary" : "btn-ghost"}`}
          aria-pressed={currentTheme === "dark"}
          onClick={() => handleThemeChange("dark")}
        >
          Dark
        </button>{" "}
        <button
          type="button"
          className={`btn ${currentTheme === "system" ? "btn-primary" : "btn-ghost"}`}
          aria-pressed={currentTheme === "system"}
          onClick={() => handleThemeChange("system")}
        >
          System
        </button>
      </p>
      <p className="hint">System follows your device.</p>

      <div className="section-label">About</div>
      <p className="hint">Sofos {me ? me.version.current : "…"}</p>
      <p>
        <button className="btn btn-ghost" onClick={openWhatsNew}>
          What's new
        </button>{" "}
        {!user.isAgent && (
          <button className="btn btn-ghost" onClick={replayTour}>Replay tour</button>
        )}
      </p>
      {whatsNewNotes && (
        <WhatsNewModal entries={whatsNewNotes} viewOnly onClose={() => setWhatsNewNotes(null)} />
      )}

      {!user.isAgent && invites.length > 0 && (
        <>
          <div className="section-label">Invites · {invites.length}</div>
          <ul className="member-list">
            {invites.map((inv) => {
              const owner = inv.superWorkspace?.owner?.username || "Someone";
              return (
                <li key={inv._id} className="member-row">
                  <span>
                    {owner} invites you to {inviteScopeLabel(inv)} as <strong>{inv.role}</strong>
                    {inv.expiresAt && <span className="hint"> · expires {formatDate(inv.expiresAt)}</span>}
                  </span>
                  <span className="member-actions">
                    <button className="btn btn-ghost" onClick={() => handleAcceptInvite(inv)}>Accept</button>
                    <button className="btn btn-ghost" onClick={() => handleDeclineInvite(inv)}>Decline</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!user.isAgent && (
        <>
          <div className="section-label">Sharing · {memberships.length}</div>
          {error && <p role="alert">{error}</p>}

          {memberships.length === 0 ? (
            <p>You haven't shared anything yet.</p>
          ) : (
            <ul className="member-list">
              {memberships.map((m) => {
                const expired = m.expiresAt && new Date(m.expiresAt) <= new Date();
                return (
                  <li key={m._id} className="member-row">
                    <span>
                      <strong>{m.user.username}</strong>
                      {m.user.isAgent && " (agent)"} — {scopeLabel(m)}
                      {expired ? (
                        <span className="status-chip expired">expired</span>
                      ) : m.status === "pending" ? (
                        <span className="status-chip pending">pending</span>
                      ) : null}
                      {m.expiresAt && <span className="hint"> · expires {formatDate(m.expiresAt)}</span>}
                    </span>
                    <span className="member-actions">
                      <Dropdown
                        ariaLabel={"Role for " + m.user.username}
                        value={m.role}
                        onChange={(role) => handleRoleChange(m, role)}
                        options={MEMBER_ROLE_OPTIONS}
                      />
                      <button className="delete-x" aria-label="Revoke" onClick={() => handleRevoke(m)}>×</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <h4>Share with someone</h4>
          <form onSubmit={handleSubmit} className="share-form">
            <label>
              Their share code
              <input
                value={form.shareCode}
                onChange={(e) => setForm({ ...form, shareCode: e.target.value })}
                placeholder="SF-XXXXXXXX"
              />
            </label>

            <label>
              <span id={accessLabelId}>Access</span>
              <Dropdown
                labelledBy={accessLabelId}
                value={form.role}
                onChange={(role) => setForm({ ...form, role })}
                options={ACCESS_ROLE_OPTIONS}
              />
            </label>

            <label>
              <span id={scopeLabelId}>What to share</span>
              <Dropdown
                labelledBy={scopeLabelId}
                value={form.scope}
                onChange={(scope) => setForm({ ...form, scope, target: "" })}
                options={SCOPE_OPTIONS}
              />
            </label>

            {form.scope === "workspace" && (
              <label>
                <span id={workspaceTargetLabelId}>Workspace</span>
                <Dropdown
                  labelledBy={workspaceTargetLabelId}
                  value={form.target}
                  onChange={(target) => setForm({ ...form, target })}
                  options={[
                    { value: "", label: "— pick a workspace —" },
                    ...ownedWorkspaces.map((w) => ({ value: w._id, label: w.name })),
                  ]}
                />
              </label>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={!!shareFormMissing}>Share…</button>
              {formError ? (
                <p role="alert">{formError}</p>
              ) : (
                shareFormMissing && <p className="hint">{shareFormMissing}</p>
              )}
            </div>
          </form>

          {pending && (
            <Modal title="Confirm sharing" onClose={() => { setPending(null); setExpiresDate(""); }}>
              {pending.scope === "none" ? (
                <p>
                  <strong>This grants {pending.role} access to EVERYTHING you own</strong> —
                  including your private Home workspace — and automatically covers
                  anything you create in the future. Are you sure?
                </p>
              ) : (
                <p>
                  Give <strong>{pending.role}</strong> access to the {pending.scope}{" "}
                  <strong>{pendingTargetName}</strong> to the account{" "}
                  <strong>{pending.shareCode.trim().toUpperCase()}</strong>?
                </p>
              )}
              <label>
                Expires (optional)
                <input
                  type="date"
                  value={expiresDate}
                  onChange={(e) => setExpiresDate(e.target.value)}
                />
              </label>
              <p className="hint">Recipient must accept this invite before it grants any access.</p>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={confirmGrant} disabled={confirmingGrant}>Yes, share</button>
                <button className="btn btn-ghost" onClick={() => { setPending(null); setExpiresDate(""); }}>Cancel</button>
              </div>
            </Modal>
          )}
        </>
      )}

      {!user.isAgent && (
        <div className="danger-zone">
          <div className="section-label">Clear revision history</div>
          <p>Permanently deletes all edit history for everything you own. Documents themselves are untouched.</p>
          <button className="btn btn-danger" onClick={handleClearRevisions}>
            Clear revision history
          </button>
        </div>
      )}

      {!user.isAgent && (
        <div className="danger-zone">
          <div className="section-label">Danger zone</div>
          <p>
            Permanently deletes your account and everything in it. Your data is
            exported to a server-side backup first.
          </p>
          <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>
            Delete my account
          </button>
        </div>
      )}

      {showDeleteModal && (
        <Modal title="Delete your account" onClose={closeDeleteModal}>
          <p>
            <strong>
              This permanently deletes your account, tenant, and everything in
              it. This cannot be undone from the app.
            </strong>
          </p>
          {deleteError && <p role="alert">{deleteError}</p>}
          <label>
            Confirm your password
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoFocus
            />
          </label>
          <div className="form-actions">
            <button
              className="btn btn-danger"
              onClick={handleDeleteAccount}
              disabled={deleting || !deletePassword}
            >
              Yes, delete my account
            </button>
            <button className="btn btn-ghost" onClick={closeDeleteModal}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
