export const BASE_URL = (import.meta.env.VITE_API_URL || "") + "/api";

// Registered by AuthContext; fired when a session dies mid-app so the UI can
// log out cleanly instead of stranding the user on 401s.
let onUnauthorized = null;
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}

// Shared with raw-fetch callers that bypass `request()` (attachmentsService's
// chunked upload PUTs + download) so a dead session triggers the same global
// logout there too, instead of only inside this wrapper.
export async function throwIfError(res) {
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  // Validation failures carry a per-field `details` array; the top-level
  // message is just "Validation failed", so surface the specific field
  // reasons instead — otherwise every form error reads the same generic line.
  const details = body.error?.details;
  const detailMsg = Array.isArray(details)
    ? details.map((d) => d.msg).filter(Boolean).join("; ")
    : "";
  const err = new Error(detailMsg || body.error?.message || `Request failed (${res.status})`);
  err.status = res.status;
  err.code = body.error?.code;
  err.details = details;
  if (res.status === 401 && err.code === "AUTH") onUnauthorized?.();
  throw err;
}

// Thin fetch wrapper: attaches the token, throws on errors, unwraps JSON.
// `...options` forwards any fetch init field callers pass, including P61's
// `keepalive: true` (the reload-guard flush — a request that must survive
// past the page unload, notesService.updateNote's own keepalive flag).
export async function request(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(BASE_URL + path, {
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...options,
  });

  await throwIfError(res);
  if (res.status === 204) return null;
  return res.json();
}
