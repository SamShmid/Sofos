const { body, param } = require("express-validator");

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
    .withMessage("Content must be text")
    .isLength({ max: 50000 })
    .withMessage("Content cannot exceed 50000 characters"),

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
    .withMessage("Content must be text")
    .isLength({ max: 50000 })
    .withMessage("Content cannot exceed 50000 characters"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),
];

const noteIdRules = [
  param("id").isMongoId().withMessage("Invalid note ID"),
];

module.exports = {
  createNoteRules,
  updateNoteRules,
  noteIdRules,
};
