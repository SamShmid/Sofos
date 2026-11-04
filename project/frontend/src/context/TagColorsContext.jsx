import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { getTagColors } from "../services/tagsService";

const TagColorsContext = createContext({ maps: {}, refresh: () => {}, setLocal: () => {} });
export const useTagColors = () => useContext(TagColorsContext);

// Boot fetch of every tenant's tag-color map the caller can reach — optional,
// like getMe: a failed fetch just leaves maps empty (every tag falls back to
// its auto hash color), never blocks the app. `setLocal` is the popover's
// optimistic-update primitive (also used to revert on a failed PUT).
export function TagColorsProvider({ children }) {
  const { user } = useAuth();
  const [maps, setMaps] = useState({});

  const refresh = useCallback(() => getTagColors().then(setMaps).catch(() => {}), []);

  useEffect(() => {
    if (!user) {
      setMaps({});
      return;
    }
    refresh();
    // Deliberately keyed on user (login/logout), not refresh's own identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const setLocal = useCallback((tenantId, tag, color) => {
    setMaps((prev) => {
      const tenantMap = { ...(prev[tenantId] || {}) };
      if (color == null) delete tenantMap[tag];
      else tenantMap[tag] = color;
      return { ...prev, [tenantId]: tenantMap };
    });
  }, []);

  return (
    <TagColorsContext.Provider value={{ maps, refresh, setLocal }}>
      {children}
    </TagColorsContext.Provider>
  );
}
