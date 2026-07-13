import { request } from "./api";

export const getWorkspaces = () => request("/workspaces").then((r) => r.data);
export const getWorkspace = (id) => request(`/workspaces/${id}`).then((r) => r.data);

export const createWorkspace = (data) =>
  request("/workspaces", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateWorkspace = (id, patch) =>
  request(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => r.data);

export const deleteWorkspace = (id) =>
  request(`/workspaces/${id}`, { method: "DELETE" });
