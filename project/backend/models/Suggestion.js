const mongoose = require("mongoose")

// Google-Docs-style suggesting: a proposed create/update/delete on a content
// resource, sitting inert until a writer/owner approves it. Deliberately NOT
// plugged with historyPlugin — suggestions aren't revisioned; a resolved
// (approved/rejected) doc just stays put as its own audit record.
// P61: retract is now a soft delete (deletedAt) so unretract can restore the
// exact same doc — hand-rolled rather than historyPlugin because Revision's
// resourceType enum has no "Suggestion" entry and Suggestion carries no
// updatedBy for editedBy attribution.
// P65: a suggestion is tied to its target — when the target (or its
// container) is trashed, the suggestion rides the same cascade timestamp
// (deletedAt/deletedVia: "cascade"), and restoring the target revives exactly
// the suggestions that fell with it. deletedVia distinguishes a user retract
// from a cascade sweep, same idiom as Comment's P61 deletedVia. Still not
// revisioned.
const suggestionSchema = mongoose.Schema(
    {
        resourceType: { type: String, enum: ["Task", "Note", "Goal", "Link", "Attachment", "Workspace", "Project"], required: true },
        op: { type: String, enum: ["create", "update", "delete"], required: true },
        // Absent for op create (there's no target yet); refPath so populate() resolves
        // onto the right collection per-doc.
        resource: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "resourceType",
            required: function () { return this.op !== "create" },
        },
        payload: { type: mongoose.Schema.Types.Mixed, default: {} }, //Whitelisted fields proposed for create/update
        // Absent only for a Workspace create in tenant-root mode (superWorkspace names
        // the tenant directly, there's no parent workspace to list under).
        workspace: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            required: function () { return !(this.resourceType === "Workspace" && this.op === "create") },
        },
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: absent means a workspace-level target/container
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, //Set on approve/reject; never touches the resource's own history
        resolvedAt: { type: Date },
        // WAL intent markers for crash-safe approve: applyStartedAt is written BEFORE
        // any target mutation, so a retry after a crash can tell an in-progress apply
        // from a fresh one. appliedResource is the create target's id, reserved before
        // the doc exists, so a retry finds (or re-creates) exactly that doc.
        applyStartedAt: { type: Date },
        appliedResource: { type: mongoose.Schema.Types.ObjectId },
        deletedAt: { type: Date, default: null }, //P61: retract stamps this instead of hard-deleting; unretract clears it
        deletedVia: { type: String, enum: ["user", "cascade"], default: null }, //P65: an explicit retract vs. riding a container/leaf trash
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        optimisticConcurrency: true, //two concurrent approves race on the intent save; the loser gets a VersionError -> central 409
    }
)

// The list-panel read path: newest-first within one container, filterable by status.
suggestionSchema.index({ workspace: 1, project: 1, status: 1, createdAt: -1 })

// The duplicate-suggestion check's read path (createSuggestion): proposedBy is
// the selective term, status narrows to the small pending set worth comparing in JS.
suggestionSchema.index({ proposedBy: 1, status: 1 })

// Soft-delete filtering, hand-rolled — mirrors utils/history.js's hideDeleted
// verbatim (opt out with .setOptions({ withDeleted: true })). deleteMany/updateMany
// aren't /^find/ and so bypass this, same as historyPlugin's own note about it.
function hideDeleted(next) {
    if (!this.getOptions().withDeleted) this.where({ deletedAt: null })
    if (next) next()
}
suggestionSchema.pre(/^find/, hideDeleted)
suggestionSchema.pre("countDocuments", hideDeleted)

// Single source of truth for what a suggestion payload may touch, shared by
// suggest-time whitelist validation and apply-time field application.
const SUGGESTABLE_FIELDS = {
    Task: ["title", "content", "completed", "goal", "status", "dueAt", "dueHasTime", "priority", "parentTask"],
    Note: ["title", "content", "contentHunk"],
    Goal: ["title", "description", "completed", "dueAt", "dueHasTime", "priority"],
    Link: ["title", "url", "description"],
    Attachment: ["filename"],
    Workspace: ["name", "description"],
    Project: ["name", "description", "tags", "status"],
}

module.exports = mongoose.model("Suggestion", suggestionSchema)
module.exports.SUGGESTABLE_FIELDS = SUGGESTABLE_FIELDS
