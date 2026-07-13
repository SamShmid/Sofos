const Workspace = require("../models/Workspace");
const { cascadeDeleteWorkspace } = require("../utils/cascade");
const { ensureGeneralProject } = require("../utils/defaults");

// List all workspaces: Home pinned first, then the rest alphabetically (case-insensitive)
const getWorkspaces = async (req, res, next) => {
  try {
    const workspaces = await Workspace.find()
      .sort({ isDefault: -1, name: 1 })
      .collation({ locale: "en", strength: 2 });
    res.json({ data: workspaces, count: workspaces.length });
  } catch (err) {
    next(err);
  }
};

const getOneWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: { message: "Workspace not found" } });
    res.json({ data: workspace });
  } catch (err) {
    next(err);
  }
};

const createWorkspace = async (req, res, next) => {
  try {
    // Only name/description come from the client; isDefault stays false so users can't forge a second Home.
    const workspace = await Workspace.create({ name: req.body.name, description: req.body.description });
    // Every workspace gets an undeletable "General" project for its non-project notes/tasks.
    await ensureGeneralProject(workspace._id);
    res.status(201).json({ data: workspace });
  } catch (err) {
    next(err);
  }
};

const updateWorkspace = async (req, res, next) => {
  try {
    // Name and description are updatable; isDefault is never changed through the API.
    const update = {};
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.description !== undefined) update.description = req.body.description;
    const workspace = await Workspace.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );
    if (!workspace) return res.status(404).json({ error: { message: "Workspace not found" } });
    res.json({ data: workspace });
  } catch (err) {
    next(err);
  }
};

const deleteWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) return res.status(404).json({ error: { message: "Workspace not found" } });

    //Prevent users from deleteing the home workspace
    if (workspace.isDefault)
      return res.status(400).json({ error: { message: "The Home workspace cannot be deleted" } });

    // Recursive delete of all projects/notes/tasks filed under this workspace.
    await cascadeDeleteWorkspace(workspace._id);
    await workspace.deleteOne();

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getWorkspaces,
  getOneWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
};
