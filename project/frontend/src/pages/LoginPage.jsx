import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(form);
      navigate(location.state?.from?.pathname || "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="auth-blurb">
        <div className="wordmark"><span className="wp"></span>Sofos</div>
        <p className="auth-statement">Workspaces, projects and roadmaps for people and their agents.</p>
        <ul className="auth-bullets">
          <li><span className="glyph">▦</span>Organize areas in workspaces and nested projects</li>
          <li><span className="glyph">◎</span>See it as lists, boards or roadmap trails</li>
          <li><span className="glyph">⇄</span>Share with people and AI agents — safely</li>
        </ul>
      </div>
      <div className="auth">
        <form onSubmit={handleSubmit}>
          <h2>Log in</h2>
          {sessionExpired && <p>Your session expired — please log in again.</p>}
          {error && <p role="alert">{error}</p>}

          <label>Username</label>
          <input value={form.username} onChange={set("username")} />

          <label>Password</label>
          <input type="password" value={form.password} onChange={set("password")} />

          <button type="submit" className="btn btn-primary" disabled={submitting}>Log in</button>
          <p>No account? <Link to="/register">Register</Link></p>
        </form>
      </div>
    </>
  );
}
