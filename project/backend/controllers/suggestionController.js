const mongoose = require("mongoose");
const { isURL } = require("validator");
const Suggestion = require("../models/Suggestion");
const { SUGGESTABLE_FIELDS } = Suggestion;
const Task = require("../models/Task");
const Note = require("../models/Note");
const Goal = require("../models/Goal");
const Link = require("../models/Link");
const Attachment = require("../models/Attachment");
const { deleteStoredFile } = require("../utils/uploadStore");
const Workspace = require("../models/Workspace");
const Project = require("../models/Project");
const SuperWorkspace = require("../models/SuperWorkspace");
const { assertRole } = require("../middleware/auth");
const { accessibleFilters } = require("../utils/permissions");
const requireExactlyOneContainer = require("../utils/requireExactlyOneContainer");
const withEffectiveRole = require("../utils/withEffectiveRole");
const { softCascadeWorkspace, softCascadeProject, softCascadeTask } = require("../utils/cascade");
const { assertSiblingNameFree } = require("../utils/nameGuard");
const { locateHunk, applyHunk, hunkAlreadyApplied } = require("../utils/contentHunk");
const Comment = require("../models/Comment");
const { pruneOrphanedComments } = require("../utils/commentAnchor");

const MODELS = { Task, Note, Goal, Link, Attachment, Workspace, Project };

// Mirrors taskController's goalFieldFor (not exported there, so duplicated here):
// a project goal only accepts tasks of that project; a workspace goal accepts any
// task in that workspace. Used both at suggest-time-of-no-check and apply-time.
async function goalFieldFor(goalId, taskWorkspaceId, taskProjectId) {
  const goal = await Goal.findById(goalId); // live only — trashed goals aren't assignable
  if (!goal) {
    const e = new Error("Goal not found");
    e.status = 400;
    throw e;
  }
  const matches = goal.project ? goal.project.equals(taskProjectId) : goal.workspace.equals(taskWorkspaceId);
  if (!matches) {
    const e = new Error("Task and goal must be in the same workspace/project");
    e.status = 400;
    throw e;
  }
  return goal._id;
}

// A schema-validation failure at apply time (e.g. an over-long suggested title)
// must read as 400, not the central handler's default 500 — the suggest-time
// whitelist only checks field NAMES, not Mongoose's own rules. CastError covers
// a garbage id surviving inside a payload (e.g. a malformed goal id on a
// suggestion created before suggest-time id validation existed).
function rethrowValidationAs400(err) {
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) err.status = 400;
  throw err;
}

// Backstop for suggestions created before suggest-time URL validation existed —
// approval must never be able to store a non-http(s) URL, so re-check the scheme
// here too, right before it lands on the Link doc.
function assertValidLinkUrl(resourceType, payload) {
  if (resourceType !== "Link" || payload.url === undefined) return;
  if (!isURL(payload.url, { protocols: ["http", "https"], require_protocol: true, require_valid_protocol: true })) {
    const e = new Error("Invalid URL in suggestion payload");
    e.status = 400;
    throw e;
  }
}

// null-for-null id comparison: undefined/null both mean "no container"/"no
// resource" and must compare equal to each other, not just to themselves.
function sameIdOrNull(a, b) {
  const av = a === undefined || a === null ? null : String(a);
  const bv = b === undefined || b === null ? null : String(b);
  return av === bv;
}

// Stable deep-equal for Mixed payloads: sort keys at every level so key order
// (which carries no meaning here) never causes a false mismatch.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function samePayload(a, b) {
  return stableStringify(a || {}) === stableStringify(b || {});
}

// P65 §2b: unretract's target-liveness guard. Mirrors the apply phase's own
// lookup shape — a create has no target yet, so its CONTAINER (project, else
// workspace, else nothing to check for a tenant-root create) stands in;
// everything else (including an Attachment create, whose resource is a
// pre-existing siloed file, per uploadController) checks the resource itself.
// Default-filtered, so a trashed target/container reads as gone.
const TARGET_WORD = { Task: "task", Note: "note", Goal: "goal", Link: "link", Attachment: "file", Workspace: "workspace", Project: "project" };

async function targetIsLive(suggestion) {
  if (suggestion.op === "create" && suggestion.resourceType !== "Attachment") {
    if (suggestion.project) return Boolean(await Project.findById(suggestion.project));
    if (suggestion.workspace) return Boolean(await Workspace.findById(suggestion.workspace));
    return true; // tenant-root Workspace create — no container to check
  }
  const Model = MODELS[suggestion.resourceType];
  return Boolean(await Model.findById(suggestion.resource));
}

