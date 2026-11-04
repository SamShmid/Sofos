import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getReviewSummary } from "../services/suggestionsService";
import SuggestionsPanel from "./SuggestionsPanel";

// A row's container tells us its kind: both null is the tenant root, otherwise
// exactly one of workspace/project is set (mirrors the container modes used
// everywhere else — getSuggestions, createSuggestion).
const isRootRow = (row) => !row.workspace && !row.project;

function RollupRow({ row, expanded, onToggleRoot }) {
  if (isRootRow(row)) {
    return (
      <div className="rollup-row">
        <div className="rr-what">
          <span className="rr-path">Tenant root</span>
          <span className="rr-context">directly in your tenant</span>
        </div>
        <span className="rr-count">{row.count} pending</span>
        <button type="button" className="btn btn-ghost" onClick={onToggleRoot}>
          {expanded ? "Hide" : "Review"}
        </button>
      </div>
    );
  }

  const isProject = Boolean(row.project);
  const target = isProject ? row.project : row.workspace;

  return (
    <div className="rollup-row">
      <div className="rr-what">
        <span className="rr-path">{target.name}</span>
        <span className="rr-context">{isProject ? "project" : "workspace"}</span>
      </div>
      <span className="rr-count">{row.count} pending</span>
      <Link className="btn btn-ghost" to={isProject ? `/projects/${target.id}` : `/workspaces/${target.id}`}>
        Review
      </Link>
    </div>
  );
}

// Replaces the P27 tenant-root-only SuggestionsPanel mount on HomePage: that
// slice was structurally ~always empty since real proposals land inside a
// workspace or project, never the tenant root directly (P33 fleet finding).
// Aggregates pending counts across every container the caller owns, one
// jump-link per row — except the tenant-root row, which has no container page
// of its own, so it expands the same SuggestionsPanel (reused, not forked)
// inline instead. Owner-only: tenant-wide writers manage containers directly,
// so nothing rolls up for them (mirrors the old panel's own scoping).
export default function ReviewSummary({ ownsTenant, superWorkspace }) {
  const [summary, setSummary] = useState(null); // { data, total } once loaded
  const [error, setError] = useState(null);
  const [rootExpanded, setRootExpanded] = useState(false);

  useEffect(() => {
    if (!ownsTenant) return;
    let ignore = false;
    getReviewSummary()
      .then((s) => { if (!ignore) { setSummary(s); setError(null); } })
      .catch(() => { if (!ignore) setError("Could not load your review queue"); });
    return () => { ignore = true; };
  }, [ownsTenant]);

  // Approving/rejecting inside the expanded tenant-root panel below leaves the
  // roll-up counts stale — refetch when that panel reports a change.
  const refetch = () =>
    getReviewSummary()
      .then((s) => { setSummary(s); setError(null); })
      .catch(() => setError("Could not load your review queue"));

  if (!ownsTenant) return null;

  if (error) {
    return (
      <>
        <div className="section-label">Needs your review</div>
        <p role="alert">{error}</p>
      </>
    );
  }

  if (!summary) return null; // loading — quiet, no flash

  const hasRoot = summary.data.some(isRootRow);

  return (
    <>
      <div className="section-label">
        Needs your review {summary.total > 0 && <span className="count-badge">{summary.total}</span>}
      </div>
      {summary.total === 0 ? (
        <p className="shared-meta">All clear — nothing waiting on your review.</p>
      ) : (
        <div className="rollup">
          {summary.data.map((row) => (
            <RollupRow
              key={row.project?.id || row.workspace?.id || "root"}
              row={row}
              expanded={rootExpanded}
              onToggleRoot={() => setRootExpanded((v) => !v)}
            />
          ))}
        </div>
      )}
      {hasRoot && rootExpanded && (
        <SuggestionsPanel container={{ superWorkspace }} effectiveRole="owner" onChange={refetch} />
      )}
    </>
  );
}
