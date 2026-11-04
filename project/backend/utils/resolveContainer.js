const SuperWorkspace = require("../models/SuperWorkspace");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}

// Decide where a task/note lives. Items can belong directly to a workspace or
// to a project. An omitted container defaults to the owner's Home workspace.
// Returns the ids to stamp on the item plus the loaded container doc, so the
// controller can assertRole on it without refetching. A missing ref reads as
// 404 to match authorize: callers can't tell "doesn't exist" from "not mine".
// Agents own no tenant, so an unfiled create has nowhere to default into -> 400.
async function resolveContainer(userId, body) {
  let container;

  if (body.project) {
    container = await Project.findById(body.project);
    if (!container) fail(404, "Project not found");
  } else if (body.workspace) {
    container = await Workspace.findById(body.workspace);
    if (!container) fail(404, "Workspace not found");
  } else {
    const own = await SuperWorkspace.findOne({ owner: userId });
    if (!own) fail(400, "A workspace or project is required");
    container = await Workspace.findOne({ superWorkspace: own._id, isDefault: true });
    if (!container) fail(500, "Tenant defaults are missing");
  }

  const isProject = container.constructor.modelName === "Project";

  return {
    superWorkspace: container.superWorkspace,
    workspace: isProject ? container.workspace : container._id,
    project: isProject ? container._id : null,
    container,
  };
}

module.exports = { resolveContainer };
