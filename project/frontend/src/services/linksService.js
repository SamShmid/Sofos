import { request } from "./api";

export const getLinks = ({ workspace, project, includeSubprojects = false }) =>
  request(`/links?${workspace ? `workspace=${workspace}` : `project=${project}`}${includeSubprojects ? "&includeSubprojects=1" : ""}`).then((r) => r.data);

export const createLink = (data) =>
  request("/links", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateLink = (id, patch, ifVersion) =>
  request(`/links/${id}`, {
    method: "PATCH",
    body: JSON.stringify(ifVersion !== undefined ? { ...patch, ifVersion } : patch),
  }).then((r) => r.data);

export const reorderLinks = (container, ids) =>
  request("/links/reorder", { method: "POST", body: JSON.stringify({ ...container, ids }) }).then((r) => r.data);

export const deleteLink = (id) =>
  request(`/links/${id}`, { method: "DELETE" });
