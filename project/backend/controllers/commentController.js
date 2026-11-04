const Note = require("../models/Note");
const Comment = require("../models/Comment");
const { assertRole } = require("../middleware/auth");
const { effectiveRole } = require("../utils/permissions");
const { locateAnchor } = require("../utils/commentAnchor");

const POPULATE = [
  { path: "createdBy", select: "username" },
  { path: "resolvedBy", select: "username" },
  { path: "replies.author", select: "username" },
];

// revision-controller pattern: load the container, assertRole, then list.
const getComments = async (req, res, next) => {
  try {
    const note = await Note.findById(req.query.note);
    if (!note) return res.status(404).json({ error: { message: "Note not found" } });
    await assertRole(req.user.id, note, "reader");

    const comments = await Comment.find({ note: note._id }).sort({ createdAt: 1 }).populate(POPULATE);

    res.json({ data: comments, count: comments.length });
  } catch (err) {
    next(err);
  }
};

const createComment = async (req, res, next) => {
  try {
    const note = await Note.findById(req.body.note);
    if (!note) return res.status(404).json({ error: { message: "Note not found" } });
    const role = await assertRole(req.user.id, note, "suggester");

    if (locateAnchor(note.content ?? "", req.body.anchor) === null) {
      const e = new Error("Can't attach — the note's text changed since you selected it.");
      e.status = 409;
      throw e;
    }

    const comment = await Comment.create({
      note: note._id,
      workspace: note.workspace,
      project: note.project,
      superWorkspace: note.superWorkspace,
      body: req.body.body,
      anchor: req.body.anchor,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    await comment.populate(POPULATE);

    res.status(201).json({ data: comment, effectiveRole: role });
  } catch (err) {
    next(err);
  }
};

const replyToComment = async (req, res, next) => {
  try {
    const comment = req.resource;
    comment.replies.push({ body: req.body.body, author: req.user.id });
    comment.updatedBy = req.user.id;
    await comment.save(); // VersionError -> central 409 handler (concurrent replies, same as concurrent note edits)
    await comment.populate(POPULATE);

    res.json({ data: comment, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

const resolveComment = async (req, res, next) => {
  try {
    const comment = req.resource;
    if (comment.status !== "resolved") {
      comment.status = "resolved";
      comment.resolvedBy = req.user.id;
      comment.resolvedAt = new Date();
      comment.updatedBy = req.user.id;
      await comment.save();
    }
    await comment.populate(POPULATE);

    res.json({ data: comment, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Root-author-only, regardless of role — even a workspace owner can't delete
// someone else's thread (resolve is the moderation tool, PHASE_SPEC.md
// ruling). Not role-shaped, so no authorize middleware; mirrors
// retractSuggestion's own idiom (load, ownership-gate, soft delete — P61).
const deleteComment = async (req, res, next) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment || !comment.createdBy.equals(req.user.id)) {
      return res.status(404).json({ error: { message: "Comment not found" } });
    }
    comment.deletedAt = new Date();
    comment.deletedVia = "user";
    comment.updatedBy = req.user.id;
    await comment.save();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// Undo of resolveComment — idempotent the same way resolve is: unresolving an
// already-open thread is a no-op 200, not an error.
const unresolveComment = async (req, res, next) => {
  try {
    const comment = req.resource;
    if (comment.status !== "open") {
      comment.status = "open";
      comment.resolvedBy = undefined;
      comment.resolvedAt = undefined;
      comment.updatedBy = req.user.id;
      await comment.save();
    }
    await comment.populate(POPULATE);

    res.json({ data: comment, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Undo of deleteComment — root-author-only, mirrors unretractSuggestion's
// idiom (soft-deleted doc, no authorize middleware, controller gates on
// ownership). Prune-deleted comments are unapprove's job, not this one's.
const undeleteComment = async (req, res, next) => {
  try {
    const comment = await Comment.findById(req.params.id).setOptions({ withDeleted: true });
    if (!comment || !comment.createdBy.equals(req.user.id) || comment.deletedAt === null || comment.deletedVia !== "user") {
      return res.status(404).json({ error: { message: "Comment not found" } });
    }
    // Target-liveness guard (P65, audit finding #5): a comment can't come back
    // onto a note that's since been trashed — default-filtered so a trashed note reads as gone.
    const note = await Note.findById(comment.note);
    if (!note) {
      const e = new Error("Can't restore — its note was deleted");
      e.status = 409;
      throw e;
    }
    comment.deletedAt = null;
    comment.deletedVia = null;
    comment.updatedBy = req.user.id;
    await comment.save();
    await comment.populate(POPULATE);

    res.json({ data: comment });
  } catch (err) {
    next(err);
  }
};

// Reply-author-only, same non-role-shaped idiom as deleteComment.
const deleteReply = async (req, res, next) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: { message: "Comment not found" } });

    const idx = comment.replies.findIndex((r) => r._id.equals(req.params.replyId));
    if (idx === -1 || !comment.replies[idx].author.equals(req.user.id)) {
      return res.status(404).json({ error: { message: "Reply not found" } });
    }
    comment.replies.splice(idx, 1);
    comment.updatedBy = req.user.id;
    await comment.save();
    await comment.populate(POPULATE);

    res.json({ data: comment, effectiveRole: await effectiveRole(req.user.id, comment) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getComments,
  createComment,
  replyToComment,
  resolveComment,
  deleteComment,
  deleteReply,
  unresolveComment,
  undeleteComment,
};
