// Plain-language rendering for suggestion cards (Phase 48 ruling 14) — the
// op-chip text mapping and payload-field formatting used by SuggestionsPanel
// live here (not in the component) so Phase 52 (MySuggestions/ReviewSummary)
// can reuse them. Pure JS, no React import — must stay importable/testable
// from a plain node script.

// Display word for a resourceType, used both in the op chip ("new task")
// and in body sentences ("proposes changes to task ..."). Matches the app's
// existing UI vocabulary, not a bare .toLowerCase() — Attachment is called
// "file" everywhere else in the frontend (FilesSection's section label,
// its "Suggest deleting this file?" confirm copy), so it reads "file" here
// too rather than "attachment".
const RESOURCE_TYPE_WORDS = {
  Task: "task",
  Note: "note",
  Goal: "goal",
  Link: "link",
  Attachment: "file",
  Workspace: "workspace",
  Project: "project",
};

function typeWord(resourceType) {
  return RESOURCE_TYPE_WORDS[resourceType] || (resourceType || "").toLowerCase();
}

// create/update use `title` as their content-label field, except Workspace/
// Project which use `name` (mirrors SUGGESTABLE_FIELDS / createSuggestion's
// own required-field check on the backend).
const LABEL_FIELD_BY_TYPE = { Workspace: "name", Project: "name" };

export function labelFieldFor(resourceType) {
  return LABEL_FIELD_BY_TYPE[resourceType] || "title";
}

// field -> display label. `completed` has no plain "field: value" label — it
// renders as a standalone action phrase instead (see formatFieldList) — kept
// here anyway (null) so this map stays the single source of truth for every
// field the panel understands.
export const FIELD_LABELS = {
  title: "title",
  content: "description",
  status: "status",
  dueAt: "due date",
  dueHasTime: "due time",
  priority: "priority",
  completed: null,
  url: "link URL",
  filename: "file name",
  name: "name",
  goal: "goal",
};

export const STATUS_VALUE_LABELS = { todo: "to do", in_progress: "in progress", done: "done" };

// Op chip text (ruling 14): create -> "new <type>", update -> "change",
// delete -> "removal".
export function opChipText(op, resourceType) {
  if (op === "create") return `new ${typeWord(resourceType)}`;
  if (op === "delete") return "removal";
  return "change";
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function formatScalar(field, value) {
  if (field === "status") return STATUS_VALUE_LABELS[value] || String(value);
  if (field === "priority") return value === null || value === undefined ? "none" : String(value);
  if (Array.isArray(value) || (value && typeof value === "object")) return truncate(JSON.stringify(value), 80);
  return String(value);
}

function formatDueDate(value, hasTime) {
  if (value === null) return "none";
  const d = new Date(value);
  return hasTime ? d.toLocaleString() : d.toLocaleDateString();
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

// Only keys that also exist on `resource` (the populated target — the API's
// select is narrow: title/name/filename/url) can be proven unchanged; every
// other payload key has nothing to compare against and is always kept.
function dropNoOpKeys(payload, resource) {
  return Object.entries(payload || {}).filter(([key, value]) => {
    if (!resource || typeof resource !== "object") return true;
    if (!(key in resource)) return true;
    return !valuesEqual(resource[key], value);
  });
}

// Renders an (optionally no-op-filtered) payload as plain-language lines.
// dueAt/dueHasTime merge into a single "due date: ..." line when both
// survive filtering; dueHasTime alone renders as "due time: shown/hidden".
// Pass `resource` to enable no-op dropping (update); pass null/undefined to
// keep every key (create's extra-fields line — nothing to compare against).
export function formatFieldList(payload, resource) {
  const entries = dropNoOpKeys(payload, resource);
  const map = Object.fromEntries(entries);
  const hasDueAt = "dueAt" in map;
  const hasDueHasTime = "dueHasTime" in map;
  const lines = [];

  if (hasDueAt) {
    lines.push(`due date: ${formatDueDate(map.dueAt, hasDueHasTime ? map.dueHasTime : false)}`);
  } else if (hasDueHasTime) {
    lines.push(`due time: ${map.dueHasTime ? "shown" : "hidden"}`);
  }

  for (const [key, value] of entries) {
    if (key === "dueAt" || key === "dueHasTime") continue;
    if (key === "completed") {
      lines.push(value ? "mark complete" : "mark incomplete");
      continue;
    }
    const label = FIELD_LABELS[key] || key;
    lines.push(`${label}: ${formatScalar(key, value)}`);
  }

  return lines;
}

// title || name || filename || url is the fallback order; anything else
// (nothing to show, or an unpopulated bare id — the target was likely purged
// since the suggestion was proposed) reads as an explicit note instead of a
// raw Mongo id. `name` is in the order because Project/Workspace targets
// carry no title (the API selects "title name filename url"), so dropping it
// would label every project suggestion as unavailable.
export function resourceLabel(suggestion) {
  const { resource } = suggestion;
  if (resource && typeof resource === "object") {
    return resource.title || resource.name || resource.filename || resource.url || "(deleted or unavailable)";
  }
  return "(deleted or unavailable)";
}

// Structured pieces for a card's body — lets a caller (e.g. JSX wanting to
// bold just the quoted label) compose its own markup without re-deriving
// the label/field logic. `type` is already the display word (see
// RESOURCE_TYPE_WORDS above), not the raw resourceType.
// `hunk` (Phase 52): the payload's contentHunk object when present, else
// null — only ever set on an update (Writer B's whitelist is update-only),
// exposed here so a caller can render the inline mini-diff instead of the
// plain-language field list, without re-deriving the payload shape itself.
export function suggestionParts(suggestion) {
  const { op, resourceType, payload } = suggestion;
  const type = typeWord(resourceType);

  if (op === "create") {
    const field = labelFieldFor(resourceType);
    const rest = { ...(payload || {}) };
    delete rest[field];
    return { op, type, label: (payload || {})[field], fields: formatFieldList(rest, null), hunk: null };
  }
  if (op === "delete") {
    return { op, type, label: resourceLabel(suggestion), fields: [], hunk: null };
  }
  const hunk = payload?.contentHunk || null;
  const fieldPayload = hunk ? { ...payload } : payload;
  if (hunk) delete fieldPayload.contentHunk;
  return { op, type, label: resourceLabel(suggestion), fields: formatFieldList(fieldPayload, suggestion.resource), hunk };
}

// One-line summary for a suggester's OWN suggestion rows (MySuggestions, and
// SuggestionsPanel's non-approver swap) — mirrors mock5's row text: the op
// chip word, plus type + quoted label for update/delete (create's chip word
// already names the type, e.g. "new task").
export function suggestionLine(suggestion) {
  const { op, type, label } = suggestionParts(suggestion);
  const chip = opChipText(op, suggestion.resourceType);
  return op === "create" ? `${chip} "${label}"` : `${chip} — ${type} "${label}"`;
}

// Full plain-text body (used by the panel's non-JSX fallback and by any
// caller that just wants one string — also what makes this module directly
// testable from a plain node script, no React involved).
export function suggestionBody(suggestion) {
  const { op, type, label, fields } = suggestionParts(suggestion);

  if (op === "delete") return `proposes deleting ${type} "${label}"`;

  if (op === "create") {
    const lead = `proposes a new ${type}: "${label}"`;
    return fields.length ? `${lead}\n${fields.join(", ")}` : lead;
  }

  const fieldText = fields.length ? fields.join(", ") : "no effective changes";
  return `proposes changes to ${type} "${label}": ${fieldText}`;
}
