const { body } = require("express-validator");

// null clears the override (back to auto); any integer 0-15 sets one.
const putTagColorRules = [
  body("tag")
    .trim()
    .notEmpty()
    .withMessage("tag is required")
    .isLength({ max: 40 })
    .withMessage("tag cannot exceed 40 characters"),

  body("color")
    .custom((value) => value === null || (Number.isInteger(value) && value >= 0 && value <= 15))
    .withMessage("color must be an integer 0-15, or null to clear the override"),
];

module.exports = { putTagColorRules };
