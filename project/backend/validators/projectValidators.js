const { body, param } = require("express-validator");

const createProjectRules = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ max: 120 })
    .withMessage("Name cannot exceed 120 characters"),

  body("workspace")
    .notEmpty()
    .withMessage("Workspace is required")
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),
];

const updateProjectRules = [
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

const projectIdRules = [
  param("id").isMongoId().withMessage("Invalid project ID"),
];

module.exports = {
  createProjectRules,
  updateProjectRules,
  projectIdRules,
};
