const { body, param, query } = require("express-validator");

// Both list filters go straight into a find(); malformed ids must be a 400 here,
// not a CastError 500. The controller enforces exactly-one-of.
const listLinkRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("project").optional().isMongoId().withMessage("Invalid project ID"),
  query("includeSubprojects").optional().isIn(["1"]).withMessage("Invalid includeSubprojects value"),
];

// Prepend https:// only when there is NO scheme at all. A present-but-wrong
// scheme (javascript:, ftp:) must survive to isURL and be rejected there.
function normalizeUrl(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) ? `https://${t}` : t;
}

const createLinkRules = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 120 })
    .withMessage("Title cannot exceed 120 characters"),

  body("url")
    .notEmpty()
    .withMessage("URL is required")
    .customSanitizer(normalizeUrl)
    .isURL({ protocols: ["http", "https"], require_protocol: true, require_valid_protocol: true })
    .withMessage("Invalid URL")
    .isLength({ max: 2048 })
    .withMessage("URL cannot exceed 2048 characters"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 300 })
    .withMessage("Description cannot exceed 300 characters"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),
];

const updateLinkRules = [
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty")
    .isLength({ max: 120 })
    .withMessage("Title cannot exceed 120 characters"),

  body("url")
    .optional()
    .customSanitizer(normalizeUrl)
    .isURL({ protocols: ["http", "https"], require_protocol: true, require_valid_protocol: true })
    .withMessage("Invalid URL")
    .isLength({ max: 2048 })
    .withMessage("URL cannot exceed 2048 characters"),

  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .isLength({ max: 300 })
    .withMessage("Description cannot exceed 300 characters"),

  // Links are immovable: refiling never happens through update.
  body("workspace").not().exists().withMessage("Links cannot be moved"),
  body("project").not().exists().withMessage("Links cannot be moved"),
];

const linkIdRules = [
  param("id").isMongoId().withMessage("Invalid link ID"),
];

const reorderLinkRules = [
  body("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  body("project").optional().isMongoId().withMessage("Invalid project ID"),
  body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array"),
  body("ids.*").isMongoId().withMessage("Invalid link ID"),
];

module.exports = {
  listLinkRules,
  createLinkRules,
  updateLinkRules,
  linkIdRules,
  reorderLinkRules,
};
