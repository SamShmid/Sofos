#!/usr/bin/env node
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const mongoose = require("mongoose");

if (!process.env.MONGODB_URI) {
  console.error("Refusing to run without an explicit MONGODB_URI for an isolated test database.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const oid = () => new mongoose.Types.ObjectId();
const same = (left, right) => String(left) === String(right);
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`Check ${checks} failed. ${message}`);
}

async function fixture(db) {
  await db.dropDatabase();
  const now = new Date();
  const owner = oid();
  const grantee = oid();
  const secondGrantee = oid();
  const tenant = oid();
  const root = oid();
  const nested = oid();
  const deep = oid();
  const rootGeneral = oid();
  const nestedGeneral = oid();
  const project = oid();
  const archive = oid();
  const archiveChild = oid();
  const taggedArchive = oid();
  const taggedArchiveChild = oid();
  const rootTask = oid();
  const nestedTask = oid();
  const projectTask = oid();
  const deepNote = oid();

  const base = { createdAt: now, updatedAt: now, __v: 0, deletedAt: null };
  await db.collection("users").insertMany([
    { _id: owner, username: "owner", passwordHash: "unused", shareCode: `${String.fromCharCode(89, 84)}-ABCDEFGH`, isAgent: false, ...base },
    { _id: grantee, username: "grantee", passwordHash: "unused", shareCode: `${String.fromCharCode(89, 84)}-BCDEFGHJ`, isAgent: false, ...base },
    { _id: secondGrantee, username: "second", passwordHash: "unused", shareCode: `${String.fromCharCode(89, 84)}-CDEFGHJK`, isAgent: false, ...base },
  ]);
  await db.collection("superworkspaces").insertOne({ _id: tenant, name: "Owner", owner, ...base });
  await db.collection("workspaces").insertMany([
    { _id: root, name: "Work", isDefault: false, superWorkspace: tenant, createdBy: owner, updatedBy: owner, ancestors: [], ...base },
    { _id: nested, name: "Client", isDefault: false, parentWorkspace: root, ancestors: [root], superWorkspace: tenant, createdBy: owner, updatedBy: owner, ...base },
    { _id: deep, name: "Delivery", isDefault: false, parentWorkspace: nested, ancestors: [root, nested], superWorkspace: tenant, createdBy: owner, updatedBy: owner, ...base },
  ]);
  await db.collection("projects").insertMany([
    { _id: rootGeneral, name: "General", isDefault: true, workspace: root, parentProject: null, ancestors: [], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: [], ...base },
    { _id: nestedGeneral, name: "General", isDefault: true, workspace: nested, parentProject: null, ancestors: [], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: [], ...base },
    { _id: project, name: "Email assistant", isDefault: false, workspace: nested, parentProject: null, ancestors: [], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: ["waiting"], ...base },
    { _id: archive, name: "Academic Archive", isDefault: false, workspace: root, parentProject: null, ancestors: [], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: [], ...base },
    { _id: archiveChild, name: "Old course", isDefault: false, workspace: root, parentProject: archive, ancestors: [archive], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: [], ...base },
    { _id: taggedArchive, name: "Dormant client", isDefault: false, workspace: root, parentProject: null, ancestors: [], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: ["archive"], ...base },
    { _id: taggedArchiveChild, name: "Dormant deliverable", isDefault: false, workspace: root, parentProject: taggedArchive, ancestors: [taggedArchive], superWorkspace: tenant, createdBy: owner, updatedBy: owner, tags: [], ...base },
  ]);
  await db.collection("tasks").insertMany([
    { _id: rootTask, title: "Root direct", workspace: root, project: rootGeneral, superWorkspace: tenant, createdBy: owner, updatedBy: owner, order: 0, status: "todo", completed: false, ancestors: [], ...base },
    { _id: nestedTask, title: "Nested direct", workspace: nested, project: nestedGeneral, superWorkspace: tenant, createdBy: owner, updatedBy: owner, order: 0, status: "todo", completed: false, ancestors: [], ...base },
    { _id: projectTask, title: "Project task", workspace: nested, project, superWorkspace: tenant, createdBy: owner, updatedBy: owner, order: 0, status: "todo", completed: false, ancestors: [], ...base },
  ]);
  await db.collection("notes").insertOne({ _id: deepNote, title: "Deep direct", content: "preserve me", workspace: deep, superWorkspace: tenant, createdBy: owner, updatedBy: owner, ...base });
  await db.collection("memberships").insertMany([
    { _id: oid(), user: grantee, superWorkspace: tenant, workspace: root, role: "reader", status: "active", ...base },
    { _id: oid(), user: grantee, superWorkspace: tenant, project, role: "writer", status: "active", ...base },
    { _id: oid(), user: secondGrantee, superWorkspace: tenant, workspace: nested, role: "reader", status: "active", ...base },
  ]);
  return { tenant, root, nested, deep, rootGeneral, nestedGeneral, project, archive, archiveChild, taggedArchive, taggedArchiveChild, rootTask, nestedTask, projectTask, deepNote, grantee, secondGrantee };
}

