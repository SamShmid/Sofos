const { body, param } = require("express-validator");

const startUploadRules = [
  body("filename")
    .trim()
    .notEmpty()
    .withMessage("Filename is required")
    .isLength({ max: 255 })
    .withMessage("Filename cannot exceed 255 characters"),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),
];

const chunkIndexRules = [
  param("index").isInt({ min: 0 }).withMessage("Invalid chunk index"),
];

const finalizeUploadRules = [
  body("size")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Invalid size"),
];

module.exports = {
  startUploadRules,
  chunkIndexRules,
  finalizeUploadRules,
};
