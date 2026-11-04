const mongoose = require("mongoose");

// Server-side session allowlist `protect` checks on every request — the piece that
// lets logout/account-deletion actually kill a token before its 7-day JWT expiry.
// NOT a resource: no historyPlugin, no superWorkspace, not in trash/revisions/cascade.
const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
});

// TTL cleanup: Mongo drops the row once expiresAt passes, mirroring the JWT's own expiry.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", sessionSchema);
