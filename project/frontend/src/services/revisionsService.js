import { request } from "./api";

export const getRevisions = (resourceType, resourceId) =>
  request(`/revisions?resourceType=${resourceType}&resource=${resourceId}`).then((r) => r.data);

export const restoreRevision = (revisionId) =>
  request(`/revisions/${revisionId}/restore`, { method: "POST" }).then((r) => r.data);

export const clearRevisions = () =>
  request("/revisions", { method: "DELETE" }).then((r) => r.data);
