const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");

// Activity log + Samuel's 30/60/90 retention scheme (P68). One JSON line per
// request into LOGS_DIR/activity-YYYY-MM-DD.log (UTC day). After 30 days a raw
// day-file is summed down to hourly buckets, after 60 the hourly file collapses
// to a single daily bucket, and after 90 the file is deleted. Rotated mongod
// logs (mongod.log.<suffix>, produced by --logRotate rename) are pruned after
// 30 days — rotate + prune only, no summarization.

const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, "..", "logs");

const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_MAX_DAYS = 30;
const HOURLY_MAX_DAYS = 60;
const DELETE_AFTER_DAYS = 90;
const MONGOD_MAX_DAYS = 30;

async function initLogsDir() {
  await fsp.mkdir(LOGS_DIR, { recursive: true });
}

// Fail-open by design: a logging error must never take a request down with it,
// so everything here happens after the response is finished and every failure
// is swallowed behind a single console.warn.
function activityLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const ts = new Date();
      // Prefer the matched route pattern (no raw ids); express restores
      // baseUrl/route only when a router fully unwinds, which a handled
      // request never does — so both are still set here. Unmatched paths
      // (404s, static files) fall back to the raw path minus query string.
      let p;
      if (req.route) {
        p = ((req.baseUrl || "") + (req.route.path === "/" ? "" : req.route.path)) || "/";
      } else {
        p = req.originalUrl.split("?")[0];
      }
      const entry = {
        ts: ts.toISOString(),
        method: req.method,
        path: p,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - startedAt) / 1000000n),
      };
      if (req.user) entry.userId = req.user.id;
      fs.appendFile(
        path.join(LOGS_DIR, `activity-${ts.toISOString().slice(0, 10)}.log`),
        JSON.stringify(entry) + "\n",
        (err) => {
          if (err) console.warn(`activity log append failed: ${err.message}`);
        }
      );
    } catch (err) {
      console.warn(`activity log line failed: ${err.message}`);
    }
  });
  next();
}

function ageInDays(dateStr, now) {
  return Math.floor((now - Date.parse(`${dateStr}T00:00:00Z`)) / DAY_MS);
}

function emptyBucket() {
  return { total: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
}

function countInto(bucket, status) {
  bucket.total += 1;
  if (status >= 200 && status < 300) bucket.s2xx += 1;
  else if (status >= 300 && status < 400) bucket.s3xx += 1;
  else if (status >= 400 && status < 500) bucket.s4xx += 1;
  else if (status >= 500) bucket.s5xx += 1;
}

// Crash-safe write: temp file in the same dir + rename, so a half-written
// summary can never be mistaken for a finished one on the next sweep.
async function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, contents);
  await fsp.rename(tmp, filePath);
}

// Raw day-file -> per-hour buckets. The file's own lines are the last chance
// to see individual userIds, so the day-level distinct-user count is computed
// HERE and carried on the hourly file — the later daily collapse can't recover
// it from per-hour uniques (summing those would double-count a user active in
// two hours).
async function rawToHourly(logsDir, date) {
  const rawPath = path.join(logsDir, `activity-${date}.log`);
  const hourlyPath = path.join(logsDir, `activity-${date}.hourly.json`);
  const alreadyDone = await fsp.access(hourlyPath).then(() => true, () => false);
  if (!alreadyDone) {
    const lines = (await fsp.readFile(rawPath, "utf8")).split("\n").filter(Boolean);
    const hours = {};
    const dayUsers = new Set();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // a torn/corrupt line loses one request, never the sweep
      }
      const hour = typeof entry.ts === "string" ? entry.ts.slice(11, 13) : "00";
      if (!hours[hour]) hours[hour] = { ...emptyBucket(), users: new Set() };
      countInto(hours[hour], entry.status);
      if (entry.userId) {
        hours[hour].users.add(entry.userId);
        dayUsers.add(entry.userId);
      }
    }
    const out = { date, uniqueUsers: dayUsers.size, hours: {} };
    for (const hour of Object.keys(hours).sort()) {
      const { users, ...counts } = hours[hour];
      out.hours[hour] = { ...counts, uniqueUsers: users.size };
    }
    await writeAtomic(hourlyPath, JSON.stringify(out) + "\n");
  }
  // A crash between rename and unlink leaves both files; re-runs land here and
  // just finish the unlink (alreadyDone skips the recompute).
  await fsp.unlink(rawPath);
}

