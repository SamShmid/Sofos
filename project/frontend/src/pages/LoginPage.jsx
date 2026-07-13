import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await login(form);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth">
      <form onSubmit={handleSubmit}>
        <h2>Log in</h2>
        {error && <p role="alert">{error}</p>}

        <label>Username</label>
        <input value={form.username} onChange={set("username")} />

        <label>Password</label>
        <input type="password" value={form.password} onChange={set("password")} />

        <button type="submit">Log in</button>
        <p>No account? <Link to="/register">Register</Link></p>
      </form>
    </div>
  );
}