// Every deterministic, read-only check the apply phase below can fail on — run
// in full BEFORE the WAL intent is written (first entry only; the resume path
// skips this and re-runs the apply phase's own checks instead, unchanged). A
// failure here must never durably mark the suggestion as in-progress, or
// reject/retract would 409 forever on a suggestion that can never finish
// applying. Mirrors (read-only) the same helpers/conditions the apply phase
// below uses — kept deliberately redundant with it rather than restructuring
// the apply phase, so the resume path's behavior stays byte-identical to today.
async function runApproveValidation(suggestion) {
  // P65 §5, audit finding #1 (defense-in-depth): a raced or legacy orphan
  // target must 409 cleanly here, before the WAL intent is written, instead of
  // zombie-ing past it. The per-type checks below may re-run this same lookup
  // redundantly — left in place unchanged rather than restructured. Creates
  // are excluded (nothing exists yet to be gone); Workspace/Project deletes
  // are excluded (their own check, further below, already covers this).
  if (
    suggestion.op === "update" ||
    (suggestion.op === "delete" && suggestion.resourceType !== "Workspace" && suggestion.resourceType !== "Project")
  ) {
    const Model = MODELS[suggestion.resourceType];
    const target = await Model.findById(suggestion.resource);
    if (!target) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
  }

  assertValidLinkUrl(suggestion.resourceType, suggestion.payload);

  if (suggestion.op === "create" && suggestion.resourceType === "Attachment") {
    const attachment = await Attachment.findById(suggestion.resource).setOptions({ withDeleted: true });
    if (!attachment) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
    // Approval must never flip a trashed or infected file back to live status.
    if (attachment.deletedAt || attachment.scanStatus === "infected") {
      const e = new Error("File was quarantined");
      e.status = 409;
      throw e;
    }
    return;
  }

  if (suggestion.op === "create") {
    // nameGuard checkpoint 2 (approve time): re-check against the CURRENT
    // world — a sibling with this name may have appeared since propose time.
    if (suggestion.resourceType === "Project" || suggestion.resourceType === "Workspace") {
      const Model = suggestion.resourceType === "Project" ? Project : Workspace;
      const filter =
        suggestion.resourceType === "Project"
          ? { workspace: suggestion.workspace, parentProject: suggestion.project || null }
          : { superWorkspace: suggestion.superWorkspace };
      await assertSiblingNameFree(Model, { filter, name: suggestion.payload.name });
    }

    const projectId = suggestion.project || null;
    if (suggestion.resourceType === "Task" && suggestion.payload.parentTask) {
      const parent = await Task.findById(suggestion.payload.parentTask);
      if (
        !parent ||
        !sameIdOrNull(parent.workspace, suggestion.workspace) ||
        !sameIdOrNull(parent.project, projectId)
      ) {
        const e = new Error("A subtask must use the same workspace and project as its parent");
        e.status = 400;
        throw e;
      }
    }
    // Mirrors the apply phase's condition exactly (docFields.goal !== undefined,
    // which is also true for an explicit null — goalFieldFor(null, ...) 400s there
    // too; preserved here rather than "fixed" since it's existing behavior).
    if (suggestion.resourceType === "Task" && suggestion.payload.goal !== undefined) {
      try {
        await goalFieldFor(suggestion.payload.goal, suggestion.workspace, projectId);
      } catch (err) {
        rethrowValidationAs400(err);
      }
    }
    return;
  }

  if (
    suggestion.op === "update" &&
    suggestion.resourceType === "Task" &&
    suggestion.payload.goal !== undefined &&
    suggestion.payload.goal !== null
  ) {
    const target = await Task.findById(suggestion.resource); // NOT withDeleted — mirrors the apply phase's own lookup
    if (!target) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
    try {
      await goalFieldFor(suggestion.payload.goal, target.workspace, target.project);
    } catch (err) {
      rethrowValidationAs400(err);
    }
  }

  if (
    suggestion.op === "update" &&
    suggestion.resourceType === "Task" &&
    suggestion.payload.parentTask !== undefined
  ) {
    const target = await Task.findById(suggestion.resource);
    if (!target) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
    if (suggestion.payload.parentTask !== null) {
      const parent = await Task.findById(suggestion.payload.parentTask);
      if (!parent || !sameIdOrNull(parent.workspace, target.workspace) || !sameIdOrNull(parent.project, target.project)) {
        const e = new Error("A subtask must use the same workspace and project as its parent");
        e.status = 400;
        throw e;
      }
      if (parent._id.equals(target._id) || parent.ancestors.some((ancestor) => ancestor.equals(target._id))) {
        const e = new Error("Cannot move a task into itself or its descendant");
        e.status = 400;
        throw e;
      }
    }
  }

  // nameGuard checkpoint 2 for renames (approve time): re-check against the
  // CURRENT world, loading the target fresh in case it moved since propose.
  if (
    suggestion.op === "update" &&
    (suggestion.resourceType === "Project" || suggestion.resourceType === "Workspace") &&
    suggestion.payload.name !== undefined
  ) {
    const Model = suggestion.resourceType === "Project" ? Project : Workspace;
    const target = await Model.findById(suggestion.resource); // NOT withDeleted — mirrors the apply phase's own lookup
    if (!target) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
    const filter =
      suggestion.resourceType === "Project"
        ? { workspace: target.workspace, parentProject: target.parentProject }
        : { superWorkspace: target.superWorkspace };
    await assertSiblingNameFree(Model, { filter, name: suggestion.payload.name, excludeId: target._id });
  }

  // Content-hunk pre-intent check: the hunk must still be locatable (or
  // already applied, for a resume) against the CURRENT note text — otherwise
  // the note changed underneath the suggestion since it was proposed.
  if (suggestion.op === "update" && suggestion.resourceType === "Note" && suggestion.payload.contentHunk !== undefined) {
    const target = await Note.findById(suggestion.resource); // NOT withDeleted — mirrors the apply phase's own lookup
    if (!target) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
    const hunk = suggestion.payload.contentHunk;
    if (!hunkAlreadyApplied(target.content, hunk) && applyHunk(target.content, hunk) === null) {
      const e = new Error("Can't apply — the note's text changed since this was suggested. The suggestion stays pending.");
      e.status = 409;
      throw e;
    }
  }

  // Re-check container deletes at approve time. A missing project must fail
  // before the WAL marker just like a missing workspace, or the suggestion
  // would become an unrejectable in-progress orphan.
  if (
    suggestion.op === "delete" &&
    (suggestion.resourceType === "Workspace" || suggestion.resourceType === "Project")
  ) {
    const Model = suggestion.resourceType === "Workspace" ? Workspace : Project;
    const target = await Model.findById(suggestion.resource); // NOT withDeleted — mirrors the apply phase's own lookup
    if (!target) {
      const e = new Error("Target no longer available");
      e.status = 409;
      throw e;
    }
    if (suggestion.resourceType === "Workspace" && target.isDefault) {
      const e = new Error(
        "The Home workspace cannot be deleted"
      );
      e.status = 400;
      throw e;
    }
  }
}

