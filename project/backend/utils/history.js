const mongoose = require("mongoose")

// Version-history + soft-delete plugin for resource schemas. Applied to Workspace,
// Project, Task, and Note; NOT to Membership/SuperWorkspace. It:
//  - adds a deletedAt tombstone and hides tombstoned docs from every find/count,
//  - records an append-only Revision on each save (create/update/delete/restore),
//  - turns on optimisticConcurrency so stale load-then-save collisions throw a
//    VersionError the central handler maps to 409.
function historyPlugin(schema, { resourceType, coalesceMs }) {
    schema.add({ deletedAt: { type: Date, default: null } }) //null = live; a Date = trashed at that instant

    schema.set("optimisticConcurrency", true) //guard load-then-save on exactly the plugged schemas

    // Stash the loaded (BEFORE) state so a later save can snapshot it into history.
    schema.post("init", function () {
        this.$locals.original = this.toObject()
    })

    // Classify the pending change and capture its BEFORE snapshot; the actual
    // Revision.create happens post-save, once we know the write succeeded.
    schema.pre("save", function () {
        let operation
        let snapshot
        if (this.isNew) {
            operation = "create"
            snapshot = this.toObject() //no prior state; record the initial doc
        } else if (this.isModified("deletedAt")) {
            operation = this.deletedAt ? "delete" : "restore"
            snapshot = this.$locals.original
        } else {
            operation = "update"
            snapshot = this.$locals.original
        }
        // Restore-to-version needs to record "restore" even though only content
        // fields change (isModified("deletedAt") is false in that case).
        this.$locals.pendingRevision = { operation: this.$locals.operationOverride || operation, snapshot }
        this.$locals.operationOverride = null
    })

    // Only after a successful write do we append the revision; editedBy is the
    // updatedBy every controller stamps before save (createdBy===updatedBy on create).
    schema.post("save", async function () {
        const pending = this.$locals.pendingRevision
        if (!pending) return
        const Revision = mongoose.model("Revision") //lazy to dodge circular imports

        // Coalescing (opt-in per model, e.g. Note's autosave burst): the first
        // revision of a same-user burst already snapshots the pre-burst state,
        // so skip the rest until a different editor or a stale-enough gap shows
        // up. Gated on coalesceMs so unplugged models never pay the extra query.
        // Only "update" coalesces — a delete/restore (or a restore-to-version)
        // is a deliberate act that must always leave its own revision, even
        // when it lands inside a same-user autosave burst.
        if (coalesceMs && pending.operation === "update") {
            const latest = await Revision.findOne({ resourceType, resource: this._id }).sort({ createdAt: -1 }).select("editedBy createdAt").lean()
            if (latest && String(latest.editedBy) === String(this.updatedBy) && Date.now() - latest.createdAt.getTime() < coalesceMs) {
                this.$locals.pendingRevision = null
                this.$locals.original = this.toObject() //still refresh BEFORE state even though we skipped the snapshot
                return
            }
        }

        await Revision.create({
            resourceType,
            resource: this._id,
            superWorkspace: this.superWorkspace,
            operation: pending.operation,
            snapshot: pending.snapshot,
            editedBy: this.updatedBy,
        })
        this.$locals.pendingRevision = null
        this.$locals.original = this.toObject() //refresh BEFORE state for any subsequent save
    })

    // Trash is hidden by default; a query opts in with .setOptions({ withDeleted: true }).
    // deleteMany/updateMany aren't /^find/ and so bypass this — cascades rely on that.
    function hideDeleted(next) {
        if (!this.getOptions().withDeleted) this.where({ deletedAt: null })
        if (next) next()
    }
    schema.pre(/^find/, hideDeleted)
    schema.pre("countDocuments", hideDeleted)

    // Soft delete / restore go through save() so each writes its own revision.
    schema.methods.softDelete = function (userId, at = new Date()) {
        this.deletedAt = at
        this.updatedBy = userId
        return this.save()
    }
    schema.methods.restoreDoc = function (userId) {
        this.deletedAt = null
        this.updatedBy = userId
        return this.save()
    }
}

module.exports = { historyPlugin }
