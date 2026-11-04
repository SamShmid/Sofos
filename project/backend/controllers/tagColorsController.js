const SuperWorkspace = require("../models/SuperWorkspace");
const Membership = require("../models/Membership");
const { liveGrantFilter } = require("../utils/permissions");
const { ownedTenantOrThrow } = require("../utils/ownedTenant");

const MAX_TAG_COLORS = 300;

// Tenant-wide, cosmetic-global (matches the owner-manages-tenant precedent).
const ownedTenant = (userId) => ownedTenantOrThrow(userId, "Only the tenant owner can set tag colors");

function mapFromEntries(entries) {
  const map = {};
  for (const entry of entries) map[entry.tag] = entry.color;
  return map;
}

// Every tenant the caller can reach: their own (if they own one) plus every
// tenant behind a live grant, however scoped — same choke point (liveGrantFilter)
// the rest of the app uses to derive reach. A Membership always carries
// superWorkspace regardless of workspace/project narrowing (models/Membership.js).
const getTagColors = async (req, res, next) => {
  try {
    const [own, memberships] = await Promise.all([
      SuperWorkspace.findOne({ owner: req.user.id }),
      Membership.find({ user: req.user.id, ...liveGrantFilter() }).select("superWorkspace"),
    ]);

    const tenantIds = new Set();
    if (own) tenantIds.add(String(own._id));
    for (const m of memberships) tenantIds.add(String(m.superWorkspace));

    const data = {};
    for (const id of tenantIds) data[id] = {};
    if (own) data[String(own._id)] = mapFromEntries(own.tagColors);

    const otherIds = [...tenantIds].filter((id) => !own || id !== String(own._id));
    if (otherIds.length) {
      const others = await SuperWorkspace.find({ _id: { $in: otherIds } }).select("tagColors");
      for (const doc of others) data[String(doc._id)] = mapFromEntries(doc.tagColors);
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
};

// Owner-only; load-then-save on the owner's own tenant doc. null clears an
// override (back to auto); non-null upserts, capped at MAX_TAG_COLORS entries.
const putTagColor = async (req, res, next) => {
  try {
    const own = await ownedTenant(req.user.id);
    const { tag, color } = req.body;

    const idx = own.tagColors.findIndex((entry) => entry.tag === tag);
    if (color === null) {
      if (idx !== -1) own.tagColors.splice(idx, 1);
    } else if (idx !== -1) {
      own.tagColors[idx].color = color;
    } else {
      if (own.tagColors.length >= MAX_TAG_COLORS) {
        const e = new Error("Too many tag colors");
        e.status = 400;
        throw e;
      }
      own.tagColors.push({ tag, color });
    }

    await own.save();
    res.json({ data: mapFromEntries(own.tagColors) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getTagColors, putTagColor };
