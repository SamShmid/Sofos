import { request } from "./api";

// The list is { owned, shared }. Every workspace is top-level. Shared items
// carry effectiveRole and a populated superWorkspace for the owner label.
export const getWorkspaces = () => request("/workspaces").then((r) => r.data);

// Single-resource responses carry effectiveRole next to data. Merge it onto
// the doc so components can read workspace.effectiveRole directly.
export const getWorkspace = (id) =>
  request(`/workspaces/${id}`).then((r) => ({ ...r.data, effectiveRole: r.effectiveRole }));

export const createWorkspace = (data) =>
  request("/workspaces", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateWorkspace = (id, patch, ifVersion) =>
  request(`/workspaces/${id}`, {
    method: "PATCH",
    body: JSON.stringify(ifVersion !== undefined ? { ...patch, ifVersion } : patch),
  }).then((r) => r.data);

export const deleteWorkspace = (id) =>
  request(`/workspaces/${id}`, { method: "DELETE" });
