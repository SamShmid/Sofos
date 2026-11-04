const express = require("express");
const router = express.Router();
const { getTagColors, putTagColor } = require("../controllers/tagColorsController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { putTagColorRules } = require("../validators/tagColorValidators");

router.get("/colors", protect, getTagColors);
router.put("/colors", protect, putTagColorRules, validate, putTagColor);

module.exports = router;
