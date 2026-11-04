import { createContext, useCallback, useContext, useState } from "react";

const RefreshContext = createContext(null);
export const useRefresh = () => useContext(RefreshContext);

export function RefreshProvider({ children }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <RefreshContext.Provider value={{ refreshKey, bump }}>
      {children}
    </RefreshContext.Provider>
  );
}
