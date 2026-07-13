const express = require("express");
const router = express.Router();
const {
  getProjects,
  getOneProject,
  createProject,
  updateProject,
  deleteProject,
} = require("../controllers/projectController");
const { protect, requireWriter } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createProjectRules,
  updateProjectRules,
  projectIdRules,
} = require("../validators/projectValidators");

router.get("/", protect, getProjects);
router.get("/:id", protect, projectIdRules, validate, getOneProject);
router.post("/", protect, requireWriter, createProjectRules, validate, createProject);
router.patch("/:id", protect, requireWriter, projectIdRules, updateProjectRules, validate, updateProject);
router.delete("/:id", protect, requireWriter, projectIdRules, validate, deleteProject);

module.exports = router;
