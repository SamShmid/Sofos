const Task = require("../models/Task");
const { resolveContainer } = require("../utils/resolveContainer");


// List tasks, alphabetically by title. Optional ?workspace= and ?project= filters.
const getTasks = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.workspace) filter.workspace = req.query.workspace;
    if (req.query.project) filter.project = req.query.project;
    const tasks = await Task.find(filter)
      .sort({ title: 1 })
      .collation({ locale: "en", strength: 2 });
    res.json({ data: tasks, count: tasks.length });
  } catch (err) {
    next(err);
  }
};

const getOneTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
};

const createTask = async (req, res, next) => {
  try {
    const { workspace, project } = await resolveContainer(req.body);
    const task = await Task.create({
      title: req.body.title,
      content: req.body.content,
      completed: req.body.completed,
      workspace,
      project,
    });
    res.status(201).json({ data: task });
  } catch (err) {
    next(err);
  }
};

const updateTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });

    if (req.body.title !== undefined) task.title = req.body.title;
    if (req.body.content !== undefined) task.content = req.body.content;
    if (req.body.completed !== undefined) task.completed = req.body.completed;
    // Re-file only if the client is moving it to a different project/workspace.
    if (req.body.project !== undefined || req.body.workspace !== undefined) {
      const { workspace, project } = await resolveContainer(req.body);
      task.workspace = workspace;
      task.project = project;
    }

    await task.save();
    res.json({ data: task });
  } catch (err) {
    next(err);
  }
};

const deleteTask = async (req, res, next) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: { message: "Task not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTasks,
  getOneTask,
  createTask,
  updateTask,
  deleteTask,
};
