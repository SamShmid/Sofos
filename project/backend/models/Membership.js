const mongoose = require("mongoose")

const membershipSchema = mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, //Who the grant is for
        superWorkspace: { type: mongoose.Schema.Types.ObjectId, ref: "SuperWorkspace", required: true }, //Whose stuff it applies to (denormalized so resolution is one query)
        role: { type: String, enum: ["reader", "suggester", "writer"], required: true },

        //Scope: which slice of the owner's stuff the grant covers. Unset means
        //tenant-wide; workspace is the smallest shareable scope.
        workspace: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace" },

        //Fail-closed: any code path that forgets to set status produces a no-access grant,
        //never a surprise-access one. create() sets it explicitly to "pending"; seed.js sets
        //"active" explicitly on all seeded grants.
        status: { type: String, enum: ["pending", "active"], default: "pending" },
        //Optional; absent = never expires. Set at grant time only — changing it is revoke + regrant.
        expiresAt: { type: Date },
    },
    {
        timestamps: true,
        toJSON: {virtuals: true}
    }
)

//One grant per (user, exact scope): a role change is an update, never a second grant, so
//resolution can never find two conflicting roles at the same specificity. Its { user,
//superWorkspace } prefix also serves the hot path - every authz check is one
//find({ user, superWorkspace }) over this index.
membershipSchema.index({ user: 1, superWorkspace: 1, workspace: 1 }, { unique: true })
membershipSchema.index({ superWorkspace: 1 }) //Owner's member-management list
membershipSchema.index({ workspace: 1 })


module.exports = mongoose.model('Membership', membershipSchema)
