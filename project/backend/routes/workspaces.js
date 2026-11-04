const express = require("express");
const router = express.Router();
const Workspace = require("../models/Workspace");
const {
  getWorkspaces,
  getOneWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} = require("../controllers/workspaceController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createWorkspaceRules,
  updateWorkspaceRules,
  workspaceIdRules,
  listWorkspaceRules,
} = require("../validators/workspaceValidators");

// authorize runs AFTER validate: it hits the database with :id, so the id must be
// well-formed first. List and create carry no :id — list is pre-scoped by query,
// create checks tenant ownership in the controller.
router.get("/", protect, listWorkspaceRules, validate, getWorkspaces);
router.get("/:id", protect, workspaceIdRules, validate, authorize("reader", Workspace), getOneWorkspace);
router.post("/", protect, createWorkspaceRules, validate, createWorkspace);
router.patch("/:id", protect, workspaceIdRules, updateWorkspaceRules, validate, authorize("writer", Workspace), updateWorkspace);
router.delete("/:id", protect, workspaceIdRules, validate, authorize("writer", Workspace), deleteWorkspace);

module.exports = router;
