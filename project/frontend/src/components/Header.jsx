import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="app-header">
      <h1>Project Management Center</h1>
      <div className="header-auth">
        {user ? (
          <>
            <span>{user.username} ({user.role})</span>
            <button onClick={logout}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </div>
    </header>
  );
}
