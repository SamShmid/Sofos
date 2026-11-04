const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { initUploadStore } = require("./utils/uploadStore");
const { activityLogger, initLogsDir, startRetention } = require("./utils/activityLog");
const { scanEnabled } = require("./utils/clamav");
const { startSweeper, scannerIsUp } = require("./utils/scanSweeper");
const { currentVersion } = require("./utils/releaseNotes");

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is not set. Refusing to start.");
  process.exit(1);
}
if (process.env.JWT_SECRET === "replace-with-a-long-random-string" || process.env.JWT_SECRET.length < 16) {
  console.error("JWT_SECRET is a placeholder or too short (<16 chars). Refusing to start.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Unset by default (direct/Tailscale serving needs nothing). Set to trust a
// reverse proxy's X-Forwarded-For so req.ip (and the login limiter's per-IP
// bucket) reflects the real client, not the proxy.
if (process.env.TRUST_PROXY) {
  const n = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(n) ? process.env.TRUST_PROXY : n);
}

// Basic hardening only, hand-rolled (this app serves Samuel's local network).
// Mounted before every route AND the static/SPA serving below so all responses
// carry the headers. Deliberately NO CSP (risks breaking the Vite SPA for zero
// local-network benefit) and NO HSTS (wrong for an http tailnet deployment).
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  next();
});

// Activity log (P68): one JSON line per request into LOGS_DIR, fail-open —
// mounted before everything else that answers requests so 404s and static
// serving are captured too. Retention: utils/activityLog.js (30/60/90 scheme).
app.use(activityLogger);

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  const body = { ok: dbUp, db: dbUp, version: currentVersion() };
  // Surfaced only when scanning is on: false = the sweeper's probes say clamd
  // is down (uploads are accepted but sit unscanned until it returns).
  if (scanEnabled()) body.scanner = scannerIsUp();
  res.status(dbUp ? 200 : 503).json(body);
});

// Resource routers
app.use("/api/auth", require("./routes/auth"));
app.use("/api/workspaces", require("./routes/workspaces"));
app.use("/api/memberships", require("./routes/memberships"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/notes", require("./routes/notes"));
app.use("/api/comments", require("./routes/comments"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/goals", require("./routes/goals"));
app.use("/api/links", require("./routes/links"));
app.use("/api/uploads", require("./routes/uploads"));
app.use("/api/attachments", require("./routes/attachments"));
app.use("/api/suggestions", require("./routes/suggestions"));
app.use("/api/tags", require("./routes/tags"));
app.use("/api/trash", require("./routes/trash"));
app.use("/api/revisions", require("./routes/revisions"));
app.use("/api/guide", require("./routes/guide"));
// Public — no protect, mirrors the guide route's shape but serves JSON.
app.use("/api/openapi.json", require("./routes/openapi"));
app.use("/api/me", require("./routes/me"));
app.use("/api/search", require("./routes/search"));

// Public discovery endpoint: exact "/api" only (Express matches this before
// falling through to the catch-all below, and it never matches "/api/foo").
// Unauthenticated on purpose — it exists so a caller with nothing but a base
// URL can learn how to register/log in/find the guide without already
// knowing an endpoint's shape (fixes the register-to-read-docs chicken-and-egg:
// GET /api/guide needs a token, but this doesn't).
app.get("/api", (req, res) => {
  res.json({
    data: {
      name: "Sofos",
      version: currentVersion(),
      description: "Workspaces, projects and roadmaps for people and their agents.",
      register: {
        url: "POST /api/auth/register",
        body: {
          username: "...",
          password: "...",
          isAgent: "set true for AI/automation accounts — unlocks a one-time setup payload with credentials echo and first steps",
        },
      },
      login: "POST /api/auth/login",
      me: "GET /api/me (auth)",
      guide: "GET /api/guide (auth; full API reference)",
      openapi: "GET /api/openapi.json (public; machine-readable spec)",
      search: "GET /api/search?q= (auth)",
      health: "GET /api/health",
    },
  });
});

// JSON 404 for any /api path that didn't match a router above (including the
// exact-path GET /api discovery route just above) — must sit after all
// /api/* mounts and before the SPA fallback below, which owns everything else.
app.use("/api", (req, res) => {
  res.status(404).json({ error: { message: "Not found" } });
});

// In the container the built frontend is copied to ./public; dev trees don't
// have it, so dev behavior is untouched.
const clientDir = path.join(__dirname, "public");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  // SPA fallback: React Router owns non-API paths (Express 5 has no "*" route).
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

// Central error handler (must be last, after the routes)
app.use((err, req, res, next) => {
  // A stale load-then-save on an optimisticConcurrency schema: the doc moved on
  // under the editor, so ask them to reload rather than clobber the newer version.
  if (err instanceof mongoose.Error.VersionError) {
    return res.status(409).json({
      error: { message: "This item was changed by someone else since you loaded it. Reload and try again." },
    });
  }
  // express.json() surfaces a malformed request body as a SyntaxError re-thrown
  // via http-errors with .status 400, .type "entity.parse.failed", and a .body
  // buffer — give it the standard shape instead of leaking the raw parser text.
  if (err.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400 && "body" in err)) {
    return res.status(400).json({ error: { message: "Invalid JSON in request body" } });
  }
  // A unique-index collision that didn't get local handling (membershipController's
  // does, and stays) — 409 instead of the raw 500 a driver E11000 would otherwise be.
  if (err.code === 11000) {
    return res.status(409).json({ error: { message: "Already exists" } });
  }
  const status = err.status || 500;
  console.error(err);
  res.status(status).json({
    error: {
      message: status < 500 ? err.message : "Internal server error",
      details: status < 500 ? err.details : undefined,
    },
  });
});

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log("Connected to MongoDB!");
  await initUploadStore();
  await initLogsDir();
  startRetention();
  if (scanEnabled()) startSweeper();
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to connect to MongoDB", err);
  process.exit(1);
});
