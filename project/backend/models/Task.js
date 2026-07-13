const mongoose = require("mongoose")

const taskSchema = mongoose.Schema(
    {
        title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 120 },
        content: { type: String, default: "" }, //Optional markdown description
        completed: { type: Boolean, default: false }, //Done / not done
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Always lives in a workspace (Default if not filed elsewhere)
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" }, //Optional: may also live inside a project

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)


module.exports = mongoose.model('Task', taskSchema)
