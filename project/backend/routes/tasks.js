const express = require("express");
const router = express.Router();
const Task = require("../models/Task");
const {
  getTasks,
  getOneTask,
  createTask,
  updateTask,
  reorderTasks,
  deleteTask,
} = require("../controllers/taskController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  listTaskRules,
  createTaskRules,
  updateTaskRules,
  taskIdRules,
  reorderTaskRules,
} = require("../validators/taskValidators");

// /reorder is a static segment and must be declared before /:id, or "reorder"
// would be swallowed as an id param.
// authorize AFTER validate (it queries by :id). List is pre-scoped by query;
// create's authorization is assertRole on the resolved container, in the controller.
router.get("/", protect, listTaskRules, validate, getTasks);
router.post("/", protect, createTaskRules, validate, createTask);
router.post("/reorder", protect, reorderTaskRules, validate, reorderTasks);
router.get("/:id", protect, taskIdRules, validate, authorize("reader", Task), getOneTask);
router.patch("/:id", protect, taskIdRules, updateTaskRules, validate, authorize("writer", Task), updateTask);
router.delete("/:id", protect, taskIdRules, validate, authorize("writer", Task), deleteTask);

module.exports = router;
