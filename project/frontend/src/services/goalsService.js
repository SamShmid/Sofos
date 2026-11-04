import { request } from "./api";

export const getGoals = ({ workspace, project, own = false }) =>
  request(`/goals?${workspace ? `workspace=${workspace}` : `project=${project}`}${own ? "&own=1" : ""}`).then((r) => r.data);

export const getGoalsSummary = () => request("/goals/summary").then((r) => r.data);

export const createGoal = (data) =>
  request("/goals", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateGoal = (id, patch, ifVersion) =>
  request(`/goals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(ifVersion !== undefined ? { ...patch, ifVersion } : patch),
  }).then((r) => r.data);

export const reorderGoals = (container, ids) =>
  request("/goals/reorder", { method: "POST", body: JSON.stringify({ ...container, ids }) }).then((r) => r.data);

export const deleteGoal = (id) =>
  request(`/goals/${id}`, { method: "DELETE" });
