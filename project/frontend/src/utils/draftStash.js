// Ruling 10: backdrop/Escape close an edit modal but keep the typed draft,
// restored when that same modal reopens; Cancel/× discard it; a reload clears
// everything. A module-level Map (not localStorage) gives exactly that —
// it lives only as long as the page does. No serialization needed since
// values never leave memory.
const drafts = new Map();

export function getDraft(key) {
  return drafts.get(key);
}

export function setDraft(key, values) {
  drafts.set(key, values);
}

export function clearDraft(key) {
  drafts.delete(key);
}
