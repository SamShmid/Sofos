import { request } from "./api";

// Exactly one of project/workspace, same object-arg shape as getProjects'
// { parent }/{ workspace } forms — a project-scoped note filters by project,
// a workspace-level (project-less) note by workspace.
export const getNotes = ({ project, workspace, includeSubprojects = false }) =>
  request(`/notes?${project ? `project=${project}` : `workspace=${workspace}`}${includeSubprojects ? "&includeSubprojects=1" : ""}`).then((r) => r.data);

// Populated project/workspace (+ their ancestors) ride along on data for
// NotePage's breadcrumb trail and switcher; effectiveRole merges onto the doc
// like projectsService.getProject so components can read note.effectiveRole.
export const getNote = (id) =>
  request(`/notes/${id}`).then((r) => ({ ...r.data, effectiveRole: r.effectiveRole }));

export const createNote = (data) =>
  request("/notes", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

// Phase 60: autosave threads the LAST RESPONSE's __v as ifVersion (never a
// round-trip through getNote) and marks COMMIT points with `commit: true`
// (backend prunes drift-orphaned comments only then — PHASE_SPEC.md §4).
// Phase 61: `keepalive` is a fetch-level option, not part of the body — it
// lets NoteView's reload guard flush on beforeunload/pagehide and survive
// past the page unload.
export const updateNote = (id, patch, { ifVersion, commit, keepalive } = {}) =>
  request(`/notes/${id}`, {
    method: "PATCH",
    ...(keepalive ? { keepalive: true } : {}),
    body: JSON.stringify({
      ...patch,
      ...(ifVersion !== undefined ? { ifVersion } : {}),
      ...(commit ? { commit: true } : {}),
    }),
  }).then((r) => r.data);

export const deleteNote = (id) =>
  request(`/notes/${id}`, { method: "DELETE" });
