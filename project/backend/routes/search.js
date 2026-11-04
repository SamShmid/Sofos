const express = require("express");
const router = express.Router();
const { search } = require("../controllers/searchController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { searchRules } = require("../validators/searchValidators");

router.get("/", protect, searchRules, validate, search);

module.exports = router;
