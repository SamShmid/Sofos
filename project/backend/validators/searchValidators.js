const { query } = require("express-validator");

const searchRules = [
  query("q")
    .trim()
    .notEmpty()
    .withMessage("q is required")
    .isLength({ max: 80 })
    .withMessage("q cannot exceed 80 characters"),
];

module.exports = { searchRules };
