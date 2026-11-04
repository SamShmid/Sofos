import { useEffect, useState } from "react";
import { getMySuggestions, retractSuggestion } from "../services/suggestionsService";
import { useToast } from "../context/ToastContext";
import { suggestionLine } from "../utils/suggestionText";

function containerLabel(s) {
  if (s.project && typeof s.project === "object") return s.project.name;
  if (s.workspace && typeof s.workspace === "object") return s.workspace.name;
  return "Tenant root";
}

// Your own proposals, wherever they live — the counterpart to ReviewSummary
// (which rolls up what YOU need to review). Default view: every pending
// proposal plus your last 10 resolved ones, no pagination this phase. Absent
// entirely when you have nothing to show — a suggester with zero proposals
// gets no empty section cluttering HomePage.
export default function MySuggestions() {
  const toast = useToast();
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    getMySuggestions("all")
      .then((data) => { setSuggestions(data); setError(null); })
      .catch(() => setError("Could not load your suggestions"));

  useEffect(() => {
    let ignore = false;
    getMySuggestions("all")
      .then((data) => { if (!ignore) { setSuggestions(data); setError(null); } })
      .catch(() => { if (!ignore) setError("Could not load your suggestions"); });
    return () => { ignore = true; };
  }, []);

  // Mirrors SuggestionsPanel's own handleRetract — no confirm step there
  // either, so none added here for consistency.
  async function handleRetract(id) {
    try {
      await retractSuggestion(id);
      await load();
    } catch (err) {
      toast.error(err.message);
      await load();
    }
  }

  if (error) {
    return (
      <>
        <div className="section-label">My suggestions</div>
        <p role="alert">{error}</p>
      </>
    );
  }

  if (!suggestions || suggestions.length === 0) return null;

  const pending = suggestions.filter((s) => s.status === "pending");
  const resolved = suggestions.filter((s) => s.status !== "pending").slice(0, 10);
  const visible = [...pending, ...resolved];

  return (
    <>
      <div className="section-label">My suggestions · {visible.length}</div>
      <ul className="row-list">
        {visible.map((s) => (
          <li key={s._id}>
            <span className="fname">{suggestionLine(s)}</span>
            <span className="meta">{containerLabel(s)}</span>
            <span className={`status-chip ${s.status}`}>{s.status}</span>
            {s.status === "pending" && (
              <button type="button" className="btn btn-ghost" onClick={() => handleRetract(s._id)}>Retract</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
