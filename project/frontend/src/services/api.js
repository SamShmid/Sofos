const BASE_URL = (import.meta.env.VITE_API_URL || "") + "/api";

// Thin fetch wrapper: attaches the token, throws on errors, unwraps JSON.
export async function request(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(BASE_URL + path, {
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}
