import { request } from "./api";

// Lists default to pending server-side; pass status to see all/approved/rejected.
// Exactly one of workspace/project/superWorkspace — the last is the tenant-wide
// listing (no container) for the HomePage owner review panel.
export const getSuggestions = ({ workspace, project, superWorkspace }, status) =>
  request(
    `/suggestions?${
      workspace ? `workspace=${workspace}` : project ? `project=${project}` : `superWorkspace=${superWorkspace}`
    }${status ? `&status=${status}` : ""}`
  ).then((r) => r.data);

// P52: proposals originate all over the app — task rows, the note pane, the
// link/file sections, the page-level forms — and none of those can reach the
// SuggestionsPanel that lists them, so a card only showed up after a reload.
// That made the Editing/Suggesting toggle read as broken: you flip, you tick a
// checkbox, and nothing appears. A module-level notifier (same shape as api.js's
// onUnauthorized hook) lets the panel refetch on any proposal, wherever it came
// from, without threading a callback through every producer.
// P52.1: a RESOLUTION moves the same lists a proposal does. The note margin and
// the panel both render the same pending suggestions from separate fetches, so
// approving in one left a live Approve/Reject card for an already-applied edit
// in the other — the same "if its applied dont show that" complaint, one pane
// over. Every mutation notifies; listeners only re-fetch, so there's no cycle.
const proposalListeners = new Set();
export function onProposal(fn) {
  proposalListeners.add(fn);
  return () => proposalListeners.delete(fn);
}
const notifyProposalChange = () => proposalListeners.forEach((fn) => fn());

export const createSuggestion = (data) =>
  request("/suggestions", { method: "POST", body: JSON.stringify(data) }).then((r) => {
    notifyProposalChange();
    return r.data;
  });

export const approveSuggestion = (id, { completeSubtasks = false } = {}) =>
  request(`/suggestions/${id}/approve`, {
    method: "POST",
    ...(completeSubtasks ? { body: JSON.stringify({ completeSubtasks: true }) } : {}),
  }).then((r) => {
    notifyProposalChange();
    return r.data;
  });

// P61 §2.3: `data` is `{ suggestion, resource: note }`, same shape as approve
// — the note's reverted content/__v is what NoteView threads into autosave
// state so the mirror splice doesn't trigger a phantom (stale-ifVersion) save.
export const unapproveSuggestion = (id) =>
  request(`/suggestions/${id}/unapprove`, { method: "POST" }).then((r) => {
    notifyProposalChange();
    return r.data;
  });

export const rejectSuggestion = (id) =>
  request(`/suggestions/${id}/reject`, { method: "POST" }).then((r) => {
    notifyProposalChange();
    return r.data;
  });

export const unrejectSuggestion = (id) =>
  request(`/suggestions/${id}/unreject`, { method: "POST" }).then((r) => {
    notifyProposalChange();
    return r.data;
  });

export const retractSuggestion = (id) =>
  request(`/suggestions/${id}`, { method: "DELETE" }).then((r) => {
    notifyProposalChange();
    return r;
  });

export const unretractSuggestion = (id) =>
  request(`/suggestions/${id}/unretract`, { method: "POST" }).then((r) => {
    notifyProposalChange();
    return r.data;
  });

// P33: the owner's aggregated review queue — pending counts across every
// container they own (workspaces/projects, any depth) plus the tenant root,
// replacing the old tenant-root-only SuggestionsPanel mount on HomePage.
// `total` rides alongside `data` (mirrors getWorkspace's effectiveRole merge)
// since ReviewSummary needs it for the section-label badge, not just a length.
export const getReviewSummary = () =>
  request("/suggestions/review-summary").then((r) => ({ data: r.data, total: r.total }));

// The caller's own proposals, any container, status-filterable (default the
// server applies is "pending" — MySuggestions asks for "all" and slices
// client-side per P33's no-pagination-this-phase call).
export const getMySuggestions = (status) =>
  request(`/suggestions?mine=1${status ? `&status=${status}` : ""}`).then((r) => r.data);
