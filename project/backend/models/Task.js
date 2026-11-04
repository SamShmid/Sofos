const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const taskSchema = mongoose.Schema(
    {
        title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 120 },
        content: { type: String, default: "" }, //Optional markdown description
        completed: { type: Boolean, default: false }, //Done / not done
        status: { type: String, enum: ["todo", "in_progress", "done"], default: "todo" }, //Kanban source of truth; synced with completed below
        dueAt: { type: Date, default: null }, //All-day due stores midnight UTC (dueHasTime false); timed due stores the real instant
        dueHasTime: { type: Boolean, default: false }, //True when dueAt carries a specific time, not just a calendar date
        priority: { type: String, enum: ["low", "medium", "high", null], default: null }, //Unset (null) means no priority; existing docs stay quiet
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Always lives in a workspace (Default if not filed elsewhere)
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: may also live inside a project
        parentTask: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
        ancestors: { type: [mongoose.Schema.Types.ObjectId], ref: "Task", default: [], index: true },
        goal: { type: mongoose.Schema.Types.ObjectId, ref: "Goal" }, //Optional: assignment onto a same-container roadmap goal
        order: { type: Number }, //Dense among siblings in one workspace/project + parentTask container
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

taskSchema.index({ workspace: 1, project: 1, parentTask: 1, order: 1 })
taskSchema.index({ project: 1 })
taskSchema.index({ goal: 1 })

taskSchema.plugin(historyPlugin, { resourceType: "Task" })

// One rule, every write path (controllers, suggestion approve, seed) inherits it:
// status drives completed when status changed this save; completed drives status
// (done<->todo only — in_progress has no boolean equivalent) otherwise. If both
// were modified in the same save, status wins.
taskSchema.pre("validate", function () {
    if (this.isModified("status")) {
        this.completed = this.status === "done"
    } else if (this.isModified("completed")) {
        this.status = this.completed ? "done" : (this.status === "done" ? "todo" : this.status)
    }
})

module.exports = mongoose.model('Task', taskSchema)
