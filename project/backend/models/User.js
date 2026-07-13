const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["writer", "reader"], default: "reader" },
  },
  {
    timestamps: true
  }
);
// Unique index on username ensures no duplicate accounts
// select: false on passwordHash prevents accidental exposure in queries


module.exports = mongoose.model("User", userSchema);