async function main() {
  await mongoose.connect(uri, { autoIndex: false });
  if (!mongoose.connection.name.includes("test")) throw new Error("Migration tests require a database name containing test");
  const db = mongoose.connection.db;
  const ids = await fixture(db);
  await mongoose.disconnect();

  const migration = path.join(__dirname, "migrate-sofos-v4.js");
  const env = { ...process.env, MONGODB_URI: uri };
  const refused = spawnSync(process.execPath, [migration, "--apply"], { env, encoding: "utf8" });
  ok(refused.status !== 0 && refused.stderr.includes("--promote-grants"), "Apply must refuse to widen legacy grants without explicit consent");

  await mongoose.connect(uri, { autoIndex: false });
  ok(await mongoose.connection.db.collection("workspaces").findOne({ _id: ids.nested }), "A refused apply must not mutate nested workspaces");
  await mongoose.disconnect();

  execFileSync(process.execPath, [migration, "--apply", "--promote-grants"], { env, stdio: "pipe" });
  execFileSync(process.execPath, [migration, "--apply", "--promote-grants"], { env, stdio: "pipe" });

  await mongoose.connect(uri, { autoIndex: false });
  const finalDb = mongoose.connection.db;
  ok(!(await finalDb.collection("workspaces").findOne({ _id: ids.nested })), "Converted nested workspaces must be removed");
  ok(!(await finalDb.collection("workspaces").findOne({ _id: ids.deep })), "Deep nested workspaces must be removed");
  const nestedProject = await finalDb.collection("projects").findOne({ _id: ids.nested });
  const deepProject = await finalDb.collection("projects").findOne({ _id: ids.deep });
  ok(nestedProject && same(nestedProject.workspace, ids.root) && nestedProject.parentProject == null, "A nested workspace must become a top-level project in its root workspace");
  ok(deepProject && same(deepProject.parentProject, ids.nested) && deepProject.ancestors.some((ancestor) => same(ancestor, ids.nested)), "Nested workspace depth must become project depth");
  ok(!(await finalDb.collection("projects").findOne({ _id: ids.rootGeneral })) && !(await finalDb.collection("projects").findOne({ _id: ids.nestedGeneral })), "General projects must be removed");

  const rootTask = await finalDb.collection("tasks").findOne({ _id: ids.rootTask });
  const nestedTask = await finalDb.collection("tasks").findOne({ _id: ids.nestedTask });
  const projectTask = await finalDb.collection("tasks").findOne({ _id: ids.projectTask });
  const deepNote = await finalDb.collection("notes").findOne({ _id: ids.deepNote });
  ok(rootTask.project == null && same(rootTask.workspace, ids.root), "Root General content must become direct workspace content");
  ok(same(nestedTask.project, ids.nested) && same(nestedTask.workspace, ids.root), "Nested General content must move onto the converted project");
  ok(same(projectTask.project, ids.project) && same(projectTask.workspace, ids.root), "Existing project content must keep its project and receive the root workspace");
  ok(same(deepNote.project, ids.deep) && same(deepNote.workspace, ids.root), "Direct deep-workspace content must move onto the converted deep project");

  const normalizedProject = await finalDb.collection("projects").findOne({ _id: ids.project });
  const archive = await finalDb.collection("projects").findOne({ _id: ids.archive });
  const archiveChild = await finalDb.collection("projects").findOne({ _id: ids.archiveChild });
  const taggedArchive = await finalDb.collection("projects").findOne({ _id: ids.taggedArchive });
  const taggedArchiveChild = await finalDb.collection("projects").findOne({ _id: ids.taggedArchiveChild });
  ok(normalizedProject.status === "blocked" && same(normalizedProject.parentProject, ids.nested), "Waiting projects must become blocked and stay under the converted workspace project");
  ok(archive.archivedAt && archiveChild.archivedAt, "The Academic Archive tree must become archived");
  ok(taggedArchive.archivedAt && taggedArchiveChild.archivedAt, "An archive-tagged project tree must become archived");
  ok(taggedArchive.archivedAt.getTime() === taggedArchiveChild.archivedAt.getTime(), "An archive-tagged tree must share one restoration timestamp");

  const granteeMemberships = await finalDb.collection("memberships").find({ user: ids.grantee }).toArray();
  const secondMemberships = await finalDb.collection("memberships").find({ user: ids.secondGrantee }).toArray();
  ok(granteeMemberships.length === 1 && granteeMemberships[0].role === "writer" && same(granteeMemberships[0].workspace, ids.root) && !granteeMemberships[0].project, "Promoted grants must deduplicate at the strongest role");
  ok(secondMemberships.length === 1 && same(secondMemberships[0].workspace, ids.root), "Nested-workspace grants must promote to the root workspace");
  const badShareCodes = await finalDb.collection("users").countDocuments({ shareCode: { $not: /^SF-/ } });
  ok(badShareCodes === 0, "Legacy share codes must receive the SF prefix");
  ok(await finalDb.collection("migrationstates").findOne({ name: "sofos-v4-flat-workspaces" }), "Migration completion must be recorded");

  await finalDb.collection("users").insertOne({
    _id: oid(),
    username: "collision",
    passwordHash: "unused",
    shareCode: `${String.fromCharCode(89, 84)}-ABCDEFGH`,
    isAgent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    __v: 0,
  });
  await mongoose.disconnect();

  const collision = spawnSync(process.execPath, [migration], { env, encoding: "utf8" });
  ok(collision.status !== 0 && collision.stderr.includes("Share code collision"), "A projected share-code collision must fail before migration");

  console.log(`Sofos v4 migration suite passed ${checks} checks.`);
}

main().catch(async (error) => {
  console.error(error.stack || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
