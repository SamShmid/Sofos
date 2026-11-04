const express = require("express");
const router = express.Router();
const { getMe, ackMe, getNotes, getAttention } = require("../controllers/meController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { ackRules } = require("../validators/meValidators");

router.get("/", protect, getMe);
router.get("/notes", protect, getNotes);
router.get("/attention", protect, getAttention);
router.post("/ack", protect, ackRules, validate, ackMe);

module.exports = router;
