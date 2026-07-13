const { validationResult } = require("express-validator");

// Runs after a list of express-validator rules. If any failed, build a 400
// error with the details and hand it to the central error handler.
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error("Validation failed");
    error.status = 400;
    error.details = errors.array();
    return next(error);
  }
  next();
};