const createSuggestion = async (req, res, next) => {
  try {
    const { resourceType, op } = req.body;
    const Model = MODELS[resourceType];

    let workspace, project, superWorkspace, target;

    if (op === "create") {
      let container;

      if (resourceType === "Workspace") {
        if (!req.body.superWorkspace || req.body.workspace) {
          const e = new Error("Workspace suggestions require superWorkspace and cannot be nested");
          e.status = 400;
          throw e;
        }
        container = await SuperWorkspace.findById(req.body.superWorkspace);
        if (!container) {
          const e = new Error("Tenant not found");
          e.status = 404;
          throw e;
        }
        await assertRole(req.user.id, container, "suggester");
        workspace = null;
        superWorkspace = container._id;
      } else {
        const isProjectMode = requireExactlyOneContainer(req.body);
        if (isProjectMode) {
          container = await Project.findById(req.body.project);
          if (!container) {
            const e = new Error("Project not found");
            e.status = 404;
            throw e;
          }
          project = container._id;
          workspace = container.workspace;
        } else {
          container = await Workspace.findById(req.body.workspace);
          if (!container) {
            const e = new Error("Workspace not found");
            e.status = 404;
            throw e;
          }
          workspace = container._id;
        }
        superWorkspace = container.superWorkspace;

        // effectiveRole >= suggester, same 404/403 split as every other authz site.
        await assertRole(req.user.id, container, "suggester");
      }

      // FIELDS' required-content-fields check: Workspace/Project use `name`, every
      // other type uses `title` (url additionally for Link).
      const payload = req.body.payload || {};
      if (resourceType === "Workspace" || resourceType === "Project") {
        if (typeof payload.name !== "string" || !payload.name.trim()) {
          const e = new Error("name is required");
          e.status = 400;
          throw e;
        }
      } else {
        if (typeof payload.title !== "string" || !payload.title.trim()) {
          const e = new Error("title is required");
          e.status = 400;
          throw e;
        }
        if (resourceType === "Link" && (typeof payload.url !== "string" || !payload.url.trim())) {
          const e = new Error("url is required");
          e.status = 400;
          throw e;
        }
      }
    } else {
      // withDeleted NOT set — a trashed target is not suggestable.
      target = await Model.findById(req.body.resource);
      if (!target) {
        const e = new Error(`${Model.modelName} not found`);
        e.status = 404;
        throw e;
      }
      await assertRole(req.user.id, target, "suggester");

      // Containment inherits from the target's own shape: a Workspace target has no
      // `workspace`/`project` fields of its own (it names itself); a Project target
      // sits IN a workspace and names itself as the project container.
      if (resourceType === "Workspace") {
        workspace = target._id;
        project = null;
      } else if (resourceType === "Project") {
        workspace = target.workspace;
        project = target._id;
      } else {
        workspace = target.workspace;
        project = target.project;
      }
      superWorkspace = target.superWorkspace;

      if (op === "delete") {
        if (resourceType === "Workspace" && target.isDefault) {
          const e = new Error("The Home workspace cannot be deleted");
          e.status = 400;
          throw e;
        }
      }
    }

    const resource = op === "create" ? undefined : target._id;
    const payload = op === "delete" ? {} : req.body.payload || {};

    // nameGuard checkpoint 1 (propose time, ruling 12/13): reject a name-
    // colliding suggestion outright instead of letting it fail silently at
    // approve time. Same filters + 409 message the direct controllers use
    // (utils/nameGuard.js) — Model is already Project/Workspace-specific here.
    if (resourceType === "Project" || resourceType === "Workspace") {
      if (op === "create") {
        const filter =
          resourceType === "Project"
            ? { workspace, parentProject: project || null }
            : { superWorkspace };
        await assertSiblingNameFree(Model, { filter, name: payload.name });
      } else if (op === "update" && payload.name !== undefined) {
        const filter =
          resourceType === "Project"
            ? { workspace: target.workspace, parentProject: target.parentProject }
            : { superWorkspace: target.superWorkspace };
        await assertSiblingNameFree(Model, { filter, name: payload.name, excludeId: target._id });
      }
    }

    // Duplicate-suggestion protection: reject a repeat of the SAME proposer's
    // own still-pending suggestion (same container/resource/payload). Only
    // pending collides — an approved/rejected identical proposal doesn't block
    // a fresh one, since the thing may genuinely need re-doing. proposedBy is
    // the selective filter term (indexed alongside status); the small resulting
    // set is compared in JS since payload equality can't be expressed as a query.
    const pendingSameShape = await Suggestion.find(
      { proposedBy: req.user.id, status: "pending", resourceType, op },
      { workspace: 1, project: 1, resource: 1, payload: 1 }
    );
    const isDuplicate = pendingSameShape.some(
      (s) =>
        sameIdOrNull(s.workspace, workspace) &&
        sameIdOrNull(s.project, project) &&
        sameIdOrNull(s.resource, resource) &&
        samePayload(s.payload, payload)
    );
    if (isDuplicate) {
      const e = new Error("You've already suggested that — it's still pending review.");
      e.status = 409;
      throw e;
    }

    const suggestion = await Suggestion.create({
      resourceType,
      op,
      resource,
      payload,
      workspace,
      project,
      superWorkspace,
      proposedBy: req.user.id,
    });

    res.status(201).json({ data: suggestion });
  } catch (err) {
    next(err);
  }
};

