import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import * as authService from "../services/authService";
import { useToast } from "../context/ToastContext";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ username: "", password: "", isAgent: false });
  const [created, setCreated] = useState(null); // the new account, held to show the confirmation screen
  const [agentSetup, setAgentSetup] = useState(null); // isAgent handoff block, for the download
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const user = await register(form);
      setAgentSetup(authService.takeAgentSetup());
      setCreated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadGuide() {
    setDownloading(true);
    try {
      await authService.downloadAgentSetup({ username: created.username, password: form.password, agentSetup });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading(false);
    }
  }

  // Post-signup: a compact confirmation, not a share-code reveal (P32 — the
  // code moves to Settings, where it's always been available; the tour takes
  // over from here). Agent accounts still get their setup-download step first
  // — that flow (P19) is untouched, just the surrounding copy is shorter.
  if (created) {
    return (
      <div className="auth">
        <div className="auth-reveal">
          <h2>You're all set, {created.username}!</h2>
          <p>Your account is ready — find your share code anytime in Settings.</p>
          {created.isAgent && agentSetup && (
            <button className="btn btn-primary" onClick={handleDownloadGuide} disabled={downloading}>
              Download agent setup guide
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate("/")}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form onSubmit={handleSubmit}>
        <h2>Register</h2>
        {error && <p role="alert">{error}</p>}

        <label>Username</label>
        <input value={form.username} onChange={set("username")} />

        <label>Password</label>
        <input type="password" value={form.password} onChange={set("password")} />

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.isAgent}
            onChange={(e) => setForm({ ...form, isAgent: e.target.checked })}
          />
          Register as an agent account
        </label>
        <p className="hint">For AI/automation accounts — humans leave this off.</p>

        <button type="submit" className="btn btn-primary" disabled={submitting}>Register</button>
        <p>Have an account? <Link to="/login">Log in</Link></p>
      </form>
    </div>
  );
}
