import { request } from "./api";

export const getTasks = (projectId) =>
  request(`/tasks?project=${projectId}`).then((r) => r.data);
export const getTask = (id) => request(`/tasks/${id}`).then((r) => r.data);

export const createTask = (data) =>
  request("/tasks", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateTask = (id, patch) =>
  request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((r) => r.data);

export const deleteTask = (id) =>
  request(`/tasks/${id}`, { method: "DELETE" });
