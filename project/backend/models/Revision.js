const mongoose = require("mongoose")

// Append-only audit trail: one doc per create/update/delete/restore of a plugged
// resource. snapshot is the FULL doc as it was BEFORE the change (for "create" it
// is the initial state). No update/delete paths exist anywhere — history is
// immutable except when a hard delete purges it wholesale.
const revisionSchema = mongoose.Schema(
    {
        resourceType: { type: String, enum: ["Workspace", "Project", "Task", "Note", "Goal", "Link", "Attachment"], required: true },
        resource: { type: mongoose.Schema.Types.ObjectId, required: true },
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; scopes history reads
        operation: { type: String, enum: ["create", "update", "delete", "restore"], required: true },
        snapshot: { type: mongoose.Schema.Types.Mixed, required: true }, //Full BEFORE state (initial state for "create")
        editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    {
        timestamps: true,
    }
)

//The history-panel read path: newest-first for one resource.
revisionSchema.index({ resourceType: 1, resource: 1, createdAt: -1 })
revisionSchema.index({ resource: 1 })


module.exports = mongoose.model("Revision", revisionSchema)
