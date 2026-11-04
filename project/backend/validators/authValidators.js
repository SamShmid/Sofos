const { body } = require("express-validator");

const registerRules = [
  // isString + bail FIRST: without it, .trim() coerces a non-string (e.g. an
  // object like {"$ne":null}) into "[object Object]" and lets it through as a
  // username — an account-squatting vector. Reject non-strings up front.
  body("username")
    .isString()
    .withMessage("Username must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Username is required")
    .isLength({ max: 60 })
    .withMessage("Username cannot exceed 60 characters")
    // Usernames flow into a backup folder path (utils/accountDeletion.js) — this
    // charset is the primary traversal defense: no slashes, no leading dot, so a
    // username is always a single safe path segment and ".." alone is impossible.
    .matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .withMessage("Username can only use letters, numbers, dots, underscores, and hyphens, and must start with a letter or number"),

  body("password")
    .isString()
    .withMessage("Password must be text")
    .bail()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    // bcrypt silently truncates/collides past 72 bytes — reject before that's a surprise.
    .isLength({ max: 72 })
    .withMessage("Password cannot exceed 72 characters"),

  // Optional: absent means a normal user. When sent it must be a real boolean,
  // so a mistyped "true" fails loudly instead of silently creating a person.
  body("isAgent")
    .optional()
    .isBoolean({ strict: true })
    .withMessage("isAgent must be true or false"),
];

const loginRules = [
  // isString + bail before anything else: a non-string password (e.g. an object)
  // otherwise passes .notEmpty() and reaches bcrypt.compare, which throws on a
  // non-string arg → an unhandled 500. Guard it to a clean 400.
  body("username")
    .isString()
    .withMessage("Username must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Username is required"),

  body("password")
    .isString()
    .withMessage("Password must be text")
    .bail()
    .notEmpty()
    .withMessage("Password is required"),
];

const deleteAccountRules = [
  // Same bcrypt.compare 500 guard as login.
  body("password")
    .isString()
    .withMessage("Password must be text")
    .bail()
    .notEmpty()
    .withMessage("Password is required"),
];

module.exports = {
  registerRules,
  loginRules,
  deleteAccountRules,
};
