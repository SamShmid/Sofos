const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const SuperWorkspace = require("../models/SuperWorkspace");
const Session = require("../models/Session");
const { ensureTenantDefaults } = require("../utils/defaults");
const { exportAccountBackup, purgeAccount } = require("../utils/accountDeletion");
const { currentVersion } = require("../utils/releaseNotes");

// Single source for the onboarding text an agent needs on creation; the guide's
// "Agent first steps" section mirrors this verbatim (see docs/API_GUIDE.md).
const FIRST_STEPS =
  "First steps: log in with these credentials (POST /api/auth/login) and call GET /api/workspaces. " +
  "If both the owned and shared lists are empty, you have not been shared on anything yet — tell your " +
  "operator, and give them your shareCode so they can add you to a workspace. If you have " +
  "shares, start by exploring them. If your role on a share is 'suggester', your creates/edits/deletes " +
  "become suggestions that a writer reviews — that is the normal, expected mode for agents.";

// Role is gone from the token: authorization is resolved per-resource now, so the
// token only proves WHO you are, never what you may touch.
function signToken(user, jti) {
  return jwt.sign(
    { id: user._id, username: user.username, isAgent: user.isAgent, jti },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// Mints a token AND its backing session row in one step, expiry single-sourced from
// the token itself so the two can never drift apart.
async function issueSession(user) {
  const jti = crypto.randomUUID();
  const token = signToken(user, jti);
  const { exp } = jwt.decode(token);
  await Session.create({ user, jti, expiresAt: new Date(exp * 1000) });
  return token;
}

// The account shape both endpoints return; shareCode rides along so the frontend
// (Settings page, post-signup reveal) never needs a separate who-am-I call.
function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    isAgent: user.isAgent,
    shareCode: user.shareCode,
  };
}

// Open signup for both kinds of account. Humans get their account and Home
// workspace on the spot. Agents get neither and exist purely through grants.
const register = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const isAgent = req.body.isAgent === true; // strict: anything but literal true means a normal user

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: { message: "Username already taken" } });

    const passwordHash = await bcrypt.hash(password, 10);
    // New accounts never see a stale What's-new — they start acked on the version
    // they registered against (human and agent paths both go through here).
    const user = await User.create({ username, passwordHash, isAgent, lastSeenVersion: currentVersion() });

    if (!isAgent) {
      // Upsert keyed on owner: a double-submit can't trip the unique owner index,
      // and ensureTenantDefaults is idempotent for the same reason.
      const tenant = await SuperWorkspace.findOneAndUpdate(
        { owner: user._id },
        { $setOnInsert: { name: username, owner: user._id } },
        { upsert: true, new: true }
      );
      await ensureTenantDefaults(tenant._id, user._id);
    }

    // Immediate orientation pointers for whoever/whatever just registered —
    // present for both account kinds (agents get this alongside agentSetup below).
    const responseBody = {
      data: publicUser(user),
      token: await issueSession(user),
      next: { me: "GET /api/me", guide: "GET /api/guide" },
    };
    if (isAgent) {
      // Complete handoff document — Samuel's decision: echo the password back ONCE
      // here since this is the only moment the plaintext exists server-side.
      const baseUrl = `${req.protocol}://${req.get("host")}/api`;
      responseBody.agentSetup = {
        baseUrl,
        username: user.username,
        password,
        shareCode: user.shareCode,
        guideUrl: `${baseUrl}/guide`,
        firstSteps: FIRST_STEPS,
      };
    }
    res.status(201).json(responseBody);
  } catch (err) {
    next(err);
  }
};

// One login for users and agents alike; nothing here branches on isAgent.
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // passwordHash is select:false in the schema, so ask for it explicitly.
    const user = await User.findOne({ username }).select("+passwordHash");
    if (!user) return res.status(401).json({ error: { message: "Invalid credentials" } });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: { message: "Invalid credentials" } });

    res.json({ data: publicUser(user), token: await issueSession(user) });
  } catch (err) {
    next(err);
  }
};

// Export-then-purge self-delete: password re-verified exactly like login (same
// message, no oracle for whether an account exists). Owners get a full tenant
// backup written before anything is purged; agents own nothing to back up.
const deleteAccount = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("+passwordHash");
    if (!user) return res.status(401).json({ error: { message: "Invalid credentials" } });

    const ok = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: { message: "Invalid credentials" } });

    if (user.isAgent) {
      await purgeAccount(user, null);
    } else {
      const tenant = await SuperWorkspace.findOne({ owner: user._id });
      if (tenant) {
        await exportAccountBackup(user, tenant); // backup FIRST, purge second
        await purgeAccount(user, tenant);
      } else {
        await purgeAccount(user, null); // tenant-less non-agent shouldn't exist, but don't crash on it
      }
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// Per-device revocation: deletes only the session behind this request's token,
// leaving any other devices the user is logged in on untouched.
const logout = async (req, res, next) => {
  try {
    await Session.deleteOne({ jti: req.user.jti });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, deleteAccount, logout };
