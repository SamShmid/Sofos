const { body, param } = require("express-validator");

// Creating a grant. The target account is named by its shareCode (never a raw
// user id — ids aren't public, codes are). Scope is explicit so a tenant-wide
// grant is a deliberate word, never an accidentally-omitted field.
const createMembershipRules = [
  body("shareCode")
    .trim()
    .toUpperCase()
    .notEmpty()
    .withMessage("A share code is required")
    .matches(/^SF-[A-Z0-9]{8}$/)
    .withMessage("That doesn't look like a share code"),

  body("role")
    .isIn(["reader", "suggester", "writer"])
    .withMessage("Role must be reader, suggester, or writer"),

  body("scope")
    .isIn(["none", "workspace"])
    .withMessage("Scope must be none or workspace"),

  // A scoped grant must name what it's scoped to...
  body("target")
    .if(body("scope").equals("workspace"))
    .isMongoId()
    .withMessage("A valid workspace id is required for this scope"),

  // ...and a tenant-wide grant must NOT, so intent can't be misread.
  body("target")
    .if(body("scope").equals("none"))
    .not()
    .exists()
    .withMessage("A tenant-wide grant takes no target"),

  // Optional expiry, set at grant time only (no edit endpoint — changing it is
  // revoke + regrant).
  body("expiresAt")
    .optional()
    .isISO8601()
    .withMessage("Invalid expiry date")
    .custom((value) => new Date(value) > new Date())
    .withMessage("Expiry date must be in the future"),
];

// The only mutable part of a grant is its role. Moving a grant to a different
// scope/target is a delete-and-recreate, not an edit, so those aren't accepted here.
const updateMembershipRules = [
  body("role")
    .isIn(["reader", "suggester", "writer"])
    .withMessage("Role must be reader, suggester, or writer"),
];

const membershipIdRules = [
  param("id").isMongoId().withMessage("Invalid membership ID"),
];

const inviteIdRules = [
  param("id").isMongoId().withMessage("Invalid membership ID"),
];

module.exports = {
  createMembershipRules,
  updateMembershipRules,
  membershipIdRules,
  inviteIdRules,
};
