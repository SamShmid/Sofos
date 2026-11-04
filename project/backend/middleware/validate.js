const { validationResult } = require("express-validator");

const MAX_DETAIL_VALUE_LENGTH = 200;

// express-validator echoes the full offending value into each error — fine for
// a bad title, but a rejected 50KB suggestion payload would produce an equally
// large error response. Cap what actually leaves the process.
function truncateValue(value) {
  if (typeof value === "string") {
    return value.length > MAX_DETAIL_VALUE_LENGTH ? `${value.slice(0, MAX_DETAIL_VALUE_LENGTH)}…` : value;
  }
  if (value !== null && typeof value === "object") {
    const json = JSON.stringify(value);
    if (json !== undefined && json.length > MAX_DETAIL_VALUE_LENGTH) {
      return Array.isArray(value) ? "[array omitted]" : "[object omitted]";
    }
  }
  return value;
}

// Runs after a list of express-validator rules. If any failed, build a 400
// error with the details and hand it to the central error handler.
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error("Validation failed");
    error.status = 400;
    error.details = errors.array().map((e) => ("value" in e ? { ...e, value: truncateValue(e.value) } : e));
    return next(error);
  }
  next();
};
