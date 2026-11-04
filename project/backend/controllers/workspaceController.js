const Workspace = require("../models/Workspace");
const SuperWorkspace = require("../models/SuperWorkspace");
const { softCascadeWorkspace } = require("../utils/cascade");
const { accessibleFilters } = require("../utils/permissions");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { assertVersion } = require("../utils/assertVersion");
const { assertRole } = require("../middleware/auth");
const { assertSiblingNameFree } = require("../utils/nameGuard");

// Workspaces are top-level only. A bare list returns the caller's owned and
// shared workspaces; all internal hierarchy lives in projects.
const getWorkspaces = async (req, res, next) => {
  try {
    const { ownSuperWorkspaceId, memberships, workspaceFilter } = await accessibleFilters(req.user.id);

    const sharedTenantIds = [];
    const sharedWorkspaceIds = [];
    for (const m of memberships) {
      if (m.workspace) sharedWorkspaceIds.push(m.workspace);
      else sharedTenantIds.push(m.superWorkspace);
    }

    const [owned, sharedDocs] = await Promise.all([
      ownSuperWorkspaceId
        ? Workspace.find({ superWorkspace: ownSuperWorkspaceId })
            .sort({ isDefault: -1, name: 1 })
            .collation({ locale: "en", strength: 2 })
        : [], // agents own nothing
      Workspace.find({
        $or: [
          { superWorkspace: { $in: sharedTenantIds } },
          { _id: { $in: sharedWorkspaceIds } },
        ],
      })
        .populate("superWorkspace", "name owner") // whose tenant this is, for the "shared by" label
        .sort({ name: 1 })
        .collation({ locale: "en", strength: 2 }),
    ]);

    // Annotate each shared workspace with the caller's role there; ranking is
    // pure over the memberships already in hand, so this costs no queries.
    const shared = await withEffectiveRole(sharedDocs, {
      ownSuperWorkspaceId: null,
      memberships,
      coords: (ws) => [ws.superWorkspace, ws._id, null],
    });

    res.json({
      data: { owned, shared },
      count: { owned: owned.length, shared: shared.length },
    });
  } catch (err) {
    next(err);
  }
};

// authorize("reader", Workspace) already loaded the doc and resolved the caller's
// role; the role rides along so the frontend can decide what controls to show.
const getOneWorkspace = async (req, res, next) => {
  try {
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Workspace creation is always top-level. Owners create in their own account;
// a tenant-wide writer may name that account explicitly.
const createWorkspace = async (req, res, next) => {
  try {
    let superWorkspaceId;

    if (req.body.superWorkspace) {
      const tenant = await SuperWorkspace.findById(req.body.superWorkspace);
      if (!tenant) return res.status(404).json({ error: { message: "Tenant not found" } });
      await assertRole(req.user.id, tenant, "writer");
      superWorkspaceId = tenant._id;
    } else {
      const own = await SuperWorkspace.findOne({ owner: req.user.id });
      if (!own)
        return res.status(403).json({ error: { message: "Only account owners can create workspaces" } });
      superWorkspaceId = own._id;
    }

    await assertSiblingNameFree(Workspace, {
      filter: { superWorkspace: superWorkspaceId },
      name: req.body.name,
    });

    const workspace = await Workspace.create({
      name: req.body.name,
      description: req.body.description,
      superWorkspace: superWorkspaceId,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({ data: workspace });
  } catch (err) {
    next(err);
  }
};

// Load-then-save (not findByIdAndUpdate): Phase 2's optimisticConcurrency only
// guards saves on loaded docs. isDefault is never client-writable.
const updateWorkspace = async (req, res, next) => {
  try {
    const workspace = req.resource;
    assertVersion(req);
    if (req.body.name !== undefined) {
      await assertSiblingNameFree(Workspace, {
        filter: { superWorkspace: workspace.superWorkspace },
        name: req.body.name,
        excludeId: workspace._id,
      });
      workspace.name = req.body.name;
    }
    if (req.body.description !== undefined) workspace.description = req.body.description;
    if (req.body.boardOrder !== undefined) workspace.boardOrder = req.body.boardOrder;
    workspace.updatedBy = req.user.id;
    await workspace.save();
    res.json({ data: workspace, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

const deleteWorkspace = async (req, res, next) => {
  try {
    const workspace = req.resource;
    if (workspace.isDefault)
      return res.status(400).json({ error: { message: "The Home workspace cannot be deleted" } });

    // Cascade first, then the root — the root's revision timestamp matches `at`, and
    // its children carry the same stamp so a restore can revive exactly this cascade.
    const at = new Date();
    await softCascadeWorkspace(workspace._id, req.user.id, at);
    await workspace.softDelete(req.user.id, at);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getWorkspaces,
  getOneWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
};
