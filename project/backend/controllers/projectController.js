const Project = require("../models/Project");
const Workspace = require("../models/Workspace");
const { cascadeDeleteProject } = require("../utils/cascade");

// List projects, alphabetically. Optional ?workspace=<id> filter.
const getProjects = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.workspace) filter.workspace = req.query.workspace;
    const projects = await Project.find(filter)
      .sort({ isDefault: -1, name: 1 })
      .collation({ locale: "en", strength: 2 });
    res.json({ data: projects, count: projects.length });
  } catch (err) {
    next(err);
  }
};

const getOneProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: { message: "Project not found" } });
    res.json({ data: project });
  } catch (err) {
    next(err);
  }
};

const createProject = async (req, res, next) => {
  try {
    // A project must live in a real workspace.
    const workspace = await Workspace.findById(req.body.workspace);
    if (!workspace) return res.status(400).json({ error: { message: "Workspace not found" } });

    const project = await Project.create({ name: req.body.name, description: req.body.description, workspace: workspace._id });
    res.status(201).json({ data: project });
  } catch (err) {
    next(err);
  }
};

const updateProject = async (req, res, next) => {
  try {
    // Name and description are editable (moving a project between workspaces is out of scope).
    const update = {};
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.description !== undefined) update.description = req.body.description;
    const project = await Project.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );
    if (!project) return res.status(404).json({ error: { message: "Project not found" } });
    res.json({ data: project });
  } catch (err) {
    next(err);
  }
};

const deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: { message: "Project not found" } });

    //Prevent users from deleting a workspace's General project
    if (project.isDefault)
      return res.status(400).json({ error: { message: "The General project cannot be deleted" } });

    // Recursive delete: everything filed under this project goes with it.
    await cascadeDeleteProject(project._id);
    await project.deleteOne();

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProjects,
  getOneProject,
  createProject,
  updateProject,
  deleteProject,
};
