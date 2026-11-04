// Deterministic djb2-style hash so a tag always lands on the same chip color
// everywhere it's rendered (form, card, workspace filter bar).
export function tagColorIndex(name) {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i);
  }
  return Math.abs(hash) % 16;
}

// superWorkspace rides along raw (unpopulated ObjectId) on some render sites
// and populated ({ _id, name, ... }) on others depending on which endpoint fed
// them — normalize once so every chip site can pass whatever shape it already has.
export function tenantIdOf(superWorkspace) {
  if (superWorkspace == null) return null;
  return typeof superWorkspace === "object" ? String(superWorkspace._id) : String(superWorkspace);
}

// An owner's override (if any) beats the deterministic hash. `maps` is
// TagColorsContext's value: { [tenantId]: { [tag]: colorIdx } }.
export function resolveTagColor(tag, tenantId, maps) {
  const override = tenantId != null ? maps?.[tenantId]?.[tag] : undefined;
  return override ?? tagColorIndex(tag);
}
