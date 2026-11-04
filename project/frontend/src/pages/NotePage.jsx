import { useEffect, useRef, useState } from "react";
import { useParams, useLocation, useNavigate, Link, Navigate } from "react-router-dom";
import { canWrite, canSuggest } from "../utils/roles";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { useActiveWorkspace } from "../context/ActiveWorkspaceContext";
import NoteEditor from "../components/NoteEditor";
import NoteView from "../components/NoteView";
import HistoryModal from "../components/HistoryModal";
import Breadcrumbs from "../components/Breadcrumbs";
import { getNote, getNotes, createNote, deleteNote } from "../services/notesService";
import { getProject } from "../services/projectsService";
import { getWorkspace } from "../services/workspacesService";
import { createSuggestion, getSuggestions, onProposal } from "../services/suggestionsService";
import { listComments, onCommentChange } from "../services/commentsService";

// mock6: notes get their own route — full-width reading, a note-switcher
// sidebar (siblings in the same container), and the P52/P52.1 margin
// migrated in unchanged via NoteView. Two routes share this component:
// /notes/:id (view/edit an existing note) and /notes/new (create, container
// carried via router state — see App.jsx).
export default function NotePage() {
  const { id } = useParams();
  const isNew = !id;
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { setActiveWorkspaceId } = useActiveWorkspace();

  // Create mode's container arrives as router state, same bare-id shape as
  // every other `container` prop in the app ({ project: id } or { workspace:
  // id } — LinksSection/FilesSection/SuggestionsPanel's convention).
  const newProjectId = isNew ? location.state?.project ?? null : null;
  const newWorkspaceId = isNew ? location.state?.workspace ?? null : null;
  const hasNewContainerState = !!(newProjectId || newWorkspaceId);

  const [note, setNote] = useState(null);
  const [status, setStatus] = useState("loading");
  // Create mode's container detail fetch (name/ancestors/effectiveRole) — an
  // existing note gets all of this from its own populated project/workspace
  // fields instead (no separate fetch there).
  const [newContainer, setNewContainer] = useState(null);
  const [newContainerStatus, setNewContainerStatus] = useState("loading");
  const [switcherNotes, setSwitcherNotes] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [openCommentCount, setOpenCommentCount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  // P52 (ruling 12): a writer's own choice to propose instead of writing
  // directly — reset on a note switch, same as ProjectPage's mode.
  const [mode, setMode] = useState("editing");
  const switcherRef = useRef(null);
  // Imperative handle onto NoteView (P60) — the Propose button lives up here
  // (.note-page-actions, spec'd position) but the editor/draft it reads from
  // lives inside NoteView, so it's triggered through the ref instead of
  // lifting that whole machinery out of the component that owns it.
  const noteViewRef = useRef(null);

  const loadNote = () => getNote(id).then(setNote);

  useEffect(() => {
    if (isNew) return;
    let ignore = false;
    setStatus("loading");
    setMode("editing");
    getNote(id)
      .then((n) => { if (!ignore) { setNote(n); setStatus("ready"); } })
      .catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
  }, [id, isNew]);

  useEffect(() => {
    if (!isNew || !hasNewContainerState) return;
    let ignore = false;
    setNewContainerStatus("loading");
    const load = newProjectId
      ? getProject(newProjectId).then((data) => ({ kind: "project", data }))
      : getWorkspace(newWorkspaceId).then((data) => ({ kind: "workspace", data }));
    load
      .then((c) => { if (!ignore) { setNewContainer(c); setNewContainerStatus("ready"); } })
      .catch(() => { if (!ignore) setNewContainerStatus("error"); });
    return () => { ignore = true; };
  }, [isNew, hasNewContainerState, newProjectId, newWorkspaceId]);

  // A route swap (/notes/a -> /notes/b, or /notes/new -> the created note)
  // reuses this component instance, so `note` still holds the PREVIOUS note
  // for the frame before the load effect runs. Everything downstream —
  // container, switcher fetch deps, breadcrumbs — would silently describe the
  // wrong note, and the switcher would never refetch at all when both notes
  // share a container. Gate on identity, the same guard BoardPage uses for
  // its container (P50).
  const loaded = !isNew && note && note._id === id ? note : null;
  const newContainerId = newProjectId || newWorkspaceId;
  const loadedNewContainer =
    isNew && newContainer && newContainer.data._id === newContainerId ? newContainer : null;

  // Derive project/workspace identity from whichever mode is active. Fields
  // degrade gracefully to bare ids (name/ancestors omitted) if Writer B's
  // populate hasn't landed yet — never crashes, just renders what's there.
  let projectId = null, projectName = null, projectAncestors = null;
  let workspaceId = null, workspaceName = null, workspaceAncestors = null;
  let effectiveRole = null;

  if (loaded) {
    if (loaded.project && typeof loaded.project === "object") {
      projectId = loaded.project._id;
      projectName = loaded.project.name;
      projectAncestors = loaded.project.ancestors || [];
    } else if (loaded.project) {
      projectId = loaded.project;
    }
    if (loaded.workspace && typeof loaded.workspace === "object") {
      workspaceId = loaded.workspace._id;
      workspaceName = loaded.workspace.name;
      workspaceAncestors = loaded.workspace.ancestors || [];
    } else if (loaded.workspace) {
      workspaceId = loaded.workspace;
    }
    effectiveRole = loaded.effectiveRole;
  } else if (loadedNewContainer) {
    if (loadedNewContainer.kind === "project") {
      const p = loadedNewContainer.data;
      projectId = p._id;
      projectName = p.name;
      projectAncestors = p.ancestors || [];
      if (p.workspace && typeof p.workspace === "object") {
        workspaceId = p.workspace._id;
        workspaceName = p.workspace.name;
        workspaceAncestors = p.workspace.ancestors || [];
      } else if (p.workspace) {
        workspaceId = p.workspace;
      }
    } else {
      const w = loadedNewContainer.data;
      workspaceId = w._id;
      workspaceName = w.name;
      workspaceAncestors = w.ancestors || [];
    }
    effectiveRole = loadedNewContainer.data.effectiveRole;
  }

  const apiContainer = projectId ? { project: projectId } : workspaceId ? { workspace: workspaceId } : null;
  const containerPath = projectId ? `/projects/${projectId}` : workspaceId ? `/workspaces/${workspaceId}` : "/";
  const containerName = projectName || workspaceName || null;

  const loadSwitcherNotes = () =>
    apiContainer ? getNotes(apiContainer).then(setSwitcherNotes).catch(() => setSwitcherNotes([])) : Promise.resolve();

  useEffect(() => {
    if (!apiContainer) return;
    let ignore = false;
    getNotes(apiContainer)
      .then((ns) => { if (!ignore) setSwitcherNotes(ns); })
      .catch(() => { if (!ignore) setSwitcherNotes([]); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiContainer?.project, apiContainer?.workspace]);

  // note-meta's pending count — every pending suggestion on THIS note (not
  // just the content hunks NoteView's own margin fetches), so it stays
  // meaningful for a title-change/delete suggestion too.
  const loadPendingCount = () => {
    if (!apiContainer || isNew) { setPendingCount(0); return; }
    getSuggestions(apiContainer)
      .then((data) =>
        setPendingCount(data.filter((s) => s.resourceType === "Note" && String(s.resource?._id || s.resource) === String(id)).length)
      )
      .catch(() => {});
  };

  useEffect(() => {
    loadPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew, apiContainer?.project, apiContainer?.workspace]);

  useEffect(
    () => onProposal(() => loadPendingCount()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, isNew, apiContainer?.project, apiContainer?.workspace]
  );

  // note-meta's open-comment count — a suggestion approval can prune a
  // comment server-side (drift auto-delete), so it listens on both
  // notifiers, same as NoteView's own comment fetch (P55 §3).
  const loadOpenCommentCount = () => {
    if (isNew) { setOpenCommentCount(0); return; }
    listComments(id)
      .then((data) => setOpenCommentCount(data.filter((c) => c.status === "open").length))
      .catch(() => {});
  };

  useEffect(() => {
    loadOpenCommentCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  useEffect(
    () => onCommentChange(() => loadOpenCommentCount()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, isNew]
  );

  useEffect(
    () => onProposal(() => loadOpenCommentCount()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, isNew]
  );

  // Keep the active row visible in whichever rail the breakpoint produced —
  // the mobile collapse (a horizontal scroll row) otherwise hides the
  // you-are-here highlight off the right edge. Scrolls the rail itself, never
  // the document.
  useEffect(() => {
    const rail = switcherRef.current;
    const row = rail?.querySelector(".sw-row.active");
    if (!rail || !row) return;
    if (rail.scrollWidth > rail.clientWidth) {
      rail.scrollLeft = row.offsetLeft - (rail.clientWidth - row.offsetWidth) / 2;
    }
    if (rail.scrollHeight > rail.clientHeight) {
      rail.scrollTop = row.offsetTop - (rail.clientHeight - row.offsetHeight) / 2;
    }
  }, [id, switcherNotes]);

  // /notes/:id sits outside /workspaces/:id — same Sidebar handshake as
  // ProjectPage :234-244, exactly: deps on id only (name/ancestors travel
  // with it), object form so the sidebar can render the full nesting trail.
  useEffect(() => {
    if (!workspaceId) return;
    setActiveWorkspaceId({ id: workspaceId, name: workspaceName, ancestors: workspaceAncestors || [] });
    return () => setActiveWorkspaceId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, setActiveWorkspaceId]);

  async function handleCreateNote(data) {
    if (suggestible) {
      await createSuggestion({ resourceType: "Note", op: "create", ...apiContainer, payload: data });
      toast.success("Suggested — awaiting a writer's approval");
      navigate(containerPath);
      return;
    }
    const created = await createNote({ ...data, ...apiContainer });
    navigate(`/notes/${created._id}`, { replace: true });
  }

  // WRITER AUTOSAVE (P60): NoteView owns the debounce/flush state machine
  // and calls back here with the server's response on every successful save
  // — merged straight into `note`, never a loadNote() round-trip (the "no
  // refetch storm" rule). Only title/content/__v/updatedAt are taken from
  // the response, NOT the whole doc: unlike getOneNote, the PATCH endpoint
  // doesn't re-populate project/workspace, so a wholesale merge would
  // degrade `loaded.project`/`loaded.workspace` from the populated objects
  // the breadcrumb/switcher/sidebar read down to bare ids after the first
  // autosave. A COMMIT save is the only one that can have drift-pruned a
  // comment server-side, so only it refreshes the meta badge's open-comment
  // count (mirrors the old handleUpdateNote's "fires neither notifier —
  // refresh by hand" note, now commit-scoped).
  function handleNoteSaved(saved, { commit } = {}) {
    setNote((prev) =>
      prev && prev._id === saved._id
        ? { ...prev, title: saved.title, content: saved.content, __v: saved.__v, updatedAt: saved.updatedAt }
        : prev
    );
    if (commit) loadOpenCommentCount();
  }

  async function handleDeleteNote() {
    if (writable) {
      const ok = await confirm({ title: "Move to trash", message: `Move "${loaded.title}" to trash?`, confirmLabel: "Move to trash", danger: true });
      if (!ok) return;
      try {
        await deleteNote(loaded._id);
        toast.success("Moved to Trash — restorable from Trash");
        navigate(containerPath);
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    if (suggestible) {
      const ok = await confirm({ title: "Suggest deletion", message: `Suggest deleting "${loaded.title}"?`, confirmLabel: "Suggest", danger: true });
      if (!ok) return;
      try {
        await createSuggestion({ resourceType: "Note", op: "delete", resource: loaded._id });
        toast.success("Suggested — awaiting a writer's approval");
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  if (isNew && !hasNewContainerState) return <Navigate to="/" replace />;
  if (isNew && newContainerStatus === "error") return <p>Could not load. <Link to="/">← Overview</Link></p>;
  if (isNew && !loadedNewContainer) return <p className="loading">Loading…</p>;
  if (!isNew && status === "error") return <p>Could not load note. <Link to="/">← Overview</Link></p>;
  // Covers "loading" AND the frame where `note` is still the previous note.
  if (!isNew && !loaded) return <p className="loading">Loading…</p>;

  const rawWritable = canWrite(effectiveRole);
  const writable = rawWritable && mode === "editing";
  const suggestible = !writable && canSuggest(effectiveRole);

  const breadcrumbAncestors = [
    ...(workspaceId && workspaceName
      ? [
          ...(workspaceAncestors || []).map((a) => ({ ...a, kind: "workspace" })),
          { _id: workspaceId, name: workspaceName, kind: "workspace" },
        ]
      : []),
    ...(projectId && projectAncestors ? projectAncestors.map((a) => ({ ...a, kind: "project" })) : []),
    // The note's OWN container project closes the trail before the note title
    // (mock6: "Overview / P48 Demo / Launch site / Notes") — `current` is the
    // note, so unlike ProjectPage the project itself is still a link here.
    ...(projectId && projectName ? [{ _id: projectId, name: projectName, kind: "project" }] : []),
  ];

  return (
    <div className="note-layout">
      <aside className="note-switcher" ref={switcherRef}>
        <div className="sw-label">Notes{containerName ? ` · ${containerName}` : ""}</div>
        {switcherNotes.map((n) => (
          <Link
            key={n._id}
            to={`/notes/${n._id}`}
            className={"sw-row" + (n._id === id ? " active" : "")}
            title={n.title}
          >
            {n.title}
            <span className="m">upd. {new Date(n.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </Link>
        ))}
        {apiContainer && (
          <Link className="sw-add" to="/notes/new" state={apiContainer}>+ Note</Link>
        )}
      </aside>

      <main className="note-main">
        <Breadcrumbs ancestors={breadcrumbAncestors} current={isNew ? "New note" : loaded.title} />
        {isNew && (
          <p className="note-meta">
            {containerName && <>in {containerName} · </>}
            not yet created
          </p>
        )}

        {!isNew && (writable || suggestible) && (
          <div className="note-page-actions">
            {suggestible && (
              <button className="btn btn-primary" onClick={() => noteViewRef.current?.propose()}>
                Propose
              </button>
            )}
            <button
              className="btn btn-danger"
              title={writable ? "Move this note to trash" : "Suggest removing this note"}
              onClick={handleDeleteNote}
            >
              Delete
            </button>
          </div>
        )}

        {rawWritable && (
          <div className="mode-strip">
            <span className="mode-toggle">
              <button type="button" className={mode === "editing" ? "on" : undefined} aria-pressed={mode === "editing"} onClick={() => setMode("editing")}>Editing</button>
              <button type="button" className={mode === "suggesting" ? "on" : undefined} aria-pressed={mode === "suggesting"} onClick={() => setMode("suggesting")}>Suggesting</button>
            </span>
            <span className="mode-note">
              {mode === "editing"
                ? "You have edit access — flip to Suggesting and your changes become cards instead of landing directly."
                : "Suggesting — your changes become cards for review instead of landing directly. Flip back to Editing to edit directly."}
            </span>
          </div>
        )}

        {isNew ? (
          <NoteEditor
            key={`note-new:${projectId || workspaceId}`}
            draftKey={`note-new:${projectId || workspaceId}`}
            onSave={handleCreateNote}
            onCancel={() => navigate(containerPath)}
          />
        ) : (
          <NoteView
            ref={noteViewRef}
            note={loaded}
            canWrite={writable}
            canSuggest={suggestible}
            effectiveRole={effectiveRole}
            container={apiContainer}
            containerName={containerName}
            pendingCount={pendingCount}
            openCommentCount={openCommentCount}
            onHistory={() => setShowHistory(true)}
            onChange={() => { loadSwitcherNotes(); loadPendingCount(); return loadNote(); }}
            onNoteSaved={handleNoteSaved}
          />
        )}
      </main>

      {showHistory && (
        <HistoryModal
          resourceType="Note"
          resourceId={id}
          canWrite={writable}
          onRestored={() => { loadNote(); loadSwitcherNotes(); }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
