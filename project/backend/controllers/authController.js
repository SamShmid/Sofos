const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Sign a token carrying id + role, so requireWriter can read the role later.
function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// For registering new accounts by default only allow registering of readers, writers must be seeded into the database
const register = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: { message: "Username already taken" } });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash, role: "reader" });

    res.status(201).json({
      data: { id: user._id, username: user.username, role: user.role },
      token: signToken(user),
    });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // passwordHash is select:false in the schema, so ask for it explicitly.
    const user = await User.findOne({ username }).select("+passwordHash");
    if (!user) return res.status(401).json({ error: { message: "Invalid credentials" } });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: { message: "Invalid credentials" } });

    res.json({
      data: { id: user._id, username: user.username, role: user.role },
      token: signToken(user),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login };
