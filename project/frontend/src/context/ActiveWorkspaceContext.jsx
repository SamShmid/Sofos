import { createContext, useContext, useState, useCallback, useMemo } from "react";

const ActiveWorkspaceContext = createContext(null);
export const useActiveWorkspace = () => useContext(ActiveWorkspaceContext);

// Project/Roadmap/Board routes live outside /workspaces/:id, so Sidebar can't
// tell which workspace owns the open project from the URL alone (NavLink's own
// path match). Those pages report the owning workspace here once loaded, and
// clear it again on unmount, so Sidebar can highlight the right row.
//
// setActiveWorkspaceId accepts either form:
//   - a bare id (string) — the original P29 contract, still used by every
//     caller that only has the id (e.g. ProjectPage's populated `workspace` is
//     `{_id, name}` only, no ancestors) — highlight only, no trail.
//   - { id, name, ancestors } — the P31 addition, for callers holding the full
//     workspace payload (RoadmapPage/BoardPage in workspace mode: `container`
//     IS the workspace, with its populated root-first `ancestors`). `name` is
//     the active workspace's own name, needed because `ancestors` (matching
//     the Breadcrumbs convention) excludes the workspace itself — Sidebar
//     appends it to build the full root-to-leaf trail.
//
// STABILITY IS LOAD-BEARING: consumer pages list setActiveWorkspaceId in
// effect dependency arrays. An unstable identity (plain function + fresh
// value object per render) made every SPA transition into those pages an
// infinite setState loop ("Maximum update depth exceeded") that starved the
// incoming page's render — the "clicks do nothing until refresh" bug. The
// setter is therefore useCallback([]) and returns the PREVIOUS state object
// when the incoming value is equivalent, and the context value is memoized.
export function ActiveWorkspaceProvider({ children }) {
  const [active, setActive] = useState(null); // null | { id, name, ancestors }

  const setActiveWorkspaceId = useCallback((value) => {
    setActive((prev) => {
      if (value == null) return prev === null ? prev : null;
      if (typeof value === "object") {
        const next = { id: value.id, name: value.name ?? null, ancestors: value.ancestors || [] };
        const sameAncestors =
          prev?.ancestors &&
          prev.ancestors.length === next.ancestors.length &&
          prev.ancestors.every((a, i) => String(a._id ?? a) === String(next.ancestors[i]._id ?? next.ancestors[i]));
        return prev && prev.id === next.id && prev.name === next.name && sameAncestors ? prev : next;
      }
      return prev && prev.id === value && prev.name === null && prev.ancestors === null
        ? prev
        : { id: value, name: null, ancestors: null };
    });
  }, []);

  const value = useMemo(() => {
    const activeWorkspaceId = active?.id ?? null;
    // Full root-to-leaf trail (root-first, leaf last) — only available when the
    // object form was used; null otherwise, so Sidebar knows to fall back to
    // highlight-only.
    const activeWorkspaceTrail =
      active?.ancestors && active?.name
        ? [...active.ancestors, { _id: active.id, name: active.name }]
        : null;
    return { activeWorkspaceId, activeWorkspaceTrail, setActiveWorkspaceId };
  }, [active, setActiveWorkspaceId]);

  return <ActiveWorkspaceContext.Provider value={value}>{children}</ActiveWorkspaceContext.Provider>;
}
