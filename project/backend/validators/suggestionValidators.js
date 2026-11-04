const { body, param, query } = require("express-validator");
const { isURL } = require("validator");
const mongoose = require("mongoose");
const { SUGGESTABLE_FIELDS } = require("../models/Suggestion");

// Prepend https:// only when there is NO scheme at all. Mirrors linkValidators'
// normalizeUrl — duplicated here (not extracted) per spec, since the source there
// is a local function, not a shared util.
function normalizeUrl(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) ? `https://${t}` : t;
}

// A pending suggestion sits inert until approved. There is deliberately NO
// whole-payload size cap (self-hosted app — Samuel doesn't want arbitrary size
// limits); the per-field mirrors below only enforce the same name/title/short-
// description maxlengths the target models already declare, catching an over-long
// title at suggest time instead of only failing on approve.
//
// Grepped straight from each target model's own maxlength — only fields that
// actually declare one there get an entry; do not invent bounds beyond these.
const MAXLENGTHS = {
  Task: { title: 120 },
  Note: { title: 120 },
  Goal: { title: 120, description: 500 },
  Link: { title: 120, url: 2048, description: 300 },
  Attachment: { filename: 255 },
  Workspace: { name: 120, description: 500 },
  Project: { name: 120, description: 500 },
};

const createSuggestionRules = [
  body("resourceType")
    .isIn(["Task", "Note", "Goal", "Link", "Attachment", "Workspace", "Project"])
    .withMessage("Invalid resource type"),

  body("op")
    .isIn(["create", "update", "delete"])
    .withMessage("op must be create, update, or delete"),

  body("resource")
    .optional()
    .isMongoId()
    .withMessage("Invalid resource ID"),

  // Required unless op create — a create suggestion has no existing target yet.
  // (The inverse — resource present WITH op create — is deliberately not rejected.)
  body("resource").custom((value, { req }) => {
    if (req.body.op !== "create" && !value) {
      throw new Error("A resource id is required for update/delete");
    }
    return true;
  }),

  body("workspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid workspace ID"),

  body("project")
    .optional()
    .isMongoId()
    .withMessage("Invalid project ID"),

  body("superWorkspace")
    .optional()
    .isMongoId()
    .withMessage("Invalid tenant ID"),

  body("payload")
    .optional()
    .isObject()
    .withMessage("payload must be an object"),

  // Whitelist + Attachment-create rejection + Link url normalization, all in one
  // pass since they all key off the same (resourceType, op, payload) triple.
  body("payload").custom((payload, { req }) => {
    const { resourceType, op } = req.body;
    if (!SUGGESTABLE_FIELDS[resourceType] || !["create", "update", "delete"].includes(op)) {
      return true; // already flagged by the resourceType/op rules above
    }

    if (op === "delete") {
      if (payload !== undefined && payload !== null && Object.keys(payload).length > 0) {
        throw new Error("delete suggestions take no payload");
      }
      return true;
    }

    if (op === "create" && resourceType === "Attachment") {
      throw new Error("Suggesting an Attachment create is not supported");
    }

    const allowed = SUGGESTABLE_FIELDS[resourceType];
    const bounds = MAXLENGTHS[resourceType] || {};
    const fields = payload && typeof payload === "object" ? payload : {};

    // contentHunk is an update-only mechanism (a create has no prior text to
    // hunk against) and can't coexist with a whole-content replacement in the
    // same payload — the two are mutually exclusive edit shapes.
    if (op === "create" && fields.contentHunk !== undefined) {
      throw new Error("contentHunk is not allowed on create");
    }
    if (fields.content !== undefined && fields.contentHunk !== undefined) {
      throw new Error("Provide content or contentHunk, not both");
    }

    // Whitelist + value-type check in one pass: names only get you in the door,
    // the value must also be the right shape for its field — a garbage payload
    // must reject at suggest time rather than surviving to strand approve later.
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) {
        throw new Error(`${key} is not a suggestable field for ${resourceType}`);
      }
      if (key === "completed") {
        if (typeof fields[key] !== "boolean") {
          throw new Error("completed must be true or false");
        }
      } else if (key === "status") {
        const allowedStatuses = resourceType === "Project"
          ? ["active", "blocked", "completed"]
          : ["todo", "in_progress", "done"];
        if (typeof fields[key] !== "string" || !allowedStatuses.includes(fields[key])) {
          throw new Error("Invalid status");
        }
      } else if (key === "goal" || key === "parentTask") {
        if (fields[key] !== null && !mongoose.Types.ObjectId.isValid(fields[key])) {
          throw new Error(`Invalid ${key} ID`);
        }
      } else if (key === "tags") {
        // Mirrors projectValidators' tags rule exactly: array of at most 10 strings,
        // each 1-30 chars after trim. Pre-normalization values are acceptable here —
        // the Project pre("validate") hook normalizes at materialization time.
        if (!Array.isArray(fields[key]) || fields[key].length > 10) {
          throw new Error("Tags must be an array of at most 10");
        }
        for (const tag of fields[key]) {
          if (typeof tag !== "string" || !tag.trim() || tag.trim().length > 30) {
            throw new Error("Each tag must be text between 1 and 30 characters");
          }
        }
      } else if (key === "dueAt") {
        // All-day and timed dues both arrive as ISO strings; explicit null clears.
        if (fields[key] !== null && (typeof fields[key] !== "string" || isNaN(Date.parse(fields[key])))) {
          throw new Error("dueAt must be an ISO 8601 date");
        }
      } else if (key === "dueHasTime") {
        if (typeof fields[key] !== "boolean") {
          throw new Error("dueHasTime must be true or false");
        }
      } else if (key === "priority") {
        if (fields[key] !== null && !["low", "medium", "high"].includes(fields[key])) {
          throw new Error("priority must be low, medium, or high");
        }
      } else if (key === "contentHunk") {
        // Shared contract, PHASE_SPEC.md: exactly before/old/new/after, all
        // strings, old+new not both empty (a hunk must add or remove something).
        const hunk = fields[key];
        const hunkKeys = hunk && typeof hunk === "object" && !Array.isArray(hunk) ? Object.keys(hunk) : null;
        if (!hunkKeys || hunkKeys.length !== 4 || !["before", "old", "new", "after"].every((k) => hunkKeys.includes(k))) {
          throw new Error("contentHunk must be an object with exactly before, old, new, and after");
        }
        for (const hk of ["before", "old", "new", "after"]) {
          if (typeof hunk[hk] !== "string") throw new Error(`contentHunk.${hk} must be text`);
        }
        if (hunk.old === "" && hunk.new === "") {
          throw new Error("contentHunk must add or remove something");
        }
        if (hunk.old.length > 20000 || hunk.new.length > 20000) {
          throw new Error("contentHunk old/new must be at most 20000 characters each");
        }
        if (hunk.before.length > 2000 || hunk.after.length > 2000) {
          throw new Error("contentHunk before/after must be at most 2000 characters each");
        }
      } else if (typeof fields[key] !== "string") {
        // Every remaining suggestable field (titles, content, description, url, filename) is a string.
        throw new Error(`${key} must be text`);
      }
    }

    // Normalize before the maxlength check below — normalization can only grow
    // a url (adding the https:// prefix), so the bound must apply to the value
    // that actually ends up stored. Safe now: the loop above already confirmed
    // url (if present) is a string.
    if (resourceType === "Link" && fields.url !== undefined) {
      fields.url = normalizeUrl(fields.url);
      // Mirrors linkValidators' isURL check exactly — a suggested Link must be
      // just as scheme-safe as a directly-created one (approve stores verbatim).
      if (!isURL(fields.url, { protocols: ["http", "https"], require_protocol: true, require_valid_protocol: true })) {
        throw new Error("Invalid URL");
      }
    }

    for (const key of Object.keys(fields)) {
      if (bounds[key] !== undefined && typeof fields[key] === "string" && fields[key].length > bounds[key]) {
        throw new Error(`${key} must be at most ${bounds[key]} characters`);
      }
    }

    return true;
  }),
];

