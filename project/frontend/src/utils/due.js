// Only place date/due math lives (PHASE_SPEC contract 3). All-day dates are
// read/written by their UTC date parts (contract 2) so a date picked with no
// time never shifts a day depending on the viewer's timezone; timed dues are
// a real instant, read/written in local time.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

// Form fields → payload. No time picked collapses to all-day at midnight UTC.
export function toDueAt(dateStr, timeStr) {
  if (!dateStr) return { dueAt: null, dueHasTime: false };
  if (!timeStr) return { dueAt: `${dateStr}T00:00:00.000Z`, dueHasTime: false };
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  return { dueAt: new Date(y, m - 1, d, h, min).toISOString(), dueHasTime: true };
}

// Payload → form fields. All-day reads back its UTC date parts (how it was
// written); timed reads back local wall-clock time.
export function fromDueAt(dueAt, dueHasTime) {
  if (!dueAt) return { dateStr: "", timeStr: "" };
  const d = new Date(dueAt);
  if (!dueHasTime) {
    return { dateStr: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, timeStr: "" };
  }
  return {
    dateStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Short chip text: this year drops the year (timed dues add the time
// instead); other years drop the time and show the year instead.
export function formatDue(dueAt, dueHasTime) {
  if (!dueAt) return "";
  const d = new Date(dueAt);
  const year = dueHasTime ? d.getFullYear() : d.getUTCFullYear();
  const month = MONTHS[dueHasTime ? d.getMonth() : d.getUTCMonth()];
  const day = dueHasTime ? d.getDate() : d.getUTCDate();
  const thisYear = year === new Date().getFullYear();
  let s = `${month} ${day}`;
  if (thisYear) {
    if (dueHasTime) s += ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    s += ` ${year}`;
  }
  return s;
}

// Overdue/today per contract 2: timed compares the real instant; all-day
// compares today's local calendar date against dueAt's UTC date parts.
export function dueState(dueAt, dueHasTime) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  if (dueHasTime) {
    if (now > d) return "overdue";
    const sameDay = now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
    return sameDay ? "today" : null;
  }
  const dueDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (today > dueDay) return "overdue";
  if (today === dueDay) return "today";
  return null;
}

// Overview dashboard's coarser bucket (Phase 42): overdue/today reuse dueState
// as-is; "week" adds the next-7-calendar-days window on top, using the same
// all-day-UTC/local-timed day math dueState already applies.
export function dueBucket(dueAt, dueHasTime) {
  const state = dueState(dueAt, dueHasTime);
  if (state === "overdue" || state === "today") return state;
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const dueDay = dueHasTime
    ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAhead = (dueDay - today) / 86400000;
  return daysAhead >= 1 && daysAhead <= 7 ? "week" : null;
}
