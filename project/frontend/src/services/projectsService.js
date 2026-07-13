import { request } from "./api";

export const getProjects = (workspaceId) =>
  request(`/projects?workspace=${workspaceId}`).then((r) => r.data);
export const getProject = (id) => request(`/projects/${id}`).then((r) => r.data);

export const createProject = (data) =>
  request("/projects", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateProject = (id, patch) =>
  request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => r.data);

export const deleteProject = (id) =>
  request(`/projects/${id}`, { method: "DELETE" });
