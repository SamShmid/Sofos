import { request } from "./api";

// Accepts a bare projectId (existing call sites), { workspace } for a
// workspace's whole task list (board roll-up), or { project, deep } for a
// project's own tasks plus its sub-projects' (P34 board subtree) — same
// backward-compat trick as projectsService's getProjects.
export const getTasks = (arg) => {
  let qs;
  if (arg && typeof arg === "object") {
    qs = arg.workspace
      ? `workspace=${arg.workspace}`
      : `project=${arg.project}${arg.own ? "&own=1" : ""}`;
  } else {
    qs = `project=${arg}`;
  }
  return request(`/tasks?${qs}`).then((r) => r.data);
};
export const getTasksByWorkspace = (workspaceId) =>
  request(`/tasks?workspace=${workspaceId}`).then((r) => r.data);
export const getTask = (id) => request(`/tasks/${id}`).then((r) => r.data);

export const createTask = (data) =>
  request("/tasks", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const reorderTasks = (project, ids, parentTask = null) =>
  request("/tasks/reorder", { method: "POST", body: JSON.stringify({ project, parentTask, ids }) }).then((r) => r.data);

export const updateTask = (id, patch, ifVersion) =>
  request(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(ifVersion !== undefined ? { ...patch, ifVersion } : patch),
  }).then((r) => r.data);

export const deleteTask = (id) =>
  request(`/tasks/${id}`, { method: "DELETE" });
