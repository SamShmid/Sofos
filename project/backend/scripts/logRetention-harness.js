// Phase 68 verification harness for utils/activityLog.js sweepRetention —
// plain Node, no test framework (mirrors the frontend harness style). It
// synthesizes a LOGS_DIR holding files at all four retention ages (fresh raw,
// raw >30d, hourly >60d, anything >90d) plus rotated mongod logs, runs the
// sweep with a fixed `now`, asserts the exact end-state files and their
// summed numbers, then runs the sweep AGAIN to prove idempotence.
//
// Run: node scripts/logRetention-harness.js

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sweepRetention } = require("../utils/activityLog");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`ok - ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${label}`);
    console.error(err);
  }
}

const NOW = Date.parse("2026-09-04T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const dateAgo = (days) => new Date(NOW - days * DAY_MS).toISOString().slice(0, 10);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p68-logret-"));

const line = (ts, status, userId) =>
  JSON.stringify({ ts, method: "GET", path: "/api/health", status, ms: 3, ...(userId ? { userId } : {}) }) + "\n";

// 1. Fresh raw (<30d): must survive byte-identical.
const freshDate = dateAgo(5);
const freshContent =
  line(`${freshDate}T09:00:00.000Z`, 200, "userA") + line(`${freshDate}T09:00:01.000Z`, 404);
fs.writeFileSync(path.join(dir, `activity-${freshDate}.log`), freshContent);

// 2. Raw >30d: becomes hourly buckets. Two hours, two users, one 404, one 5xx,
// one 3xx, plus a torn line that must be skipped without killing the sweep.
const rawDate = dateAgo(40);
fs.writeFileSync(
  path.join(dir, `activity-${rawDate}.log`),
  line(`${rawDate}T10:01:00.000Z`, 200, "userA") +
    line(`${rawDate}T10:02:00.000Z`, 201, "userB") +
    line(`${rawDate}T10:03:00.000Z`, 404) +
    "{torn line, not JSON\n" +
    line(`${rawDate}T11:01:00.000Z`, 500, "userA") +
    line(`${rawDate}T11:02:00.000Z`, 302, "userA")
);
const expectedHourly = {
  date: rawDate,
  uniqueUsers: 2, // userA + userB across the whole day (per-hour uniques don't sum)
  hours: {
    "10": { total: 3, s2xx: 2, s3xx: 0, s4xx: 1, s5xx: 0, uniqueUsers: 2 },
    "11": { total: 2, s2xx: 0, s3xx: 1, s4xx: 0, s5xx: 1, uniqueUsers: 1 },
  },
};

// 3. Crash re-run convergence: BOTH raw and hourly exist for one date (as if a
// prior sweep crashed between writing the summary and unlinking the raw). The
// sweep must keep the existing summary as-is and just finish the unlink.
const crashDate = dateAgo(45);
fs.writeFileSync(path.join(dir, `activity-${crashDate}.log`), line(`${crashDate}T01:00:00.000Z`, 200, "userZ"));
const crashHourly = {
  date: crashDate,
  uniqueUsers: 4,
  hours: { "01": { total: 7, s2xx: 7, s3xx: 0, s4xx: 0, s5xx: 0, uniqueUsers: 4 } },
};
fs.writeFileSync(path.join(dir, `activity-${crashDate}.hourly.json`), JSON.stringify(crashHourly) + "\n");

// 4. Hourly >60d: collapses to one daily bucket with summed counts and the
// carried day-level uniqueUsers.
const hourlyDate = dateAgo(70);
fs.writeFileSync(
  path.join(dir, `activity-${hourlyDate}.hourly.json`),
  JSON.stringify({
    date: hourlyDate,
    uniqueUsers: 3,
    hours: {
      "00": { total: 4, s2xx: 3, s3xx: 0, s4xx: 1, s5xx: 0, uniqueUsers: 2 },
      "23": { total: 6, s2xx: 5, s3xx: 1, s4xx: 0, s5xx: 0, uniqueUsers: 2 },
    },
  }) + "\n"
);
const expectedDaily70 = {
  date: hourlyDate,
  day: { total: 10, s2xx: 8, s3xx: 1, s4xx: 1, s5xx: 0, uniqueUsers: 3 },
};