// A workspace list shows workspace-level suggestions only (project: null) — same
// shape as getLinks/getGoals/getAttachments. A tenant list (?superWorkspace=) shows
// tenant-root suggestions only (workspace: null) — the third exclusive container
// mode, checked ahead of requireExactlyOneContainer (which stays scoped to the
// workspace|project pair used everywhere else). listSuggestionRules already
// enforces exactly one of the three is present; this only picks which arm applies.
// `?mine=1` is a fourth, disjoint mode — the caller's own proposals in ANY
// container — checked first; listSuggestionRules rejects it combined with
// workspace/project/superWorkspace, so the two never need to compose.
const getSuggestions = async (req, res, next) => {
  try {
    const { ownSuperWorkspaceId, memberships, itemFilter } = await accessibleFilters(req.user.id);

    const isMine = req.query.mine === "1";
    let filter;
    if (isMine) {
      filter = { proposedBy: req.user.id };
    } else {
      filter = { ...itemFilter };
      if (req.query.superWorkspace) {
        filter.superWorkspace = req.query.superWorkspace;
        filter.workspace = null;
      } else {
        const isProjectMode = requireExactlyOneContainer(req.query);
        if (isProjectMode) {
          filter.project = req.query.project;
        } else {
          filter.workspace = req.query.workspace;
          filter.project = null;
        }
      }
    }

    const status = req.query.status || "pending";
    if (status !== "all") filter.status = status;

    let query = Suggestion.find(filter)
      .sort({ createdAt: -1 })
      .populate("proposedBy", "username")
      .populate("reviewedBy", "username")
      // Rides the target's display name along so the panel never shows a bare
      // id; withDeleted so a delete-suggestion whose target is already
      // trashed still resolves a name. Workspace/Project targets use `name`,
      // not `title`.
      .populate({ path: "resource", select: "title name filename url", options: { withDeleted: true } });
    // The container is implicit (from the query params) on every other mode, so
    // only `mine` — spanning any container — needs the container's own name along.
    if (isMine) {
      query = query.populate("workspace", "name").populate("project", "name");
    }
    const suggestions = await query;

    const data = await withEffectiveRole(suggestions, { ownSuperWorkspaceId, memberships });

    res.json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

// Owner-only roll-up for the Home "Needs your review" panel: every PENDING
// suggestion in the caller's own tenant, grouped by its container. A non-owner
// (including an agent, who owns no tenant) gets a quiet empty result rather
// than a 403 — this is a dashboard widget, not an admin action, and the
// frontend renders nothing at all for non-owners (see PHASE_SPEC). Volumes are
// small (pending suggestions in one tenant), so a single find + JS reduce
// beats an aggregation pipeline for this.
const reviewSummary = async (req, res, next) => {
  try {
    const own = await SuperWorkspace.findOne({ owner: req.user.id });
    if (!own) {
      return res.json({ data: [], total: 0 });
    }

    const suggestions = await Suggestion.find({ superWorkspace: own._id, status: "pending" })
      .populate("workspace", "name")
      .populate("project", "name");

    const groups = new Map();
    for (const s of suggestions) {
      const wsId = s.workspace ? String(s.workspace._id) : "";
      const projId = s.project ? String(s.project._id) : "";
      const key = `${wsId}:${projId}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          workspace: s.workspace ? { id: s.workspace._id, name: s.workspace.name } : null,
          project: s.project ? { id: s.project._id, name: s.project.name } : null,
          count: 0,
        };
        groups.set(key, group);
      }
      group.count += 1;
    }

    const data = [...groups.values()].sort((a, b) => {
      const aIsRoot = !a.workspace && !a.project;
      const bIsRoot = !b.workspace && !b.project;
      if (aIsRoot !== bIsRoot) return aIsRoot ? -1 : 1;
      return b.count - a.count;
    });

    res.json({ data, total: suggestions.length });
  } catch (err) {
    next(err);
  }
};

const getOneSuggestion = async (req, res, next) => {
  try {
    res.json({ data: req.resource, effectiveRole: req.effectiveRole });
  } catch (err) {
    next(err);
  }
};

// Applies the suggestion's op onto its target, attributing the change to the
// PROPOSER (createdBy/updatedBy/softDelete userId = proposedBy) — they authored
// it, Google-Docs style. The approver only ever lands on the suggestion doc.
const approveSuggestion = async (req, res, next) => {
  try {
    const suggestion = req.resource;
    if (suggestion.status !== "pending") {
      const e = new Error("Already resolved");
      e.status = 409;
      throw e;
    }

    // WAL: resuming means an earlier approve call on this suggestion already wrote
    // the intent marker (and possibly the target mutation) before crashing. The
    // intent must be durable before we touch the target, and re-entering that state
    // must never redo work that already landed.
    const resuming = Boolean(suggestion.applyStartedAt);
    if (!resuming) {
      const completesParentTask = suggestion.op === "update" && suggestion.resourceType === "Task" &&
        (suggestion.payload.status === "done" ||
          (suggestion.payload.status === undefined && suggestion.payload.completed === true));
      if (completesParentTask) {
        const unfinished = await Task.find({ ancestors: suggestion.resource, status: { $ne: "done" } });
        if (unfinished.length && !req.body?.completeSubtasks) {
          return res.status(409).json({
            error: {
              code: "INCOMPLETE_SUBTASKS",
              message: `This task has ${unfinished.length} unfinished subtask${unfinished.length === 1 ? "" : "s"}.`,
              details: { count: unfinished.length },
            },
          });
        }
      }
      await runApproveValidation(suggestion); // all deterministic checks, before any durable write

      if (suggestion.op === "create" && suggestion.resourceType !== "Attachment") {
        suggestion.appliedResource = new mongoose.Types.ObjectId();
      }
      suggestion.applyStartedAt = new Date();
      await suggestion.save(); // intent durable BEFORE any target write
    }

    const Model = MODELS[suggestion.resourceType];
    const fields = SUGGESTABLE_FIELDS[suggestion.resourceType];
    let resource = null;

    assertValidLinkUrl(suggestion.resourceType, suggestion.payload);

    if (suggestion.op === "create" && suggestion.resourceType === "Attachment") {
      // Siloed-file special case: the attachment doc already exists (created
      // pending at upload finalize); approval just flips it live — never
      // Model.create, the doc is already there.
      const attachment = await Attachment.findById(suggestion.resource).setOptions({ withDeleted: true });
      if (!attachment) {
        const e = new Error("Target no longer available");
        e.status = 409;
        throw e;
      }
      attachment.status = "live";
      await attachment.save();
      resource = attachment;
    } else if (suggestion.op === "create") {
      // withDeleted: a crash after creation must find the doc even if it was
      // somehow trashed since (still counts as "already applied", not re-creatable).
      const existing = await Model.findById(suggestion.appliedResource).setOptions({ withDeleted: true });
      if (existing) {
        resource = existing;
      } else {
        let docFields;

        if (suggestion.resourceType === "Workspace") {
          docFields = {
            _id: suggestion.appliedResource,
            name: suggestion.payload.name,
            description: suggestion.payload.description,
            superWorkspace: suggestion.superWorkspace,
            createdBy: suggestion.proposedBy,
            updatedBy: suggestion.proposedBy,
          };
        } else if (suggestion.resourceType === "Project") {
          // Mirrors createProject's own field derivation: workspace mode (suggestion.project
          // absent, suggestion.workspace is the top-level container) or parent-project mode
          // (suggestion.project is the parent — load it fresh for ancestors, same rationale
          // as the Workspace arm above).
          let parentProject = null;
          let ancestors = [];
          let workspaceId = suggestion.workspace;
          if (suggestion.project) {
            const parent = await Project.findById(suggestion.project);
            if (!parent) {
              const e = new Error("Target no longer available");
              e.status = 409;
              throw e;
            }
            parentProject = parent._id;
            ancestors = [...parent.ancestors, parent._id];
            workspaceId = parent.workspace;
          }
          docFields = {
            _id: suggestion.appliedResource,
            name: suggestion.payload.name,
            description: suggestion.payload.description,
            tags: suggestion.payload.tags || [],
            status: suggestion.payload.status || "active",
            workspace: workspaceId,
            parentProject,
            ancestors,
            superWorkspace: suggestion.superWorkspace,
            createdBy: suggestion.proposedBy,
            updatedBy: suggestion.proposedBy,
          };
        } else {
          docFields = {
            _id: suggestion.appliedResource,
            workspace: suggestion.workspace,
            project: suggestion.project || undefined,
            superWorkspace: suggestion.superWorkspace,
            createdBy: suggestion.proposedBy,
            updatedBy: suggestion.proposedBy,
          };

          for (const key of fields) {
            if (suggestion.payload[key] !== undefined) docFields[key] = suggestion.payload[key];
          }

          if (suggestion.resourceType === "Task") {
            let parent = null;
            if (docFields.parentTask) {
              parent = await Task.findById(docFields.parentTask);
              if (
                !parent ||
                !sameIdOrNull(parent.workspace, docFields.workspace) ||
                !sameIdOrNull(parent.project, docFields.project)
              ) {
                const e = new Error("A subtask must use the same workspace and project as its parent");
                e.status = 400;
                throw e;
              }
              docFields.ancestors = [...parent.ancestors, parent._id];
            }
            const last = await Task.findOne({
              workspace: docFields.workspace,
              project: docFields.project || null,
              parentTask: parent ? parent._id : null,
            }).sort({ order: -1 });
            docFields.order = last?.order === undefined ? 0 : last.order + 1;
          }

          if (suggestion.resourceType === "Task" && docFields.goal !== undefined) {
            try {
              docFields.goal = await goalFieldFor(docFields.goal, suggestion.workspace, docFields.project);
            } catch (err) {
              rethrowValidationAs400(err);
            }
          }

          if (suggestion.resourceType === "Goal" || suggestion.resourceType === "Link") {
            const orderFilter = suggestion.project
              ? { project: suggestion.project }
              : { workspace: suggestion.workspace, project: null };
            const last = await Model.findOne(orderFilter).sort({ order: -1 });
            docFields.order = last ? last.order + 1 : 0;
          }
        }

        try {
          resource = await Model.create(docFields);
        } catch (err) {
          if (err.code === 11000) {
            // A parallel retry won the create race first (same reserved _id) — use its doc.
            resource = await Model.findById(suggestion.appliedResource).setOptions({ withDeleted: true });
            if (!resource) throw err;
          } else {
            rethrowValidationAs400(err);
          }
        }
      }

    } else if (suggestion.op === "update") {
      // NOT withDeleted — hard-gone, directly trashed, or cascade-trashed via a
      // trashed container all collapse into "not found" here (the cascade stamps
      // the same deletedAt onto children, so a trashed-container item is trashed too).
      const target = await Model.findById(suggestion.resource);
      if (!target) {
        const e = new Error("Target no longer available");
        e.status = 409;
        throw e;
      }

      const completesTask = suggestion.resourceType === "Task" &&
        (suggestion.payload.status === "done" ||
          (suggestion.payload.status === undefined && suggestion.payload.completed === true));
      if (completesTask) {
        const descendants = await Task.find({ ancestors: target._id, status: { $ne: "done" } });
        for (const child of descendants) {
          child.status = "done";
          child.updatedBy = suggestion.proposedBy;
          await child.save();
        }
      }

      let taskDescendants = [];
      if (suggestion.resourceType === "Task" && suggestion.payload.parentTask !== undefined) {
        const parent = suggestion.payload.parentTask === null
          ? null
          : await Task.findById(suggestion.payload.parentTask);
        if (parent && (
          !sameIdOrNull(parent.workspace, target.workspace) ||
          !sameIdOrNull(parent.project, target.project)
        )) {
          const e = new Error("A subtask must use the same workspace and project as its parent");
          e.status = 400;
          throw e;
        }
        if (parent && (parent._id.equals(target._id) || parent.ancestors.some((ancestor) => ancestor.equals(target._id)))) {
          const e = new Error("Cannot move a task into itself or its descendant");
          e.status = 400;
          throw e;
        }
        target.parentTask = parent?._id || null;
        target.ancestors = parent ? [...parent.ancestors, parent._id] : [];
        taskDescendants = await Task.find({ ancestors: target._id }, "_id parentTask")
          .setOptions({ withDeleted: true });
      }

      for (const key of fields) {
        if (suggestion.payload[key] === undefined) continue;
        if (key === "parentTask") {
          continue;
        } else if (key === "goal") {
          if (suggestion.payload.goal === null) {
            target.goal = undefined;
          } else {
            try {
              target.goal = await goalFieldFor(suggestion.payload.goal, target.workspace, target.project);
            } catch (err) {
              rethrowValidationAs400(err);
            }
          }
        } else if (key === "contentHunk") {
          // Idempotent: a resumed retry re-runs this unconditionally (the pre-
          // intent locatability check above is skipped on resume) — already-
          // applied is a no-op skip rather than a re-apply.
          const hunk = suggestion.payload.contentHunk;
          if (!hunkAlreadyApplied(target.content, hunk)) {
            const applied = applyHunk(target.content, hunk);
            if (applied === null) {
              const e = new Error("Can't apply — the note's text changed since this was suggested. The suggestion stays pending.");
              e.status = 409;
              throw e;
            }
            target.content = applied;
          }
        } else {
          target[key] = suggestion.payload[key];
        }
      }
      target.updatedBy = suggestion.proposedBy;
      try {
        await target.save(); // VersionError -> central 409 handler; ValidationError -> 400 below
      } catch (err) {
        rethrowValidationAs400(err);
      }
      resource = target;

      if (taskDescendants.length) {
        const byId = new Map(taskDescendants.map((doc) => [String(doc._id), doc]));
        const cache = new Map([[String(target._id), target.ancestors]]);
        const ancestorsOf = (taskId) => {
          const key = String(taskId);
          if (cache.has(key)) return cache.get(key);
          const doc = byId.get(key);
          const chain = [...ancestorsOf(doc.parentTask), doc.parentTask];
          cache.set(key, chain);
          return chain;
        };
        await Promise.all(taskDescendants.map((doc) =>
          Task.updateOne({ _id: doc._id }, { ancestors: ancestorsOf(doc._id) })
        ));
      }

      const reopensTask = suggestion.resourceType === "Task" && (
        (suggestion.payload.status && suggestion.payload.status !== "done") ||
        (suggestion.payload.status === undefined && suggestion.payload.completed === false)
      );
      if (reopensTask && target.ancestors.length) {
        const completedAncestors = await Task.find({ _id: { $in: target.ancestors }, status: "done" });
        for (const ancestor of completedAncestors) {
          ancestor.status = "todo";
          ancestor.updatedBy = suggestion.proposedBy;
          await ancestor.save();
        }
      }

      // Auto-delete on drift (PHASE_SPEC.md ruling): a suggestion-approved
      // content change is treated exactly like a direct edit for comment
      // anchors — covers both the contentHunk arm and a whole-content arm.
      if (suggestion.resourceType === "Note" && (suggestion.payload.content !== undefined || suggestion.payload.contentHunk !== undefined)) {
        await pruneOrphanedComments(Comment, target._id, target.content, suggestion._id);
      }
    } else {
      // delete
      const target = await Model.findById(suggestion.resource);
      if (target) {
        // Workspace/Project deletes cascade to their subtree first, same as the
        // controllers' own deleteWorkspace/deleteProject (NOT a bare softDelete) —
        // children ride the root's exact `at` so a later restore revives precisely
        // this cascade.
        if (suggestion.resourceType === "Workspace") {
          const at = new Date();
          await softCascadeWorkspace(target._id, suggestion.proposedBy, at);
          await target.softDelete(suggestion.proposedBy, at);
        } else if (suggestion.resourceType === "Project") {
          const at = new Date();
          await softCascadeProject(target._id, suggestion.proposedBy, at);
          await target.softDelete(suggestion.proposedBy, at);
        } else if (suggestion.resourceType === "Task") {
          const at = new Date();
          await softCascadeTask(target._id, suggestion.proposedBy, at);
          await target.softDelete(suggestion.proposedBy, at);
        } else {
          await target.softDelete(suggestion.proposedBy);
        }
        resource = null;
      } else {
        // A resumed retry: re-check withDeleted — if it's there with deletedAt set,
        // the softDelete already committed before the crash; nothing left to do.
        const trashed = resuming
          ? await Model.findById(suggestion.resource).setOptions({ withDeleted: true })
          : null;
        if (trashed && trashed.deletedAt) {
          resource = null;
        } else {
          const e = new Error("Target no longer available");
          e.status = 409;
          throw e;
        }
      }
    }

    suggestion.status = "approved";
    suggestion.reviewedBy = req.user.id;
    suggestion.resolvedAt = new Date();
    await suggestion.save();

    res.json({ data: { suggestion, resource } });
  } catch (err) {
    next(err);
  }
};

const rejectSuggestion = async (req, res, next) => {
  try {
    const suggestion = req.resource;
    if (suggestion.status !== "pending") {
      const e = new Error("Already resolved");
      e.status = 409;
      throw e;
    }
    // A crashed approve leaves status "pending" with applyStartedAt set — the
    // mutation may already be durable, so this can only be finished via approve,
    // never rejected out from under it. Exception: a create whose intent was
    // reserved but never actually landed (e.g. Model.create failed deterministically
    // after the intent save) is provably safe to un-stick — nothing exists to lose,
    // and re-approving would only fail the same way forever.
    if (suggestion.applyStartedAt) {
      let unlandedCreate = false;
      if (suggestion.op === "create" && suggestion.appliedResource) {
        const Model = MODELS[suggestion.resourceType];
        const existing = await Model.findById(suggestion.appliedResource).setOptions({ withDeleted: true });
        unlandedCreate = !existing;
      }
      // Content-hunk equivalent: provably unlanded means `old` is still findable
      // (the mutation never happened) and `new` isn't sitting at the anchor
      // (rules out the "already applied, just not yet marked" WAL-crash case).
      let unlandedHunk = false;
      if (suggestion.op === "update" && suggestion.resourceType === "Note" && suggestion.payload.contentHunk) {
        const target = await Note.findById(suggestion.resource);
        if (target) {
          const hunk = suggestion.payload.contentHunk;
          unlandedHunk = locateHunk(target.content, hunk) !== null && !hunkAlreadyApplied(target.content, hunk);
        }
      }
      if (unlandedCreate || unlandedHunk) {
        suggestion.applyStartedAt = undefined;
        suggestion.appliedResource = undefined;
      } else {
        const e = new Error("Approval already in progress — approve again to finish applying");
        e.status = 409;
        throw e;
      }
    }

    if (suggestion.resourceType === "Attachment" && suggestion.op === "create") {
      const attachment = await Attachment.findById(suggestion.resource).setOptions({ withDeleted: true });
      // Guard: only ever purge a still-pending attachment — never a live one.
      if (attachment && attachment.status === "pending") {
        await attachment.deleteOne();
        await deleteStoredFile(attachment.storageKey);
      }
    }

    suggestion.status = "rejected";
    suggestion.reviewedBy = req.user.id;
    suggestion.resolvedAt = new Date();
    await suggestion.save();
    res.json({ data: suggestion });
  } catch (err) {
    next(err);
  }
};

// Proposer-only, own-pending-only; no authorize middleware since the rule isn't
// role-shaped — it's "did YOU propose this, and is it still pending".
const retractSuggestion = async (req, res, next) => {
  try {
    const suggestion = await Suggestion.findById(req.params.id);
    if (!suggestion || !suggestion.proposedBy.equals(req.user.id)) {
      return res.status(404).json({ error: { message: "Suggestion not found" } });
    }
    // A crashed approve leaves status "pending" with applyStartedAt set — the
    // proposer already owns this suggestion (checked above), so a 409 here leaks
    // nothing; it must be finished via approve, never retracted mid-apply.
    if (suggestion.status === "pending" && suggestion.applyStartedAt) {
      const e = new Error("Approval already in progress — approve again to finish applying");
      e.status = 409;
      throw e;
    }
    if (suggestion.status !== "pending") {
      return res.status(404).json({ error: { message: "Suggestion not found" } });
    }
    suggestion.deletedAt = new Date(); // P61: soft delete so unretract can restore this exact doc
    suggestion.deletedVia = "user"; // P65: distinguishes this from a cascade sweep
    await suggestion.save();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// Undo of approveSuggestion — supported ONLY for the note-page contentHunk review
// flow (the one op/resourceType/payload shape whose effect can be cleanly mirrored
// back onto live text); every other approve is a one-way door (P61 ruling).
const unapproveSuggestion = async (req, res, next) => {
  try {
    const suggestion = req.resource;
    if (suggestion.status !== "approved") {
      const e = new Error("Not approved");
      e.status = 409;
      throw e;
    }
    if (!(suggestion.op === "update" && suggestion.resourceType === "Note" && suggestion.payload.contentHunk !== undefined)) {
      const e = new Error("This approval can't be undone");
      e.status = 409;
      throw e;
    }

    const note = await Note.findById(suggestion.resource);
    if (!note) {
      const e = new Error("Note not found");
      e.status = 404;
      throw e;
    }

    // Reverse the original hunk by locating and applying its MIRROR (old<->new
    // swapped) — same mirror shape hunkAlreadyApplied uses to detect the hunk's
    // effect is present, just applied here instead of only checked.
    const hunk = suggestion.payload.contentHunk;
    const mirror = { before: hunk.before, old: hunk.new, new: hunk.old, after: hunk.after };
    const reverted = applyHunk(note.content, mirror);
    if (reverted === null) {
      const e = new Error("Can't undo — the note's text changed since this was approved");
      e.status = 409;
      throw e;
    }
    note.content = reverted;
    note.updatedBy = req.user.id; // the undoer, not the original proposer — this is a new content state
    await note.save();

    // Restore only the comments THIS approve pruned — updateMany bypasses the
    // model's default hideDeleted filter both ways, which is fine: it needs to
    // match currently-hidden docs to un-hide them.
    await Comment.updateMany(
      { note: note._id, prunedBySuggestion: suggestion._id, deletedVia: "prune", deletedAt: { $ne: null } },
      { $set: { deletedAt: null, deletedVia: null, prunedBySuggestion: null } }
    );

    suggestion.status = "pending";
    suggestion.reviewedBy = undefined;
    suggestion.resolvedAt = undefined;
    suggestion.applyStartedAt = undefined;
    suggestion.appliedResource = undefined;
    await suggestion.save();

    res.json({ data: { suggestion, resource: note } });
  } catch (err) {
    next(err);
  }
};

// Undo of rejectSuggestion — plain state flip, except an Attachment create
// whose file the reject already deleted (irreversible).
const unrejectSuggestion = async (req, res, next) => {
  try {
    const suggestion = req.resource;
    if (suggestion.status !== "rejected") {
      const e = new Error("Not rejected");
      e.status = 409;
      throw e;
    }
    if (suggestion.op === "create" && suggestion.resourceType === "Attachment") {
      const e = new Error("This rejection can't be undone");
      e.status = 409;
      throw e;
    }
    suggestion.status = "pending";
    suggestion.reviewedBy = undefined;
    suggestion.resolvedAt = undefined;
    await suggestion.save();
    res.json({ data: suggestion });
  } catch (err) {
    next(err);
  }
};

// Undo of retract — proposer-only, mirrors retract's own not-role-shaped gate.
// No authorize middleware: authorize()'s findById would 404 on the soft-deleted
// doc before the controller ever got to check ownership. P65: only a USER
// retract is undoable here — a cascade-deleted suggestion 404s (it comes back
// only by restoring its target); reviving into a since-trashed target 409s.
const unretractSuggestion = async (req, res, next) => {
  try {
    const suggestion = await Suggestion.findById(req.params.id).setOptions({ withDeleted: true });
    if (
      !suggestion ||
      !suggestion.proposedBy.equals(req.user.id) ||
      suggestion.deletedAt === null ||
      suggestion.deletedVia !== "user"
    ) {
      return res.status(404).json({ error: { message: "Suggestion not found" } });
    }
    if (!(await targetIsLive(suggestion))) {
      const e = new Error(`Can't restore — its ${TARGET_WORD[suggestion.resourceType]} was deleted`);
      e.status = 409;
      throw e;
    }
    suggestion.deletedAt = null;
    suggestion.deletedVia = null;
    await suggestion.save();
    res.json({ data: suggestion });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createSuggestion,
  getSuggestions,
  reviewSummary,
  getOneSuggestion,
  approveSuggestion,
  rejectSuggestion,
  retractSuggestion,
  unapproveSuggestion,
  unrejectSuggestion,
  unretractSuggestion,
};
