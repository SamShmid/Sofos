import { createContext, useContext, useEffect, useState } from "react";
import * as authService from "../services/authService";
import { setOnUnauthorized } from "../services/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    // Pre-tenancy sessions stored a global `role` and no shareCode; their token
    // shape is stale too, so treat them as logged out and start clean.
    try {
      const stored = JSON.parse(localStorage.getItem("user"));
      if (!stored || stored.role !== undefined || !stored.shareCode) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        return null;
      }
      return stored;
    } catch {
      return null;
    }
  });
  const [sessionExpired, setSessionExpired] = useState(false);

  // Registered once: when api.js sees a dead-session 401, log out locally so
  // RequireAuth bounces to /login instead of the app stranding on failed calls.
  useEffect(() => {
    setOnUnauthorized(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setUser(null);
      setSessionExpired(true);
    });
  }, []);

  function persist({ token, user }) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    setUser(user);
    return user;
  }

  const login = (c) => authService.login(c).then((r) => { setSessionExpired(false); return persist(r); });
  const register = (c) => authService.register(c).then((r) => { setSessionExpired(false); return persist(r); });

  function logout() {
    // Best-effort: the UI never blocks on the network to log out locally.
    authService.logout().catch(() => {});
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  // No global writer/reader anymore: what you can do is per-resource, answered by
  // each API response's effectiveRole. The context only knows WHO you are.
  return (
    <AuthContext.Provider value={{ user, login, register, logout, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}
