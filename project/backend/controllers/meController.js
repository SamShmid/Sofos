const User = require("../models/User");
const Membership = require("../models/Membership");
const SuperWorkspace = require("../models/SuperWorkspace");
const Task = require("../models/Task");
const Goal = require("../models/Goal");
const Project = require("../models/Project");
const { currentVersion, entriesSince, loadEntries } = require("../utils/releaseNotes");
const { accessibleFilters } = require("../utils/permissions");

// Static legend mirroring docs/API_GUIDE.md's "Capability matrix" — short
// summaries only, the guide (linked below as `guide.url`) is the full source.
const ROLE_CAPABILITIES = {
  reader: ["Read/list every resource the grant reaches", "Accept/decline invites addressed to you"],
  suggester: [
    "Everything a reader can do",
    "Propose create/update/delete on tasks, notes, goals, links, attachments, workspaces, and projects via POST /suggestions",
    "Cannot write directly, and cannot approve/reject suggestions (not even your own)",
  ],
  writer: [
    "Everything a suggester can do, plus direct create/update/delete on content resources",
    "Approve or reject any pending suggestion reaching a resource you can write (no self-approval block)",
    "Restore a resource to a past revision",
  ],
  owner: [
    "Everything a writer can do, across the whole tenant",
    "Manage sharing: create/update/revoke memberships (/api/memberships)",
    "Manage trash: list/restore/hard-delete (/api/trash)",
    "Root-create a workspace in your own tenant",
  ],
};

// Single per-agent (and per-user) status/orientation call: who you are, what
// you can reach, what's new since you last looked, and where the full guide
// lives. Deliberately one round trip — see PHASE_SPEC.md "Agents" decision.
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: { message: "Invalid credentials" } });

    const notesFor = (entry) => (user.isAgent ? entry.agent : entry.user);
    const whatsNew = entriesSince(user.lastSeenVersion).map((entry) => ({
      version: entry.version,
      date: entry.date,
      notes: notesFor(entry),
    }));

    // All statuses (not just active) — mirrors getMemberships' populate idiom,
    // scope labels kept even for a trashed container via withDeleted.
    const grants = await Membership.find({ user: user._id })
      .populate({
        path: "superWorkspace",
        select: "name owner",
        populate: { path: "owner", select: "username" },
      })
      .populate({ path: "workspace", select: "name", options: { withDeleted: true } })
      .sort({ createdAt: 1 });

    const ownsTenant = await SuperWorkspace.findOne({ owner: user._id });

    res.json({
      data: {
        user: {
          id: user._id,
          username: user.username,
          isAgent: user.isAgent,
          shareCode: user.shareCode,
          createdAt: user.createdAt,
        },
        version: {
          current: currentVersion(),
          lastSeen: user.lastSeenVersion,
          tourSeen: !!user.tourSeenAt,
        },
        tipsSeen: user.tipsSeen,
        themePref: user.themePref || "system",
        whatsNew,
        grants: grants.map((g) => ({
          superWorkspace: g.superWorkspace && {
            id: g.superWorkspace._id,
            name: g.superWorkspace.name,
            ownerUsername: g.superWorkspace.owner?.username,
          },
          workspace: g.workspace ? { id: g.workspace._id, name: g.workspace.name } : null,
          role: g.role,
          status: g.status,
          expiresAt: g.expiresAt,
        })),
        ownsTenant: ownsTenant ? { id: ownsTenant._id, name: ownsTenant.name } : null,
        roleCapabilities: ROLE_CAPABILITIES,
        guide: { url: "/api/guide" },
      },
    });
  } catch (err) {
    next(err);
  }
};

