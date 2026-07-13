const jwt = require("jsonwebtoken");

function readToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Required on every route — reject when no/invalid token
function protect(req, res, next) {
  const token = readToken(req);
  if (!token)
    return res.status(401).json({ error: { message: "Not authenticated" } });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: { message: "Invalid token" } });
  }
}

// Required on writes — reject readers
function requireWriter(req, res, next) {
  if (!req.user || req.user.role !== "writer")
    return res.status(403).json({ error: { message: "Writers only" } });
  next();
}

module.exports = { protect, requireWriter };
