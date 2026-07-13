const express = require("express");
const router = express.Router();
const {
  getNotes,
  getOneNote,
  createNote,
  updateNote,
  deleteNote,
} = require("../controllers/noteController");
const { protect, requireWriter } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createNoteRules,
  updateNoteRules,
  noteIdRules,
} = require("../validators/noteValidators");

router.get("/", protect, getNotes);
router.get("/:id", protect, noteIdRules, validate, getOneNote);
router.post("/", protect, requireWriter, createNoteRules, validate, createNote);
router.patch("/:id", protect, requireWriter, noteIdRules, updateNoteRules, validate, updateNote);
router.delete("/:id", protect, requireWriter, noteIdRules, validate, deleteNote);

module.exports = router;
