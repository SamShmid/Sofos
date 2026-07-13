const Project = require("../models/Project");

const HOME_WORKSPACE_DESCRIPTION =
  "This is the home of it all jot down important or unfilable notes, tasks, and projects here!";
const GENERAL_PROJECT_DESCRIPTION =
  "This area is for you to jot down unorganized tasks and ideas relevant to this workspace";

// Idempotently give a workspace its undeletable "General" project.
function ensureGeneralProject(workspaceId) {
  return Project.findOneAndUpdate(
    { workspace: workspaceId, isDefault: true },
    { $setOnInsert: { name: "General", description: GENERAL_PROJECT_DESCRIPTION, workspace: workspaceId, isDefault: true } },
    { upsert: true, new: true }
  );
}

module.exports = { HOME_WORKSPACE_DESCRIPTION, GENERAL_PROJECT_DESCRIPTION, ensureGeneralProject };
