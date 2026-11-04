const Project = require("../models/Project");
const Workspace = require("../models/Workspace");
const Task = require("../models/Task");
const Note = require("../models/Note");
const Goal = require("../models/Goal");
const Link = require("../models/Link");
const Attachment = require("../models/Attachment");
const Comment = require("../models/Comment");
const Suggestion = require("../models/Suggestion");
const { softCascadeProject } = require("../utils/cascade");
const { assertRole } = require("../middleware/auth");
const { accessibleFilters } = require("../utils/permissions");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { assertVersion } = require("../utils/assertVersion");
const { assertSiblingNameFree } = require("../utils/nameGuard");

const SORTS = {
  az: { name: 1 },
  za: { name: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
};

// Three shapes, by use case:
//  - ?workspace=<id> (WorkspacePage): flat list of that workspace's TOP-LEVEL
//    projects (parentProject: null) the caller can see — the access filter
//    intersects with workspace access. &deep=1 drops the top-level restriction
//    for move pickers and tree assembly.
//  - ?parent=<projectId> (ProjectPage sub-projects): flat list of that project's
//    direct sub-projects, same access-filter intersection.
//  - no filter (Home): { owned, shared }. Shared stays empty because sharing
//    enters through a workspace or the whole account.
const getProjects = async (req, res, next) => {
  try {
    const { ownSuperWorkspaceId, memberships, projectFilter } = await accessibleFilters(req.user.id);

    if (req.query.workspace || req.query.parent) {
      const archiveFilter = req.query.archived === "only"
        ? { archivedAt: { $ne: null } }
        : req.query.archived === "include"
        ? {}
        : { archivedAt: null };
      const find = req.query.workspace
        ? {
            workspace: req.query.workspace,
            ...(req.query.deep === "1" ? {} : { parentProject: null }),
            ...archiveFilter,
            ...projectFilter,
          }
        : { parentProject: req.query.parent, ...archiveFilter, ...projectFilter };
      if (req.query.tags) {
        const tags = req.query.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (tags.length) find.tags = { $in: tags };
      }

      const sortKey = req.query.sort || "az";
      let query = Project.find(find).sort(SORTS[sortKey]);
      if (sortKey === "az" || sortKey === "za") query = query.collation({ locale: "en", strength: 2 });
      const projects = await query;
      const data = await withEffectiveRole(projects, {
        ownSuperWorkspaceId,
        memberships,
        coords: (p) => [p.superWorkspace, p.workspace, p._id],
      });
      return res.json({ data, count: data.length });
    }

    const [owned, sharedDocs] = await Promise.all([
      ownSuperWorkspaceId
        ? Project.find({ superWorkspace: ownSuperWorkspaceId, archivedAt: null })
            .sort({ name: 1 })
            .collation({ locale: "en", strength: 2 })
        : [],
      [],
    ]);

    const shared = await withEffectiveRole(sharedDocs, {
      ownSuperWorkspaceId: null,
      memberships,
      coords: (p) => [p.superWorkspace, p.workspace, p._id],
    });

    res.json({
      data: { owned, shared },
      count: { owned: owned.length, shared: shared.length },
    });
  } catch (err) {
    next(err);
  }
};

// authorize("reader", Project) loaded the doc and the caller's role; the labels are
// populated here so a shared project's page can name its workspace and owner.
const getOneProject = async (req, res, next) => {
  try {
    await req.resource.populate([
      { path: "workspace", select: "name" },
      { path: "superWorkspace", select: "name owner" },
      { path: "ancestors", select: "name" },
    ]);
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// A project's container is exactly one of a workspace (top-level) or another
// project (nested) — writer there (owner, tenant-wide, or workspace/project
// grant) is what permits creating into it, including cross-tenant.
const createProject = async (req, res, next) => {
  try {
    let workspaceId, superWorkspaceId, parentProject = null, ancestors = [];

    if (req.body.workspace) {
      const workspace = await Workspace.findById(req.body.workspace);
      if (!workspace) return res.status(404).json({ error: { message: "Workspace not found" } });
      await assertRole(req.user.id, workspace, "writer");
      workspaceId = workspace._id;
      superWorkspaceId = workspace.superWorkspace;
    } else {
      const parent = await Project.findById(req.body.parentProject);
      if (!parent) return res.status(404).json({ error: { message: "Project not found" } });
      await assertRole(req.user.id, parent, "writer");
      workspaceId = parent.workspace;
      superWorkspaceId = parent.superWorkspace;
      parentProject = parent._id;
      ancestors = [...parent.ancestors, parent._id];
    }

    await assertSiblingNameFree(Project, {
      filter: { workspace: workspaceId, parentProject },
      name: req.body.name,
    });

    const project = await Project.create({
      name: req.body.name,
      description: req.body.description,
      tags: req.body.tags || [],
      status: req.body.status || "active",
      workspace: workspaceId,
      parentProject,
      ancestors,
      superWorkspace: superWorkspaceId,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({ data: project });
  } catch (err) {
    next(err);
  }
};

// Load-then-save for optimistic concurrency.
const updateProject = async (req, res, next) => {
  try {
    const project = req.resource;
    assertVersion(req);
    if (req.body.name !== undefined) {
      await assertSiblingNameFree(Project, {
        filter: { workspace: project.workspace, parentProject: project.parentProject },
        name: req.body.name,
        excludeId: project._id,
      });
      project.name = req.body.name;
    }
    if (req.body.description !== undefined) project.description = req.body.description;
    if (req.body.tags !== undefined) project.tags = req.body.tags;
    if (req.body.status !== undefined) project.status = req.body.status;
    if (req.body.boardOrder !== undefined) project.boardOrder = req.body.boardOrder;
    project.updatedBy = req.user.id;
    await project.save();
    res.json({ data: project, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Re-parent a complete project tree. A destination workspace may be supplied to
// move the tree across workspaces in the same tenant. Every descendant and every
// contained resource is re-stamped so no item is left pointing at the old place.
const moveProject = async (req, res, next) => {
  try {
    const project = req.resource;
    const parentProject = req.body.parentProject ?? null;
    let destinationWorkspace;
    let newAncestors = [];

    if (parentProject !== null) {
      const dest = await Project.findById(parentProject);
      if (!dest) return res.status(404).json({ error: { message: "Project not found" } });
      if (dest.archivedAt)
        return res.status(400).json({ error: { message: "Restore the destination project before moving into it" } });
      await assertRole(req.user.id, dest, "writer");
      if (dest._id.equals(project._id) || dest.ancestors.some((id) => id.equals(project._id)))
        return res.status(400).json({ error: { message: "Cannot move a project into itself or its descendant" } });
      destinationWorkspace = await Workspace.findById(dest.workspace);
      newAncestors = [...dest.ancestors, dest._id];
    } else {
      destinationWorkspace = await Workspace.findById(req.body.workspace || project.workspace);
      if (!destinationWorkspace)
        return res.status(404).json({ error: { message: "Workspace not found" } });
      await assertRole(req.user.id, destinationWorkspace, "writer");
    }

    if (!destinationWorkspace.superWorkspace.equals(project.superWorkspace))
      return res.status(400).json({ error: { message: "Projects can only move between workspaces in the same account" } });

    await assertSiblingNameFree(Project, {
      filter: { workspace: destinationWorkspace._id, parentProject },
      name: project.name,
      excludeId: project._id,
    });

    project.parentProject = parentProject;
    project.ancestors = newAncestors;
    project.workspace = destinationWorkspace._id;
    project.updatedBy = req.user.id;
    await project.save();

    // Containment metadata only — bypasses history/versioning, same rationale as
    // cascade.js (ancestors/parentProject aren't Revision CONTENT_FIELDS). Chains
    // are recomputed in memory from parent pointers, then written per doc.
    const descendants = await Project.find({ ancestors: project._id }, "_id parentProject")
      .setOptions({ withDeleted: true });
    const byId = new Map(descendants.map((d) => [String(d._id), d]));
    const resolved = new Map([[String(project._id), project.ancestors]]);
    const ancestorsOf = (id) => {
      const key = String(id);
      if (resolved.has(key)) return resolved.get(key);
      const doc = byId.get(key);
      const chain = [...ancestorsOf(doc.parentProject), doc.parentProject];
      resolved.set(key, chain);
      return chain;
    };
    await Promise.all(
      descendants.map((d) => Project.updateOne(
        { _id: d._id },
        { ancestors: ancestorsOf(d._id), workspace: destinationWorkspace._id, updatedBy: req.user.id }
      ))
    );

    const projectIds = [project._id, ...descendants.map((d) => d._id)];
    await Promise.all(
      [Task, Note, Goal, Link, Attachment].map((Model) =>
        Model.updateMany(
          { project: { $in: projectIds } },
          { workspace: destinationWorkspace._id, updatedBy: req.user.id }
        )
      ).concat([
        Comment.updateMany(
          { project: { $in: projectIds } },
          { workspace: destinationWorkspace._id, updatedBy: req.user.id }
        ),
        Suggestion.updateMany(
          { project: { $in: projectIds } },
          { workspace: destinationWorkspace._id }
        ),
      ])
    );

    res.json({ data: project, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

const deleteProject = async (req, res, next) => {
  try {
    const project = req.resource;
    // Cascade first, then the root — children ride the root's `at` for restore.
    const at = new Date();
    await softCascadeProject(project._id, req.user.id, at);
    await project.softDelete(req.user.id, at);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const archiveProject = async (req, res, next) => {
  try {
    const project = req.resource;
    if (project.archivedAt)
      return res.status(409).json({ error: { message: "Project is already archived" } });
    const at = new Date();
    await Project.updateMany(
      { $or: [{ _id: project._id }, { ancestors: project._id }], archivedAt: null },
      { archivedAt: at, archivedBy: req.user.id, updatedBy: req.user.id }
    );
    project.archivedAt = at;
    project.archivedBy = req.user.id;
    res.json({ data: project, archivedTree: true });
  } catch (err) {
    next(err);
  }
};

const restoreProject = async (req, res, next) => {
  try {
    const project = req.resource;
    if (!project.archivedAt)
      return res.status(409).json({ error: { message: "Project is not archived" } });
    if (project.ancestors.length) {
      const archivedParent = await Project.findOne({
        _id: { $in: project.ancestors },
        archivedAt: { $ne: null },
      });
      if (archivedParent)
        return res.status(409).json({ error: { message: "Restore the parent project first" } });
    }
    const archivedAt = project.archivedAt;
    await Project.updateMany(
      {
        $or: [
          { _id: project._id },
          { ancestors: project._id, archivedAt },
        ],
      },
      { archivedAt: null, archivedBy: null, updatedBy: req.user.id }
    );
    project.archivedAt = null;
    project.archivedBy = null;
    res.json({ data: project, restoredTree: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProjects,
  getOneProject,
  createProject,
  updateProject,
  moveProject,
  archiveProject,
  restoreProject,
  deleteProject,
};
