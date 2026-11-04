const express = require("express");
const router = express.Router();
const { getGuide } = require("../controllers/guideController");
const { protect } = require("../middleware/auth");

router.get("/", protect, getGuide);

module.exports = router;