// Hourly -> one bucket for the whole day. Counts are summed; uniqueUsers is
// the true day-level distinct count computed at raw->hourly time (above).
async function hourlyToDaily(logsDir, date) {
  const hourlyPath = path.join(logsDir, `activity-${date}.hourly.json`);
  const dailyPath = path.join(logsDir, `activity-${date}.daily.json`);
  const alreadyDone = await fsp.access(dailyPath).then(() => true, () => false);
  if (!alreadyDone) {
    const hourly = JSON.parse(await fsp.readFile(hourlyPath, "utf8"));
    const day = emptyBucket();
    for (const hour of Object.values(hourly.hours || {})) {
      day.total += hour.total;
      day.s2xx += hour.s2xx;
      day.s3xx += hour.s3xx;
      day.s4xx += hour.s4xx;
      day.s5xx += hour.s5xx;
    }
    day.uniqueUsers = hourly.uniqueUsers || 0;
    await writeAtomic(dailyPath, JSON.stringify({ date, day }) + "\n");
  }
  await fsp.unlink(hourlyPath);
}

// The retention sweep, exported pure-ish (logsDir + now injected) so the
// harness can synthesize any mix of ages and re-run it to prove idempotence.
// Returns what it did so callers/harness can assert on it.
async function sweepRetention(logsDir, now) {
  const summary = { toHourly: 0, toDaily: 0, deleted: 0, mongodPruned: 0 };
  let entries;
  try {
    entries = await fsp.readdir(logsDir);
  } catch (err) {
    if (err.code === "ENOENT") return summary; // no logs yet — nothing to do
    throw err;
  }

  for (const name of entries) {
    const m = name.match(/^activity-(\d{4}-\d{2}-\d{2})\.(log|hourly\.json|daily\.json)$/);
    if (m) {
      const [, date, kind] = m;
      const age = ageInDays(date, now);
      if (age > DELETE_AFTER_DAYS) {
        await fsp.unlink(path.join(logsDir, name)).catch(() => {});
        summary.deleted += 1;
      } else if (kind === "log" && age > RAW_MAX_DAYS) {
        await rawToHourly(logsDir, date);
        summary.toHourly += 1;
        if (age > HOURLY_MAX_DAYS) {
          // A raw file that skipped past 60 (e.g. the server was off for
          // months) converges in one sweep instead of waiting for the next.
          await hourlyToDaily(logsDir, date);
          summary.toDaily += 1;
        }
      } else if (kind === "hourly.json" && age > HOURLY_MAX_DAYS) {
        await hourlyToDaily(logsDir, date);
        summary.toDaily += 1;
      }
      continue;
    }
    // Rotated mongod logs (mongod.log.<timestamp-suffix> from --logRotate
    // rename): prune by mtime — the suffix format isn't worth parsing.
    if (/^mongod\.log\./.test(name) && !name.endsWith(".tmp")) {
      const stat = await fsp.stat(path.join(logsDir, name)).catch(() => null);
      if (stat && now - stat.mtimeMs > MONGOD_MAX_DAYS * DAY_MS) {
        await fsp.unlink(path.join(logsDir, name)).catch(() => {});
        summary.mongodPruned += 1;
      }
    }
  }
  return summary;
}

// Ask the live mongod to rotate its log file so the sweep has dated
// mongod.log.* files to prune. Outside docker (dev mongod logging to stdout,
// or perms that differ) the command fails — tolerated, rotation is a
// deploy-image concern.
async function rotateMongodLog() {
  try {
    await mongoose.connection.db.admin().command({ logRotate: 1 });
  } catch {
    // dev / non-file logging — nothing to rotate
  }
}

// Boot + every 24h. unref()'d so the timer never keeps the process alive.
function startRetention() {
  const run = async () => {
    await rotateMongodLog();
    const summary = await sweepRetention(LOGS_DIR, Date.now());
    if (summary.toHourly || summary.toDaily || summary.deleted || summary.mongodPruned) {
      console.log(
        `Log retention sweep: ${summary.toHourly} raw->hourly, ${summary.toDaily} hourly->daily, ${summary.deleted} deleted, ${summary.mongodPruned} mongod logs pruned`
      );
    }
  };
  run().catch((err) => console.warn(`log retention sweep failed: ${err.message}`));
  const timer = setInterval(() => {
    run().catch((err) => console.warn(`log retention sweep failed: ${err.message}`));
  }, DAY_MS);
  timer.unref();
}

module.exports = { activityLogger, initLogsDir, sweepRetention, startRetention, LOGS_DIR };
