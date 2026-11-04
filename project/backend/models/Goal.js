const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const goalSchema = mongoose.Schema(
    {
        title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 120 },
        description: { type: String, default: "", trim: true, maxlength: 500 },
        completed: { type: Boolean, default: false },
        dueAt: { type: Date, default: null }, //All-day due stores midnight UTC (dueHasTime false); timed due stores the real instant
        dueHasTime: { type: Boolean, default: false }, //True when dueAt carries a specific time, not just a calendar date
        priority: { type: String, enum: ["low", "medium", "high", null], default: null }, //Unset (null) means no priority; existing docs stay quiet
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Always set; a project goal's project also lives in this workspace
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: absent means a workspace-level goal
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        order: { type: Number, required: true }, //Position within its container's roadmap (0-based)
        canvas: {
            type: new mongoose.Schema({ x: { type: Number }, y: { type: Number } }, { _id: false }),
            default: null,
        }, //Saved roadmap-canvas position; null = default layout (a real subdocument, not a bare nested path, so the whole field can be explicitly null)
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

goalSchema.index({ workspace: 1, project: 1, order: 1 })
goalSchema.index({ project: 1 })

goalSchema.plugin(historyPlugin, { resourceType: "Goal" })


module.exports = mongoose.model('Goal', goalSchema)
