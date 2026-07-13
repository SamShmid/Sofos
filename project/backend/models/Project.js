const mongoose = require("mongoose")

const projectSchema = mongoose.Schema(
    {
        name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
        description: { type: String, default: "", trim: true, maxlength: 500 },
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true }, //Workspace it is contained in
        isDefault: { type: Boolean, default: false }, //The auto-created "General" project, cannot be deleted

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)


module.exports = mongoose.model('Project', projectSchema)
