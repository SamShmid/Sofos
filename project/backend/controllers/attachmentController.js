const fs = require("fs");
const Attachment = require("../models/Attachment");
const Project = require("../models/Project");
const { filePathFor } = require("../utils/uploadStore");
const { accessibleFilters, roleAtLeast } = require("../utils/permissions");
const { assertVersion } = require("../utils/assertVersion");
const requireExactlyOneContainer = require("../utils/requireExactlyOneContainer");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { softCascadeLeafSuggestions } = require("../utils/cascade");

// An attachments list is always scoped to exactly one container (a workspace's
// files list shows only its OWN files, not its projects' files).
const getAttachments = async (req, res, next) => {
  try {
    const isProjectMode = requireExactlyOneContainer(req.query);

    const { ownSuperWorkspaceId, memberships, itemFilter } = await accessibleFilters(req.user.id);

    const filter = {
      $and: [
        itemFilter,
        // "not pending" (incl. attachments created before this field existed, whose
        // status is unset) is visible to all; a pending one only to its uploader.
        { $or: [{ status: { $ne: "pending" } }, { status: "pending", createdBy: req.user.id }] },
        // Same idea for scanning: the uploader sees their own scanning-in-progress
        // file (with its status); everyone else doesn't. failed/infected are
        // soft-deleted already, so default find-filtering hides those for free.
        { $or: [{ scanStatus: { $nin: ["pending_scan"] } }, { scanStatus: "pending_scan", createdBy: req.user.id }] },
      ],
    };
    if (isProjectMode) {
      if (req.query.includeSubprojects === "1") {
        const descendantIds = await Project.find({ ancestors: req.query.project, archivedAt: null }).distinct("_id");
        filter.project = { $in: [req.query.project, ...descendantIds] };
      } else filter.project = req.query.project;
    } else {
      filter.workspace = req.query.workspace;
      if (req.query.includeSubprojects === "1") {
        const archivedIds = await Project.find({ workspace: req.query.workspace, archivedAt: { $ne: null } }).distinct("_id");
        if (archivedIds.length) filter.$and.push({ $or: [{ project: null }, { project: { $exists: false } }, { project: { $nin: archivedIds } }] });
      } else filter.project = null;
    }

    const attachments = await Attachment.find(filter).sort({ createdAt: -1 });

    const data = await withEffectiveRole(attachments, { ownSuperWorkspaceId, memberships });

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

// Orthogonal to the Phase-15 approval gate above: a scan-pending/failed/infected
// file is blocked for EVERYONE, uploader and writers included (unset/clean/skipped
// pass through unchanged). failed/infected attachments are soft-deleted, so
// authorize() 404s them first — the failed/infected 409s here are defense-in-depth,
// normally shadowed by that trash 404; only pending_scan (a live doc) hits this for real.
function scanGateMessage(attachment) {
  if (attachment.scanStatus === "pending_scan") return "File is awaiting virus scan";
  if (attachment.scanStatus === "failed") return "File could not be scanned";
  if (attachment.scanStatus === "infected") return "File is infected — download blocked";
  return null;
}

const getOneAttachment = async (req, res, next) => {
  try {
    if (
      req.resource.status === "pending" &&
      !req.resource.createdBy.equals(req.user.id) &&
      !roleAtLeast(req.effectiveRole, "writer")
    ) {
      return res.status(404).json({ error: { message: "Attachment not found" } });
    }
    const scanBlock = scanGateMessage(req.resource);
    if (scanBlock) return res.status(409).json({ error: { message: scanBlock } });
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Strip control chars so a hostile filename can't smuggle a header-injection
// newline into either Content-Disposition parameter below.
function sanitizeFilename(name) {
  return name.replace(/[\x00-\x1f\x7f]/g, "");
}

// RFC 6266 filename= is a quoted-string (backslash-escape quotes/backslashes).
// Node rejects header values outside ISO-8859-1, so anything non-ASCII is
// replaced with "_" here — the real name travels via filename* below instead.
function asciiFallbackFilename(name) {
  return name.replace(/[\\"]/g, "\\$&").replace(/[^\x20-\x7e]/g, "_");
}

// RFC 5987/8187 ext-value percent-encoding: encodeURIComponent covers most of
// it, but leaves ! * ' ( ) unescaped, which attr-char excludes — encode those too.
function extValuePercentEncode(name) {
  return encodeURIComponent(name).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// Per RFC 6266/5987: an ASCII fallback for clients that don't parse filename*,
// plus filename* carrying the actual UTF-8 name — the only way a non-Latin1
// filename can survive a Content-Disposition header at all.
function contentDispositionHeader(disposition, rawFilename) {
  const filename = sanitizeFilename(rawFilename);
  return `${disposition}; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${extValuePercentEncode(filename)}`;
}

const downloadAttachment = async (req, res, next) => {
  try {
    if (
      req.resource.status === "pending" &&
      !req.resource.createdBy.equals(req.user.id) &&
      !roleAtLeast(req.effectiveRole, "writer")
    ) {
      return res.status(404).json({ error: { message: "Attachment not found" } });
    }
    const scanBlock = scanGateMessage(req.resource);
    if (scanBlock) return res.status(409).json({ error: { message: scanBlock } });
    const attachment = req.resource;
    const filePath = filePathFor(attachment.storageKey);

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return res.status(404).json({ error: { message: "File data missing" } });
    }

    res.setHeader("Content-Length", stat.size);
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (attachment.mimeType && attachment.mimeType.startsWith("image/")) {
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader("Content-Disposition", contentDispositionHeader("inline", attachment.filename));
    } else {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", contentDispositionHeader("attachment", attachment.filename));
    }

    const stream = fs.createReadStream(filePath);
    // Headers may already be flushed by the time a read error happens mid-stream,
    // so no JSON error body is possible here — log and tear down the connection
    // instead of letting the unhandled error crash the process.
    stream.on("error", (err) => {
      console.error("Attachment download stream error:", err);
      res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

const renameAttachment = async (req, res, next) => {
  try {
    const attachment = req.resource; // authorize("writer", Attachment) already vetted the edit itself
    assertVersion(req);

    attachment.filename = req.body.filename;
    attachment.updatedBy = req.user.id;
    await attachment.save();
    res.json({ data: attachment, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

const deleteAttachment = async (req, res, next) => {
  try {
    await req.resource.softDelete(req.user.id);
    await softCascadeLeafSuggestions(req.resource._id, req.resource.deletedAt);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAttachments,
  getOneAttachment,
  downloadAttachment,
  renameAttachment,
  deleteAttachment,
};
