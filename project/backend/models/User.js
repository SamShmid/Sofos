const mongoose = require("mongoose");
const crypto = require("crypto");

// Share-code alphabet skips 0/O/1/I so codes survive being read aloud or retyped
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 8 random chars over 32 symbols = 40 bits; crypto-random so codes can't be guessed
function generateShareCode() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % 32];
  return `SF-${code}`;
}

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true, select: false },
    isAgent: { type: Boolean, default: false }, // Agents own no SuperWorkspace; they act only through Memberships
    shareCode: { type: String, unique: true, immutable: true, default: generateShareCode }, // Public handle others use to grant this account access; identifies, never authenticates
    lastSeenVersion: { type: String, default: null }, // null = every release-notes entry reads as new; register sets this to the current version so new accounts never see a stale What's-new
    tourSeenAt: { type: Date, default: null }, // set once the first-run tour is skipped/finished; replayable from Settings without clearing this
    tipsSeen: { type: [String], default: [] }, // ids of dismissed first-visit contextual tips (board/roadmap/review/...), one-way like tourSeenAt
    themePref: { type: String, enum: ["light", "dark", "system"], default: "system" }, // device-independent UI preference, applied client-side
  },
  {
    timestamps: true
  }
);
// Unique index on username ensures no duplicate accounts
// select: false on passwordHash prevents accidental exposure in queries


module.exports = mongoose.model("User", userSchema);
