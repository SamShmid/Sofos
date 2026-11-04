// Ruling 11: block duplicate sibling names. App-level check, NOT a unique
// index — dev data already has grandfathered dup siblings (two sibling
// "TEST-BED" workspaces) that an index build would fail on. Case-insensitive
// via the same collation every sort/list query in this codebase uses; the
// history plugin's default `deletedAt: null` filter (utils/history.js) is
// what makes trashed siblings NOT block reuse — findOne inherits it same as
// any other find.
async function assertSiblingNameFree(Model, { filter, name, excludeId }) {
  const existing = await Model.findOne({ ...filter, name }).collation({ locale: "en", strength: 2 });
  if (existing && String(existing._id) !== String(excludeId)) {
    const label = Model.modelName === "Workspace" ? "workspace" : "project";
    const e = new Error(`A ${label} named "${name}" already exists here`);
    e.status = 409;
    throw e;
  }
}

module.exports = { assertSiblingNameFree };