// 5. Raw that skipped past 60d (server off for months): must converge
// raw -> hourly -> daily in ONE sweep.
const skippedDate = dateAgo(65);
fs.writeFileSync(path.join(dir, `activity-${skippedDate}.log`), line(`${skippedDate}T08:00:00.000Z`, 200, "userC"));
const expectedDaily65 = {
  date: skippedDate,
  day: { total: 1, s2xx: 1, s3xx: 0, s4xx: 0, s5xx: 0, uniqueUsers: 1 },
};

// 6. >90d: deleted, whatever form it's in.
const oldDailyDate = dateAgo(95);
fs.writeFileSync(
  path.join(dir, `activity-${oldDailyDate}.daily.json`),
  JSON.stringify({ date: oldDailyDate, day: { total: 1, s2xx: 1, s3xx: 0, s4xx: 0, s5xx: 0, uniqueUsers: 1 } }) + "\n"
);
const oldRawDate = dateAgo(100);
fs.writeFileSync(path.join(dir, `activity-${oldRawDate}.log`), line(`${oldRawDate}T00:00:00.000Z`, 200));

// 7. mongod logs: the live file is never touched; rotated ones prune by mtime
// after 30d.
fs.writeFileSync(path.join(dir, "mongod.log"), "current mongod log\n");
const oldRotated = path.join(dir, "mongod.log.2026-07-26T00-00-00");
fs.writeFileSync(oldRotated, "old rotated\n");
fs.utimesSync(oldRotated, new Date(NOW - 40 * DAY_MS), new Date(NOW - 40 * DAY_MS));
const freshRotated = path.join(dir, "mongod.log.2026-08-30T00-00-00");
fs.writeFileSync(freshRotated, "fresh rotated\n");
fs.utimesSync(freshRotated, new Date(NOW - 5 * DAY_MS), new Date(NOW - 5 * DAY_MS));

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const listing = () => fs.readdirSync(dir).sort();

const expectedEndState = [
  `activity-${crashDate}.hourly.json`,
  `activity-${freshDate}.log`,
  `activity-${hourlyDate}.daily.json`,
  `activity-${rawDate}.hourly.json`,
  `activity-${skippedDate}.daily.json`,
  "mongod.log",
  "mongod.log.2026-08-30T00-00-00",
].sort();

(async () => {
  const first = await sweepRetention(dir, NOW);

  check("first sweep summary counts", () => {
    // toHourly: rawDate + crashDate (finishes the unlink) + skippedDate;
    // toDaily: hourlyDate + skippedDate; deleted: the two >90d files.
    assert.deepEqual(first, { toHourly: 3, toDaily: 2, deleted: 2, mongodPruned: 1 });
  });
  check("end-state file listing is exactly the expected set", () => {
    assert.deepEqual(listing(), expectedEndState);
  });
  check("fresh raw file untouched byte-for-byte", () => {
    assert.equal(fs.readFileSync(path.join(dir, `activity-${freshDate}.log`), "utf8"), freshContent);
  });
  check("raw >30d became exact hourly buckets (torn line skipped)", () => {
    assert.deepEqual(readJson(`activity-${rawDate}.hourly.json`), expectedHourly);
  });
  check("crash re-run kept the existing hourly summary and dropped the raw", () => {
    assert.deepEqual(readJson(`activity-${crashDate}.hourly.json`), crashHourly);
  });
  check("hourly >60d collapsed to one summed daily bucket", () => {
    assert.deepEqual(readJson(`activity-${hourlyDate}.daily.json`), expectedDaily70);
  });
  check("raw >60d converged raw -> hourly -> daily in one sweep", () => {
    assert.deepEqual(readJson(`activity-${skippedDate}.daily.json`), expectedDaily65);
  });

  // Second run: nothing left to do, nothing changes — idempotence.
  const before = listing().map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]);
  const second = await sweepRetention(dir, NOW);
  check("second sweep is a no-op summary", () => {
    assert.deepEqual(second, { toHourly: 0, toDaily: 0, deleted: 0, mongodPruned: 0 });
  });
  check("second sweep left every file byte-identical", () => {
    assert.deepEqual(
      listing().map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
      before
    );
  });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll retention harness checks passed" : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
