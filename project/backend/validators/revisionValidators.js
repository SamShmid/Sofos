const { query, param } = require("express-validator");

const listRevisionRules = [
  query("resourceType")
    .isIn(["Workspace", "Project", "Task", "Note", "Goal", "Link", "Attachment"])
    .withMessage("resourceType must be one of Workspace, Project, Task, Note, Goal, Link, Attachment"),
  query("resource").isMongoId().withMessage("A valid resource id is required"),
];

const revisionIdRules = [
  param("id").isMongoId().withMessage("Invalid revision ID"),
];

module.exports = { listRevisionRules, revisionIdRules };
