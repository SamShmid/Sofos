import { request } from "./api";

// { [superWorkspaceId]: { [tag]: colorIdx } } — one key per tenant the caller
// can reach. TagColorsContext's boot fetch.
export const getTagColors = () => request("/tags/colors").then((r) => r.data);

// color: 0-15 to set an override, null to revert to auto. Owner-only
// (ownedTenantOrThrow, enforced server-side). Returns the tenant's full
// tag-color map after the write.
export const setTagColor = (tag, color) =>
  request("/tags/colors", { method: "PUT", body: JSON.stringify({ tag, color }) }).then((r) => r.data);
