const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");
const loginLimiter = require("../middleware/loginLimiter");
const { validate } = require("../middleware/validate");
const { registerRules, loginRules } = require("../validators/authValidators");

router.post("/register", loginLimiter, registerRules, validate, register);
router.post("/login", loginLimiter, loginRules, validate, login);

module.exports = router;
