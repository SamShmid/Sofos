const { body, param, query } = require("express-validator");
const mongoose = require("mongoose");

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

  body("superWorkspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid tenant ID"),

  body("parentWorkspace")
    .not()
    .exists()
    .withMessage("Workspaces cannot be nested. Create a project instead"),

  // Board position is set only after a workspace exists (default order until dragged).
  body("boardOrder").not().exists().withMessage("boardOrder cannot be set on create"),
];

const updateWorkspaceRules = [
  body("parentWorkspace")
    .not()
    .exists()
    .withMessage("Workspaces cannot be nested. Move projects instead"),

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

  // Board view's saved rank list: null clears it, otherwise an array of ids —
  // deliberately NO permutation/membership check (unlike /tasks/reorder): the
  // array is advisory view-state, garbage ids are self-healing at render.
  body("boardOrder")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      if (!Array.isArray(value) || value.length > 5000 || !value.every((id) => mongoose.Types.ObjectId.isValid(id))) {
        throw new Error("boardOrder must be null or an array of at most 5000 valid ids");
      }
      return true;
    }),
];

const workspaceIdRules = [
  param("id").isMongoId().withMessage("Invalid workspace ID"),
];

const listWorkspaceRules = [];

module.exports = {
  createWorkspaceRules,
  updateWorkspaceRules,
  workspaceIdRules,
  listWorkspaceRules,
};
