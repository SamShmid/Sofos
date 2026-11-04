const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Note = require("../models/Note");
const Goal = require("../models/Goal");
const Link = require("../models/Link");
const Attachment = require("../models/Attachment");
const Revision = require("../models/Revision");
const Comment = require("../models/Comment");
const Suggestion = require("../models/Suggestion");
const { ownedTenantOrThrow } = require("../utils/ownedTenant");
const { deleteStoredFile } = require("../utils/uploadStore");
const {
  restoreCascadeWorkspace,
  restoreCascadeProject,
  hardDeleteWorkspace,
  hardDeleteProject,
  restoreCascadeTask,
  hardDeleteTask,
  restoreCascadeLeafSuggestions,
} = require("../utils/cascade");

const MODELS = { Workspace, Project, Task, Note, Goal, Link, Attachment };

// Trash is GLOBAL and OWN-TENANT-ONLY: every operation here requires the caller
// to OWN a SuperWorkspace — agents and non-owners get 403 (ownedTenantOrThrow).
const ownedTenant = (userId) => ownedTenantOrThrow(userId, "Only account owners can manage trash");

// Lists only deletion ROOTS: a cascaded child (project/task/note trashed at the
// exact same instant as its trashed parent) is implied by its root and hidden
// here — restoring/emptying the root is what the frontend acts on.
const getTrash = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);

    const [workspaces, projects, tasks, notes, goals, links, attachments] = await Promise.all(
      [Workspace, Project, Task, Note, Goal, Link, Attachment].map((Model) =>
        Model.find({ superWorkspace: own._id, deletedAt: { $ne: null } }).setOptions({ withDeleted: true })
      )
    );

    const workspaceDeletedAt = new Map(workspaces.map((w) => [String(w._id), w.deletedAt.getTime()]));
    const projectDeletedAt = new Map(projects.map((p) => [String(p._id), p.deletedAt.getTime()]));
    const taskDeletedAt = new Map(tasks.map((t) => [String(t._id), t.deletedAt.getTime()]));

    const items = [];

    for (const doc of workspaces) {
      items.push({ resourceType: "Workspace", deletedAt: doc.deletedAt, doc });
    }

    for (const doc of projects) {
      // Immediate parent only — a nested project checks parentProject, a
      // top-level one checks its workspace. Cascades stamp one `at` down the
      // whole subtree, so this single comparison is sufficient.
      const immediateAt = doc.parentProject
        ? projectDeletedAt.get(String(doc.parentProject))
        : workspaceDeletedAt.get(String(doc.workspace));
      if (immediateAt !== undefined && immediateAt === doc.deletedAt.getTime()) continue; // cascaded with its immediate parent
      items.push({ resourceType: "Project", deletedAt: doc.deletedAt, doc });
    }

    for (const [resourceType, docs] of [["Task", tasks], ["Note", notes], ["Goal", goals], ["Link", links], ["Attachment", attachments]]) {
      for (const doc of docs) {
        const at = doc.deletedAt.getTime();
        if (resourceType === "Task" && doc.parentTask) {
          const parentAt = taskDeletedAt.get(String(doc.parentTask));
          if (parentAt !== undefined && parentAt === at) continue;
        }
        const projAt = doc.project ? projectDeletedAt.get(String(doc.project)) : undefined;
        const wsAt = workspaceDeletedAt.get(String(doc.workspace));
        if ((projAt !== undefined && projAt === at) || (wsAt !== undefined && wsAt === at)) continue; // cascaded
        items.push({ resourceType, deletedAt: doc.deletedAt, doc });
      }
    }

    items.sort((a, b) => b.deletedAt - a.deletedAt);
    res.json({ data: items, count: items.length });
  } catch (err) {
    next(err);
  }
};

