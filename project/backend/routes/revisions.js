const express = require("express");
const router = express.Router();
const { getRevisions, restoreRevision, deleteAllRevisions } = require("../controllers/revisionController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { listRevisionRules, revisionIdRules } = require("../validators/revisionValidators");

// No authorize(Model) here: role is asserted in-controller via assertRole, since
// the target doc is named by query (?resource=) rather than a route :id.
router.get("/", protect, listRevisionRules, validate, getRevisions);
// Owner-only tenant-wide clear; ownership enforced inside the controller
// (ownedTenantOrThrow) — no :id, no body, so no rules array needed.
router.delete("/", protect, deleteAllRevisions);
router.post("/:id/restore", protect, revisionIdRules, validate, restoreRevision);

module.exports = router;
