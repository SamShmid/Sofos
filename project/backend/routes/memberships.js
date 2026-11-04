const express = require("express");
const router = express.Router();
const {
  getMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
  listMyInvites,
  acceptInvite,
  declineInvite,
} = require("../controllers/membershipController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createMembershipRules,
  updateMembershipRules,
  membershipIdRules,
  inviteIdRules,
} = require("../validators/membershipValidators");

// No authorize(Model) here: memberships aren't a role-governed resource, they
// DEFINE roles. Ownership is enforced inside the controller (ownedTenantOrThrow).
router.get("/", protect, getMemberships);
router.post("/", protect, createMembershipRules, validate, createMembership);

// Recipient invite actions — must come before /:id or Express would capture
// "invites" as an :id.
router.get("/invites", protect, listMyInvites);
router.post("/invites/:id/accept", protect, inviteIdRules, validate, acceptInvite);
router.post("/invites/:id/decline", protect, inviteIdRules, validate, declineInvite);

router.patch("/:id", protect, membershipIdRules, updateMembershipRules, validate, updateMembership);
router.delete("/:id", protect, membershipIdRules, validate, deleteMembership);

module.exports = router;
