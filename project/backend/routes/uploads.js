const express = require("express");
const router = express.Router();
const {
  createUpload,
  uploadChunk,
  finalizeUpload,
  deleteUpload,
} = require("../controllers/uploadController");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  startUploadRules,
  chunkIndexRules,
  finalizeUploadRules,
} = require("../validators/uploadValidators");

router.post("/", protect, startUploadRules, validate, createUpload);

// Raw body parser scoped to this route only; global express.json stays untouched.
router.put(
  "/:uploadId/chunks/:index",
  protect,
  express.raw({ type: "*/*", limit: "6mb" }),
  chunkIndexRules,
  validate,
  uploadChunk
);

router.post("/:uploadId/finalize", protect, finalizeUploadRules, validate, finalizeUpload);
router.delete("/:uploadId", protect, deleteUpload);

module.exports = router;