// Records that the caller has seen a version's notes, finished the tour,
// and/or dismissed a contextual tip. Load-then-save (not findByIdAndUpdate)
// per the resource-edit convention.
const ackMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: { message: "Invalid credentials" } });

    if (req.body.lastSeenVersion !== undefined) user.lastSeenVersion = req.body.lastSeenVersion;
    if (req.body.tourSeen === true) user.tourSeenAt = new Date();
    if (req.body.tipSeen !== undefined) user.tipsSeen.addToSet(req.body.tipSeen);
    if (req.body.themePref !== undefined) user.themePref = req.body.themePref;
    await user.save();

    res.json({
      data: {
        lastSeenVersion: user.lastSeenVersion,
        tourSeen: !!user.tourSeenAt,
        tipsSeen: user.tipsSeen,
        themePref: user.themePref || "system",
      },
    });
  } catch (err) {
    next(err);
  }
};

// Full release-notes history for Settings' view-only "What's new" — every
// entry, newest-first, no lastSeen filtering (whatsNew on getMe is empty once
// the version is acked). notes = the AGENT section for agents, else USER.
const getNotes = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ error: { message: "Invalid credentials" } });

    const data = loadEntries().map((entry) => ({
      version: entry.version,
      date: entry.date,
      notes: user.isAgent ? entry.agent : entry.user,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

// Coarse net for the Overview needs-attention dashboard: everything reachable,
// not completed, and either overdue/due-soon or high priority. "Today"/"this
// week" are LOCAL-calendar questions the frontend answers (utils/due.js) —
// the 9-day margin here just has to comfortably cover the 7-day window across
// any timezone skew, not land on an exact boundary (PHASE_SPEC "Design calls").
const ATTENTION_MARGIN_DAYS = 9;

function attentionContainer(doc) {
  return {
    workspace: { _id: doc.workspace._id, name: doc.workspace.name },
    project: doc.project ? { _id: doc.project._id, name: doc.project.name } : null,
  };
}

// dueAt ascending, null-due (high-priority-only) items last; createdAt asc tiebreak.
function byDueThenCreated(a, b) {
  if (!a.dueAt && !b.dueAt) return a.createdAt - b.createdAt;
  if (!a.dueAt) return 1;
  if (!b.dueAt) return -1;
  if (a.dueAt.getTime() !== b.dueAt.getTime()) return a.dueAt - b.dueAt;
  return a.createdAt - b.createdAt;
}

// Identity-scoped aggregate like getMe/getNotes: one flat candidate list per
// resource, links only (no per-item effectiveRole — see PHASE_SPEC). Scope is
// the same accessibleFilters().itemFilter the task/goal GET-list controllers
// use, so a caller only ever sees what a grant (or ownership) reaches.
const getAttention = async (req, res, next) => {
  try {
    const { itemFilter, projectFilter } = await accessibleFilters(req.user.id);
    const archivedProjectIds = await Project.find({ archivedAt: { $ne: null }, ...projectFilter }).distinct("_id");

    const marginDate = new Date(Date.now() + ATTENTION_MARGIN_DAYS * 24 * 60 * 60 * 1000);
    const candidateFilter = {
      completed: false,
      $or: [{ dueAt: { $ne: null, $lt: marginDate } }, { priority: "high" }],
    };
    // itemFilter itself carries a top-level $or (permissions.js) — combine via
    // $and instead of spreading, or the two $or keys would collide.
    const visibleContainerFilter = { $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedProjectIds } }] };
    const filter = { $and: [itemFilter, candidateFilter, visibleContainerFilter] };

    const [tasks, goals] = await Promise.all([
      Task.find(filter).populate("workspace", "name").populate("project", "name"),
      Goal.find(filter).populate("workspace", "name").populate("project", "name"),
    ]);

    const taskData = tasks.sort(byDueThenCreated).map((t) => ({
      _id: t._id,
      title: t.title,
      dueAt: t.dueAt,
      dueHasTime: t.dueHasTime,
      priority: t.priority,
      status: t.status,
      ...attentionContainer(t),
    }));

    const goalData = goals.sort(byDueThenCreated).map((g) => ({
      _id: g._id,
      title: g.title,
      dueAt: g.dueAt,
      dueHasTime: g.dueHasTime,
      priority: g.priority,
      ...attentionContainer(g),
    }));

    res.json({ data: { tasks: taskData, goals: goalData } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMe, ackMe, getNotes, getAttention };
