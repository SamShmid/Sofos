#!/usr/bin/env node
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const PROMOTE_GRANTS = process.argv.includes("--promote-grants");
const MIGRATION = "sofos-v4-flat-workspaces";
const ROLE_RANK = { reader: 1, suggester: 2, writer: 3 };
const CONTENT_COLLECTIONS = ["tasks", "notes", "goals", "links", "attachments", "comments", "suggestions"];

const id = (value) => value == null ? null : String(value);
const live = (doc) => doc.deletedAt == null;
const uniq = (values) => [...new Set(values.filter(Boolean))];

function hasTag(project, candidates) {
  const tags = (project.tags || []).map((tag) => String(tag).trim().toLowerCase());
  return candidates.some((candidate) => tags.includes(candidate));
}

function fail(message) {
  const error = new Error(message);
  error.expected = true;
  throw error;
}

async function main() {
  if (!process.env.MONGODB_URI) fail("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const db = mongoose.connection.db;

  const [workspaces, projects, memberships, users] = await Promise.all([
    db.collection("workspaces").find({}).toArray(),
    db.collection("projects").find({}).toArray(),
    db.collection("memberships").find({}).toArray(),
    db.collection("users").find({}).toArray(),
  ]);

  const workspaceById = new Map(workspaces.map((doc) => [id(doc._id), doc]));
  const projectById = new Map(projects.map((doc) => [id(doc._id), doc]));
  const sharePrefix = String.fromCharCode(89, 84) + "-";
  const projectedShareCode = (user) => typeof user.shareCode === "string" && user.shareCode.startsWith(sharePrefix)
    ? `SF-${user.shareCode.slice(sharePrefix.length)}`
    : user.shareCode;
  const usersByProjectedShareCode = new Map();
  for (const user of users) {
    const code = projectedShareCode(user);
    if (!code) continue;
    if (!usersByProjectedShareCode.has(code)) usersByProjectedShareCode.set(code, []);
    usersByProjectedShareCode.get(code).push(user);
  }
  const shareCodeCollisions = [...usersByProjectedShareCode]
    .filter(([, matchingUsers]) => matchingUsers.length > 1);
  if (shareCodeCollisions.length) {
    fail(`Share code collision after prefix migration for ${shareCodeCollisions.map(([code]) => code).join(", ")}`);
  }
  const liveWorkspaces = workspaces.filter(live);
  const liveProjects = projects.filter(live);
  const nestedWorkspaces = liveWorkspaces.filter((doc) => doc.parentWorkspace);
  const trashedNestedWorkspaces = workspaces.filter((doc) => !live(doc) && doc.parentWorkspace);
  const generalProjects = liveProjects.filter((doc) => doc.isDefault);
  const trashedGeneralProjects = projects.filter((doc) => !live(doc) && doc.isDefault);

  const rootCache = new Map();
  function rootOfWorkspace(workspaceId) {
    const key = id(workspaceId);
    if (rootCache.has(key)) return rootCache.get(key);
    const seen = new Set();
    let current = workspaceById.get(key);
    if (!current) fail(`Workspace ${key} is missing`);
    while (current.parentWorkspace) {
      const currentId = id(current._id);
      if (seen.has(currentId)) fail(`Workspace cycle includes ${currentId}`);
      seen.add(currentId);
      current = workspaceById.get(id(current.parentWorkspace));
      if (!current) fail(`Workspace ${currentId} has missing parent ${id(workspaceById.get(currentId)?.parentWorkspace)}`);
    }
    rootCache.set(key, current);
    return current;
  }

  const convertedByWorkspace = new Map();
  const convertedRootByWorkspace = new Map();
  for (const workspace of nestedWorkspaces) {
    convertedByWorkspace.set(id(workspace._id), workspace._id);
    convertedRootByWorkspace.set(id(workspace._id), rootOfWorkspace(workspace._id)._id);
  }
  for (const project of projects) {
    if (project._migration?.name === MIGRATION && project._migration?.sourceWorkspace) {
      convertedByWorkspace.set(id(project._migration.sourceWorkspace), project._id);
      if (project._migration.rootWorkspace) {
        convertedRootByWorkspace.set(id(project._migration.sourceWorkspace), project._migration.rootWorkspace);
      }
    }
  }
  const rootForConverted = (workspaceId) => {
    const root = convertedRootByWorkspace.get(id(workspaceId));
    if (!root) fail(`Converted workspace ${id(workspaceId)} has no recorded root workspace`);
    return root;
  };

  const collisions = nestedWorkspaces.filter((workspace) => {
    const existing = projectById.get(id(workspace._id));
    return existing && existing._migration?.name !== MIGRATION;
  });
  if (collisions.length) fail(`Project id collision for ${collisions.map((doc) => id(doc._id)).join(", ")}`);

  const generalByWorkspace = new Map(generalProjects.map((doc) => [id(doc.workspace), doc]));
  const generalIds = new Set(generalProjects.map((doc) => id(doc._id)));

  const projectWorkspace = (project) => project && workspaceById.get(id(project.workspace));
  const owningRootForMembership = (membership) => {
    if (membership.project) {
      const project = projectById.get(id(membership.project));
      if (!project) fail(`Membership ${id(membership._id)} targets missing project ${id(membership.project)}`);
      return rootOfWorkspace(project.workspace)._id;
    }
    if (membership.workspace && convertedByWorkspace.has(id(membership.workspace))) {
      return rootForConverted(membership.workspace);
    }
    return membership.workspace || null;
  };

  const scopedLegacyGrants = memberships.filter((membership) =>
    membership.project || (membership.workspace && convertedByWorkspace.has(id(membership.workspace)))
  );
  if (APPLY && scopedLegacyGrants.length && !PROMOTE_GRANTS) {
    fail("Legacy project or nested-workspace grants exist. Run a dry run, review its legacyScopedGrants report, then explicitly add --promote-grants if widening each grant to its top-level workspace is acceptable.");
  }

  const projectPlans = new Map();
  for (const workspace of nestedWorkspaces) {
    const root = rootOfWorkspace(workspace._id);
    const parentProject = workspace.parentWorkspace && convertedByWorkspace.has(id(workspace.parentWorkspace))
      ? convertedByWorkspace.get(id(workspace.parentWorkspace))
      : null;
    projectPlans.set(id(workspace._id), {
      _id: workspace._id,
      name: workspace.name,
      description: workspace.description || "",
      tags: [],
      status: "active",
      archivedAt: null,
      archivedBy: null,
      workspace: root._id,
      parentProject,
      ancestors: [],
      boardOrder: workspace.boardOrder ?? null,
      superWorkspace: workspace.superWorkspace,
      createdBy: workspace.createdBy,
      updatedBy: workspace.updatedBy || workspace.createdBy,
      createdAt: workspace.createdAt || new Date(),
      updatedAt: workspace.updatedAt || new Date(),
      deletedAt: null,
      __v: 0,
      _migration: { name: MIGRATION, sourceWorkspace: workspace._id, rootWorkspace: root._id, migratedAt: new Date() },
    });
  }

  for (const project of liveProjects.filter((doc) => !doc.isDefault)) {
    const root = rootOfWorkspace(project.workspace);
    const baseParent = convertedByWorkspace.get(id(project.workspace)) || null;
    const oldParent = project.parentProject && !generalIds.has(id(project.parentProject)) ? project.parentProject : null;
    projectPlans.set(id(project._id), {
      ...project,
      workspace: root._id,
      parentProject: oldParent || baseParent,
      status: project.status || (hasTag(project, ["blocked", "waiting", "on hold", "on-hold"]) ? "blocked"
        : hasTag(project, ["complete", "completed", "done"]) ? "completed" : "active"),
      archivedAt: project.archivedAt || null,
      archivedBy: project.archivedBy || null,
      _migration: project._migration,
    });
  }

  const ancestorCache = new Map();
  function ancestorsOfProject(projectId, visiting = new Set()) {
    const key = id(projectId);
    if (ancestorCache.has(key)) return ancestorCache.get(key);
    if (visiting.has(key)) fail(`Project cycle includes ${key}`);
    const project = projectPlans.get(key);
    if (!project) fail(`Project ${key} has a missing parent during migration`);
    visiting.add(key);
    const chain = project.parentProject
      ? [...ancestorsOfProject(project.parentProject, visiting), project.parentProject]
      : [];
    visiting.delete(key);
    ancestorCache.set(key, chain);
    return chain;
  }
  for (const project of projectPlans.values()) project.ancestors = ancestorsOfProject(project._id);

  const archiveRoots = [...projectPlans.values()]
    .filter((project) => project.archivedAt ||
      hasTag(project, ["archive", "archived"]) ||
      project.name?.trim().toLowerCase() === "academic archive")
    .sort((left, right) => left.ancestors.length - right.ancestors.length);
  const archivedProjectIds = new Set();
  const ambiguousProjects = [];
  for (const root of archiveRoots) {
    const archivedAt = root.archivedAt || new Date();
    for (const project of projectPlans.values()) {
      if (id(project._id) !== id(root._id) &&
        !(project.ancestors || []).some((ancestor) => id(ancestor) === id(root._id))) continue;
      if (!project.archivedAt) project.archivedAt = archivedAt;
      project.archivedBy = project.archivedBy || root.archivedBy || root.updatedBy || root.createdBy;
      archivedProjectIds.add(id(project._id));
    }
  }
  for (const project of projectPlans.values()) {
    if (hasTag(project, ["shipped-maintenance", "shipped maintenance"])) {
      ambiguousProjects.push({ _id: id(project._id), name: project.name, reason: "shipped-maintenance tag needs a human status decision" });
    }
  }

  const contentCounts = {};
  const contentOperations = [];
  for (const name of CONTENT_COLLECTIONS) {
    const collection = db.collection(name);
    let changed = 0;
    for (const [workspaceId, convertedProjectId] of convertedByWorkspace) {
      const rootId = rootForConverted(workspaceId);
      const general = generalByWorkspace.get(workspaceId);
      const directFilter = {
        workspace: new mongoose.Types.ObjectId(workspaceId),
        $or: [
          { project: null },
          { project: { $exists: false } },
          ...(general ? [{ project: general._id }] : []),
        ],
      };
      changed += await collection.countDocuments(directFilter);
      contentOperations.push({ name, filter: directFilter, update: { $set: { workspace: rootId, project: convertedProjectId } } });

      const otherFilter = {
        workspace: new mongoose.Types.ObjectId(workspaceId),
        project: { $exists: true, $nin: general ? [general._id, null] : [null] },
      };
      changed += await collection.countDocuments(otherFilter);
      contentOperations.push({ name, filter: otherFilter, update: { $set: { workspace: rootId } } });
    }
    for (const rootWorkspace of liveWorkspaces.filter((workspace) => !workspace.parentWorkspace)) {
      const general = generalByWorkspace.get(id(rootWorkspace._id));
      if (!general) continue;
      const filter = { workspace: rootWorkspace._id, project: general._id };
      changed += await collection.countDocuments(filter);
      contentOperations.push({ name, filter, update: { $set: { project: null } } });
    }
    contentCounts[name] = changed;
  }

  const shareCodeChanges = users.filter((user) => typeof user.shareCode === "string" && user.shareCode.startsWith(sharePrefix));

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    database: mongoose.connection.name,
    nestedWorkspacesToConvert: nestedWorkspaces.length,
    convertedProjectsAlreadyPresent: [...convertedByWorkspace.keys()].length - nestedWorkspaces.length,
    generalProjectsToRemove: generalProjects.length,
    projectDocumentsToNormalize: projectPlans.size,
    projectsToArchive: archivedProjectIds.size,
    contentDocumentsToMove: contentCounts,
    shareCodesToRename: shareCodeChanges.length,
    legacyScopedGrants: scopedLegacyGrants.map((membership) => ({
      _id: id(membership._id),
      scope: membership.project ? "project" : "nested-workspace",
      targetWorkspace: id(owningRootForMembership(membership)),
    })),
    manualReview: ambiguousProjects,
    excludedTrash: {
      nestedWorkspaces: trashedNestedWorkspaces.map((doc) => ({ _id: id(doc._id), name: doc.name })),
      generalProjects: trashedGeneralProjects.map((doc) => ({ _id: id(doc._id), name: doc.name })),
    },
  };

  if (!APPLY) {
    console.log(JSON.stringify(summary, null, 2));
    console.error("Dry run only. Re-run with --apply after reviewing this report.");
    return;
  }

  const projectsCollection = db.collection("projects");
  for (const project of projectPlans.values()) {
    const replacement = { ...project };
    delete replacement.isDefault;
    if (!replacement._migration) delete replacement._migration;
    await projectsCollection.replaceOne({ _id: project._id }, replacement, { upsert: true });
  }

  for (const operation of contentOperations) {
    await db.collection(operation.name).updateMany(operation.filter, operation.update);
  }

  if (PROMOTE_GRANTS && scopedLegacyGrants.length) {
    const transformed = memberships.map((membership) => ({
      ...membership,
      workspace: owningRootForMembership(membership),
      project: undefined,
    }));
    const groups = new Map();
    for (const membership of transformed) {
      const key = `${id(membership.user)}:${id(membership.superWorkspace)}:${id(membership.workspace) || "tenant"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(membership);
    }
    for (const group of groups.values()) {
      if (!group.some((membership) => memberships.find((old) => id(old._id) === id(membership._id))?.project ||
        convertedByWorkspace.has(id(memberships.find((old) => id(old._id) === id(membership._id))?.workspace)))) continue;
      group.sort((a, b) => (ROLE_RANK[b.role] || 0) - (ROLE_RANK[a.role] || 0));
      const survivor = group[0];
      const status = group.some((membership) => membership.status === "active") ? "active" : "pending";
      const neverExpires = group.some((membership) => !membership.expiresAt);
      const expiresAt = neverExpires ? undefined : new Date(Math.max(...group.map((membership) => new Date(membership.expiresAt).getTime())));
      await db.collection("memberships").deleteMany({ _id: { $in: group.slice(1).map((membership) => membership._id) } });
      const set = { workspace: survivor.workspace, role: survivor.role, status, updatedAt: new Date() };
      if (expiresAt) set.expiresAt = expiresAt;
      await db.collection("memberships").updateOne(
        { _id: survivor._id },
        { $set: set, $unset: { project: "", ...(expiresAt ? {} : { expiresAt: "" }) } }
      );
    }
  }

  for (const user of shareCodeChanges) {
    await db.collection("users").updateOne(
      { _id: user._id },
      { $set: { shareCode: `SF-${user.shareCode.slice(sharePrefix.length)}` } }
    );
  }

  if (generalProjects.length) await projectsCollection.deleteMany({ _id: { $in: generalProjects.map((doc) => doc._id) } });
  if (nestedWorkspaces.length) await db.collection("workspaces").deleteMany({ _id: { $in: nestedWorkspaces.map((doc) => doc._id) } });

  await db.collection("migrationstates").updateOne(
    { name: MIGRATION },
    { $set: { name: MIGRATION, completedAt: new Date(), summary } },
    { upsert: true }
  );

  const models = ["User", "Workspace", "Project", "Task", "Note", "Goal", "Link", "Attachment", "Membership", "Suggestion", "Comment"];
  for (const modelName of models) {
    const Model = require(`../models/${modelName}`);
    await Model.syncIndexes();
  }

  summary.completed = true;
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error.expected ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
