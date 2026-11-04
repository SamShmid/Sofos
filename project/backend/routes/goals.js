const express = require("express");
const router = express.Router();
const Goal = require("../models/Goal");
const {
  getGoals,
  getOneGoal,
  createGoal,
  updateGoal,
  reorderGoals,
  deleteGoal,
  getGoalsSummary,
} = require("../controllers/goalController");
const { protect, authorize } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const {
  listGoalRules,
  createGoalRules,
  updateGoalRules,
  goalIdRules,
  reorderGoalRules,
} = require("../validators/goalValidators");

// /summary and /reorder are static segments and must be declared before /:id,
// or "summary"/"reorder" would be swallowed as an id param.
router.get("/", protect, listGoalRules, validate, getGoals);
router.get("/summary", protect, getGoalsSummary);
router.post("/", protect, createGoalRules, validate, createGoal);
router.post("/reorder", protect, reorderGoalRules, validate, reorderGoals);
router.get("/:id", protect, goalIdRules, validate, authorize("reader", Goal), getOneGoal);
router.patch("/:id", protect, goalIdRules, updateGoalRules, validate, authorize("writer", Goal), updateGoal);
router.delete("/:id", protect, goalIdRules, validate, authorize("writer", Goal), deleteGoal);

module.exports = router;
