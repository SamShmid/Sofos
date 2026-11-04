import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canWrite, canSuggest } from "../utils/roles";
import { getSuggestions, approveSuggestion, rejectSuggestion, retractSuggestion, onProposal } from "../services/suggestionsService";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import FirstVisitTip from "./FirstVisitTip";
import { opChipText, suggestionParts, suggestionLine } from "../utils/suggestionText";
import { refineWords } from "../utils/noteDiff";

// Pending suggestions for a workspace, project, or superWorkspace (tenant-wide)
// container. No create form here — suggestions are proposed from the resource's
// own form (W4); this panel only lists, approves/rejects, or retracts them.
// Mirrors LinksSection's container/load pattern.
// `onChange` (optional, P33): fired after any successful approve/reject/retract
// so an outer view (ReviewSummary's roll-up, or the mount's own task/note
// lists) can refetch. Undefined by default — every other mount keeps its
// existing behavior.
//
// Phase 52: fetches every status (not just pending) — the approver queue below
// still filters to pending only, but the suggester-view swap (ruling 13) needs
// its own resolved history too, and one fetch is simpler than two.
export default function SuggestionsPanel({ container, effectiveRole, onChange }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  // Per-suggestion-id approve failure (409: name collision or can't-apply) —
  // rendered inside that suggestion's own card instead of only a toast.
  const [approveErrors, setApproveErrors] = useState({});

  const loadSuggestions = () =>
    getSuggestions(container, "all")
      .then((data) => { setSuggestions(data); setError(null); setLoaded(true); })
      .catch(() => { setError("Could not load suggestions"); setLoaded(true); });

  useEffect(() => {
    let ignore = false;
    getSuggestions(container, "all")
      .then((data) => { if (!ignore) { setSuggestions(data); setError(null); setLoaded(true); } })
      .catch(() => { if (!ignore) { setError("Could not load suggestions"); setLoaded(true); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.workspace, container.project, container.superWorkspace]);

  // A proposal made anywhere on the page (a task row's checkbox in Suggesting
  // mode, the note pane, a link/file section) lands its card here immediately
  // instead of on the next reload.
  useEffect(() => onProposal(() => { loadSuggestions(); }), [container.workspace, container.project, container.superWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearApproveError(id) {
    setApproveErrors((e) => {
      if (!(id in e)) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  async function handleApprove(id) {
    try {
      try {
        await approveSuggestion(id);
      } catch (err) {
        if (err.code !== "INCOMPLETE_SUBTASKS") throw err;
        const ok = await confirm({
          title: "Complete every subtask?",
          message: `${err.message} Complete all of them with the parent task?`,
          confirmLabel: "Yes, complete all",
          cancelLabel: "No",
        });
        if (!ok) return;
        await approveSuggestion(id, { completeSubtasks: true });
      }
      clearApproveError(id);
      await loadSuggestions();
      onChange?.();
    } catch (err) {
      if (err.status === 409) {
        setApproveErrors((e) => ({ ...e, [id]: err.message }));
      } else {
        toast.error(err.message);
      }
      await loadSuggestions();
    }
  }

  async function handleReject(id) {
    try {
      await rejectSuggestion(id);
      clearApproveError(id);
      await loadSuggestions();
      onChange?.();
    } catch (err) {
      toast.error(err.message);
      await loadSuggestions();
    }
  }

  async function handleRetract(id) {
    try {
      await retractSuggestion(id);
      clearApproveError(id);
      await loadSuggestions();
      onChange?.();
    } catch (err) {
      toast.error(err.message);
      await loadSuggestions();
    }
  }

  // Ruling 13: canWrite is the ONLY gate — a plain reader is not an approver
  // either, and gets the same "own list" swap (empty, for them) instead of a
  // review queue full of other people's pending work they can't act on.
  const approver = canWrite(effectiveRole);
  const suggestor = canSuggest(effectiveRole);

  const pending = suggestions.filter((s) => s.status === "pending");
  const own = suggestions.filter((s) => s.proposedBy?._id === user.id);
  const ownPending = own.filter((s) => s.status === "pending");
  const ownResolved = own.filter((s) => s.status !== "pending").slice(0, 10);
  const ownVisible = [...ownPending, ...ownResolved];

  const visibleCount = approver ? pending.length : ownVisible.length;
  if (!error && visibleCount === 0 && !suggestor) return null;

  // First-visit tip (P32): only once there's actually something to review,
  // and only for the viewer who can act on it — a suggester with nothing
  // pending yet has nothing to be tipped about.
  const showReviewTip = loaded && !error && pending.length > 0 && approver;

  if (!approver) {
    return (
      <div>
        <div className="section-label">My suggestions{loaded && !error ? ` · ${ownVisible.length}` : ""}</div>
        {error && <p role="alert">{error}</p>}
        {loaded && !error && (
          ownVisible.length === 0 ? (
            <p className="shared-meta">No pending suggestions.</p>
          ) : (
            <ul className="row-list">
              {ownVisible.map((s) => (
                <li key={s._id}>
                  <span className="fname">{suggestionLine(s)}</span>
                  <span className={`status-chip ${s.status}`}>{s.status}</span>
                  {s.status === "pending" && (
                    <button type="button" className="btn btn-ghost" onClick={() => handleRetract(s._id)}>Retract</button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    );
  }

  const cards = groupHunkSuggestions(pending);

  return (
    <div>
      {showReviewTip && (
        <FirstVisitTip tipId="review">Someone proposed this — approve applies it as theirs.</FirstVisitTip>
      )}
      <div className="section-label">Needs your review{loaded && !error ? ` · ${pending.length}` : ""}</div>
      {error && <p role="alert">{error}</p>}
      {loaded && !error && (
        cards.length === 0 ? (
          <p className="shared-meta">No pending suggestions.</p>
        ) : (
          cards.map((card) =>
            card.kind === "group" ? (
              <GroupedHunkCard key={card.key} members={card.members} navigate={navigate} />
            ) : (
              <SuggestionCard
                key={card.suggestion._id}
                suggestion={card.suggestion}
                canApprove={approver}
                isOwn={card.suggestion.proposedBy?._id === user.id}
                error={approveErrors[card.suggestion._id]}
                onApprove={handleApprove}
                onReject={handleReject}
                onRetract={handleRetract}
              />
            )
          )
        )
      )}
    </div>
  );
}

// Groups pending Note-update suggestions that share (resource + proposedBy)
// and carry a contentHunk into ONE card (mock5's "edits in N places" +
// View changes) — everything else (creates/deletes, non-hunk updates, a
// hunk group of exactly one) stays an individual card. Preserves the
// server's newest-first order: a group's position is wherever its first
// member appeared.
function groupHunkSuggestions(suggestions) {
  const groupKey = (s) => `${s.resource?._id || s.resource}:${s.proposedBy?._id}`;
  const isHunkUpdate = (s) => s.resourceType === "Note" && s.op === "update" && !!s.payload?.contentHunk;

  const membersByKey = new Map();
  for (const s of suggestions) {
    if (!isHunkUpdate(s)) continue;
    const key = groupKey(s);
    if (!membersByKey.has(key)) membersByKey.set(key, []);
    membersByKey.get(key).push(s);
  }

  const seen = new Set();
  const cards = [];
  for (const s of suggestions) {
    if (!isHunkUpdate(s)) {
      cards.push({ kind: "single", suggestion: s });
      continue;
    }
    const key = groupKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    const members = membersByKey.get(key);
    if (members.length > 1) {
      cards.push({ kind: "group", key, members });
    } else {
      cards.push({ kind: "single", suggestion: s });
    }
  }
  return cards;
}

function initials(name) {
  return (name || "").slice(0, 2).toUpperCase();
}

function TargetLine({ op, type, label }) {
  return (
    <p className="sugg2-target">
      {op === "create" && "new "}
      {op === "delete" && "delete "}
      <span className="rtype">{type}</span> <b>"{label}"</b>
    </p>
  );
}

// Plain-language field list (ruling 14: colons, only what changes) rendered
// as `.delta` — mirrors mock5's "key: value · key: value" line. A field
// without a colon (formatFieldList's "mark complete"/"mark incomplete" action
// phrases) renders as plain text instead of a dk/value pair.
function Delta({ fields }) {
  if (fields.length === 0) return null;
  return (
    <p className="delta">
      {fields.map((line, i) => {
        const idx = line.indexOf(": ");
        return (
          <span key={i}>
            {i > 0 && <span className="sep">·</span>}
            {idx === -1 ? line : <><span className="dk">{line.slice(0, idx)}:</span> {line.slice(idx + 2)}</>}
          </span>
        );
      })}
    </p>
  );
}

// Inline mini-diff (mock5 `.diff`) for a single contiguous content hunk —
// before/after render as context, one line per "\n"-joined segment (empty
// strings, e.g. document-start/-end, contribute no rows). A genuine change
// (both old and new present) flows as ONE block with word-level del/add
// marks (P52.1 — Samuel: a line-append rendering as full del-line + full
// add-line "simply isn't correct"); a pure insert or delete (only one side
// present) keeps the line-per-row rendering, since there's no old/new pair
// to refine against.
function HunkDiff({ hunk }) {
  const lines = (text) => (text ? text.split("\n") : []);
  const changed = hunk.old !== "" && hunk.new !== "";
  return (
    <div className="diff">
      {lines(hunk.before).map((l, i) => <div key={`b${i}`} className="diff-line ctx">{l}</div>)}
      {changed ? (
        <div className="diff-line chg">
          {refineWords(hunk.old, hunk.new).map((seg, i) =>
            seg.type === "same" ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <span key={i} className={seg.type === "del" ? "del" : "add"}>{seg.text}</span>
            )
          )}
        </div>
      ) : (
        <>
          {lines(hunk.old).map((l, i) => <div key={`o${i}`} className="diff-line del">{l}</div>)}
          {lines(hunk.new).map((l, i) => <div key={`n${i}`} className="diff-line add">{l}</div>)}
        </>
      )}
      {lines(hunk.after).map((l, i) => <div key={`a${i}`} className="diff-line ctx">{l}</div>)}
    </div>
  );
}

function SuggestionCard({ suggestion, canApprove, isOwn, error, onApprove, onReject, onRetract }) {
  const { op, type, label, fields, hunk } = suggestionParts(suggestion);
  const name = suggestion.proposedBy?.username || "Unknown";
  return (
    <div className="sugg2">
      <div className="sugg2-head">
        <span className="avatar">{initials(name)}</span>
        <span className="who-name">{name}</span>
        <span className="who-time">{new Date(suggestion.createdAt).toLocaleDateString()}</span>
        <span className="chip-op">{opChipText(op, suggestion.resourceType)}</span>
      </div>
      <TargetLine op={op} type={type} label={label} />
      {hunk ? (
        <HunkDiff hunk={hunk} />
      ) : fields.length > 0 ? (
        <Delta fields={fields} />
      ) : op === "update" ? (
        <p className="delta">no effective changes</p>
      ) : null}
      {error && <p role="alert">⚠ {error}</p>}
      <div className="sugg2-actions">
        {canApprove && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => onApprove(suggestion._id)}>Approve</button>
            <button type="button" className="btn btn-ghost" onClick={() => onReject(suggestion._id)}>Reject</button>
          </>
        )}
        {isOwn && (
          <button type="button" className="btn btn-ghost" onClick={() => onRetract(suggestion._id)}>Retract</button>
        )}
      </div>
    </div>
  );
}

// A note edited in N places by the same person → one card, no per-edit
// Approve/Reject (Samuel: decisions happen per-edit at the note itself).
// P54: View changes lands directly on the note's own route — every note
// (project-scoped or workspace-level) has one now, so there's no container
// detour or dead-end case to render an explanatory line for.
function GroupedHunkCard({ members, navigate }) {
  const first = members[0];
  const { op, type, label } = suggestionParts(first);
  const name = first.proposedBy?.username || "Unknown";
  const noteId = first.resource?._id || first.resource;

  return (
    <div className="sugg2">
      <div className="sugg2-head">
        <span className="avatar">{initials(name)}</span>
        <span className="who-name">{name}</span>
        <span className="who-time">{new Date(first.createdAt).toLocaleDateString()}</span>
        <span className="chip-op">{opChipText(op, first.resourceType)}</span>
      </div>
      <TargetLine op={op} type={type} label={label} />
      <p className="delta"><span className="summary-chip">edits in {members.length} places</span></p>
      <div className="sugg2-actions">
        <button type="button" className="btn btn-primary" onClick={() => navigate(`/notes/${noteId}`)}>
          View changes
        </button>
        <span className="sugg2-hint">opens the note with each edit highlighted, approve or reject each one</span>
      </div>
    </div>
  );
}
