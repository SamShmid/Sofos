const express = require("express");
const router = express.Router();
const { getTrash, restoreFromTrash, hardDelete } = require("../controllers/trashController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { trashResourceRules } = require("../validators/trashValidators");

// No authorize(Model) here: trash isn't a role-governed resource, ownership is
// enforced inside the controller (ownedTenantOrThrow) — same reasoning as memberships.
router.get("/", protect, getTrash);
router.post("/:resourceType/:id/restore", protect, trashResourceRules, validate, restoreFromTrash);
router.delete("/:resourceType/:id", protect, trashResourceRules, validate, hardDelete);

module.exports = router;
