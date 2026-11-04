const Workspace = require("../models/Workspace");
const Note = require("../models/Note");
const Task = require("../models/Task");
const Project = require("../models/Project");
const Goal = require("../models/Goal");
const Link = require("../models/Link");
const Attachment = require("../models/Attachment");
const Membership = require("../models/Membership");
const Revision = require("../models/Revision");
const Comment = require("../models/Comment");
const Suggestion = require("../models/Suggestion");
const { deleteStoredFile } = require("./uploadStore");

// Cascade helpers for the version-history world. Two philosophies:
//  - Soft delete/restore: children ride the ROOT's exact deletedAt timestamp, so a
//    later restore can revive precisely the children that fell with the cascade and
//    leave independently-trashed ones alone. Children are moved with updateMany,
//    which deliberately bypasses the save hooks — no per-child revision; the root's
//    single revision represents the whole cascade.
//  - Hard delete: irreversible purge of docs, grants, AND history. Must see trashed
//    docs, so every distinct() that feeds an id list opts in with withDeleted.
// (deleteMany/updateMany aren't /^find/ and so aren't hidden by the soft-delete
// filter; distinct IS — hence the explicit withDeleted where it matters.)
// P65: Suggestion rides the same soft-delete/restore/hard-delete sweeps, keyed
// on its own stored workspace/project fields — but it carries no updatedBy, so
// its updateMany calls omit that field (unlike the resource sweeps above).

