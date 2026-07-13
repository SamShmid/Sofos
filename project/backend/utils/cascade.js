const Note = require("../models/Note");
const Task = require("../models/Task");
const Project = require("../models/Project");

// Delete everything in a workspace
async function cascadeDeleteWorkspace(workspaceId) {
  await Note.deleteMany({ workspace: workspaceId });
  await Task.deleteMany({ workspace: workspaceId });
  await Project.deleteMany({ workspace: workspaceId });
}

// Delete everything in a project
async function cascadeDeleteProject(projectId) {
  await Note.deleteMany({ project: projectId });
  await Task.deleteMany({ project: projectId });
}

module.exports = { cascadeDeleteWorkspace, cascadeDeleteProject };
