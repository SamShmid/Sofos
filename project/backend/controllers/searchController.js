const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Note = require("../models/Note");
const Goal = require("../models/Goal");
const { accessibleFilters } = require("../utils/permissions");

const RESULT_CAP = 5;

// `q` must always be a literal substring, never a pattern — a caller typing
// "(" or ".*" is searching for those characters, not injecting a regex.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cmd-K quick-switcher: one case-insensitive substring match per searchable
// type, each intersected with the SAME access filter its own list endpoint
// uses (workspaceFilter/projectFilter/itemFilter, utils/permissions.js) —
// search must never surface anything a caller couldn't already reach via
// GET /workspaces, /projects, /tasks, /notes, or /goals. Every query is
// capped at RESULT_CAP; `total` is the sum of what's actually returned, not
// the true match count (documented plainly in docs/API_GUIDE.md).
const search = async (req, res, next) => {
  try {
    const re = new RegExp(escapeRegex(req.query.q), "i");
    const { workspaceFilter, projectFilter, itemFilter } = await accessibleFilters(req.user.id);
    const archivedProjectIds = await Project.find({ archivedAt: { $ne: null }, ...projectFilter }).distinct("_id");
    const visibleItems = {
      $and: [
        itemFilter,
        { $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedProjectIds } }] },
      ],
    };

    const [workspaces, projects, tasks, notes, goals] = await Promise.all([
      Workspace.find({ name: re, ...workspaceFilter })
        .select("_id name")
        .sort({ name: 1 })
        .collation({ locale: "en", strength: 2 })
        .limit(RESULT_CAP),
      Project.find({ name: re, archivedAt: null, ...projectFilter })
        .select("_id name workspace")
        .populate("workspace", "name")
        .sort({ name: 1 })
        .collation({ locale: "en", strength: 2 })
        .limit(RESULT_CAP),
      Task.find({ title: re, ...visibleItems })
        .select("_id title project workspace")
        .populate("project", "name")
        .populate("workspace", "name")
        .sort({ title: 1 })
        .collation({ locale: "en", strength: 2 })
        .limit(RESULT_CAP),
      Note.find({ title: re, ...visibleItems })
        .select("_id title project workspace")
        .populate("project", "name")
        .populate("workspace", "name")
        .sort({ title: 1 })
        .collation({ locale: "en", strength: 2 })
        .limit(RESULT_CAP),
      // A goal's container is exactly one of project (set) or workspace
      // (always set) — populating both and letting the frontend prefer
      // project.name is simpler than branching the query per doc, and a
      // populate on an absent project ref is just a no-op.
      Goal.find({ title: re, ...visibleItems })
        .select("_id title workspace project")
        .populate([
          { path: "project", select: "name" },
          { path: "workspace", select: "name" },
        ])
        .sort({ title: 1 })
        .collation({ locale: "en", strength: 2 })
        .limit(RESULT_CAP),
    ]);

    const data = { workspaces, projects, tasks, notes, goals };
    const total = workspaces.length + projects.length + tasks.length + notes.length + goals.length;
    res.json({ data, total });
  } catch (err) {
    next(err);
  }
};

module.exports = { search };
