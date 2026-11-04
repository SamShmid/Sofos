const Membership = require("../models/Membership");
const Workspace = require("../models/Workspace");
const User = require("../models/User");
const { ownedTenantOrThrow } = require("../utils/ownedTenant");

// Sharing is an owner-only act, and you can only share your OWN tenant.
const ownedTenant = (userId) => ownedTenantOrThrow(userId, "Only account owners can manage sharing");

// Translate the API's explicit scope/target into the model's workspace
// fields, and prove the target actually lives in the caller's tenant — otherwise an
// owner could name another tenant's workspace id. A miss reads as 404, never leaking
// whether the id exists elsewhere. "none" sets neither field (tenant-wide grant).
async function scopeFields(scope, target, superWorkspaceId) {
  if (scope === "none") return {};

  const container = await Workspace.findById(target);
  if (!container || !container.superWorkspace.equals(superWorkspaceId)) {
    const e = new Error("Workspace not found");
    e.status = 404;
    throw e;
  }
  return { workspace: container._id };
}

// Owner lists every grant on their tenant, with each grantee's public identity.
const getMemberships = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);
    // Scope labels populate withDeleted: a grant on a trashed container must still
    // name it, or the row would misread as a tenant-wide grant.
    const memberships = await Membership.find({ superWorkspace: own._id })
      .populate("user", "username shareCode isAgent")
      .populate({ path: "workspace", select: "name", options: { withDeleted: true } })
      .sort({ createdAt: 1 });
    res.json({ data: memberships, count: memberships.length });
  } catch (err) {
    next(err);
  }
};

const createMembership = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);

    // Named by public code, never by a raw id the sharer wouldn't know.
    const target = await User.findOne({ shareCode: req.body.shareCode });
    if (!target) return res.status(404).json({ error: { message: "No account with that share code" } });

    // Granting to yourself is meaningless — you already own everything here.
    if (target._id.equals(req.user.id))
      return res.status(400).json({ error: { message: "You already have full access to your own account" } });

    const fields = await scopeFields(req.body.scope, req.body.target, own._id);

    // The unique (user, superWorkspace, workspace) index still holds an
    // expired grant's row, which would otherwise 409 every regrant attempt until
    // the owner manually revokes it. A still-live grant at this exact scope keeps
    // blocking (below, via the index) — only a provably expired one is cleared.
    const stale = await Membership.findOne({
      user: target._id,
      superWorkspace: own._id,
      workspace: fields.workspace || null,
    });
    if (stale && stale.expiresAt && stale.expiresAt < new Date()) {
      await stale.deleteOne();
    }

    const membership = await Membership.create({
      user: target._id,
      superWorkspace: own._id,
      role: req.body.role,
      status: "pending", // conveys zero access until the recipient accepts
      expiresAt: req.body.expiresAt,
      ...fields,
    });
    await membership.populate([
      { path: "user", select: "username shareCode isAgent" },
      { path: "workspace", select: "name" },
    ]);
    res.status(201).json({ data: membership });
  } catch (err) {
    // The (user, superWorkspace, workspace) unique index: an identical grant already exists.
    if (err.code === 11000)
      return res.status(409).json({ error: { message: "That account already has a grant at this scope" } });
    next(err);
  }
};

const updateMembership = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);
    // Scoped to the caller's tenant, so an owner can only touch grants on their own stuff.
    const membership = await Membership.findOne({ _id: req.params.id, superWorkspace: own._id });
    if (!membership) return res.status(404).json({ error: { message: "Membership not found" } });

    membership.role = req.body.role; // role is the only mutable field (enforced by the validator)
    await membership.save();
    await membership.populate("user", "username shareCode isAgent");
    res.json({ data: membership });
  } catch (err) {
    next(err);
  }
};

const deleteMembership = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);
    const membership = await Membership.findOneAndDelete({ _id: req.params.id, superWorkspace: own._id });
    if (!membership) return res.status(404).json({ error: { message: "Membership not found" } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// Recipient reads their own pending invites, populated so the UI can render
// "«owner» invites you to «scope label» as «role»". Mirrors getMemberships' populate
// shape (including withDeleted on scope labels — an invited container can be trashed
// before the recipient acts on it).
const listMyInvites = async (req, res, next) => {
  try {
    const invites = await Membership.find({ user: req.user.id, status: "pending" })
      .populate({
        path: "superWorkspace",
        select: "name owner",
        populate: { path: "owner", select: "username" },
      })
      .populate({ path: "workspace", select: "name", options: { withDeleted: true } })
      .sort({ createdAt: 1 });
    res.json({ data: invites, count: invites.length });
  } catch (err) {
    next(err);
  }
};

// Recipient-only actions — deliberately NOT ownedTenantOrThrow. "Not yours or doesn't
// exist" reads as 404 either way, so a recipient can't tell the two apart.
const acceptInvite = async (req, res, next) => {
  try {
    const invite = await Membership.findById(req.params.id);
    if (!invite || !invite.user.equals(req.user.id) || invite.status !== "pending")
      return res.status(404).json({ error: { message: "Invite not found" } });
    invite.status = "active";
    await invite.save();
    res.json({ data: invite });
  } catch (err) {
    next(err);
  }
};

const declineInvite = async (req, res, next) => {
  try {
    const invite = await Membership.findById(req.params.id);
    if (!invite || !invite.user.equals(req.user.id) || invite.status !== "pending")
      return res.status(404).json({ error: { message: "Invite not found" } });
    await invite.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
  listMyInvites,
  acceptInvite,
  declineInvite,
};
