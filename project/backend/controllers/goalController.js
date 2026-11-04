const Goal = require("../models/Goal");
const Task = require("../models/Task");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const SuperWorkspace = require("../models/SuperWorkspace");
const { assertRole } = require("../middleware/auth");
const { accessibleFilters } = require("../utils/permissions");
const requireExactlyOneContainer = require("../utils/requireExactlyOneContainer");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { assertVersion } = require("../utils/assertVersion");
const { softCascadeLeafSuggestions } = require("../utils/cascade");

// Goals roll up from sub-projects by default. `own=1` narrows a project or
// workspace roadmap to content directly owned by that container.
const getGoals = async (req, res, next) => {
  try {
    const isProjectMode = requireExactlyOneContainer(req.query);

    const { ownSuperWorkspaceId, memberships, itemFilter } = await accessibleFilters(req.user.id);

    const filter = { ...itemFilter };
    if (isProjectMode) {
      if (req.query.own === "1") filter.project = req.query.project;
      else {
        const descendantIds = await Project.find({ ancestors: req.query.project, archivedAt: null }).distinct("_id");
        filter.project = { $in: [req.query.project, ...descendantIds] };
      }
    } else {
      filter.workspace = req.query.workspace;
      if (req.query.own === "1") filter.project = null;
      else {
        const archivedIds = await Project.find({ workspace: req.query.workspace, archivedAt: { $ne: null } }).distinct("_id");
        if (archivedIds.length) {
          filter.$and = [{ $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedIds } }] }];
        }
      }
    }

    const goals = await Goal.find(filter).sort({ order: 1 });

    const goalIds = goals.map((g) => g._id);
    const tasks = await Task.find({ goal: { $in: goalIds } })
      .sort({ title: 1 })
      .collation({ locale: "en", strength: 2 });
    const tasksByGoal = new Map();
    for (const t of tasks) {
      const key = String(t.goal);
      if (!tasksByGoal.has(key)) tasksByGoal.set(key, []);
      tasksByGoal.get(key).push({ _id: t._id, title: t.title, completed: t.completed });
    }

    const data = (await withEffectiveRole(goals, { ownSuperWorkspaceId, memberships })).map((obj) => {
      obj.tasks = tasksByGoal.get(String(obj._id)) || [];
      return obj;
    });
    const rolledUpProjectIds = [...new Set(data
      .filter((goal) => goal.project && (!req.query.project || String(goal.project) !== String(req.query.project)))
      .map((goal) => String(goal.project)))];
    if (rolledUpProjectIds.length) {
      const sourceProjects = await Project.find({ _id: { $in: rolledUpProjectIds } }, "name");
      const names = new Map(sourceProjects.map((project) => [String(project._id), project.name]));
      for (const goal of data) {
        const name = goal.project && names.get(String(goal.project));
        if (name) goal.sourceProject = { _id: goal.project, name };
      }
    }

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

const getOneGoal = async (req, res, next) => {
  try {
    const tasks = await Task.find({ goal: req.resource._id })
      .sort({ title: 1 })
      .collation({ locale: "en", strength: 2 });

    const data = req.resource.toObject({ virtuals: true });
    data.tasks = tasks.map((t) => ({ _id: t._id, title: t.title, completed: t.completed }));

    res.json({ data, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Order is dense per-container: max live order + 1, or 0 for the container's
// first goal.
const createGoal = async (req, res, next) => {
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
    const last = await Goal.findOne(orderFilter).sort({ order: -1 });
    const order = last ? last.order + 1 : 0;

    const goal = await Goal.create({
      title: req.body.title,
      description: req.body.description,
      dueAt: req.body.dueAt,
      dueHasTime: req.body.dueHasTime,
      priority: req.body.priority,
      workspace,
      project: isProjectMode ? project._id : undefined,
      superWorkspace,
      order,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({ data: goal });
  } catch (err) {
    next(err);
  }
};

const updateGoal = async (req, res, next) => {
  try {
    const goal = req.resource; // authorize("writer", Goal) already vetted the edit itself
    assertVersion(req);

    if (req.body.title !== undefined) goal.title = req.body.title;
    if (req.body.description !== undefined) goal.description = req.body.description;
    if (req.body.completed !== undefined) goal.completed = req.body.completed;
    if (req.body.dueAt !== undefined) goal.dueAt = req.body.dueAt;
    if (req.body.dueHasTime !== undefined) goal.dueHasTime = req.body.dueHasTime;
    if (req.body.priority !== undefined) goal.priority = req.body.priority;
    if (req.body.canvas !== undefined) {
      goal.canvas = req.body.canvas === null ? null : { x: Math.round(req.body.canvas.x), y: Math.round(req.body.canvas.y) };
    }

    goal.updatedBy = req.user.id;
    await goal.save();
    res.json({ data: goal, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// ids must be exactly a permutation of the container's current live goals;
// each save writes its own revision (accepted cost of reusing load-then-save).
const reorderGoals = async (req, res, next) => {
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

    const goals = await Goal.find(filter);
    const currentIds = goals.map((g) => String(g._id));
    const ids = req.body.ids;
    const isPermutation =
      ids.length === currentIds.length &&
      new Set(ids).size === currentIds.length &&
      ids.every((id) => currentIds.includes(id));

    if (!isPermutation) {
      const e = new Error("ids must be exactly the container's goals");
      e.status = 400;
      throw e;
    }

    const goalsById = new Map(goals.map((g) => [String(g._id), g]));
    for (let i = 0; i < ids.length; i++) {
      const goal = goalsById.get(ids[i]);
      goal.order = i;
      goal.updatedBy = req.user.id;
      await goal.save();
    }

    res.json({ data: { reordered: ids.length } });
  } catch (err) {
    next(err);
  }
};

const deleteGoal = async (req, res, next) => {
  try {
    // No cascade: tasks keep their (now dangling) goal ref until a hard delete.
    await req.resource.softDelete(req.user.id);
    await softCascadeLeafSuggestions(req.resource._id, req.resource.deletedAt);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// Own-tenant workspace thumbnails for the WorkspacePage/HomePage progress bars.
// Counts workspace goals plus goals in non-archived projects, matching the
// workspace roadmap's default rollup. aggregate() bypasses the history
// plugin's find filter, so the soft-delete exclusion is written out explicitly.
const getGoalsSummary = async (req, res, next) => {
  try {
    const own = await SuperWorkspace.findOne({ owner: req.user.id });
    if (!own) return res.json({ data: {} });

    const archivedIds = await Project.find({ superWorkspace: own._id, archivedAt: { $ne: null } }).distinct("_id");
    const rows = await Goal.aggregate([
      { $match: { superWorkspace: own._id, project: { $nin: archivedIds }, deletedAt: null } },
      { $group: { _id: "$workspace", total: { $sum: 1 }, completed: { $sum: { $cond: ["$completed", 1, 0] } } } },
    ]);

    const data = {};
    for (const row of rows) {
      data[row._id] = { completed: row.completed, total: row.total };
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getGoals,
  getOneGoal,
  createGoal,
  updateGoal,
  reorderGoals,
  deleteGoal,
  getGoalsSummary,
};
