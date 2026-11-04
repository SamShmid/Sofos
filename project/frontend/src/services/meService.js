import { request } from "./api";

// Identity + grants + version/whats-new/tour state in one payload — the boot-flow
// read for Layout and the About section's data source on Settings.
export const getMe = () => request("/me").then((r) => r.data);

// patch: { lastSeenVersion? }, { tourSeen: true }, and/or { themePref? } —
// at least one required.
export const ackMe = (patch) =>
  request("/me/ack", { method: "POST", body: JSON.stringify(patch) }).then((r) => r.data);

// Full release-notes history (all entries, newest-first) for Settings' view-only
// "What's new" — getMe's whatsNew is empty once the current version is acked.
export const getNotes = () => request("/me/notes").then((r) => r.data);

// Overview's needs-attention dashboard candidates (tasks + goals) — bucketing
// is client-side (utils/due.js), this is just the flat scored-candidate read.
export const getAttention = () => request("/me/attention").then((r) => r.data);
