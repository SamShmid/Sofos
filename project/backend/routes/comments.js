const express = require("express");
const router = express.Router();
const Comment = require("../models/Comment");
const {
  getComments,
  createComment,
  replyToComment,
  resolveComment,
  deleteComment,
  deleteReply,
  unresolveComment,
  undeleteComment,
} = require("../controllers/commentController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createCommentRules,
  replyRules,
  commentIdRules,
  replyIdRules,
  listCommentRules,
} = require("../validators/commentValidators");

router.get("/", protect, listCommentRules, validate, getComments);
router.post("/", protect, createCommentRules, validate, createComment);
router.post("/:id/replies", protect, commentIdRules, replyRules, validate, authorize("suggester", Comment), replyToComment);
router.post("/:id/resolve", protect, commentIdRules, validate, authorize("writer", Comment), resolveComment);
router.post("/:id/unresolve", protect, commentIdRules, validate, authorize("writer", Comment), unresolveComment);
// Root-author-only retract-style delete: not role-shaped, no authorize
// middleware (mirrors suggestions' retract idiom) — the controller itself
// gates on createdBy.
router.delete("/:id", protect, commentIdRules, validate, deleteComment);
// Root-author-only undelete: soft-deleted doc, same not-role-shaped idiom
// (authorize() would 404 on it before the controller ever checked ownership).
router.post("/:id/undelete", protect, commentIdRules, validate, undeleteComment);
router.delete("/:id/replies/:replyId", protect, replyIdRules, validate, deleteReply);

module.exports = router;
