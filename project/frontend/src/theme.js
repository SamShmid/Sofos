// Theme pref resolution + persistence, shared by Layout (server sync) and
// SettingsPage (control). index.html's inline pre-paint script duplicates this
// resolve logic by hand, since a module import here would paint light first.
const VALID = ["light", "dark", "system"];
export const THEME_KEY = "sofos.themePref"; // raw pref, may be "system"
const LEGACY_THEME_KEY = atob("eWl0cm8udGhlbWVQcmVm");

const media = window.matchMedia("(prefers-color-scheme: dark)");
let listening = false;

const resolve = (pref) => (pref === "system" ? (media.matches ? "dark" : "light") : pref);

// Re-stamps on live OS theme changes — only wired up while pref is "system".
function handleSystemChange() {
  document.documentElement.dataset.theme = media.matches ? "dark" : "light";
}

export function getStoredPref() {
  try {
    let raw = localStorage.getItem(THEME_KEY);
    if (raw === null) {
      raw = localStorage.getItem(LEGACY_THEME_KEY);
      if (raw !== null) {
        localStorage.setItem(THEME_KEY, raw);
        localStorage.removeItem(LEGACY_THEME_KEY);
      }
    }
    return VALID.includes(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

// Stamps the resolved theme, persists the raw pref, and (un)subscribes the
// one shared matchMedia listener so it's live only while pref is "system" —
// module-owned + guarded by `listening` so repeat calls never double-subscribe.
export function applyPref(pref) {
  document.documentElement.dataset.theme = resolve(pref);
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // best-effort mirror; pre-paint falls back to "system" if unreadable
  }
  if (pref === "system" && !listening) {
    media.addEventListener("change", handleSystemChange);
    listening = true;
  } else if (pref !== "system" && listening) {
    media.removeEventListener("change", handleSystemChange);
    listening = false;
  }
}
