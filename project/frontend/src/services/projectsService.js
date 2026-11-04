import { request } from "./api";

// Within one workspace: flat list, each project annotated with effectiveRole.
// Accepts a bare workspaceId (top-level projects, existing call sites), { parent }
// for a project's sub-projects, or { workspace, deep } for that workspace's whole
// project tree at every depth (parentProject/ancestors ride along, unpopulated) —
// the Move/Organize picker. All are flat lists, same shape.
export const getProjects = (arg) => {
  let qs;
  if (arg && typeof arg === "object") {
    qs = arg.workspace
      ? `workspace=${arg.workspace}${arg.deep ? "&deep=1" : ""}${arg.archived ? `&archived=${arg.archived}` : ""}`
      : `parent=${arg.parent}${arg.archived ? `&archived=${arg.archived}` : ""}`;
  } else {
    qs = `workspace=${arg}`;
  }
  return request(`/projects?${qs}`).then((r) => r.data);
};

// Populated workspace/superWorkspace/ancestors ride along on data for the
// breadcrumb trail and the "shared by" line.
export const getProject = (id) =>
  request(`/projects/${id}`).then((r) => ({ ...r.data, effectiveRole: r.effectiveRole }));

// data holds exactly one of workspace | parentProject.
export const createProject = (data) =>
  request("/projects", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateProject = (id, patch, ifVersion) =>
  request(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(ifVersion !== undefined ? { ...patch, ifVersion } : patch),
  }).then((r) => r.data);

// parentProject: null re-parents to the project's own workspace root.
export const moveProject = (id, destination) =>
  request(`/projects/${id}/move`, {
    method: "POST",
    body: JSON.stringify(
      destination && typeof destination === "object"
        ? destination
        : { parentProject: destination }
    ),
  }).then((r) => r.data);

export const archiveProject = (id) =>
  request(`/projects/${id}/archive`, { method: "POST" }).then((r) => r.data);

export const restoreProject = (id) =>
  request(`/projects/${id}/restore`, { method: "POST" }).then((r) => r.data);

export const deleteProject = (id) =>
  request(`/projects/${id}`, { method: "DELETE" });
