const Project = require("../models/Project");
const Workspace = require("../models/Workspace");

// Decide where a note/task lives. Every item ends up inside a project:
//  - has a project  -> use that project (and its workspace)
//  - workspace only  -> that workspace's "General" project
//  - neither         -> the Home workspace's "General" project
// Throws a 400 error (handled by the central error middleware) for bad references.
async function resolveContainer(body) {
  if (body.project) {
    const project = await Project.findById(body.project);
    if (!project) {
      const e = new Error("Project not found");
      e.status = 400;
      throw e;
    }
    return { workspace: project.workspace, project: project._id };
  }

  let workspaceId;
  if (body.workspace) {
    const workspace = await Workspace.findById(body.workspace);
    if (!workspace) {
      const e = new Error("Workspace not found");
      e.status = 400;
      throw e;
    }
    workspaceId = workspace._id;
  } else {
    const home = await Workspace.findOne({ isDefault: true });
    workspaceId = home._id;
  }

  const general = await Project.findOne({ workspace: workspaceId, isDefault: true });
  return { workspace: workspaceId, project: general._id };
}

module.exports = { resolveContainer };
