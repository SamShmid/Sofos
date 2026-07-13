const rateLimit = require("express-rate-limit");

// Throttle auth attempts per IP to slow down brute-force guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // attempts per IP per window (still throttles brute-force, roomy for testing)
  message: { error: { message: "Too many attempts, try later" } },
});

module.exports = loginLimiter;
