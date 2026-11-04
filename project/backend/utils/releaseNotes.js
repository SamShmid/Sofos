const fs = require("fs");
const path = require("path");

// Same two-candidate resolution as guideController: the dev repo checkout
// (docs/ lives three levels up from this file) and the in-image path the
// Dockerfile COPYs it to (one level up from /app/utils) — first one found
// on disk wins. Read fresh per call, no caching, so dev edits are live.
const NOTES_CANDIDATES = [
  path.join(__dirname, "../../../docs/RELEASE_NOTES.json"),
  path.join(__dirname, "../docs/RELEASE_NOTES.json"),
];

// Parse failure (missing file, bad JSON, wrong shape) returns [] rather than
// throwing — a broken notes file must never 500 a caller.
function loadEntries() {
  for (const candidate of NOTES_CANDIDATES) {
    try {
      const text = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // try the next candidate
    }
  }
  return [];
}

// vX.Y.Z -> [X, Y, Z] numeric parts; anything that doesn't match is unparseable.
function parseVersion(v) {
  const m = typeof v === "string" && v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Numeric compare of vX.Y.Z parts. Unparseable versions sort oldest, on
// either side of the comparison, so a corrupt entry never reads as newest.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// Resolution order: explicit env (set at image build) -> newest entry in the
// notes file -> a dev-only fallback so an unconfigured checkout still boots.
function currentVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const entries = loadEntries();
  if (entries.length === 0) return "0.0.0-dev";
  // The file is documented newest-first, but don't trust that blindly.
  return entries.reduce(
    (newest, e) => (compareVersions(e.version, newest) > 0 ? e.version : newest),
    entries[0].version
  );
}

// Entries strictly newer than lastSeen, in the file's newest-first order.
// null/absent lastSeen means every entry counts as new.
function entriesSince(lastSeen) {
  const entries = loadEntries();
  if (!lastSeen) return entries;
  return entries.filter((e) => compareVersions(e.version, lastSeen) > 0);
}

module.exports = { loadEntries, currentVersion, compareVersions, entriesSince };
