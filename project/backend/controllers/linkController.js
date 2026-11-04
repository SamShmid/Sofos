const Link = require("../models/Link");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const { assertRole } = require("../middleware/auth");
const { accessibleFilters } = require("../utils/permissions");
const requireExactlyOneContainer = require("../utils/requireExactlyOneContainer");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { assertVersion } = require("../utils/assertVersion");
const { softCascadeLeafSuggestions } = require("../utils/cascade");

// A links list is always scoped to exactly one container (a workspace's links
// list shows only its OWN links, not its projects' links).
const getLinks = async (req, res, next) => {
  try {
    const isProjectMode = requireExactlyOneContainer(req.query);

    const { ownSuperWorkspaceId, memberships, itemFilter } = await accessibleFilters(req.user.id);

    const filter = { ...itemFilter };
    if (isProjectMode) {
      if (req.query.includeSubprojects === "1") {
        const descendantIds = await Project.find({ ancestors: req.query.project, archivedAt: null }).distinct("_id");
        filter.project = { $in: [req.query.project, ...descendantIds] };
      } else filter.project = req.query.project;
    } else {
      filter.workspace = req.query.workspace;
      if (req.query.includeSubprojects === "1") {
        const archivedIds = await Project.find({ workspace: req.query.workspace, archivedAt: { $ne: null } }).distinct("_id");
        if (archivedIds.length) filter.$and = [{ $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedIds } }] }];
      } else filter.project = null;
    }

    const links = await Link.find(filter).sort({ order: 1 });

    const data = await withEffectiveRole(links, { ownSuperWorkspaceId, memberships });

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

const getOneLink = async (req, res, next) => {
  try {
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Order is dense per-container: max live order + 1, or 0 for the container's
// first link.
const createLink = async (req, res, next) => {
  try {
    const isProjectMode = requireExactlyOneContainer(req.body);

    let container, workspace, project, superWorkspace;
    if (isProjectMode) {
      project = await Project.findById(req.body.project);
      if (!project) {
        const e = new Error("Project not found");
        e.status = 404;
        throw e;
      }
      container = project;
      workspace = project.workspace;
      superWorkspace = project.superWorkspace;
    } else {
      const ws = await Workspace.findById(req.body.workspace);
      if (!ws) {
        const e = new Error("Workspace not found");
        e.status = 404;
        throw e;
      }
      container = ws;
      workspace = ws._id;
      superWorkspace = ws.superWorkspace;
    }

    await assertRole(req.user.id, container, "writer");

    const orderFilter = isProjectMode ? { project: project._id } : { workspace, project: null };
    const last = await Link.findOne(orderFilter).sort({ order: -1 });
    const order = last ? last.order + 1 : 0;

    const link = await Link.create({
      title: req.body.title,
      url: req.body.url,
      description: req.body.description,
      workspace,
      project: isProjectMode ? project._id : undefined,
      superWorkspace,
      order,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({ data: link });
  } catch (err) {
    next(err);
  }
};

const updateLink = async (req, res, next) => {
  try {
    const link = req.resource; // authorize("writer", Link) already vetted the edit itself
    assertVersion(req);

    if (req.body.title !== undefined) link.title = req.body.title;
    if (req.body.url !== undefined) link.url = req.body.url;
    if (req.body.description !== undefined) link.description = req.body.description;

    link.updatedBy = req.user.id;
    await link.save();
    res.json({ data: link, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// ids must be exactly a permutation of the container's current live links;
// each save writes its own revision (accepted cost of reusing load-then-save).
const reorderLinks = async (req, res, next) => {
  try {
    const isProjectMode = requireExactlyOneContainer(req.body);

    let container, filter;
    if (isProjectMode) {
      container = await Project.findById(req.body.project);
      if (!container) {
        const e = new Error("Project not found");
        e.status = 404;
        throw e;
      }
      filter = { project: container._id };
    } else {
      container = await Workspace.findById(req.body.workspace);
      if (!container) {
        const e = new Error("Workspace not found");
        e.status = 404;
        throw e;
      }
      filter = { workspace: container._id, project: null };
    }

    await assertRole(req.user.id, container, "writer");

    const links = await Link.find(filter);
    const currentIds = links.map((l) => String(l._id));
    const ids = req.body.ids;
    const isPermutation =
      ids.length === currentIds.length &&
      new Set(ids).size === currentIds.length &&
      ids.every((id) => currentIds.includes(id));

    if (!isPermutation) {
      const e = new Error("ids must be exactly the container's links");
      e.status = 400;
      throw e;
    }

    const linksById = new Map(links.map((l) => [String(l._id), l]));
    for (let i = 0; i < ids.length; i++) {
      const link = linksById.get(ids[i]);
      link.order = i;
      link.updatedBy = req.user.id;
      await link.save();
    }

    res.json({ data: { reordered: ids.length } });
  } catch (err) {
    next(err);
  }
};

const deleteLink = async (req, res, next) => {
  try {
    await req.resource.softDelete(req.user.id);
    await softCascadeLeafSuggestions(req.resource._id, req.resource.deletedAt);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getLinks,
  getOneLink,
  createLink,
  updateLink,
  reorderLinks,
  deleteLink,
};
