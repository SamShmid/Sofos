const Workspace = require("../models/Workspace");

const HOME_WORKSPACE_DESCRIPTION =
  "The home for it all — jot down unfiled notes, tasks, and projects here.";
// Idempotently give a tenant its undeletable Home workspace.
// Called at registration; safe to re-run if a previous attempt died halfway.
async function ensureTenantDefaults(superWorkspaceId, userId) {
  const home = await Workspace.findOneAndUpdate(
    { superWorkspace: superWorkspaceId, isDefault: true },
    {
      $setOnInsert: {
        name: "Home",
        description: HOME_WORKSPACE_DESCRIPTION,
        isDefault: true,
        superWorkspace: superWorkspaceId,
        createdBy: userId,
        updatedBy: userId,
      },
    },
    { upsert: true, new: true }
  );
  return { home };
}

module.exports = {
  HOME_WORKSPACE_DESCRIPTION,
  ensureTenantDefaults,
};
