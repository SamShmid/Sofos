const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Note = require("../models/Note");
const Goal = require("../models/Goal");
const Link = require("../models/Link");
const Attachment = require("../models/Attachment");
const Revision = require("../models/Revision");
const { assertRole } = require("../middleware/auth");
const { ownedTenantOrThrow } = require("../utils/ownedTenant");

const MODELS = { Workspace, Project, Task, Note, Goal, Link, Attachment };

// Content fields a version restore is allowed to touch — never containment,
// ownership, isDefault, or deletedAt.
const CONTENT_FIELDS = {
  Workspace: ["name", "description"],
  Project: ["name", "description"],
  Task: ["title", "content", "completed"],
  Note: ["title", "content"],
  // NOT order — a version restore must not corrupt roadmap ordering.
  Goal: ["title", "description", "completed"],
  Link: ["title", "url", "description"],
  Attachment: ["filename"],
};

// History is only readable for a LIVE doc (default find filter) — a trashed
// resource's story is read through /api/trash, not here.
const getRevisions = async (req, res, next) => {
  try {
    const { resourceType, resource } = req.query;
    const Model = MODELS[resourceType];

    const doc = await Model.findById(resource);
    if (!doc) return res.status(404).json({ error: { message: `${resourceType} not found` } });
    await assertRole(req.user.id, doc, "reader");

    const revisions = await Revision.find({ resourceType, resource })
      .sort({ createdAt: -1 })
      .populate("editedBy", "username");
    res.json({ data: revisions, count: revisions.length });
  } catch (err) {
    next(err);
  }
};

const restoreRevision = async (req, res, next) => {
  try {
    const revision = await Revision.findById(req.params.id);
    if (!revision) return res.status(404).json({ error: { message: "Revision not found" } });

    const Model = MODELS[revision.resourceType];
    const doc = await Model.findById(revision.resource); // default filter: trashed/missing reads as 404
    if (!doc) return res.status(404).json({ error: { message: `${revision.resourceType} not found` } });

    await assertRole(req.user.id, doc, "writer");

    for (const field of CONTENT_FIELDS[revision.resourceType]) {
      doc[field] = revision.snapshot[field];
    }
    doc.updatedBy = req.user.id;
    doc.$locals.operationOverride = "restore";
    await doc.save();

    res.json({ data: doc });
  } catch (err) {
    next(err);
  }
};

// Owner-only, tenant-wide, irreversible — keep-forever is the default (Samuel's
// call, PHASE_SPEC.md); this is the opt-in "clear it all" escape hatch. No
// soft-delete plugin on Revision, so a plain deleteMany is correct here.
const deleteAllRevisions = async (req, res, next) => {
  try {
    const own = await ownedTenantOrThrow(req.user.id, "Only account owners can clear revision history");
    const result = await Revision.deleteMany({ superWorkspace: own._id });
    res.json({ data: { deleted: result.deletedCount } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getRevisions, restoreRevision, deleteAllRevisions };
