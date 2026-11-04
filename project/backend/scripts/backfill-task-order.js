require("dotenv").config();
const mongoose = require("mongoose");
const Task = require("../models/Task");
require("../models/Revision"); // register the model the historyPlugin writes to on save

// One-time migration for pre-P22 deployments: tasks created before the `order`
// field existed have none. Idempotent — only touches tasks that currently lack
// `order`; a task that already has one (from create/reorder, or a prior run of
// this script) is left untouched. Trashed tasks are excluded automatically by
// Task.find()'s default deletedAt filter (historyPlugin).
// Run with: MONGODB_URI=... node scripts/backfill-task-order.js
async function backfill() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const projectIds = await Task.distinct("project", { project: { $ne: null } });

  let totalAssigned = 0;
  for (const projectId of projectIds) {
    const tasks = await Task.find({ project: projectId, order: { $exists: false } }).sort({ createdAt: 1 });
    if (tasks.length === 0) continue;

    for (let i = 0; i < tasks.length; i++) {
      tasks[i].order = i;
      await tasks[i].save();
    }
    console.log(`Project ${projectId}: assigned order to ${tasks.length} task(s)`);
    totalAssigned += tasks.length;
  }

  console.log(`Done. Total tasks assigned order: ${totalAssigned}`);
  await mongoose.connection.close();
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
