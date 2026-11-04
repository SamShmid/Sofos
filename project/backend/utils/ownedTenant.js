const SuperWorkspace = require("../models/SuperWorkspace");

// Loads the caller's own SuperWorkspace or throws 403 — agents (who own none) and
// non-owners can't reach tenant-wide administrative actions (sharing, trash) at
// all. Shared by membershipController and trashController.
async function ownedTenantOrThrow(userId, message = "Only account owners can do that") {
  const own = await SuperWorkspace.findOne({ owner: userId });
  if (!own) {
    const e = new Error(message);
    e.status = 403;
    throw e;
  }
  return own;
}

module.exports = { ownedTenantOrThrow };
