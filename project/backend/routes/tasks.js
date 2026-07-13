const express = require("express");
const router = express.Router();
const {
  getTasks,
  getOneTask,
  createTask,
  updateTask,
  deleteTask,
} = require("../controllers/taskController");
const { protect, requireWriter } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  createTaskRules,
  updateTaskRules,
  taskIdRules,
} = require("../validators/taskValidators");

router.get("/", protect, getTasks);
router.get("/:id", protect, taskIdRules, validate, getOneTask);
router.post("/", protect, requireWriter, createTaskRules, validate, createTask);
router.patch("/:id", protect, requireWriter, taskIdRules, updateTaskRules, validate, updateTask);
router.delete("/:id", protect, requireWriter, taskIdRules, validate, deleteTask);

module.exports = router;
