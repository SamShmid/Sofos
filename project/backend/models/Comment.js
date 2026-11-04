const mongoose = require("mongoose")

// One doc per THREAD (root comment + replies embedded) — PHASE_SPEC.md's
// Google-Docs-style phrase anchoring. Deliberately NOT historyPlugin-plugged,
// same call as Suggestion: comments aren't revisioned or trashed. P61: a user
// delete and a drift prune are now both soft deletes (deletedAt + deletedVia)
// so undelete/unapprove can restore the original doc — hand-rolled rather than
// historyPlugin for the same reason as Suggestion (no matching Revision
// resourceType). Still not revisioned or trashed.
const replySchema = mongoose.Schema(
    {
        body: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
)

const commentSchema = mongoose.Schema(
    {
        note: { type: mongoose.Schema.Types.ObjectId, ref: "Note", required: true, index: true },
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; copies Note's own convention
        body: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
        // {quote, before, after} — shape/bounds enforced at the validator layer
        // (Mixed-plus-validator split, same idiom as Suggestion.payload), never
        // re-derived here. See utils/commentAnchor.js for the locate algorithm.
        anchor: { type: mongoose.Schema.Types.Mixed, required: true },
        status: { type: String, enum: ["open", "resolved"], default: "open" },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        resolvedAt: { type: Date },
        replies: [replySchema],
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        deletedAt: { type: Date, default: null }, //P61: user delete or drift prune stamps this instead of hard-deleting
        deletedVia: { type: String, enum: ["user", "prune"], default: null },
        prunedBySuggestion: { type: mongoose.Schema.Types.ObjectId, ref: "Suggestion", default: null },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        optimisticConcurrency: true, //a reply race is handled exactly like a simultaneous note edit: loser gets VersionError -> central 409
    }
)

// The list-panel read path (getComments) + drift-prune's own open-only sweep.
commentSchema.index({ note: 1, status: 1 })

// Soft-delete filtering, hand-rolled — mirrors utils/history.js's hideDeleted
// verbatim (opt out with .setOptions({ withDeleted: true })). deleteMany/updateMany
// aren't /^find/ and so bypass this, same as historyPlugin's own note about it.
function hideDeleted(next) {
    if (!this.getOptions().withDeleted) this.where({ deletedAt: null });
    if (next) next();
}
commentSchema.pre(/^find/, hideDeleted);
commentSchema.pre("countDocuments", hideDeleted);

module.exports = mongoose.model("Comment", commentSchema)
