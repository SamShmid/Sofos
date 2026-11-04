import { request } from "./api";

export const getTrash = () => request("/trash").then((r) => r.data);

export const restoreFromTrash = (resourceType, id) =>
  request(`/trash/${resourceType}/${id}/restore`, { method: "POST" }).then((r) => r.data);

export const hardDelete = (resourceType, id) =>
  request(`/trash/${resourceType}/${id}`, { method: "DELETE" });
