require("dotenv").config();
const mongoose = require("mongoose");
const Task = require("../models/Task");

// One-time migration for pre-P26 deployments: tasks created before the `status`
// field existed have none, so hydration would default them all to "todo" even
// though `completed` already recorded which were done. Idempotent — only touches
// tasks that currently lack `status`; a task that already has one (from create/
// update, the sync hook, or a prior run of this script) is left untouched.
// Direct updateMany, not load-then-save: no hook needs to fire — `status` here is
// derived 1:1 from the existing `completed` value, nothing to reconcile. updateMany
// also isn't /^find/ so it bypasses historyPlugin's default deletedAt filter (see
// utils/history.js), backfilling trashed tasks too so a restore is consistent.
// Run with: MONGODB_URI=... node scripts/backfill-task-status.js
async function backfill() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const doneResult = await Task.updateMany(
    { completed: true, status: { $exists: false } },
    { $set: { status: "done" } }
  );
  console.log(`Marked done: ${doneResult.modifiedCount} task(s)`);

  const todoResult = await Task.updateMany(
    { completed: false, status: { $exists: false } },
    { $set: { status: "todo" } }
  );
  console.log(`Marked todo: ${todoResult.modifiedCount} task(s)`);

  console.log(`Done. Total tasks assigned status: ${doneResult.modifiedCount + todoResult.modifiedCount}`);
  await mongoose.connection.close();
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
