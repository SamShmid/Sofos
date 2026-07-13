const express = require("express");
const router = express.Router();
const {
  getWorkspaces,
  getOneWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} = require("../controllers/workspaceController");
const { protect, requireWriter } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createWorkspaceRules,
  updateWorkspaceRules,
  workspaceIdRules,
} = require("../validators/workspaceValidators");

router.get("/", protect, getWorkspaces);
router.get("/:id", protect, workspaceIdRules, validate, getOneWorkspace);
router.post("/", protect, requireWriter, createWorkspaceRules, validate, createWorkspace);
router.patch("/:id", protect, requireWriter, workspaceIdRules, updateWorkspaceRules, validate, updateWorkspace);
router.delete("/:id", protect, requireWriter, workspaceIdRules, validate, deleteWorkspace);

module.exports = router;
