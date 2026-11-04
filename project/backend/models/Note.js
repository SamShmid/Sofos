const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const noteSchema = mongoose.Schema(
    {
        title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 120 },
        content: { type: String, default: "" }, //Saving the markdown file as text
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Always lives in a workspace (Default if not filed elsewhere)
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: may also live inside a project
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

noteSchema.index({ workspace: 1, project: 1 })
noteSchema.index({ project: 1 })

noteSchema.plugin(historyPlugin, { resourceType: "Note", coalesceMs: 10 * 60 * 1000 })


module.exports = mongoose.model('Note', noteSchema)
