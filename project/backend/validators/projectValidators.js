const { body, param, query } = require("express-validator");
const mongoose = require("mongoose");

// Both list filters go straight into a find(); a malformed id must die here as
// a 400, not surface as a CastError 500. workspace/parent are mutually
// exclusive — each names a different list shape (top-level vs. sub-projects).
const listProjectRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("parent").optional().isMongoId().withMessage("Invalid parent ID"),
  query("workspace").custom((value, { req }) => {
    if (req.query.workspace !== undefined && req.query.parent !== undefined)
      throw new Error("workspace and parent are mutually exclusive");
    return true;
  }),
  query("tags").optional().isString().isLength({ max: 400 }),
  query("sort").optional().isIn(["az", "za", "newest", "oldest"]).withMessage("Invalid sort"),
  query("archived").optional().isIn(["only", "include"]).withMessage("Invalid archived filter"),
  // deep is a ?workspace= modifier only — it has no meaning against ?parent=.
  query("deep").optional().isIn(["1"]).withMessage("Invalid deep value"),
  query("deep").custom((value, { req }) => {
    if (req.query.deep !== undefined && req.query.parent !== undefined)
      throw new Error("deep is only valid with workspace");
    return true;
  }),
];

const createProjectRules = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ max: 120 })
    .withMessage("Name cannot exceed 120 characters"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("parentProject")
    .optional()
    .isMongoId()
    .withMessage("Invalid parent project ID"),

  // Exactly one container must be named — never both, never neither.
  body("workspace").custom((value, { req }) => {
    const hasWorkspace = req.body.workspace !== undefined;
    const hasParent = req.body.parentProject !== undefined;
    if (hasWorkspace === hasParent)
      throw new Error("Provide exactly one of workspace or parentProject");
    return true;
  }),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("tags")
    .optional()
    .isArray({ max: 10 })
    .withMessage("Tags must be an array of at most 10"),
  body("tags.*")
    .isString()
    .withMessage("Each tag must be text")
    .trim()
    .notEmpty()
    .withMessage("Tags cannot be empty")
    .isLength({ max: 30 })
    .withMessage("Tags cannot exceed 30 characters"),

  body("status")
    .optional()
    .isIn(["active", "blocked", "completed"])
    .withMessage("Invalid project status"),

  // Board position is set only after a project exists (default order until dragged).
  body("boardOrder").not().exists().withMessage("boardOrder cannot be set on create"),
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

  body("tags")
    .optional()
    .isArray({ max: 10 })
    .withMessage("Tags must be an array of at most 10"),
  body("tags.*")
    .isString()
    .withMessage("Each tag must be text")
    .trim()
    .notEmpty()
    .withMessage("Tags cannot be empty")
    .isLength({ max: 30 })
    .withMessage("Tags cannot exceed 30 characters"),

  body("status")
    .optional()
    .isIn(["active", "blocked", "completed"])
    .withMessage("Invalid project status"),

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

const projectIdRules = [
  param("id").isMongoId().withMessage("Invalid project ID"),
];

// null parentProject means "move to the workspace root"; a MongoId means "nest
// under this project" — same null-or-id admission as a task's goal field.
const moveProjectRules = [
  body("parentProject")
    .optional({ nullable: true })
    .custom((value) => value === null || mongoose.Types.ObjectId.isValid(value))
    .withMessage("Invalid parent project ID"),
  body("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  body("workspace").custom((value, { req }) => {
    if (req.body.parentProject != null && value !== undefined)
      throw new Error("workspace is only valid when moving to a workspace root");
    return true;
  }),
];

module.exports = {
  listProjectRules,
  createProjectRules,
  updateProjectRules,
  projectIdRules,
  moveProjectRules,
};
