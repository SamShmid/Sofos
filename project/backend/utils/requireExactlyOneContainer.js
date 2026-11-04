// (source) → hasProject boolean. Throws {status:400, message:"Provide exactly one of
// workspace or project"}. Drop-in for the list/create/reorder handlers that need an
// exclusive workspace-or-project container; callers pass req.query or req.body.
module.exports = function requireExactlyOneContainer(source) {
  const hasWorkspace = Boolean(source.workspace);
  const hasProject = Boolean(source.project);
  if (hasWorkspace === hasProject) {
    const e = new Error("Provide exactly one of workspace or project");
    e.status = 400;
    throw e;
  }
  return hasProject;
};
