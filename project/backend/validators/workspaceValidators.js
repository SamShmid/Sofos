const { body, param } = require("express-validator");

const createWorkspaceRules = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ max: 120 })
    .withMessage("Name cannot exceed 120 characters"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),
];

const updateWorkspaceRules = [
  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Name cannot be empty")
    .isLength({ max: 120 })
    .withMessage("Name cannot exceed 120 characters"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),
];

const workspaceIdRules = [
  param("id").isMongoId().withMessage("Invalid workspace ID"),
];

module.exports = {
  createWorkspaceRules,
  updateWorkspaceRules,
  workspaceIdRules,
};
