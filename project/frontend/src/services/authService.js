import { request } from "./api";

// Backend replies { data: <user>, token }; reshape to { token, user } for the context.
export const register = (data) =>
  request("/auth/register", { method: "POST", body: JSON.stringify(data) })
    .then((r) => ({ token: r.token, user: r.data }));

export const login = (data) =>
  request("/auth/login", { method: "POST", body: JSON.stringify(data) })
    .then((r) => ({ token: r.token, user: r.data }));
