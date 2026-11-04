const express = require("express");
const router = express.Router();
const Attachment = require("../models/Attachment");
const {
  getAttachments,
  getOneAttachment,
  downloadAttachment,
  renameAttachment,
  deleteAttachment,
} = require("../controllers/attachmentController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  listAttachmentRules,
  attachmentIdRules,
  renameAttachmentRules,
} = require("../validators/attachmentValidators");

router.get("/", protect, listAttachmentRules, validate, getAttachments);
router.get("/:id", protect, attachmentIdRules, validate, authorize("reader", Attachment), getOneAttachment);
router.get("/:id/download", protect, attachmentIdRules, validate, authorize("reader", Attachment), downloadAttachment);
router.patch("/:id", protect, attachmentIdRules, renameAttachmentRules, validate, authorize("writer", Attachment), renameAttachment);
router.delete("/:id", protect, attachmentIdRules, validate, authorize("writer", Attachment), deleteAttachment);

module.exports = router;