const restoreFromTrash = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);
    const { resourceType, id } = req.params;
    const Model = MODELS[resourceType];

    const doc = await Model.findById(id).setOptions({ withDeleted: true });
    if (!doc || !doc.superWorkspace.equals(own._id) || !doc.deletedAt)
      return res.status(404).json({ error: { message: `${resourceType} not found in trash` } });

    // Container-liveness guard: can't revive a doc into a still-trashed parent.
    // Default-filtered findById returns null for a trashed container.
    if (resourceType === "Project") {
      const workspace = await Workspace.findById(doc.workspace);
      if (!workspace) return res.status(400).json({ error: { message: "Restore the workspace first" } });
      if (doc.parentProject) {
        const parentProject = await Project.findById(doc.parentProject);
        if (!parentProject) return res.status(400).json({ error: { message: "Restore the parent project first" } });
      }
    } else if (resourceType === "Task" || resourceType === "Note" || resourceType === "Goal" || resourceType === "Link" || resourceType === "Attachment") {
      if (resourceType === "Task" && doc.parentTask) {
        const parentTask = await Task.findById(doc.parentTask);
        if (!parentTask) return res.status(400).json({ error: { message: "Restore the parent task first" } });
      }
      if (doc.project) {
        const project = await Project.findById(doc.project);
        if (!project) return res.status(400).json({ error: { message: "Restore the containing project first" } });
      } else {
        const workspace = await Workspace.findById(doc.workspace);
        if (!workspace) return res.status(400).json({ error: { message: "Restore the containing workspace first" } });
      }
    }

    // Scan-status gate, Attachment roots only: infected files can never come
    // back; a failed (5-attempts-exhausted) file is restorable and gets
    // rescanned from scratch — maybe the scanner was just broken.
    if (resourceType === "Attachment" && doc.scanStatus === "infected") {
      return res.status(409).json({ error: { message: "This file is infected and cannot be restored" } });
    }

    const at = doc.deletedAt; // stamp before restoreDoc clears it, to find same-cascade children
    if (resourceType === "Attachment" && doc.scanStatus === "failed") {
      doc.scanStatus = "pending_scan";
      doc.scanAttempts = 0;
    }
    await doc.restoreDoc(req.user.id);
    if (resourceType === "Workspace") await restoreCascadeWorkspace(doc._id, at);
    if (resourceType === "Project") await restoreCascadeProject(doc._id, at);
    if (resourceType === "Task") await restoreCascadeTask(doc._id, at);
    if (resourceType === "Task" || resourceType === "Note" || resourceType === "Goal" || resourceType === "Link" || resourceType === "Attachment") {
      await restoreCascadeLeafSuggestions(doc._id, at);
    }

    res.json({ data: doc });
  } catch (err) {
    next(err);
  }
};

// Irreversible: only trash can be emptied, and emptying purges docs, grants, AND
// revisions (via the cascade helpers for containers; directly for leaf types).
const hardDelete = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);
    const { resourceType, id } = req.params;
    const Model = MODELS[resourceType];

    const doc = await Model.findById(id).setOptions({ withDeleted: true });
    if (!doc || !doc.superWorkspace.equals(own._id) || !doc.deletedAt)
      return res.status(404).json({ error: { message: `${resourceType} not found in trash` } });

    if (resourceType === "Workspace") await hardDeleteWorkspace(doc._id);
    if (resourceType === "Project") await hardDeleteProject(doc._id);
    if (resourceType === "Task") await hardDeleteTask(doc._id);
    if (resourceType === "Note") await Comment.deleteMany({ note: doc._id });
    if (resourceType === "Goal") await Task.updateMany({ goal: doc._id }, { $unset: { goal: "" } });
    if (resourceType === "Task" || resourceType === "Note" || resourceType === "Goal" || resourceType === "Link" || resourceType === "Attachment") {
      await Suggestion.deleteMany({ resource: doc._id });
    }

    await Revision.deleteMany({ resource: doc._id });
    await doc.deleteOne();
    if (resourceType === "Attachment") await deleteStoredFile(doc.storageKey);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = { getTrash, restoreFromTrash, hardDelete };
