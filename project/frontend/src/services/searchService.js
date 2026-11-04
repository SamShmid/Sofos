import { request } from "./api";

// Response shape is `{ data: { workspaces, projects, tasks, notes, goals }, total }`
// — total sits beside data, not inside it, so flatten it onto the group object
// here rather than unwrapping to just `r.data` like every other service.
export const search = (q) =>
  request(`/search?q=${encodeURIComponent(q)}`).then((r) => ({ ...r.data, total: r.total }));
