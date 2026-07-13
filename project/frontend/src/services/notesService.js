import { request } from "./api";

export const getNotes = (projectId) =>
  request(`/notes?project=${projectId}`).then((r) => r.data);
export const getNote = (id) => request(`/notes/${id}`).then((r) => r.data);

export const createNote = (data) =>
  request("/notes", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateNote = (id, patch) =>
  request(`/notes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => r.data);

export const deleteNote = (id) =>
  request(`/notes/${id}`, { method: "DELETE" });
