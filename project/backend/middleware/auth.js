const jwt = require("jsonwebtoken");
const Session = require("../models/Session");
const { effectiveRole, roleAtLeast } = require("../utils/permissions");

function readToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Additive on every 401 protect emits — points a zero-knowledge caller at the
// public discovery endpoint instead of leaving it to guess. Single-sourced so
// the wording never drifts between the branches below.
const DISCOVERY_HINT = "No/invalid credentials. Discover the API at GET /api";

// Required on every route — reject when no/invalid token, or a token whose session
// was revoked (logout, account deletion). code: "AUTH" is exclusive to this rejection
// path so the frontend can force a re-login without doing the same for a bad password.
async function protect(req, res, next) {
  const token = readToken(req);
  if (!token)
    return res.status(401).json({ error: { message: "Not authenticated", code: "AUTH", hint: DISCOVERY_HINT } });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: { message: "Invalid token", code: "AUTH", hint: DISCOVERY_HINT } });
  }
  // Old tokens minted before sessions existed carry no jti — same as a revoked one.
  if (!payload.jti)
    return res.status(401).json({ error: { message: "Session expired", code: "AUTH", hint: DISCOVERY_HINT } });
  try {
    const alive = await Session.exists({ jti: payload.jti });
    if (!alive)
      return res.status(401).json({ error: { message: "Session expired", code: "AUTH", hint: DISCOVERY_HINT } });
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

// Resource-scoped authorization for routes with an :id. Loads the target, resolves
// the caller's effective role, and only lets through roles at or above requiredRole.
// No access at all reads as 404 so outsiders can't probe which ids exist; the doc
// is stashed on req.resource so controllers never fetch it twice.
function authorize(requiredRole, Model) {
  return async (req, res, next) => {
    try {
      const doc = await Model.findById(req.params.id);
      if (!doc)
        return res.status(404).json({ error: { message: `${Model.modelName} not found` } });
      const role = await effectiveRole(req.user.id, doc);
      if (!role)
        return res.status(404).json({ error: { message: `${Model.modelName} not found` } });
      if (!roleAtLeast(role, requiredRole))
        return res.status(403).json({ error: { message: "You do not have permission to do that" } });
      req.resource = doc;
      req.effectiveRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Same policy for docs a controller loads itself (create targets resolved from the
// request body, restore parents): throws the 404/403 the central handler expects.
async function assertRole(userId, doc, requiredRole) {
  const role = await effectiveRole(userId, doc);
  if (!role) {
    const e = new Error(`${doc.constructor.modelName} not found`);
    e.status = 404;
    throw e;
  }
  if (!roleAtLeast(role, requiredRole)) {
    const e = new Error("You do not have permission to do that");
    e.status = 403;
    throw e;
  }
  return role;
}

module.exports = { protect, authorize, assertRole };
