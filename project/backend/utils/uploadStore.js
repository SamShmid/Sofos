const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// Upload sessions are IN-MEMORY (a Map) + a temp file on disk. A server restart
// forgets sessions; boot wipes the tmp dir. Acceptable for a single-instance
// personal app (see PHASE_SPEC.md).
const sessions = new Map();

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads");
const TMP_DIR = path.join(UPLOADS_DIR, "tmp");
const FILES_DIR = path.join(UPLOADS_DIR, "files");

const STALE_MS = 24 * 60 * 60 * 1000;

// Unset/0 = unlimited (Samuel's call, PHASE_SPEC.md C9). Read live (not cached
// at require-time) so a throwaway test server started with the env set behaves
// consistently with no surprise module-load ordering.
function maxUploadBytes() {
  const raw = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function tmpPath(uploadId) {
  return path.join(TMP_DIR, uploadId);
}

function filePathFor(storageKey) {
  return path.join(FILES_DIR, storageKey);
}

// mkdir -p tmp/ + files/, then EMPTY the tmp dir: sessions are in-memory only,
// so any tmp files surviving a restart are orphaned and unreachable.
async function initUploadStore() {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(FILES_DIR, { recursive: true });
  const entries = await fsp.readdir(TMP_DIR);
  await Promise.all(
    entries.map((name) => fsp.unlink(path.join(TMP_DIR, name)).catch(() => {}))
  );
}

// Drop sessions older than 24h (+ their tmp files). Called lazily from
// createSession so a busy server reclaims space without a background timer.
async function sweepStale() {
  const cutoff = Date.now() - STALE_MS;
  const staleIds = [];
  for (const [uploadId, session] of sessions) {
    if (session.createdAt < cutoff) staleIds.push(uploadId);
  }
  for (const uploadId of staleIds) {
    sessions.delete(uploadId);
    await fsp.unlink(tmpPath(uploadId)).catch(() => {});
  }
}

async function createSession({ userId, workspaceId, projectId, superWorkspaceId, filename }) {
  await sweepStale();
  const uploadId = crypto.randomBytes(16).toString("hex");
  await fsp.writeFile(tmpPath(uploadId), Buffer.alloc(0));
  sessions.set(uploadId, {
    uploadId,
    userId,
    workspaceId,
    projectId,
    superWorkspaceId,
    filename,
    bytesReceived: 0,
    chunksReceived: 0,
    createdAt: Date.now(),
  });
  return { uploadId };
}

// Wrong owner reads as 404 too, same not-yours-reads-as-404 rule as resources.
function getSession(uploadId, userId) {
  const session = sessions.get(uploadId);
  if (!session || String(session.userId) !== String(userId)) {
    const e = new Error("Upload not found");
    e.status = 404;
    throw e;
  }
  return session;
}

async function appendChunk(uploadId, userId, index, buffer) {
  const session = getSession(uploadId, userId);

  if (index < session.chunksReceived) {
    // Idempotent retry of an already-applied chunk: no-op.
    return { received: session.chunksReceived, bytes: session.bytesReceived };
  }
  if (index !== session.chunksReceived) {
    const e = new Error(`Chunks must arrive in order; expected ${session.chunksReceived}`);
    e.status = 409;
    throw e;
  }

  await fsp.appendFile(tmpPath(uploadId), buffer);
  session.chunksReceived += 1;
  session.bytesReceived += buffer.length;
  return { received: session.chunksReceived, bytes: session.bytesReceived };
}

// Caller scans BEFORE calling this.
async function finalizeToStorage(uploadId, userId) {
  const session = getSession(uploadId, userId);
  const storageKey = uploadId;
  await fsp.rename(tmpPath(uploadId), filePathFor(storageKey));
  sessions.delete(uploadId);
  return { storageKey, size: session.bytesReceived };
}

async function destroySession(uploadId, userId) {
  getSession(uploadId, userId); // throws 404 if missing/not yours
  await fsp.unlink(tmpPath(uploadId)).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
  sessions.delete(uploadId);
}

// Best-effort; used by trash purge + hard cascades.
async function deleteStoredFile(storageKey) {
  await fsp.unlink(filePathFor(storageKey)).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
}

module.exports = {
  initUploadStore,
  createSession,
  getSession,
  appendChunk,
  finalizeToStorage,
  tmpPath,
  filePathFor,
  destroySession,
  deleteStoredFile,
  sweepStale,
  maxUploadBytes,
};
