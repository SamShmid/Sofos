const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const projectSchema = mongoose.Schema(
    {
        name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
        description: { type: String, default: "", trim: true, maxlength: 500 },
        tags: { type: [String], default: [] },
        status: { type: String, enum: ["active", "blocked", "completed"], default: "active", index: true },
        archivedAt: { type: Date, default: null, index: true },
        archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Workspace it is contained in
        parentProject: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null }, //Direct parent project; null = top-level in its workspace
        ancestors: { type: [mongoose.Schema.Types.ObjectId], ref: "Project", default: [], index: true }, //Root-first chain of ancestor project ids; server-maintained, never client-writable
        boardOrder: { type: [mongoose.Schema.Types.ObjectId], ref: "Task", default: null }, //Board view's saved rank list: loose (may hold ids of deleted/moved tasks, may omit tasks — renderers ignore/fall back), not a permutation. null = default order (server order, createdAt) until first drag. Mongoose defaults array paths to [] unless overridden, so this default: null is deliberate — verified to survive toJSON as boardOrder: null with the key present.
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

projectSchema.index({ workspace: 1, parentProject: 1, archivedAt: 1 })

projectSchema.plugin(historyPlugin, { resourceType: "Project" })

// Canonical tag form for the ?tags= OR filter, every write path inherits it
// (controller, suggestion approve, seed): trim/lowercase/dedupe first-seen.
projectSchema.pre("validate", function () {
    if (!this.isModified("tags")) return
    const seen = new Set()
    const result = []
    for (const t of this.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)) {
        if (!seen.has(t)) {
            seen.add(t)
            result.push(t)
        }
    }
    this.tags = result
})


module.exports = mongoose.model('Project', projectSchema)
