const mongoose = require("mongoose")

const workspaceSchema = mongoose.Schema(
    {
        name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
        description: { type: String, default: "", trim: true, maxlength: 500 },
        isDefault: { type: Boolean, default: false }, //The one Home/General workspace, cannot be deleted

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)


module.exports = mongoose.model('Workspace', workspaceSchema)
