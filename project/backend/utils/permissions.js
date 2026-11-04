const SuperWorkspace = require("../models/SuperWorkspace");
const Membership = require("../models/Membership");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");

// Single source of truth for authorization: the authorize middleware, scoped list
// queries, and effective-role annotations all resolve through here.

const RANK = { reader: 1, suggester: 2, writer: 3, owner: 4 };

// Is role at least required, on the reader < suggester < writer < owner ladder?
function roleAtLeast(role, required) {
  return Boolean(role) && RANK[role] >= RANK[required];
}

// A ref field may hold a plain ObjectId or a populated doc; always compare on the id.
// (ObjectId.equals(populatedDoc) is silently false, which would skip valid grants.)
function idOf(ref) {
  return ref && ref._id ? ref._id : ref;
}

// Which workspace/project a doc sits in, for grant matching.
function containmentOf(doc) {
  switch (doc.constructor.modelName) {
    case "SuperWorkspace":
      return { workspaceId: null, projectId: null };
    case "Workspace":
      return { workspaceId: doc._id, projectId: null };
    case "Project":
      return { workspaceId: idOf(doc.workspace), projectId: doc._id };
    default: // Task, Note, and future project-contained resources
      return { workspaceId: idOf(doc.workspace), projectId: idOf(doc.project) };
  }
}

// A chain param may be a chain array (self-first, nearest->root), a bare id, or
// null/undefined (no containment at that level) — normalize once so callers old
// and new both work.
function normalizeChain(chain) {
  if (chain === null || chain === undefined) return [];
  return Array.isArray(chain) ? chain : [chain];
}

// The role of the best (highest-ranked) membership matching `field` against the
// first chain link that has ANY match — walking self-first means the nearest
// granted ancestor wins outright, never compared against a farther one.
function bestInChain(memberships, field, chain) {
  for (const link of chain) {
    const linkId = idOf(link);
    if (!linkId) continue;
    let hit = null;
    for (const m of memberships) {
      if (m[field] && m[field].equals(linkId)) {
        if (!hit || RANK[m.role] > RANK[hit.role]) hit = m;
      }
    }
    if (hit) return hit.role;
  }
  return null;
}

// Role resolution has two levels: workspace beats tenant-wide. Projects inherit
// their workspace grant and are never shared independently.
function resolveRole(memberships, superWorkspaceId, workspaceChain, projectChain) {
  const workspaceHit = bestInChain(memberships, "workspace", normalizeChain(workspaceChain));
  if (workspaceHit) return workspaceHit;

  let tenantRole = null;
  for (const m of memberships) {
    if (!m.workspace && m.superWorkspace.equals(superWorkspaceId)) {
      if (!tenantRole || RANK[m.role] > RANK[tenantRole]) tenantRole = m.role;
    }
  }
  return tenantRole;
}

// Batched ancestor-chain lookup for effectiveRole/withEffectiveRole: one query per
// level instead of one per doc. Chain = [id, ...ancestors reversed] since ancestors
// is stored root-first but resolution order is self-first, nearest->root. An id
// that isn't found in the DB (deleted, or simply not fetched) still maps to a
// valid one-link chain of itself, so callers never need a null-check.
async function chainMaps(workspaceIds, projectIds) {
  const dedupe = (refs) => {
    const map = new Map(); // idString -> id
    for (const ref of refs) {
      const id = idOf(ref);
      if (id) map.set(String(id), id);
    }
    return map;
  };
  const wsIdMap = dedupe(workspaceIds);
  const projIdMap = dedupe(projectIds);

  const [wsDocs, projDocs] = await Promise.all([
    wsIdMap.size ? Workspace.find({ _id: { $in: [...wsIdMap.values()] } }).select("_id") : [],
    projIdMap.size ? Project.find({ _id: { $in: [...projIdMap.values()] } }).select("ancestors") : [],
  ]);

  const wsChains = new Map();
  for (const [key, id] of wsIdMap) wsChains.set(key, [id]);
  for (const doc of wsDocs) wsChains.set(String(doc._id), [doc._id]);

  const projChains = new Map();
  for (const [key, id] of projIdMap) projChains.set(key, [id]);
  for (const doc of projDocs) projChains.set(String(doc._id), [doc._id, ...(doc.ancestors || []).slice().reverse()]);

  return { wsChains, projChains };
}

// Enforcement choke point: pending and expired grants must be invisible to every
// list, authorize, and assertRole. `expiresAt: null` also matches missing-field
// docs in Mongo, which is intended (no expiresAt = never expires).
function liveGrantFilter() {
  return { status: "active", $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };
}

// The full answer for one loaded doc: "owner" | "writer" | "reader" | null.
// Two indexed queries, run in parallel; owner wins outright.
async function effectiveRole(userId, doc) {
  const superWorkspaceId =
    doc.constructor.modelName === "SuperWorkspace" ? doc._id : idOf(doc.superWorkspace);
  const [owned, memberships] = await Promise.all([
    SuperWorkspace.exists({ _id: superWorkspaceId, owner: userId }),
    Membership.find({ user: userId, superWorkspace: superWorkspaceId, ...liveGrantFilter() }),
  ]);
  if (owned) return "owner";
  const { workspaceId, projectId } = containmentOf(doc);
  const { wsChains, projChains } = await chainMaps(workspaceId ? [workspaceId] : [], projectId ? [projectId] : []);
  const workspaceChain = workspaceId ? wsChains.get(String(workspaceId)) : [];
  const projectChain = projectId ? projChains.get(String(projectId)) : [];
  return resolveRole(memberships, superWorkspaceId, workspaceChain, projectChain);
}

// Everything the user can see, as ready-made find() conditions per collection
// level. One membership sweep; an empty $in list simply matches nothing, so a
// user with no grants (or an agent, which owns no tenant) sees exactly what
// they were given and nothing else.
async function accessibleFilters(userId) {
  const [own, memberships] = await Promise.all([
    SuperWorkspace.findOne({ owner: userId }),
    Membership.find({ user: userId, ...liveGrantFilter() }),
  ]);

  const tenantWide = own ? [own._id] : [];
  const workspaces = [];
  for (const m of memberships) {
    if (m.workspace) workspaces.push(m.workspace);
    else tenantWide.push(m.superWorkspace);
  }

  return {
    ownSuperWorkspaceId: own ? own._id : null,
    memberships,
    workspaceFilter: {
      $or: [{ superWorkspace: { $in: tenantWide } }, { _id: { $in: workspaces } }],
    },
    projectFilter: {
      $or: [
        { superWorkspace: { $in: tenantWide } },
        { workspace: { $in: workspaces } },
      ],
    },
    itemFilter: {
      $or: [
        { superWorkspace: { $in: tenantWide } },
        { workspace: { $in: workspaces } },
      ],
    },
  };
}

module.exports = { effectiveRole, roleAtLeast, resolveRole, accessibleFilters, liveGrantFilter, chainMaps };
