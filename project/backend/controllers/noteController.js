const Note = require("../models/Note");
const Comment = require("../models/Comment");
const Suggestion = require("../models/Suggestion");
const Revision = require("../models/Revision");
const Project = require("../models/Project");
const { resolveContainer } = require("../utils/resolveContainer");
const { assertRole } = require("../middleware/auth");
const { accessibleFilters } = require("../utils/permissions");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { assertVersion } = require("../utils/assertVersion");
const { pruneOrphanedComments } = require("../utils/commentAnchor");
const { softCascadeLeafSuggestions } = require("../utils/cascade");

// Same shape as tasks: always a flat list (sharing surfaces at the container
// level), itemFilter intersected with the optional ?workspace=/?project= filters.
const getNotes = async (req, res, next) => {
  try {
    const { ownSuperWorkspaceId, memberships, itemFilter } = await accessibleFilters(req.user.id);

    const filter = { ...itemFilter };
    if (req.query.workspace) {
      filter.workspace = req.query.workspace;
      if (req.query.includeSubprojects === "1") {
        const archivedIds = await Project.find({ workspace: req.query.workspace, archivedAt: { $ne: null } }).distinct("_id");
        if (archivedIds.length) filter.$and = [{ $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedIds } }] }];
      } else filter.project = null;
    }
    if (req.query.project) {
      if (req.query.includeSubprojects === "1") {
        const descendantIds = await Project.find({ ancestors: req.query.project, archivedAt: null }).distinct("_id");
        filter.project = { $in: [req.query.project, ...descendantIds] };
      } else filter.project = req.query.project;
    }

    const notes = await Note.find(filter)
      .sort({ title: 1 })
      .collation({ locale: "en", strength: 2 });

    const data = await withEffectiveRole(notes, { ownSuperWorkspaceId, memberships });

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

// authorize("reader", Note) already loaded the doc and resolved the caller's role;
// project (when the note is filed inside one) and workspace are populated here so
// the note page can render its breadcrumb trail — same idiom as
// projectController.js's getOneProject / workspaceController.js's getOneWorkspace.
const getOneNote = async (req, res, next) => {
  try {
    await req.resource.populate([
      { path: "project", select: "name ancestors", populate: { path: "ancestors", select: "name" } },
      { path: "workspace", select: "name" },
      { path: "updatedBy", select: "username" },
    ]);
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

const createNote = async (req, res, next) => {
  try {
    const { superWorkspace, workspace, project, container } = await resolveContainer(req.user.id, req.body);
    await assertRole(req.user.id, container, "writer");

    const note = await Note.create({
      title: req.body.title,
      content: req.body.content,
      workspace,
      project,
      superWorkspace,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({ data: note });
  } catch (err) {
    next(err);
  }
};

const updateNote = async (req, res, next) => {
  try {
    const note = req.resource; // authorize("writer", Note) already vetted the edit itself
    assertVersion(req);

    if (req.body.title !== undefined) note.title = req.body.title;
    if (req.body.content !== undefined) note.content = req.body.content;

    // Re-filing needs writer at the DESTINATION too; a move can cross tenants,
    // so the superWorkspace stamp follows the new container.
    const refiling = req.body.project !== undefined || req.body.workspace !== undefined;
    if (refiling) {
      const { superWorkspace, workspace, project, container } = await resolveContainer(req.user.id, req.body);
      await assertRole(req.user.id, container, "writer");
      note.workspace = workspace;
      note.project = project;
      note.superWorkspace = superWorkspace;
    }

    note.updatedBy = req.user.id;
    await note.save();

    if (refiling) {
      await Promise.all([
        Comment.updateMany(
          { note: note._id },
          {
            workspace: note.workspace,
            project: note.project || null,
            superWorkspace: note.superWorkspace,
            updatedBy: req.user.id,
          }
        ),
        Suggestion.updateMany(
          { resourceType: "Note", resource: note._id },
          { workspace: note.workspace, project: note.project || null, superWorkspace: note.superWorkspace }
        ),
        Revision.updateMany(
          { resourceType: "Note", resource: note._id },
          { superWorkspace: note.superWorkspace }
        ),
      ]);
    }

    // Auto-delete on drift (PHASE_SPEC.md ruling), but only at COMMIT points
    // (P60): autosave mid-typing must not strand an in-flight comment whose
    // anchor text is only transiently broken by an unfinished edit.
    if (req.body.content !== undefined && req.body.commit === true) {
      await pruneOrphanedComments(Comment, note._id, note.content);
    }

    res.json({ data: note, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

const deleteNote = async (req, res, next) => {
  try {
    await req.resource.softDelete(req.user.id);
    await softCascadeLeafSuggestions(req.resource._id, req.resource.deletedAt);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNotes,
  getOneNote,
  createNote,
  updateNote,
  deleteNote,
};
