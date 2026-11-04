import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useRefresh } from "../context/RefreshContext";
import { getWorkspaces } from "../services/workspacesService";
import { getGoalsSummary } from "../services/goalsService";
import { getMyInvites } from "../services/membershipsService";
import { getAttention } from "../services/meService";
import { dueBucket, dueState, formatDue } from "../utils/due";
import ReviewSummary from "../components/ReviewSummary";
import MySuggestions from "../components/MySuggestions";

const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

// One dashboard row: title links to where the work lives, chips mirror
// TaskItem/GoalNode as-is. `href` is precomputed by the caller since tasks
// and goals resolve to different route shapes (project/workspace vs roadmap).
function AttentionRow({ item, href }) {
  const state = dueState(item.dueAt, item.dueHasTime);
  return (
    <div className="attention-row">
      <Link to={href}>{item.title}</Link>
      {item.dueAt && <span className={"due-chip" + (state ? " " + state : "")}>{formatDue(item.dueAt, item.dueHasTime)}</span>}
      {item.priority && <span className={"prio-chip " + item.priority}>{PRIORITY_LABEL[item.priority]}</span>}
    </div>
  );
}

const taskHref = (t) => (t.project ? `/projects/${t.project._id}` : `/workspaces/${t.workspace._id}`);
const goalHref = (g) => (g.project ? `/projects/${g.project._id}/roadmap` : `/workspaces/${g.workspace._id}/roadmap`);

