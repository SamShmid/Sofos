// The UI's one question about a role: does it permit changing things?
// Cosmetic only — the backend re-checks every request regardless.
export const canWrite = (role) => role === "owner" || role === "writer";

// Can this role propose a suggestion? Suggesters, writers, and owners all can
// (writers/owners just have the direct-write door too) — cosmetic only.
export const canSuggest = (role) => role === "owner" || role === "writer" || role === "suggester";
