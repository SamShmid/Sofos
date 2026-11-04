const express = require("express");
const router = express.Router();
const Note = require("../models/Note");
const {
  getNotes,
  getOneNote,
  createNote,
  updateNote,
  deleteNote,
} = require("../controllers/noteController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  listNoteRules,
  createNoteRules,
  updateNoteRules,
  noteIdRules,
} = require("../validators/noteValidators");

// authorize AFTER validate (it queries by :id). List is pre-scoped by query;
// create's authorization is assertRole on the resolved container, in the controller.
router.get("/", protect, listNoteRules, validate, getNotes);
router.get("/:id", protect, noteIdRules, validate, authorize("reader", Note), getOneNote);
router.post("/", protect, createNoteRules, validate, createNote);
router.patch("/:id", protect, noteIdRules, updateNoteRules, validate, authorize("writer", Note), updateNote);
router.delete("/:id", protect, noteIdRules, validate, authorize("writer", Note), deleteNote);

module.exports = router;
