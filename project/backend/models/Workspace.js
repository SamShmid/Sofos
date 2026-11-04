const mongoose = require("mongoose")
const { historyPlugin } = require("../utils/history")

const workspaceSchema = mongoose.Schema(
    {
        name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
        description: { type: String, default: "", trim: true, maxlength: 500 },
        isDefault: { type: Boolean, default: false }, //This tenant's Home workspace, cannot be deleted
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true, index: true }, //Owning tenant; every authz check and scoped list reads this
        boardOrder: { type: [mongoose.Schema.Types.ObjectId], ref: "Task", default: null }, //Board view's saved rank list: loose (may hold ids of deleted/moved tasks, may omit tasks — renderers ignore/fall back), not a permutation. null = default order (server order, createdAt) until first drag. Mongoose defaults array paths to [] unless overridden, so this default: null is deliberate — verified to survive toJSON as boardOrder: null with the key present.
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Last editor; equals createdBy until someone else saves

    },
    {
        timestamps: true,
        toJSON: {virtuals: true}

    }
)

//At most one Home per tenant; the partial filter keeps ordinary workspaces out of the constraint.
workspaceSchema.index(
    { superWorkspace: 1, isDefault: 1 },
    { unique: true, partialFilterExpression: { isDefault: true } }
)

workspaceSchema.plugin(historyPlugin, { resourceType: "Workspace" })


module.exports = mongoose.model('Workspace', workspaceSchema)
