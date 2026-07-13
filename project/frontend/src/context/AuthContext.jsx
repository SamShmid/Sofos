import { createContext, useContext, useState } from "react";
import * as authService from "../services/authService";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(
    () => JSON.parse(localStorage.getItem("user")) || null
  );

  function persist({ token, user }) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    setUser(user);
  }

  const login = (c) => authService.login(c).then(persist);
  const register = (c) => authService.register(c).then(persist);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  // Writers can create/edit/delete; readers are view-only.
  const isWriter = user?.role === "writer";

  return (
    <AuthContext.Provider value={{ user, isWriter, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
