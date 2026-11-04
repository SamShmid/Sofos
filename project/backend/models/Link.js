const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const linkSchema = mongoose.Schema(
    {
        title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 120 },
        url: { type: String, required: [true, "URL is required"], trim: true, maxlength: 2048 },
        description: { type: String, default: "", trim: true, maxlength: 300 },
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Always set; a project link's project also lives in this workspace
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: absent means a workspace-level link
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        order: { type: Number, required: true }, //Position within its container's link list (0-based)
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

linkSchema.index({ workspace: 1, project: 1, order: 1 })
linkSchema.index({ project: 1 })

linkSchema.plugin(historyPlugin, { resourceType: "Link" })


module.exports = mongoose.model('Link', linkSchema)
