const { body, param, query } = require("express-validator");
const mongoose = require("mongoose");

// Both list filters go straight into a find(); malformed ids must be a 400 here,
// not a CastError 500.
const listTaskRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("project").optional().isMongoId().withMessage("Invalid project ID"),
  query("deep").optional().isIn(["1"]).withMessage("Invalid deep value"),
  query("own").optional().isIn(["1"]).withMessage("Invalid own value"),
];

const createTaskRules = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 120 })
    .withMessage("Title cannot exceed 120 characters"),

  body("content")
    .optional()
    .isString()
    .withMessage("Content must be text"),

  body("completed")
    .optional()
    .isBoolean()
    .withMessage("Completed must be true or false"),

  body("status")
    .optional()
    .isIn(["todo", "in_progress", "done"])
    .withMessage("Invalid status"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),

  body("goal")
    .optional({ nullable: true })
    .custom((value) => value === null || mongoose.Types.ObjectId.isValid(value))
    .withMessage("Invalid goal ID"),

  body("parentTask")
    .optional({ nullable: true })
    .custom((value) => value === null || mongoose.Types.ObjectId.isValid(value))
    .withMessage("Invalid parent task ID"),

  body("dueAt")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("dueAt must be an ISO 8601 date"),

  body("dueHasTime")
    .optional()
    .isBoolean()
    .withMessage("dueHasTime must be a boolean"),

  body("priority")
    .optional({ nullable: true })
    .isIn(["low", "medium", "high"])
    .withMessage("priority must be low, medium, or high"),
];

const updateTaskRules = [
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty")
    .isLength({ max: 120 })
    .withMessage("Title cannot exceed 120 characters"),

  body("content")
    .optional()
    .isString()
    .withMessage("Content must be text"),

  body("completed")
    .optional()
    .isBoolean()
    .withMessage("Completed must be true or false"),

  body("status")
    .optional()
    .isIn(["todo", "in_progress", "done"])
    .withMessage("Invalid status"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),

  body("goal")
    .optional({ nullable: true })
    .custom((value) => value === null || mongoose.Types.ObjectId.isValid(value))
    .withMessage("Invalid goal ID"),

  body("parentTask")
    .optional({ nullable: true })
    .custom((value) => value === null || mongoose.Types.ObjectId.isValid(value))
    .withMessage("Invalid parent task ID"),

  body("completeSubtasks")
    .optional()
    .isBoolean()
    .withMessage("completeSubtasks must be a boolean"),

  body("dueAt")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("dueAt must be an ISO 8601 date"),

  body("dueHasTime")
    .optional()
    .isBoolean()
    .withMessage("dueHasTime must be a boolean"),

  body("priority")
    .optional({ nullable: true })
    .isIn(["low", "medium", "high"])
    .withMessage("priority must be low, medium, or high"),
];

const taskIdRules = [
  param("id").isMongoId().withMessage("Invalid task ID"),
];

const reorderTaskRules = [
  body("project").isMongoId().withMessage("Invalid project ID"),
  body("parentTask")
    .optional({ nullable: true })
    .custom((value) => value === null || mongoose.Types.ObjectId.isValid(value))
    .withMessage("Invalid parent task ID"),
  body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array"),
  body("ids.*").isMongoId().withMessage("Invalid task ID"),
];

module.exports = {
  listTaskRules,
  createTaskRules,
  updateTaskRules,
  taskIdRules,
  reorderTaskRules,
};