const suggestionIdRules = [
  param("id").isMongoId().withMessage("Invalid suggestion ID"),
];

const approveSuggestionRules = [
  body("completeSubtasks")
    .optional()
    .isBoolean()
    .withMessage("completeSubtasks must be a boolean"),
];

const listSuggestionRules = [
  query("workspace").optional().isMongoId().withMessage("Invalid workspace ID"),
  query("project").optional().isMongoId().withMessage("Invalid project ID"),
  query("superWorkspace").optional().isMongoId().withMessage("Invalid tenant ID"),
  query("mine").optional().isIn(["1"]).withMessage("Invalid mine value"),
  // mine=1 is a fourth, disjoint mode (the caller's own proposals, any container) —
  // mutually exclusive with the three container params rather than composing with
  // requireExactlyOneContainer's "exactly one" rule below.
  query("workspace").custom((value, { req }) => {
    const hasContainer = Boolean(req.query.workspace || req.query.project || req.query.superWorkspace);
    if (req.query.mine === "1") {
      if (hasContainer) throw new Error("mine cannot be combined with workspace, project, or superWorkspace");
      return true;
    }
    const count = [req.query.workspace, req.query.project, req.query.superWorkspace].filter(Boolean).length;
    if (count !== 1) throw new Error("Provide exactly one of workspace, project, or superWorkspace");
    return true;
  }),
  query("status")
    .optional()
    .isIn(["all", "pending", "approved", "rejected"])
    .withMessage("Invalid status filter"),
];

module.exports = {
  createSuggestionRules,
  approveSuggestionRules,
  suggestionIdRules,
  listSuggestionRules,
};
