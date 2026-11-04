import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// onMenuToggle/open: the mobile drawer toggle. Only rendered when Layout passes it
// (desktop callers of this component, if any ever appear, get no hamburger).
// onSearchClick: opens the QuickSwitcher — the discoverability path for Cmd-K,
// which matters most on mobile where there's no reliable physical shortcut.
export default function Header({ onMenuToggle, open, onSearchClick }) {
  const { user, logout } = useAuth();
  const initials = user ? user.username.slice(0, 2).toUpperCase() : "";

  return (
    <header className="app-header">
      {onMenuToggle && (
        <button
          className="menu-btn"
          aria-label="Menu"
          title="Toggle navigation"
          aria-expanded={open}
          onClick={onMenuToggle}
        >
          ☰
        </button>
      )}
      <Link to="/" className="wordmark">
        <span className="wp"></span>Sofos
      </Link>
      <div className="header-auth">
        {user ? (
          <>
            <button className="qs-trigger" aria-label="Search (⌘K)" title="Search (⌘K)" onClick={onSearchClick}>⌕</button>
            {/* Username links to Settings — that's where the share code lives */}
            <Link to="/settings" title={user.username}>{user.username}{user.isAgent ? " (agent)" : ""}</Link>
            {/* Avatar is also a Settings link (P45 audit #2 — minimal fix, no menu) */}
            <Link to="/settings" className="avatar" title="Settings">{initials}</Link>
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
