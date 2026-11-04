const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const attachmentSchema = mongoose.Schema(
    {
        filename: { type: String, required: [true, "Filename is required"], trim: true, maxlength: 255 },
        size: { type: Number, required: true, min: 0 },
        mimeType: { type: String, default: "application/octet-stream" },
        storageKey: { type: String, required: true }, //Basename under UPLOADS_DIR/files; currently == the uploadId
        status: { type: String, enum: ["live", "pending"], default: "live", index: true }, //"pending" until a suggester's upload is approved; writer-created attachments are always "live"
        scanStatus: { type: String, enum: ["clean", "pending_scan", "failed", "infected", "skipped"], index: true }, //no default: unset = legacy/pre-Phase-16, visible+downloadable everywhere
        scanAttempts: { type: Number, default: 0 },
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Always set; a project attachment's project also lives in this workspace
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: absent means a workspace-level attachment
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

attachmentSchema.index({ workspace: 1, project: 1, createdAt: -1 })
attachmentSchema.index({ project: 1 })

attachmentSchema.plugin(historyPlugin, { resourceType: "Attachment" })


module.exports = mongoose.model('Attachment', attachmentSchema)
