const { resolveRole, chainMaps } = require("./permissions");

// A ref field may hold a plain ObjectId or a populated doc; always resolve to the id
// before comparing (ObjectId.equals(populatedDoc) is silently false — same rule as
// permissions.js's own idOf).
function idOf(ref) {
  return ref && ref._id ? ref._id : ref;
}

// withEffectiveRole(docs, { ownSuperWorkspaceId, memberships, coords }) → Promise<array of
// plain objects> (doc.toObject({ virtuals: true })) each with .effectiveRole attached. Owner
// short-circuits to "owner" without consulting memberships when ownSuperWorkspaceId is
// truthy and the doc's superWorkspace matches it; pass ownSuperWorkspaceId: null for
// shared-only lists. coords(doc) still returns the doc's OWN [superWorkspace, workspace,
// project] ids (unchanged contract) — this helper resolves their ANCESTOR CHAINS itself,
// one batched chainMaps() call across every doc rather than one per doc, then annotates
// via chain-aware resolveRole. Callers needing extra per-doc fields (goals attaching tasks)
// post-process the returned array — this helper stays single-purpose.
module.exports = async function withEffectiveRole(
  docs,
  { ownSuperWorkspaceId = null, memberships, coords = (d) => [d.superWorkspace, d.workspace, d.project] }
) {
  const workspaceIds = [];
  const projectIds = [];
  for (const doc of docs) {
    const [, workspace, project] = coords(doc);
    const workspaceId = idOf(workspace);
    const projectId = idOf(project);
    if (workspaceId) workspaceIds.push(workspaceId);
    if (projectId) projectIds.push(projectId);
  }
  const { wsChains, projChains } = await chainMaps(workspaceIds, projectIds);

  return docs.map((doc) => {
    const obj = doc.toObject({ virtuals: true });
    const [superWorkspace, workspace, project] = coords(doc);
    const superWorkspaceId = idOf(superWorkspace);
    const workspaceId = idOf(workspace);
    const projectId = idOf(project);
    obj.effectiveRole =
      ownSuperWorkspaceId && superWorkspaceId.equals(ownSuperWorkspaceId)
        ? "owner"
        : resolveRole(
            memberships,
            superWorkspaceId,
            workspaceId ? wsChains.get(String(workspaceId)) : null,
            projectId ? projChains.get(String(projectId)) : null
          );
    return obj;
  });
};
