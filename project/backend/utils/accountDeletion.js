const fsp = require("fs/promises");
const path = require("path");

const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Note = require("../models/Note");
const Goal = require("../models/Goal");
const Link = require("../models/Link");
const Attachment = require("../models/Attachment");
const Membership = require("../models/Membership");
const Revision = require("../models/Revision");
const Comment = require("../models/Comment");
const SuperWorkspace = require("../models/SuperWorkspace");
const User = require("../models/User");
const Session = require("../models/Session");
const { filePathFor } = require("./uploadStore");
const { hardDeleteWorkspace } = require("./cascade");

const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(__dirname, "..", "backups");

// Full server-side export of an owner's tenant, written BEFORE purge (export-then-purge:
// restore is a manual operator job, so this folder is everything they'd need). Every
// content query opts into withDeleted — trashed content is still data.
async function exportAccountBackup(user, tenant) {
  const workspaces = await Workspace.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const projects = await Project.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const tasks = await Task.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const notes = await Note.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const goals = await Goal.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const links = await Link.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const attachments = await Attachment.find({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
  const comments = await Comment.find({ createdBy: user._id }).setOptions({ withDeleted: true }); // P61: Comment now soft-deletes — a still-hidden thread is still the user's data

  // Both directions: grants others hold on this tenant AND grants this user holds elsewhere.
  const memberships = await Membership.find({
    $or: [{ superWorkspace: tenant._id }, { user: user._id }],
  });

  // Same id-collection approach as cascade.hardDeleteWorkspace: revisions of the
  // tenant's workspaces plus every resource under them.
  const resourceIds = [
    ...workspaces.map((w) => w._id),
    ...projects.map((p) => p._id),
    ...tasks.map((t) => t._id),
    ...notes.map((n) => n._id),
    ...goals.map((g) => g._id),
    ...links.map((l) => l._id),
    ...attachments.map((a) => a._id),
  ];
  const revisions = await Revision.find({ resource: { $in: resourceIds } });

  const now = new Date();
  const name = `${user.username}-${now.toISOString().replace(/[:.]/g, "-")}`;
  const folder = path.join(BACKUPS_DIR, name);
  // Belt-and-suspenders behind the register-time username charset rule
  // (validators/authValidators.js): a username that somehow carries path
  // segments must never write outside the backups dir. Deliberately vague
  // message — no path echo.
  if (!path.resolve(folder).startsWith(path.resolve(BACKUPS_DIR) + path.sep)) {
    throw new Error("Backup destination rejected");
  }
  const filesDir = path.join(folder, "files");
  await fsp.mkdir(filesDir, { recursive: true });

  // user arrives with +passwordHash selected (needed for the delete-confirmation
  // check by the caller) — strip it from the exported copy.
  const sanitizedUser = user.toObject();
  delete sanitizedUser.passwordHash;

  const account = {
    exportedAt: now.toISOString(),
    user: sanitizedUser,
    superWorkspace: tenant,
    workspaces,
    projects,
    tasks,
    notes,
    goals,
    links,
    attachments,
    memberships,
    revisions,
    comments,
  };
  await fsp.writeFile(path.join(folder, "account.json"), JSON.stringify(account, null, 2));

  // Copy-then-delete, never move: the purge that follows must stay reusable on
  // its own. Skip silently if the binary is missing on disk — a doc-only backup
  // beats a crashed deletion.
  for (const attachment of attachments) {
    try {
      await fsp.copyFile(filePathFor(attachment.storageKey), path.join(filesDir, attachment.storageKey));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  return folder;
}

// tenant is the owner's SuperWorkspace doc, or null for an agent (agents own nothing).
async function purgeAccount(user, tenant) {
  // Fix-forward for comments only (do NOT backfill the pre-existing Suggestion
  // gap): a thread the user authored, or a reply they wrote on someone else's
  // thread — possibly in a tenant that isn't theirs — must not survive their
  // account. Redundant-but-harmless overlap with hardDeleteWorkspace below,
  // which also sweeps comments on notes inside the user's OWN tenant.
  await Comment.deleteMany({ createdBy: user._id });
  await Comment.updateMany({}, { $pull: { replies: { author: user._id } } });

  if (tenant) {
    const workspaceIds = await Workspace.distinct("_id", { superWorkspace: tenant._id }).setOptions({ withDeleted: true });
    for (const workspaceId of workspaceIds) {
      await hardDeleteWorkspace(workspaceId); // purges children, grants, revisions, file binaries — not the Workspace doc itself
    }
    await Workspace.deleteMany({ superWorkspace: tenant._id }).setOptions({ withDeleted: true });
    await Membership.deleteMany({
      $or: [{ superWorkspace: tenant._id }, { user: user._id }],
    });
    await Session.deleteMany({ user: user._id }); // the token dies with the account
    await SuperWorkspace.deleteOne({ _id: tenant._id });
    await User.deleteOne({ _id: user._id });
  } else {
    await Membership.deleteMany({ user: user._id });
    await Session.deleteMany({ user: user._id }); // the token dies with the account
    await User.deleteOne({ _id: user._id });
  }
}

module.exports = { exportAccountBackup, purgeAccount };
