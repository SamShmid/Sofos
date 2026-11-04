const fs = require("fs");
const path = require("path");

// Read at request time, no caching — the file is small and this keeps dev edits
// live. Two candidate locations: the dev repo checkout (docs/ lives three levels
// up from this file) and the in-image path the Dockerfile COPYs it to (one level
// up from /app/controllers) — first one found on disk wins.
const GUIDE_CANDIDATES = [
  path.join(__dirname, "../../../docs/API_GUIDE.md"),
  path.join(__dirname, "../docs/API_GUIDE.md"),
];

const getGuide = async (req, res, next) => {
  try {
    for (const candidate of GUIDE_CANDIDATES) {
      try {
        const text = await fs.promises.readFile(candidate, "utf8");
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        return res.send(text);
      } catch {
        // try the next candidate
      }
    }
    return res.status(500).json({ error: { message: "API guide not found on this deployment" } });
  } catch (err) {
    next(err);
  }
};

module.exports = { getGuide };