async function softCascadeWorkspace(workspaceId, userId, at) {
  const allWs = [workspaceId];
  await Promise.all([
    // Descendant workspaces ride the same `at` as the root — the root itself is
    // stamped by the caller (softDelete), same as the pre-nesting contract.
    // Nested projects carry `workspace` regardless of depth, so expanding the
    // workspace set alone sweeps the whole project tree without touching `ancestors`.
    Project.updateMany(
      { workspace: { $in: allWs }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Task.updateMany(
      { workspace: { $in: allWs }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Note.updateMany(
      { workspace: { $in: allWs }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    // Every goal carries a workspace ref (project goals too), so this one filter
    // cascades both workspace-level and project-level goals under it.
    Goal.updateMany(
      { workspace: { $in: allWs }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    // Every link carries a workspace ref (project links too), so this one filter
    // cascades both workspace-level and project-level links under it.
    Link.updateMany(
      { workspace: { $in: allWs }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    // Every attachment carries a workspace ref (project attachments too), so this
    // one filter cascades both workspace-level and project-level files under it.
    Attachment.updateMany(
      { workspace: { $in: allWs }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Suggestion.updateMany({ workspace: { $in: allWs }, deletedAt: null }, { deletedAt: at, deletedVia: "cascade" }),
  ]);
  // Memberships are KEPT — restoring the workspace must bring access back with it.
}

// Only same-timestamp children revive; independently-deleted items stay trashed.
async function restoreCascadeWorkspace(workspaceId, at) {
  const allWs = [workspaceId];
  await Promise.all([
    Project.updateMany({ workspace: { $in: allWs }, deletedAt: at }, { deletedAt: null }),
    Task.updateMany({ workspace: { $in: allWs }, deletedAt: at }, { deletedAt: null }),
    Note.updateMany({ workspace: { $in: allWs }, deletedAt: at }, { deletedAt: null }),
    Goal.updateMany({ workspace: { $in: allWs }, deletedAt: at }, { deletedAt: null }),
    Link.updateMany({ workspace: { $in: allWs }, deletedAt: at }, { deletedAt: null }),
    Attachment.updateMany({ workspace: { $in: allWs }, deletedAt: at }, { deletedAt: null }),
    Suggestion.updateMany(
      { workspace: { $in: allWs }, deletedAt: at, deletedVia: "cascade" },
      { deletedAt: null, deletedVia: null }
    ),
  ]);
}

async function softCascadeProject(projectId, userId, at) {
  const desc = await Project.find({ ancestors: projectId, deletedAt: null }).distinct("_id");
  const allP = [projectId, ...desc];
  await Promise.all([
    // Descendant projects ride the same `at` as the root — the root itself is
    // stamped by the caller (softDelete), same as the pre-nesting contract.
    Project.updateMany({ _id: { $in: desc } }, { deletedAt: at, updatedBy: userId }),
    Task.updateMany(
      { project: { $in: allP }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Note.updateMany(
      { project: { $in: allP }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Goal.updateMany(
      { project: { $in: allP }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Link.updateMany(
      { project: { $in: allP }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Attachment.updateMany(
      { project: { $in: allP }, deletedAt: null },
      { deletedAt: at, updatedBy: userId }
    ),
    Suggestion.updateMany({ project: { $in: allP }, deletedAt: null }, { deletedAt: at, deletedVia: "cascade" }),
  ]);
}

async function restoreCascadeProject(projectId, at) {
  const desc = await Project.find({ ancestors: projectId, deletedAt: at })
    .setOptions({ withDeleted: true })
    .distinct("_id");
  const allP = [projectId, ...desc];
  await Promise.all([
    Project.updateMany({ _id: { $in: desc } }, { deletedAt: null }),
    Task.updateMany({ project: { $in: allP }, deletedAt: at }, { deletedAt: null }),
    Note.updateMany({ project: { $in: allP }, deletedAt: at }, { deletedAt: null }),
    Goal.updateMany({ project: { $in: allP }, deletedAt: at }, { deletedAt: null }),
    Link.updateMany({ project: { $in: allP }, deletedAt: at }, { deletedAt: null }),
    Attachment.updateMany({ project: { $in: allP }, deletedAt: at }, { deletedAt: null }),
    Suggestion.updateMany(
      { project: { $in: allP }, deletedAt: at, deletedVia: "cascade" },
      { deletedAt: null, deletedVia: null }
    ),
  ]);
}

async function softCascadeTask(taskId, userId, at) {
  const descendants = await Task.find({ ancestors: taskId, deletedAt: null }).distinct("_id");
  const allTasks = [taskId, ...descendants];
  await Promise.all([
    Task.updateMany({ _id: { $in: descendants } }, { deletedAt: at, updatedBy: userId }),
    Suggestion.updateMany(
      { resource: { $in: allTasks }, deletedAt: null },
      { deletedAt: at, deletedVia: "cascade" }
    ),
  ]);
}

async function restoreCascadeTask(taskId, at) {
  const descendants = await Task.find({ ancestors: taskId, deletedAt: at })
    .setOptions({ withDeleted: true })
    .distinct("_id");
  const allTasks = [taskId, ...descendants];
  await Promise.all([
    Task.updateMany({ _id: { $in: descendants }, deletedAt: at }, { deletedAt: null }),
    Suggestion.updateMany(
      { resource: { $in: allTasks }, deletedAt: at, deletedVia: "cascade" },
      { deletedAt: null, deletedVia: null }
    ),
  ]);
}

async function hardDeleteTask(taskId) {
  const descendants = await Task.find({ ancestors: taskId }).setOptions({ withDeleted: true }).distinct("_id");
  const allTasks = [taskId, ...descendants];
  await Promise.all([
    Task.deleteMany({ _id: { $in: descendants } }),
    Suggestion.deleteMany({ resource: { $in: allTasks } }),
    Revision.deleteMany({ resource: { $in: descendants } }),
  ]);
}

// Irreversible: docs, grants, and history all go. Collect child ids (trashed OR
// live) BEFORE deleting, so revisions of the tasks/notes/projects can be purged
// too. Descendant workspaces/projects are purged here too — the caller only
// deletes the root doc.
async function hardDeleteWorkspace(workspaceId) {
  const descWs = [];
  const allWs = [workspaceId];
  const projectIds = await Project.distinct("_id", { workspace: { $in: allWs } }).setOptions({ withDeleted: true });
  const taskIds = await Task.distinct("_id", { workspace: { $in: allWs } }).setOptions({ withDeleted: true });
  const noteIds = await Note.distinct("_id", { workspace: { $in: allWs } }).setOptions({ withDeleted: true });
  const goalIds = await Goal.distinct("_id", { workspace: { $in: allWs } }).setOptions({ withDeleted: true });
  const linkIds = await Link.distinct("_id", { workspace: { $in: allWs } }).setOptions({ withDeleted: true });
  // Files on disk survive DB deletion unless we purge them explicitly, so their
  // storageKeys must be captured BEFORE the docs are deleted.
  const attachmentDocs = await Attachment.find({ workspace: { $in: allWs } }, "_id storageKey").setOptions({ withDeleted: true });
  const attachmentIds = attachmentDocs.map((a) => a._id);
  const storageKeys = attachmentDocs.map((a) => a.storageKey);

  await Promise.all([
    Note.deleteMany({ workspace: { $in: allWs } }),
    Comment.deleteMany({ note: { $in: noteIds } }), // Notes have no revisions of their own comments — sweep here, not via Revision
    Task.deleteMany({ workspace: { $in: allWs } }),
    Goal.deleteMany({ workspace: { $in: allWs } }),
    Link.deleteMany({ workspace: { $in: allWs } }),
    Attachment.deleteMany({ workspace: { $in: allWs } }),
    Project.deleteMany({ workspace: { $in: allWs } }),
    Workspace.deleteMany({ _id: { $in: descWs } }), // root itself is deleted by the caller
    Suggestion.deleteMany({ workspace: { $in: allWs } }),
    Membership.deleteMany({
      workspace: { $in: allWs },
    }),
    Revision.deleteMany({
      $or: [
        { resource: { $in: allWs } },
        { resource: { $in: projectIds } },
        { resource: { $in: taskIds } },
        { resource: { $in: noteIds } },
        { resource: { $in: goalIds } },
        { resource: { $in: linkIds } },
        { resource: { $in: attachmentIds } },
      ],
    }),
    // Defensive: unassign any surviving tasks (shouldn't exist since tasks are
    // deleted above too, but guards against ordering surprises in Promise.all).
    Task.updateMany({ goal: { $in: goalIds } }, { $unset: { goal: "" } }),
  ]);

  await Promise.all(storageKeys.map((key) => deleteStoredFile(key)));
}

async function hardDeleteProject(projectId) {
  const descP = await Project.find({ ancestors: projectId }).setOptions({ withDeleted: true }).distinct("_id");
  const allP = [projectId, ...descP];
  const taskIds = await Task.distinct("_id", { project: { $in: allP } }).setOptions({ withDeleted: true });
  const noteIds = await Note.distinct("_id", { project: { $in: allP } }).setOptions({ withDeleted: true });
  const goalIds = await Goal.distinct("_id", { project: { $in: allP } }).setOptions({ withDeleted: true });
  const linkIds = await Link.distinct("_id", { project: { $in: allP } }).setOptions({ withDeleted: true });
  // Files on disk survive DB deletion unless we purge them explicitly, so their
  // storageKeys must be captured BEFORE the docs are deleted.
  const attachmentDocs = await Attachment.find({ project: { $in: allP } }, "_id storageKey").setOptions({ withDeleted: true });
  const attachmentIds = attachmentDocs.map((a) => a._id);
  const storageKeys = attachmentDocs.map((a) => a.storageKey);

  await Promise.all([
    Note.deleteMany({ project: { $in: allP } }),
    Comment.deleteMany({ note: { $in: noteIds } }),
    Task.deleteMany({ project: { $in: allP } }),
    Goal.deleteMany({ project: { $in: allP } }),
    Link.deleteMany({ project: { $in: allP } }),
    Attachment.deleteMany({ project: { $in: allP } }),
    Project.deleteMany({ _id: { $in: descP } }), // root itself is deleted by the caller
    Suggestion.deleteMany({ project: { $in: allP } }),
    Revision.deleteMany({
      $or: [
        { resource: { $in: allP } },
        { resource: { $in: taskIds } },
        { resource: { $in: noteIds } },
        { resource: { $in: goalIds } },
        { resource: { $in: linkIds } },
        { resource: { $in: attachmentIds } },
      ],
    }),
    Task.updateMany({ goal: { $in: goalIds } }, { $unset: { goal: "" } }),
  ]);

  await Promise.all(storageKeys.map((key) => deleteStoredFile(key)));
}

// A leaf trashed/restored on its own (not via a container cascade) doesn't go
// through the helpers above — keyed on `resource` (the suggestion's target id)
// rather than a workspace/project set. Same `at`-matching contract: restore
// revives only the suggestions that rode THIS exact soft-delete, never a
// sibling's or a user-retracted one.
async function softCascadeLeafSuggestions(resourceId, at) {
  await Suggestion.updateMany({ resource: resourceId, deletedAt: null }, { deletedAt: at, deletedVia: "cascade" });
}

async function restoreCascadeLeafSuggestions(resourceId, at) {
  await Suggestion.updateMany(
    { resource: resourceId, deletedAt: at, deletedVia: "cascade" },
    { deletedAt: null, deletedVia: null }
  );
}

module.exports = {
  softCascadeWorkspace,
  restoreCascadeWorkspace,
  softCascadeProject,
  restoreCascadeProject,
  softCascadeTask,
  restoreCascadeTask,
  hardDeleteTask,
  hardDeleteWorkspace,
  hardDeleteProject,
  softCascadeLeafSuggestions,
  restoreCascadeLeafSuggestions,
};
