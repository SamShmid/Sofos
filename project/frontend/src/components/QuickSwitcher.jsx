import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { search } from "../services/searchService";

// Render/navigation order — also the linear order arrow-key nav walks.
const GROUPS = [
  { key: "workspaces", label: "WORKSPACES" },
  { key: "projects", label: "PROJECTS" },
  { key: "tasks", label: "TASKS" },
  { key: "notes", label: "NOTES" },
  { key: "goals", label: "GOALS" },
];

function rowTitle(item) {
  return item.title ?? item.name;
}

// The muted "in <container>" line under each row. Workspaces have no
// container. A workspace-level task/note has no project — fall back to its
// (now-populated) workspace name instead of showing nothing. Goals populate
// whichever of project/workspace is set.
function rowContext(type, item) {
  if (type === "projects") return item.workspace?.name;
  if (type === "tasks" || type === "notes") return item.project?.name ?? item.workspace?.name;
  if (type === "goals") return (item.project ?? item.workspace)?.name;
  return null;
}

// P51 (Samuel's ruling): a task jump made FROM a board STAYS on that board
// when the target is reachable from it (project or workspace board alike) —
// the board's own arrival effect resolves whether the target is actually on
// screen (rollup) and bounces to the target's own board if it isn't.
// Everywhere else, a task lands on its home: its project, or — workspace-
// level, no project — its workspace. `item.workspace` may still arrive as a
// raw id (defensive: handles both the raw-id and the populated-object shape).
// P54: notes are no longer "home"-routed at all — they have their own page.
function rowPath(type, item, location) {
  if (type === "workspaces") return `/workspaces/${item._id}`;
  if (type === "projects") return `/projects/${item._id}`;
  if (type === "tasks") {
    if (location.pathname.endsWith("/board")) return location.pathname;
    return item.project ? `/projects/${item.project._id}` : `/workspaces/${item.workspace._id ?? item.workspace}`;
  }
  // P54: notes have their own route now — no home-page detour needed.
  if (type === "notes") return `/notes/${item._id}`;
  // goals: project's roadmap when it lives in a project, else its workspace's
  if (type === "goals") {
    return item.project
      ? `/projects/${item.project._id}/roadmap`
      : `/workspaces/${item.workspace._id}/roadmap`;
  }
  return "/";
}

// P46: task/note/goal selections carry an arrival-focus instruction so the
// destination page can scroll-to + flash the exact item. Router state only
// (never a URL param) — ephemeral by design, a refresh carries no state so
// it can't re-trigger. Workspace/project rows are the destination page
// itself, so no focus is needed there.
// P51: task focus also carries its home (project id, or workspace id when
// there's no project) — BoardPage's arrival effect needs it to bounce a
// stay-on-board jump whose target isn't actually on the current board.
function focusStateFor(type, item) {
  if (type === "tasks") {
    return {
      focus: {
        kind: "task",
        id: item._id,
        project: item.project?._id ?? null,
        workspace: item.workspace._id ?? item.workspace,
      },
    };
  }
  // P54: a note jump lands directly on the note's own page — no arrival-focus
  // instruction needed (there's no list/pane to scroll it into).
  if (type === "goals") return { focus: { kind: "goal", id: item._id } };
  return null;
}

export default function QuickSwitcher({ onClose }) {
  const inputRef = useRef(null);
  const previousActiveElement = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  // null = nothing searched yet (distinct from an empty-but-searched result set)
  const [results, setResults] = useState(null);
  const [highlighted, setHighlighted] = useState(0);

  // onClose is a fresh inline arrow from Layout each render; read it through a
  // ref (same trick as Modal.jsx) so the keydown effect below doesn't need it
  // in its dep array.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Debounced fetch. Deliberately never clears `results` to null on a new
  // keystroke — the previous (stale) results stay rendered through the debounce
  // window and the network round trip, then get replaced in one atomic
  // setResults call. A requestId guard drops any response that isn't the
  // latest in-flight request, so a slow earlier reply can never clobber a
  // faster later one.
  const requestId = useRef(0);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      requestId.current += 1; // invalidate any still-in-flight request
      setResults(null);
      setHighlighted(0);
      return;
    }
    const myId = ++requestId.current;
    const timer = setTimeout(() => {
      search(trimmed)
        .then((data) => {
          if (requestId.current !== myId) return; // superseded by a later keystroke
          setResults(data);
          setHighlighted(0);
        })
        .catch(() => {
          if (requestId.current !== myId) return;
          setResults({ workspaces: [], projects: [], tasks: [], notes: [], goals: [], total: 0 });
          setHighlighted(0);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  // Flat, linearly-ordered view of whatever's currently rendered — arrow keys
  // and Enter walk this, not the grouped `results` object. Memoized on
  // `results` (not `query`) so typing during the debounce window doesn't
  // thrash the keydown effect below.
  const flat = useMemo(() => {
    if (!results) return [];
    return GROUPS.flatMap(({ key }) => (results[key] || []).map((item) => ({ type: key, item })));
  }, [results]);

  function go(type, item) {
    const focus = focusStateFor(type, item);
    navigate(rowPath(type, item, location), focus ? { state: focus } : undefined);
    onCloseRef.current();
  }

  // Mount-once: capture focus origin, autofocus the input, restore focus on unmount.
  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      previousActiveElement.current?.focus?.();
    };
  }, []);

  // Keyboard nav. Re-registered whenever the visible list/highlight changes so
  // Arrow/Enter always act on what's on screen right now, never a stale list.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        // Only one focusable control in this palette (the input) — no other
        // element to trap focus between, just keep it pinned there.
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        if (flat.length === 0) return;
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        if (flat.length === 0) return;
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        const row = flat[highlighted];
        if (!row) return;
        e.preventDefault();
        go(row.type, row.item);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, highlighted]);

  let rowIndex = -1;

  return (
    <div className="qs-backdrop" onClick={onClose}>
      <div
        className="qs-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="qs-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workspaces, projects, tasks, notes, goals…"
          aria-label="Quick switcher search"
          autoComplete="off"
        />
        <div className="qs-results">
          {results && results.total === 0 && <div className="qs-empty">No matches.</div>}
          {results &&
            results.total > 0 &&
            GROUPS.map(({ key, label }) => {
              const items = results[key] || [];
              if (items.length === 0) return null;
              return (
                <div className="qs-group" key={key}>
                  <div className="qs-group-label">{label}</div>
                  <ul className="qs-row-list">
                    {items.map((item) => {
                      rowIndex += 1;
                      const i = rowIndex;
                      const context = rowContext(key, item);
                      return (
                        <li
                          key={item._id}
                          className={"qs-row" + (i === highlighted ? " qs-row-active" : "")}
                          onMouseEnter={() => setHighlighted(i)}
                          onClick={() => go(key, item)}
                        >
                          <span className="qs-row-title">{rowTitle(item)}</span>
                          {context && <span className="qs-row-context">in {context}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
