const { body, param, query } = require("express-validator");

const createCommentRules = [
  body("note").isMongoId().withMessage("Invalid note ID"),

  body("body")
    .trim()
    .notEmpty()
    .withMessage("body is required")
    .isLength({ max: 5000 })
    .withMessage("body must be at most 5000 characters"),

  // Shared contract, PHASE_SPEC.md §1: exactly quote/before/after, all
  // strings, quote non-empty — mirrors the contentHunk exact-keys validator.
  body("anchor").custom((anchor) => {
    const keys = anchor && typeof anchor === "object" && !Array.isArray(anchor) ? Object.keys(anchor) : null;
    if (!keys || keys.length !== 3 || !["quote", "before", "after"].every((k) => keys.includes(k))) {
      throw new Error("anchor must be an object with exactly quote, before, and after");
    }
    for (const k of ["quote", "before", "after"]) {
      if (typeof anchor[k] !== "string") throw new Error(`anchor.${k} must be text`);
    }
    if (!anchor.quote) throw new Error("anchor.quote is required");
    if (anchor.quote.length > 2000) throw new Error("anchor.quote must be at most 2000 characters");
    if (anchor.before.length > 500) throw new Error("anchor.before must be at most 500 characters");
    if (anchor.after.length > 500) throw new Error("anchor.after must be at most 500 characters");
    return true;
  }),
];

const replyRules = [
  body("body")
    .trim()
    .notEmpty()
    .withMessage("body is required")
    .isLength({ max: 5000 })
    .withMessage("body must be at most 5000 characters"),
];

const commentIdRules = [param("id").isMongoId().withMessage("Invalid comment ID")];

const replyIdRules = [
  param("id").isMongoId().withMessage("Invalid comment ID"),
  param("replyId").isMongoId().withMessage("Invalid reply ID"),
];

const listCommentRules = [query("note").isMongoId().withMessage("Invalid note ID")];

module.exports = {
  createCommentRules,
  replyRules,
  commentIdRules,
  replyIdRules,
  listCommentRules,
};
