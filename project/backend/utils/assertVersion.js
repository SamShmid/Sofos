// Stale-save guard: a client update request may carry ifVersion = the __v it
// loaded. Call at the top of every resource update/rename handler, AFTER
// req.resource is set by the authorize middleware (so req.resource.__v is the
// current persisted version). Throws the same 409 shape as server.js's
// VersionError branch. Also strips ifVersion off req.body so it's never
// written onto the doc by later field-assignment code.
function assertVersion(req) {
  if (req.body.ifVersion !== undefined) {
    const version = Number(req.body.ifVersion);
    if (Number.isNaN(version)) {
      const e = new Error("ifVersion must be a number");
      e.status = 400;
      throw e;
    }
    if (version !== req.resource.__v) {
      const e = new Error("This item was changed by someone else since you loaded it. Reload and try again.");
      e.status = 409;
      throw e;
    }
  }
  delete req.body.ifVersion;
}

module.exports = { assertVersion };
