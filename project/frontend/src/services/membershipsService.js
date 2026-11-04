import { request } from "./api";

// Owner-only tenant sharing. create takes the EXPLICIT scope payload:
// { shareCode, role, scope: "none" | "workspace", target?, expiresAt? }
// (expiresAt is optional ISO8601; grants created here start "pending" until accepted)
export const getMemberships = () => request("/memberships").then((r) => r.data);

export const createMembership = (data) =>
  request("/memberships", { method: "POST", body: JSON.stringify(data) }).then((r) => r.data);

export const updateMembership = (id, role) =>
  request(`/memberships/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }).then((r) => r.data);

export const deleteMembership = (id) =>
  request(`/memberships/${id}`, { method: "DELETE" });

// Recipient-side: invites are grants awaiting this user's accept/decline.
export const getMyInvites = () => request("/memberships/invites").then((r) => r.data);

export const acceptInvite = (id) =>
  request(`/memberships/invites/${id}/accept`, { method: "POST" }).then((r) => r.data);

export const declineInvite = (id) =>
  request(`/memberships/invites/${id}/decline`, { method: "POST" });
