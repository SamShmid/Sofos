const express = require("express");
const router = express.Router();
const Project = require("../models/Project");
const {
  getProjects,
  getOneProject,
  createProject,
  updateProject,
  moveProject,
  archiveProject,
  restoreProject,
  deleteProject,
} = require("../controllers/projectController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  listProjectRules,
  createProjectRules,
  updateProjectRules,
  projectIdRules,
  moveProjectRules,
} = require("../validators/projectValidators");

// authorize AFTER validate (it queries by :id). List is pre-scoped by query;
// create's authorization is assertRole on the target workspace/parent project,
// in the controller.
router.get("/", protect, listProjectRules, validate, getProjects);
router.get("/:id", protect, projectIdRules, validate, authorize("reader", Project), getOneProject);
router.post("/", protect, createProjectRules, validate, createProject);
router.patch("/:id", protect, projectIdRules, updateProjectRules, validate, authorize("writer", Project), updateProject);
router.post("/:id/move", protect, projectIdRules, moveProjectRules, validate, authorize("writer", Project), moveProject);
router.post("/:id/archive", protect, projectIdRules, validate, authorize("writer", Project), archiveProject);
router.post("/:id/restore", protect, projectIdRules, validate, authorize("writer", Project), restoreProject);
router.delete("/:id", protect, projectIdRules, validate, authorize("writer", Project), deleteProject);

module.exports = router;
