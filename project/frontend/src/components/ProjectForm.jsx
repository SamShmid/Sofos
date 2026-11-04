import { useState, useRef, useEffect } from "react";
import { resolveTagColor } from "../utils/tags";
import { useTagColors } from "../context/TagColorsContext";
import TagColorPopover from "./TagColorPopover";
import { getDraft, setDraft, clearDraft } from "../utils/draftStash";
import Dropdown from "./Dropdown";

const MAX_TAGS = 10;
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
];

// New/edit project. Name required, description optional, tags free-form.
// suggestMode (P33) overrides submitLabel with its suggest-mode counterpart —
// the caller already knows edit-vs-create (initial._id) from how it invokes
// this form, same signal this component uses internally.
// tenantId/canManageColors (P43): the container's tenant id and whether the
// viewer owns it — callers already have an effectiveRole in scope (the
// project being edited, or the workspace/project being created into) to
// derive canManageColors from; the popover is inline-management only, never
// gated on suggestMode (color mutation is a separate tenant-owner-only endpoint).
// draftKey (ruling 10): optional — when absent this form behaves exactly as
// before. When present, a backdrop/Escape close (which unmounts this form
// without clearing the stash) leaves the typed values — including tags and
// the in-progress tagInput — behind for the next mount of the SAME key.
export default function ProjectForm({ initial = {}, submitLabel = "Create", suggestMode = false, tenantId = null, canManageColors = false, draftKey = null, onSubmit, onCancel }) {
  const draft = draftKey ? getDraft(draftKey) : undefined;
  const [name, setName] = useState(draft?.name ?? initial.name ?? "");
  const [description, setDescription] = useState(draft?.description ?? initial.description ?? "");
  const [tags, setTags] = useState(draft?.tags ?? initial.tags ?? []);
  const [status, setStatus] = useState(draft?.status ?? initial.status ?? "active");
  const [tagInput, setTagInput] = useState(draft?.tagInput ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [colorPopoverTag, setColorPopoverTag] = useState(null);
  const { maps } = useTagColors();
  // `disabled={submitting}` only blocks clicks after React re-renders; two
  // clicks in the same tick both fire first. A synchronous ref guard makes a
  // double-submit truly impossible.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!draftKey) return;
    setDraft(draftKey, { name, description, tags, status, tagInput });
  }, [draftKey, name, description, tags, status, tagInput]);

  function handleCancel() {
    if (draftKey) clearDraft(draftKey);
    onCancel();
  }

  // Ignore empty/duplicate and the 11th tag rather than surfacing an error —
  // the cap is a soft, silent stop, not a validation failure.
  function commitTag(raw) {
    const t = raw.trim().toLowerCase();
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS) return;
    setTags([...tags, t]);
  }

  function handleTagKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag(tagInput);
      setTagInput("");
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  function removeTag(t) {
    setTags(tags.filter((x) => x !== t));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), tags, status });
      if (draftKey) clearDraft(draftKey);
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Status
        <Dropdown ariaLabel="Project status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </label>
      <label>
        Tags
        <div className="tag-input-box">
          {tags.map((t) => (
            <span key={t} className={`tag-chip c${resolveTagColor(t, tenantId, maps)}`}>
              {canManageColors ? (
                <button
                  type="button"
                  className="tag-chip-label"
                  onClick={() => setColorPopoverTag(colorPopoverTag === t ? null : t)}
                >
                  {t}
                </button>
              ) : (
                <span className="tag-chip-label">{t}</span>
              )}
              <button
                type="button"
                className="tag-chip-x"
                aria-label={`Remove tag ${t}`}
                onClick={(e) => { e.stopPropagation(); removeTag(t); }}
              >
                ×
              </button>
              {canManageColors && colorPopoverTag === t && (
                <TagColorPopover tag={t} tenantId={tenantId} onClose={() => setColorPopoverTag(null)} />
              )}
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder={tags.length < MAX_TAGS ? "Add a tag…" : ""}
          />
        </div>
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {suggestMode ? (initial._id ? "Suggest changes" : "Suggest") : submitLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
      </div>
    </form>
  );
}
