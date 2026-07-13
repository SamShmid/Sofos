const Note = require("../models/Note");
const { resolveContainer } = require("../utils/resolveContainer");


// List notes, alphabetically by title. Optional ?workspace= and ?project= filters.
const getNotes = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.workspace) filter.workspace = req.query.workspace;
    if (req.query.project) filter.project = req.query.project;
    const notes = await Note.find(filter)
      .sort({ title: 1 })
      .collation({ locale: "en", strength: 2 });
    res.json({ data: notes, count: notes.length });
  } catch (err) {
    next(err);
  }
};


const getOneNote = async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: { message: "Note not found" } });
    res.json({ data: note });
  } catch (err) {
    next(err);
  }
};

const createNote = async (req, res, next) => {
  try {
    const { workspace, project } = await resolveContainer(req.body);
    const note = await Note.create({
      title: req.body.title,
      content: req.body.content,
      workspace,
      project,
    });
    res.status(201).json({ data: note });
  } catch (err) {
    next(err);
  }
};

const updateNote = async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: { message: "Note not found" } });

    if (req.body.title !== undefined) note.title = req.body.title;
    if (req.body.content !== undefined) note.content = req.body.content;
    
    // Re-file only if the client is moving it to a different project/workspace.
    if (req.body.project !== undefined || req.body.workspace !== undefined) {
      const { workspace, project } = await resolveContainer(req.body);
      note.workspace = workspace;
      note.project = project;
    }

    await note.save();
    res.json({ data: note });
  } catch (err) {
    next(err);
  }
};

const deleteNote = async (req, res, next) => {
  try {
    const note = await Note.findByIdAndDelete(req.params.id);
    if (!note) return res.status(404).json({ error: { message: "Note not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNotes,
  getOneNote,
  createNote,
  updateNote,
  deleteNote,
};
