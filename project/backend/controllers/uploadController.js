const Attachment = require("../models/Attachment");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const { assertRole } = require("../middleware/auth");
const Suggestion = require("../models/Suggestion");
const { roleAtLeast } = require("../utils/permissions");
const {
  createSession,
  getSession,
  appendChunk,
  finalizeToStorage,
  destroySession,
  tmpPath,
  maxUploadBytes,
} = require("../utils/uploadStore");
const { scanEnabled, scanFile } = require("../utils/clamav");
const requireExactlyOneContainer = require("../utils/requireExactlyOneContainer");

const CHUNK_SIZE = 2 * 1024 * 1024; // advertised to clients; server rejects any single chunk body over 6mb

const createUpload = async (req, res, next) => {
  try {
    const isProjectMode = requireExactlyOneContainer(req.body);

    let container, workspaceId, projectId, superWorkspaceId;
    if (isProjectMode) {
      const project = await Project.findById(req.body.project);
      if (!project) {
        const e = new Error("Project not found");
        e.status = 404;
        throw e;
      }
      container = project;
      workspaceId = project.workspace;
      projectId = project._id;
      superWorkspaceId = project.superWorkspace;
    } else {
      const ws = await Workspace.findById(req.body.workspace);
      if (!ws) {
        const e = new Error("Workspace not found");
        e.status = 404;
        throw e;
      }
      container = ws;
      workspaceId = ws._id;
      superWorkspaceId = ws.superWorkspace;
    }

    await assertRole(req.user.id, container, "suggester");

    const { uploadId } = await createSession({
      userId: req.user.id,
      workspaceId,
      projectId,
      superWorkspaceId,
      filename: req.body.filename,
    });

    res.status(201).json({ data: { uploadId, chunkSize: CHUNK_SIZE } });
  } catch (err) {
    next(err);
  }
};

const uploadChunk = async (req, res, next) => {
  try {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      const e = new Error("Empty chunk");
      e.status = 400;
      throw e;
    }

    const index = Number(req.params.index);

    // Cap check sits BEFORE appendChunk so a chunk that would exceed it never
    // gets written/counted — session is left exactly as it was. Only applies to
    // the next genuinely-new chunk; an out-of-order or already-applied index is
    // appendChunk's call (409/no-op) to make, not this one's.
    const cap = maxUploadBytes();
    if (cap) {
      const session = getSession(req.params.uploadId, req.user.id);
      if (index === session.chunksReceived && session.bytesReceived + buffer.length > cap) {
        const e = new Error(`Upload exceeds maximum allowed size (${cap} bytes)`);
        e.status = 413;
        throw e;
      }
    }

    const { received, bytes } = await appendChunk(req.params.uploadId, req.user.id, index, buffer);
    res.json({ data: { received, bytes } });
  } catch (err) {
    next(err);
  }
};

const finalizeUpload = async (req, res, next) => {
  try {
    const session = getSession(req.params.uploadId, req.user.id);

    if (session.bytesReceived === 0) {
      const e = new Error("No chunks uploaded");
      e.status = 400;
      throw e;
    }
    if (req.body.size !== undefined && Number(req.body.size) !== session.bytesReceived) {
      const e = new Error(`Size mismatch: expected ${session.bytesReceived}, received ${req.body.size}`);
      e.status = 400;
      throw e;
    }

    // Backstop: the per-chunk cap in uploadChunk should already have blocked
    // this, but a total-size cap that changed mid-session or any other gap
    // still gets caught here before the file is committed to permanent storage.
    const cap = maxUploadBytes();
    if (cap && session.bytesReceived > cap) {
      await destroySession(session.uploadId, req.user.id);
      const e = new Error(`Upload exceeds maximum allowed size (${cap} bytes)`);
      e.status = 413;
      throw e;
    }

    const tmp = tmpPath(session.uploadId);
    // ESM-only package; dynamic import from this CommonJS controller.
    const { fileTypeFromFile } = await import("file-type");
    const detected = await fileTypeFromFile(tmp);
    const mimeType = detected?.mime || "application/octet-stream";

    let scanStatus = "skipped";
    if (scanEnabled()) {
      try {
        const scanResult = await scanFile(tmp);
        if (!scanResult.clean) {
          await destroySession(session.uploadId, req.user.id);
          const e = new Error(`File rejected: malware detected (${scanResult.signature})`);
          e.status = 422;
          throw e;
        }
        scanStatus = "clean";
      } catch (err) {
        if (err.status !== 503) throw err;
        // Scanner unreachable: accept anyway (don't destroy the session/tmp —
        // finalize proceeds exactly like the success path below) and let the
        // background sweeper (scanSweeper.js) pick it up when the scanner is
        // back. Outages never count against the attempt budget.
        console.error(
          `ClamAV scanner unavailable at upload finalize — "${session.filename}" accepted as pending_scan; files stay unscanned (and undownloadable) until the scanner returns`
        );
        scanStatus = "pending_scan";
      }
    }

    // The container may have died mid-upload; re-check existence + role right
    // before committing the file to permanent storage.
    const container = session.projectId
      ? await Project.findById(session.projectId)
      : await Workspace.findById(session.workspaceId);
    if (!container) {
      await destroySession(session.uploadId, req.user.id);
      const e = new Error(`${session.projectId ? "Project" : "Workspace"} not found`);
      e.status = 404;
      throw e;
    }
    const role = await assertRole(req.user.id, container, "suggester");

    const { storageKey, size } = await finalizeToStorage(session.uploadId, req.user.id);

    // Attempts count only confirmed-up scan failures (sweeper policy) — a
    // finalize during an outage starts the file at 0, schema default covers the rest.
    const scanFields = { scanStatus };

    if (roleAtLeast(role, "writer")) {
      const attachment = await Attachment.create({
        filename: session.filename,
        size,
        mimeType,
        storageKey,
        workspace: session.workspaceId,
        project: session.projectId,
        superWorkspace: session.superWorkspaceId,
        createdBy: req.user.id,
        updatedBy: req.user.id,
        ...scanFields,
      });

      res.status(201).json({ data: attachment });
    } else {
      // Suggester-only: silo the file — attachment stays pending until a
      // writer approves the suggestion; nobody else can see or download it
      // until then (enforced in attachmentController). The approval gate and
      // the scan gate are orthogonal: this attachment can be pending+pending_scan.
      const attachment = await Attachment.create({
        filename: session.filename,
        size,
        mimeType,
        storageKey,
        workspace: session.workspaceId,
        project: session.projectId,
        superWorkspace: session.superWorkspaceId,
        createdBy: req.user.id,
        updatedBy: req.user.id,
        status: "pending",
        ...scanFields,
      });

      const suggestion = await Suggestion.create({
        resourceType: "Attachment",
        op: "create",
        resource: attachment._id,
        workspace: session.workspaceId,
        project: session.projectId,
        superWorkspace: session.superWorkspaceId,
        payload: { filename: session.filename },
        proposedBy: req.user.id,
        status: "pending",
      });

      res.status(201).json({ data: { suggestion, attachment } });
    }
  } catch (err) {
    next(err);
  }
};

const deleteUpload = async (req, res, next) => {
  try {
    await destroySession(req.params.uploadId, req.user.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createUpload,
  uploadChunk,
  finalizeUpload,
  deleteUpload,
};
