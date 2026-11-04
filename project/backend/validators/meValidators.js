const { body } = require("express-validator");

// tourSeen only ever moves one way (unseen -> seen); false/anything but the
// literal boolean true is rejected rather than silently ignored.
const ackRules = [
  body("lastSeenVersion")
    .optional()
    .isString()
    .withMessage("lastSeenVersion must be text")
    .bail()
    .isLength({ max: 20 })
    .withMessage("lastSeenVersion cannot exceed 20 characters"),

  body("tourSeen")
    .optional()
    .custom((value) => value === true)
    .withMessage("tourSeen can only be set to true"),

  body("tipSeen")
    .optional()
    .isString()
    .withMessage("tipSeen must be text")
    .bail()
    .isLength({ min: 1, max: 40 })
    .withMessage("tipSeen must be 1-40 characters"),

  body("themePref")
    .optional()
    .isIn(["light", "dark", "system"])
    .withMessage("themePref must be light, dark, or system"),

  // At least one field required — an empty ack has nothing to record.
  body("lastSeenVersion").custom((value, { req }) => {
    if (
      value === undefined &&
      req.body.tourSeen === undefined &&
      req.body.tipSeen === undefined &&
      req.body.themePref === undefined
    ) {
      throw new Error("At least one of lastSeenVersion, tourSeen, tipSeen, or themePref is required");
    }
    return true;
  }),
];

module.exports = { ackRules };
