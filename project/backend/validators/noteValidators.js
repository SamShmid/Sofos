const { body, param, query } = require("express-validator");

// Both list filters go straight into a find(); malformed ids must be a 400 here,
// not a CastError 500.
const listNoteRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("project").optional().isMongoId().withMessage("Invalid project ID"),
  query("includeSubprojects").optional().isIn(["1"]).withMessage("Invalid includeSubprojects value"),
];

const createNoteRules = [
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

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),
];

const updateNoteRules = [
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

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),

  body("commit")
    .optional()
    .isBoolean()
    .withMessage("commit must be true or false"),
];

const noteIdRules = [
  param("id").isMongoId().withMessage("Invalid note ID"),
];

module.exports = {
  listNoteRules,
  createNoteRules,
  updateNoteRules,
  noteIdRules,
};
