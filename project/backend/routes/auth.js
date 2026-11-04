const express = require("express");
const router = express.Router();
const { register, login, deleteAccount, logout } = require("../controllers/authController");
const loginLimiter = require("../middleware/loginLimiter");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { registerRules, loginRules, deleteAccountRules } = require("../validators/authValidators");

router.post("/register", loginLimiter, registerRules, validate, register);
router.post("/login", loginLimiter, loginRules, validate, login);
// No rate limiter: already behind a valid JWT + password re-verification.
router.delete("/me", protect, deleteAccountRules, validate, deleteAccount);
// No rate limiter: already behind a valid session.
router.post("/logout", protect, logout);

module.exports = router;
