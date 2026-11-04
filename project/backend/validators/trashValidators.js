const { param } = require("express-validator");

const trashResourceRules = [
  param("resourceType")
    .isIn(["Workspace", "Project", "Task", "Note", "Goal", "Link", "Attachment"])
    .withMessage("resourceType must be one of Workspace, Project, Task, Note, Goal, Link, Attachment"),
  param("id").isMongoId().withMessage("Invalid id"),
];

module.exports = { trashResourceRules };
