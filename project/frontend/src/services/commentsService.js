import { request } from "./api";

// P55: comments notify the same way suggestions do (P52's lesson) — a
// comment can be created/replied/resolved/deleted from the note margin OR
// the mobile sheet, and both panes render the same threads from separate
// fetches, so every mutation notifies rather than only the pane it happened
// in refetching.
const commentListeners = new Set();
export function onCommentChange(fn) {
  commentListeners.add(fn);
  return () => commentListeners.delete(fn);
}
const notifyCommentChange = () => commentListeners.forEach((fn) => fn());

export const listComments = (noteId) =>
  request(`/comments?note=${noteId}`).then((r) => r.data);

export const createComment = ({ note, body, anchor }) =>
  request("/comments", { method: "POST", body: JSON.stringify({ note, body, anchor }) }).then((r) => {
    notifyCommentChange();
    return r.data;
  });

export const replyToComment = (id, body) =>
  request(`/comments/${id}/replies`, { method: "POST", body: JSON.stringify({ body }) }).then((r) => {
    notifyCommentChange();
    return r.data;
  });

export const resolveComment = (id) =>
  request(`/comments/${id}/resolve`, { method: "POST" }).then((r) => {
    notifyCommentChange();
    return r.data;
  });

export const unresolveComment = (id) =>
  request(`/comments/${id}/unresolve`, { method: "POST" }).then((r) => {
    notifyCommentChange();
    return r.data;
  });

// Mirrors notesService.deleteNote's envelope (204, no body) rather than the
// other comment endpoints' {data} — the backend contract says so explicitly
// ("match DELETE /api/notes/:id exactly"), so there's no `.data` to unwrap.
export const deleteComment = (id) =>
  request(`/comments/${id}`, { method: "DELETE" }).then((r) => {
    notifyCommentChange();
    return r;
  });

export const undeleteComment = (id) =>
  request(`/comments/${id}/undelete`, { method: "POST" }).then((r) => {
    notifyCommentChange();
    return r.data;
  });

export const deleteReply = (id, replyId) =>
  request(`/comments/${id}/replies/${replyId}`, { method: "DELETE" }).then((r) => {
    notifyCommentChange();
    return r.data;
  });
