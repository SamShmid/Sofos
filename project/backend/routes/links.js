const express = require("express");
const router = express.Router();
const Link = require("../models/Link");
const {
  getLinks,
  getOneLink,
  createLink,
  updateLink,
  reorderLinks,
  deleteLink,
} = require("../controllers/linkController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  listLinkRules,
  createLinkRules,
  updateLinkRules,
  linkIdRules,
  reorderLinkRules,
} = require("../validators/linkValidators");

// /reorder is a static segment and must be declared before /:id, or "reorder"
// would be swallowed as an id param.
router.get("/", protect, listLinkRules, validate, getLinks);
router.post("/", protect, createLinkRules, validate, createLink);
router.post("/reorder", protect, reorderLinkRules, validate, reorderLinks);
router.get("/:id", protect, linkIdRules, validate, authorize("reader", Link), getOneLink);
router.patch("/:id", protect, linkIdRules, updateLinkRules, validate, authorize("writer", Link), updateLink);
router.delete("/:id", protect, linkIdRules, validate, authorize("writer", Link), deleteLink);

module.exports = router;
