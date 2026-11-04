import { request, BASE_URL, throwIfError } from "./api";

// Backend replies { data: <user>, token, agentSetup? } (agentSetup only for isAgent
// registrations). AuthContext's persist() only threads {token, user} through to the
// page, so stash agentSetup here — RegisterPage reads it right after register()
// resolves, without a second network round-trip or touching AuthContext.
let lastAgentSetup = null;

export const takeAgentSetup = () => {
  const setup = lastAgentSetup;
  lastAgentSetup = null;
  return setup;
};

// Backend replies { data: <user>, token }; reshape to { token, user } for the context.
export const register = (data) =>
  request("/auth/register", { method: "POST", body: JSON.stringify(data) })
    .then((r) => {
      lastAgentSetup = r.agentSetup || null;
      return { token: r.token, user: r.data };
    });

export const login = (data) =>
  request("/auth/login", { method: "POST", body: JSON.stringify(data) })
    .then((r) => ({ token: r.token, user: r.data }));

export const deleteAccount = (password) =>
  request("/auth/me", { method: "DELETE", body: JSON.stringify({ password }) });

export const logout = () => request("/auth/logout", { method: "POST" });

// Guide body is markdown, not JSON — raw fetch (mirrors attachmentsService's
// download pattern) rather than the JSON `request()` helper.
async function fetchGuideText() {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}/guide`, {
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });
  await throwIfError(res);
  return res.text();
}

// Builds the one self-contained agent setup file (form-state password + the live
// guide) and triggers a browser download via Blob + a temporary <a download>.
export async function downloadAgentSetup({ username, password, agentSetup }) {
  const guide = await fetchGuideText();
  const header = [
    "# Sofos agent setup",
    "",
    `- Base URL: ${window.location.origin}/api`,
    `- Username: ${username}`,
    `- Password: ${password}`,
    `- Share code: ${agentSetup.shareCode}`,
    "",
    agentSetup.firstSteps,
  ].join("\n");

  const blob = new Blob([`${header}\n\n---\n\n${guide}`], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sofos-agent-setup-${username}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
