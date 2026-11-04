const fs = require("fs");
const path = require("path");

// Same two-candidate resolution as guideController: the dev repo checkout
// (docs/ lives three levels up from this file) and the in-image path the
// Dockerfile COPYs it to (one level up from /app/controllers) — first one
// found on disk wins. Read fresh per request, no caching, so a dev edit to
// the spec shows up on the very next fetch.
const SPEC_CANDIDATES = [
  path.join(__dirname, "../../../docs/openapi.json"),
  path.join(__dirname, "../docs/openapi.json"),
];

const getOpenApiSpec = async (req, res, next) => {
  try {
    for (const candidate of SPEC_CANDIDATES) {
      try {
        const text = await fs.promises.readFile(candidate, "utf8");
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      } catch {
        // try the next candidate
      }
    }
    return res.status(500).json({ error: { message: "OpenAPI spec not found on this deployment" } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getOpenApiSpec };
