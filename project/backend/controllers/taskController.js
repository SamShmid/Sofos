const Task = require("../models/Task");
const Goal = require("../models/Goal");
const Project = require("../models/Project");
const Suggestion = require("../models/Suggestion");
const Revision = require("../models/Revision");
const { resolveContainer } = require("../utils/resolveContainer");
const { assertRole } = require("../middleware/auth");
const { accessibleFilters } = require("../utils/permissions");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { assertVersion } = require("../utils/assertVersion");
const { softCascadeTask } = require("../utils/cascade");

function sameId(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

function siblingFilter(workspace, project, parentTask) {
  return { workspace, project: project || null, parentTask: parentTask || null };
}

async function parentFieldsFor(userId, parentTaskId, workspace, project, excludeTaskId = null) {
  if (!parentTaskId) return { parentTask: null, ancestors: [] };
  const parent = await Task.findById(parentTaskId);
  if (!parent) {
    const e = new Error("Parent task not found");
    e.status = 404;
    throw e;
  }
  await assertRole(userId, parent, "writer");
  if (!sameId(parent.workspace, workspace) || !sameId(parent.project, project)) {
    const e = new Error("A subtask must use the same workspace and project as its parent");
    e.status = 400;
    throw e;
  }
  if (excludeTaskId && (parent._id.equals(excludeTaskId) || parent.ancestors.some((id) => id.equals(excludeTaskId)))) {
    const e = new Error("Cannot move a task into itself or its descendant");
    e.status = 400;
    throw e;
  }
  return { parentTask: parent._id, ancestors: [...parent.ancestors, parent._id] };
}

// Same-container rule: a project goal only accepts tasks of that project; a
// workspace goal accepts any task in that workspace. Returns the goal's id to
// stamp onto the task.
async function goalFieldFor(userId, goalId, taskWorkspaceId, taskProjectId) {
  const goal = await Goal.findById(goalId); // live only — trashed goals aren't assignable
  if (!goal) {
    // A bad goal reference in a task create/update body is client input, not a missing route.
    const e = new Error("Goal not found");
    e.status = 400;
    throw e;
  }
  const matches = goal.project ? goal.project.equals(taskProjectId) : goal.workspace.equals(taskWorkspaceId);
  if (!matches) {
    const e = new Error("Task and goal must be in the same workspace/project");
    e.status = 400;
    throw e;
  }
  return goal._id;
}

// Always a flat list — tasks never get an owned/shared split because sharing
// surfaces at the workspace/project level; a task is just reachable or not.
// itemFilter intersects with the optional ?workspace=/?project= filters, so a
// caller only ever sees tasks a grant (or ownership) actually reaches.
const getTasks = async (req, res, next) => {
  try {
    const { ownSuperWorkspaceId, memberships, itemFilter } = await accessibleFilters(req.user.id);

    const filter = { ...itemFilter };
    if (req.query.workspace) {
      filter.workspace = req.query.workspace;
      const archivedIds = await Project.find({ workspace: req.query.workspace, archivedAt: { $ne: null } }).distinct("_id");
      if (archivedIds.length) filter.$and = [{ $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedIds } }] }];
    }
    if (req.query.project) {
      // Project task views roll up sub-projects by default. `own=1` narrows to
      // exactly the named project when a caller needs an editable local list.
      if (req.query.own !== "1") {
        const descendantIds = await Project.find({
          ancestors: req.query.project,
          archivedAt: null,
        }).distinct("_id");
        filter.project = { $in: [req.query.project, ...descendantIds] };
      } else {
        filter.project = req.query.project;
      }
    } else if (!req.query.workspace) {
      const archivedIds = await Project.find({ archivedAt: { $ne: null }, ...itemFilter }).distinct("_id");
      if (archivedIds.length) filter.$and = [{ $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedIds } }] }];
    }

    const tasks = await Task.find(filter).sort({ order: 1, createdAt: 1 });

    const data = await withEffectiveRole(tasks, { ownSuperWorkspaceId, memberships });
    const rolledUpProjectIds = [...new Set(data
      .filter((task) => task.project && (!req.query.project || String(task.project) !== String(req.query.project)))
      .map((task) => String(task.project)))];
    if (rolledUpProjectIds.length) {
      const sourceProjects = await Project.find({ _id: { $in: rolledUpProjectIds } }, "name");
      const names = new Map(sourceProjects.map((project) => [String(project._id), project.name]));
      for (const task of data) {
        const name = task.project && names.get(String(task.project));
        if (name) task.sourceProject = { _id: task.project, name };
      }
    }

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

