const mongoose = require("mongoose")

const superWorkspaceSchema = mongoose.Schema(
    {
        name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true }, //Exactly one tenant per user, enforced by the index; agents never get one
        //Per-tenant tag color overrides (P43) — auto-assigned colors (hash % 16) apply when
        //a tag has no entry here. Owner-only mutation, capped at 300 entries.
        tagColors: {
            type: [{
                tag: { type: String, trim: true, maxlength: 40 },
                color: { type: Number, min: 0, max: 15 },
            }],
            default: [],
        },
    },
    {
        timestamps: true,
        toJSON: {virtuals: true}
    }
)


module.exports = mongoose.model('SuperWorkspace', superWorkspaceSchema)
