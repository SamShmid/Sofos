const { body, param } = require("express-validator");

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
    .withMessage("Content must be text")
    .isLength({ max: 50000 })
    .withMessage("Content cannot exceed 50000 characters"),

  body("completed")
    .optional()
    .isBoolean()
    .withMessage("Completed must be true or false"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),
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
    .withMessage("Content must be text")
    .isLength({ max: 50000 })
    .withMessage("Content cannot exceed 50000 characters"),

  body("completed")
    .optional()
    .isBoolean()
    .withMessage("Completed must be true or false"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),
];

const taskIdRules = [
  param("id").isMongoId().withMessage("Invalid task ID"),
];

module.exports = {
  createTaskRules,
  updateTaskRules,
  taskIdRules,
};
