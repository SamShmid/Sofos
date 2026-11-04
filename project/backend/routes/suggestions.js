const express = require("express");
const router = express.Router();
const Suggestion = require("../models/Suggestion");
const {
  createSuggestion,
  getSuggestions,
  reviewSummary,
  getOneSuggestion,
  approveSuggestion,
  rejectSuggestion,
  retractSuggestion,
  unapproveSuggestion,
  unrejectSuggestion,
  unretractSuggestion,
} = require("../controllers/suggestionController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createSuggestionRules,
  approveSuggestionRules,
  suggestionIdRules,
  listSuggestionRules,
} = require("../validators/suggestionValidators");

router.get("/", protect, listSuggestionRules, validate, getSuggestions);
router.post("/", protect, createSuggestionRules, validate, createSuggestion);
// Before /:id per house convention — "review-summary" would otherwise be swallowed as an :id.
router.get("/review-summary", protect, reviewSummary);
router.get("/:id", protect, suggestionIdRules, validate, authorize("reader", Suggestion), getOneSuggestion);
router.post("/:id/approve", protect, suggestionIdRules, approveSuggestionRules, validate, authorize("writer", Suggestion), approveSuggestion);
router.post("/:id/reject", protect, suggestionIdRules, validate, authorize("writer", Suggestion), rejectSuggestion);
router.post("/:id/unapprove", protect, suggestionIdRules, validate, authorize("writer", Suggestion), unapproveSuggestion);
router.post("/:id/unreject", protect, suggestionIdRules, validate, authorize("writer", Suggestion), unrejectSuggestion);
// Proposer-only retract: not role-shaped, so no authorize middleware (mirrors the
// invite accept/decline pattern — the controller itself gates on ownership).
router.delete("/:id", protect, suggestionIdRules, validate, retractSuggestion);
// Proposer-only unretract: soft-deleted doc, same not-role-shaped idiom (authorize()
// would 404 on it before the controller ever checked ownership).
router.post("/:id/unretract", protect, suggestionIdRules, validate, unretractSuggestion);

module.exports = router;