// The "/" landing: everything you own on top, everything shared with you below.
// Workspaces are the smallest shared container, so project access always arrives
// through a visible workspace.
export default function HomePage() {
  const { user } = useAuth();
  const { refreshKey } = useRefresh();
  const [workspaces, setWorkspaces] = useState(null);
  const [status, setStatus] = useState("loading");
  // Roadmap thumbnails for owned workspaces — optional, never blocks the page.
  const [goalsSummary, setGoalsSummary] = useState({});
  // Pending invites banner — humans only, agents accept via API instead.
  const [inviteCount, setInviteCount] = useState(0);
  // Needs-attention dashboard — optional like goalsSummary above, null while
  // loading/on error so the panel just stays absent rather than flashing
  // an empty state.
  const [attention, setAttention] = useState(null);

  useEffect(() => {
    let ignore = false;
    getWorkspaces()
      .then((ws) => { if (!ignore) { setWorkspaces(ws); setStatus("ready"); } })
      .catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
  }, [refreshKey]);

  useEffect(() => {
    let ignore = false;
    getGoalsSummary()
      .then((summary) => { if (!ignore) setGoalsSummary(summary); })
      .catch(() => { if (!ignore) setGoalsSummary({}); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (user?.isAgent) return;
    let ignore = false;
    getMyInvites()
      .then((invites) => { if (!ignore) setInviteCount(invites.length); })
      .catch(() => { if (!ignore) setInviteCount(0); });
    return () => { ignore = true; };
  }, [user, refreshKey]);

  useEffect(() => {
    let ignore = false;
    getAttention()
      .then((a) => { if (!ignore) setAttention(a); })
      .catch(() => { if (!ignore) setAttention(null); });
    return () => { ignore = true; };
  }, [refreshKey]);

  if (status === "loading") return <p className="loading">Loading…</p>;
  if (status === "error") return <p>Could not load your home page. <Link to="/">Try again</Link></p>;

  const sharedItems = workspaces.shared.length;

  // Three due buckets are naturally exclusive; High priority always shows its
  // items too even when already listed above (Samuel's explicit duplicate rule).
  const attentionTasks = attention?.tasks || [];
  const attentionGoalCandidates = attention?.goals || [];
  const overdueTasks = attentionTasks.filter((t) => dueBucket(t.dueAt, t.dueHasTime) === "overdue");
  const todayTasks = attentionTasks.filter((t) => dueBucket(t.dueAt, t.dueHasTime) === "today");
  const weekTasks = attentionTasks.filter((t) => dueBucket(t.dueAt, t.dueHasTime) === "week");
  const highTasks = attentionTasks.filter((t) => t.priority === "high");
  const taskGroups = [
    { key: "overdue", label: "Overdue", items: overdueTasks },
    { key: "today", label: "Due today", items: todayTasks },
    { key: "week", label: "This week", items: weekTasks },
    { key: "high", label: "High priority", items: highTasks },
  ];
  const attentionGoals = attentionGoalCandidates.filter(
    (g) => dueBucket(g.dueAt, g.dueHasTime) !== null || g.priority === "high"
  );
  const hasAttention = taskGroups.some((g) => g.items.length > 0) || attentionGoals.length > 0;

  return (
    <section>
      <div className="page-head">
        <h1>Overview</h1>
      </div>

      {attention && (hasAttention ? (
        <div className="panel-band">
          <div className="panel-section">
            <div className="section-label">Needs attention</div>
            {taskGroups.map((g) => g.items.length > 0 && (
              <div key={g.key}>
                <div className="section-label">{g.label}</div>
                {g.items.map((t) => <AttentionRow key={t._id} item={t} href={taskHref(t)} />)}
              </div>
            ))}
          </div>
          {attentionGoals.length > 0 && (
            <div className="panel-section">
              <div className="section-label">Goals</div>
              {attentionGoals.map((g) => <AttentionRow key={g._id} item={g} href={goalHref(g)} />)}
            </div>
          )}
        </div>
      ) : (
        <p className="attention-status"><span aria-hidden="true">·</span> Nothing needs attention</p>
      ))}

      {inviteCount > 0 && (
        <p className="invite-banner">
          You have {inviteCount} pending invite{inviteCount === 1 ? "" : "s"} —{" "}
          <Link to="/settings">review them in Settings</Link>
        </p>
      )}

      <div className="section-label" data-tour="overview-workspaces">My workspaces · {workspaces.owned.length}</div>
      {workspaces.owned.length === 0 ? (
        <div className="empty">
          <span className="glyph">◎</span>
          <p>No workspaces yet.</p>
        </div>
      ) : (
        <div className="grid">
          {workspaces.owned.map((w) => {
            const summary = goalsSummary[w._id];
            return (
              <Link
                key={w._id}
                to={`/workspaces/${w._id}`}
                className="pcard"
                {...(w.isDefault ? { "data-tour": "home-workspace" } : {})}
              >
                <h3 title={w.name}>{w.name}</h3>
                {w.description && <p>{w.description}</p>}
                {summary && (
                  <>
                    <span className="mini-route">
                      {Array.from({ length: summary.total }).map((_, i) => (
                        <i key={i} className={i < summary.completed ? "done" : ""} />
                      ))}
                    </span>
                    <span className="mini-label">{summary.completed}/{summary.total} goals</span>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Aggregated review queue (P33): pending counts across every container
          the caller owns, not just the tenant root — see ReviewSummary. */}
      <ReviewSummary
        ownsTenant={workspaces.owned.length > 0}
        superWorkspace={workspaces.owned[0]?.superWorkspace}
      />

      <div className="section-label">Shared with you · {sharedItems}</div>
      {sharedItems === 0 ? (
        <div className="empty">
          <span className="glyph">◎</span>
          <p>Nothing shared with you yet. Others can share by adding your share code.</p>
        </div>
      ) : (
        <div className="grid">
          {workspaces.shared.map((w) => (
            <Link key={w._id} to={`/workspaces/${w._id}`} className="pcard">
              <h3 title={w.name}>{w.name}</h3>
              <p>shared by {w.superWorkspace?.name}</p>
              <span className={`role-chip ${w.effectiveRole}`}>{w.effectiveRole}</span>
            </Link>
          ))}
        </div>
      )}

      {/* My own proposals, wherever they live (P33) — absent entirely when empty. */}
      <MySuggestions />
    </section>
  );
}