const getOneTask = async (req, res, next) => {
  try {
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// resolveContainer picks a project, workspace, or the owner's Home workspace.
// Order is dense among siblings inside the chosen container.
const createTask = async (req, res, next) => {
  try {
    const { superWorkspace, workspace, project, container } = await resolveContainer(req.user.id, req.body);
    await assertRole(req.user.id, container, "writer");

    const parent = await parentFieldsFor(req.user.id, req.body.parentTask, workspace, project);
    const last = await Task.findOne(siblingFilter(workspace, project, parent.parentTask)).sort({ order: -1 });
    const lastOrder = last && last.order !== undefined ? last.order : -1;
    const order = lastOrder + 1;

    const task = await Task.create({
      title: req.body.title,
      content: req.body.content,
      completed: req.body.completed,
      status: req.body.status,
      dueAt: req.body.dueAt,
      dueHasTime: req.body.dueHasTime,
      priority: req.body.priority,
      workspace,
      project,
      parentTask: parent.parentTask,
      ancestors: parent.ancestors,
      goal: req.body.goal ? await goalFieldFor(req.user.id, req.body.goal, workspace, project) : undefined,
      superWorkspace,
      order,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
};

const updateTask = async (req, res, next) => {
  try {
    const task = req.resource; // authorize("writer", Task) already vetted the edit itself
    assertVersion(req);

    const refiling = req.body.project !== undefined || req.body.workspace !== undefined;
    let nextSuperWorkspace = task.superWorkspace;
    let nextWorkspace = task.workspace;
    let nextProject = task.project || null;

    // Finish every destination-dependent validation before changing descendants.
    // Otherwise a bad goal or parent could leave half of a task tree re-filed.
    if (refiling) {
      const destination = await resolveContainer(req.user.id, req.body);
      await assertRole(req.user.id, destination.container, "writer");
      nextSuperWorkspace = destination.superWorkspace;
      nextWorkspace = destination.workspace;
      nextProject = destination.project;
    }

    let nextParent = {
      parentTask: refiling ? null : task.parentTask || null,
      ancestors: refiling ? [] : task.ancestors,
    };
    if (req.body.parentTask !== undefined) {
      nextParent = await parentFieldsFor(
        req.user.id,
        req.body.parentTask,
        nextWorkspace,
        nextProject,
        task._id
      );
    }

    let nextGoal = task.goal;
    if (req.body.goal !== undefined) {
      nextGoal = req.body.goal === null
        ? undefined
        : await goalFieldFor(req.user.id, req.body.goal, nextWorkspace, nextProject);
    } else if (
      refiling &&
      task.goal &&
      (!sameId(task.project, nextProject) || !sameId(task.workspace, nextWorkspace))
    ) {
      try {
        await goalFieldFor(req.user.id, task.goal, nextWorkspace, nextProject);
      } catch (err) {
        if (err.status === 400) {
          err.message = "Re-filing would leave the assigned goal in a different container — unassign the goal or move it first";
        }
        throw err;
      }
    }

    const completionRequested = req.body.status === "done" ||
      (req.body.status === undefined && req.body.completed === true);
    let unfinished = [];
    if (completionRequested) {
      unfinished = await Task.find({ ancestors: task._id, status: { $ne: "done" } });
      if (unfinished.length && !req.body.completeSubtasks) {
        return res.status(409).json({
          error: {
            code: "INCOMPLETE_SUBTASKS",
            message: `This task has ${unfinished.length} unfinished subtask${unfinished.length === 1 ? "" : "s"}.`,
            details: { count: unfinished.length },
          },
        });
      }
    }

    if (req.body.title !== undefined) task.title = req.body.title;
    if (req.body.content !== undefined) task.content = req.body.content;
    if (req.body.completed !== undefined) task.completed = req.body.completed;
    if (req.body.status !== undefined) task.status = req.body.status;
    if (req.body.dueAt !== undefined) task.dueAt = req.body.dueAt;
    if (req.body.dueHasTime !== undefined) task.dueHasTime = req.body.dueHasTime;
    if (req.body.priority !== undefined) task.priority = req.body.priority;

    const placementChanged =
      !sameId(task.workspace, nextWorkspace) ||
      !sameId(task.project, nextProject) ||
      !sameId(task.parentTask, nextParent.parentTask);

    task.workspace = nextWorkspace;
    task.project = nextProject;
    task.superWorkspace = nextSuperWorkspace;
    task.parentTask = nextParent.parentTask;
    task.ancestors = nextParent.ancestors;
    task.goal = nextGoal;

    let descendants = [];
    if (placementChanged) {
      const last = await Task.findOne(siblingFilter(nextWorkspace, nextProject, nextParent.parentTask)).sort({ order: -1 });
      const lastOrder = last && last.order !== undefined ? last.order : -1;
      task.order = lastOrder + 1;

      descendants = await Task.find({ ancestors: task._id }, "_id parentTask")
        .setOptions({ withDeleted: true });
      const byId = new Map(descendants.map((d) => [String(d._id), d]));
      const cache = new Map([[String(task._id), task.ancestors]]);
      const ancestorsOf = (id) => {
        const key = String(id);
        if (cache.has(key)) return cache.get(key);
        const doc = byId.get(key);
        const chain = [...ancestorsOf(doc.parentTask), doc.parentTask];
        cache.set(key, chain);
        return chain;
      };
      await Promise.all(descendants.map((descendant) => {
        const update = {
          $set: {
            ancestors: ancestorsOf(descendant._id),
            updatedBy: req.user.id,
          },
        };
        if (refiling) {
          Object.assign(update.$set, {
            workspace: nextWorkspace,
            project: nextProject || null,
            superWorkspace: nextSuperWorkspace,
          });
          update.$unset = { goal: "" };
        }
        return Task.updateOne({ _id: descendant._id }, update);
      }));

      if (refiling) {
        const taskIds = [task._id, ...descendants.map((descendant) => descendant._id)];
        await Promise.all([
          Suggestion.updateMany(
            { resourceType: "Task", resource: { $in: taskIds } },
            { workspace: nextWorkspace, project: nextProject || null, superWorkspace: nextSuperWorkspace }
          ),
          Revision.updateMany(
            { resourceType: "Task", resource: { $in: taskIds } },
            { superWorkspace: nextSuperWorkspace }
          ),
        ]);
      }
    }

    if (unfinished.length) {
      for (const child of unfinished) {
        child.status = "done";
        child.updatedBy = req.user.id;
        await child.save();
      }
    }

    task.updatedBy = req.user.id;
    await task.save();

    const reopening = (req.body.status && req.body.status !== "done") ||
      (req.body.status === undefined && req.body.completed === false);
    if (reopening && task.ancestors.length) {
      const completedAncestors = await Task.find({ _id: { $in: task.ancestors }, status: "done" });
      for (const ancestor of completedAncestors) {
        ancestor.status = "todo";
        ancestor.updatedBy = req.user.id;
        await ancestor.save();
      }
    }
    res.json({ data: task, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// ids must be exactly a permutation of the project's current live tasks;
// each save writes its own revision (accepted cost of reusing load-then-save).
const reorderTasks = async (req, res, next) => {
  try {
    const project = await Project.findById(req.body.project);
    if (!project) {
      const e = new Error("Project not found");
      e.status = 404;
      throw e;
    }

    await assertRole(req.user.id, project, "writer");

    const parentTask = req.body.parentTask || null;
    const tasks = await Task.find(siblingFilter(project.workspace, project._id, parentTask));
    const currentIds = tasks.map((t) => String(t._id));
    const ids = req.body.ids;
    const isPermutation =
      ids.length === currentIds.length &&
      new Set(ids).size === currentIds.length &&
      ids.every((id) => currentIds.includes(id));

    if (!isPermutation) {
      const e = new Error("ids must be exactly the project's tasks");
      e.status = 400;
      throw e;
    }

    const tasksById = new Map(tasks.map((t) => [String(t._id), t]));
    for (let i = 0; i < ids.length; i++) {
      const task = tasksById.get(ids[i]);
      task.order = i;
      task.updatedBy = req.user.id;
      await task.save();
    }

    res.json({ data: { reordered: ids.length } });
  } catch (err) {
    next(err);
  }
};

const deleteTask = async (req, res, next) => {
  try {
    const at = new Date();
    await softCascadeTask(req.resource._id, req.user.id, at);
    await req.resource.softDelete(req.user.id, at);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTasks,
  getOneTask,
  createTask,
  updateTask,
  reorderTasks,
  deleteTask,
};
