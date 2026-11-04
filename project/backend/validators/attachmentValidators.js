const { body, param, query } = require("express-validator");

// Both list filters go straight into a find(); malformed ids must be a 400 here,
// not a CastError 500. The controller enforces exactly-one-of.
const listAttachmentRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("project").optional().isMongoId().withMessage("Invalid project ID"),
  query("includeSubprojects").optional().isIn(["1"]).withMessage("Invalid includeSubprojects value"),
];

const attachmentIdRules = [
  param("id").isMongoId().withMessage("Invalid attachment ID"),
];

// Rename only: attachments are never re-filed or re-uploaded through update.
const renameAttachmentRules = [
  body("filename")
    .trim()
    .notEmpty()
    .withMessage("Filename is required")
    .isLength({ max: 255 })
    .withMessage("Filename cannot exceed 255 characters"),
];

module.exports = {
  listAttachmentRules,
  attachmentIdRules,
  renameAttachmentRules,
};
