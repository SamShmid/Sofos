const { body, param, query } = require("express-validator");

// Both list filters go straight into a find(); malformed ids must be a 400 here,
// not a CastError 500. The controller enforces exactly-one-of.
const listGoalRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("project").optional().isMongoId().withMessage("Invalid project ID"),
  query("own").optional().isIn(["1"]).withMessage("Invalid own value"),
];

const createGoalRules = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 120 })
    .withMessage("Title cannot exceed 120 characters"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),

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

  // Position is set only after a goal exists (default layout until dragged).
  body("canvas").not().exists().withMessage("canvas cannot be set on create"),
];

const updateGoalRules = [
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty")
    .isLength({ max: 120 })
    .withMessage("Title cannot exceed 120 characters"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("completed")
    .optional()
    .isBoolean({ strict: true })
    .withMessage("Completed must be true or false"),

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

  // Roadmap-canvas position: null clears it back to default layout, otherwise
  // exactly {x, y}, both finite and on-canvas.
  body("canvas")
    .optional({ nullable: true })
    .custom((value) => {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("canvas must be null or an object with x and y");
      }
      const keys = Object.keys(value);
      if (keys.length !== 2 || !("x" in value) || !("y" in value)) {
        throw new Error("canvas must have exactly x and y");
      }
      for (const key of ["x", "y"]) {
        const n = value[key];
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 20000) {
          throw new Error(`canvas.${key} must be a finite number between 0 and 20000`);
        }
      }
      return true;
    }),

  // Goals are immovable: refiling never happens through update.
  body("workspace").not().exists().withMessage("Goals cannot be moved"),
  body("project").not().exists().withMessage("Goals cannot be moved"),
];

const goalIdRules = [
  param("id").isMongoId().withMessage("Invalid goal ID"),
];

const reorderGoalRules = [
  body("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  body("project").optional().isMongoId().withMessage("Invalid project ID"),
  body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array"),
  body("ids.*").isMongoId().withMessage("Invalid goal ID"),
];

module.exports = {
  listGoalRules,
  createGoalRules,
  updateGoalRules,
  goalIdRules,
  reorderGoalRules,
};
