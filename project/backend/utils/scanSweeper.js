const mongoose = require("mongoose");
const Attachment = require("../models/Attachment");
const { filePathFor } = require("./uploadStore");
const { scanEnabled, scanFile, pingScanner } = require("./clamav");

const BATCH_SIZE = 20;
// Attempts only count when the scanner is CONFIRMED UP (ping succeeds) and the
// scan of that specific file still fails — an outage never burns the budget.
const MAX_ATTEMPTS = Number(process.env.SCAN_MAX_ATTEMPTS) || 5;

// Outage probe ladder (minutes): while the scanner is down we stop touching
// attachments entirely and just re-probe on this schedule, logging loudly each
// step so the operator has time to fix it without a quarantine backlog forming.
const BACKOFF_MINUTES = [1, 5, 15, 30, 60];

// Module-level in-flight flag: the 60s setInterval must not stack a new sweep
// onto a still-running one against a slow/wedged scanner.
let sweeping = false;

// Outage state: null = scanner believed up; a Date = down since then.
let downSince = null;
let backoffIndex = 0;
let nextProbeAt = 0;

function scannerIsUp() {
  return downSince === null;
}

// Forget the outage state so the next sweep probes immediately (tests, or a
// manual "I fixed it, retry now" nudge).
function resetScannerBackoff() {
  downSince = null;
  backoffIndex = 0;
  nextProbeAt = 0;
}

function enterDownState(now) {
  if (downSince === null) downSince = new Date(now);
  const waitMin = BACKOFF_MINUTES[Math.min(backoffIndex, BACKOFF_MINUTES.length - 1)];
  nextProbeAt = now + waitMin * 60000;
  backoffIndex += 1;
  console.error(
    `ClamAV scanner is DOWN (since ${downSince.toISOString()}) — uploads cannot be scanned and pending files are on hold; next probe in ${waitMin}m`
  );
}

// Rescans everything still `pending_scan` (accepted while the scanner was down
// at finalize, or freshly restored from `failed`). Exported standalone so it's
// callable directly (tests, a manual retry) without the interval wrapper.
async function sweepOnce() {
  if (!scanEnabled()) return;
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    if (downSince !== null && now < nextProbeAt) return; // waiting out the outage backoff

    if (!(await pingScanner())) {
      enterDownState(now);
      return; // no attachment is touched during an outage — no attempts burned
    }
    if (downSince !== null) {
      console.log(`ClamAV scanner is back UP (down since ${downSince.toISOString()}) — resuming scans`);
      resetScannerBackoff();
    }

    const attachments = await Attachment.find({ scanStatus: "pending_scan" }).limit(BATCH_SIZE);

    for (const attachment of attachments) {
      try {
        let result;
        try {
          result = await scanFile(filePathFor(attachment.storageKey));
        } catch (err) {
          if (err.status !== 503) throw err;
          // A mid-batch 503 is ambiguous: the scanner may have just died, or
          // only this file may be unscannable. Re-ping to tell them apart —
          // a dead scanner stops the batch without charging anyone.
          if (!(await pingScanner())) {
            enterDownState(Date.now());
            return;
          }
          result = null; // scanner up, this file failed — that's a real attempt
        }

        if (result === null) {
          attachment.scanAttempts += 1;
          if (attachment.scanAttempts >= MAX_ATTEMPTS) {
            attachment.scanStatus = "failed";
            await attachment.softDelete(attachment.createdBy);
          } else {
            await attachment.save();
          }
        } else if (result.clean) {
          attachment.scanStatus = "clean";
          await attachment.save();
        } else {
          attachment.scanStatus = "infected";
          await attachment.softDelete(attachment.createdBy);
        }
      } catch (err) {
        // Doc moved on underneath us (e.g. restored/rescanned concurrently) —
        // skip it this round rather than clobber a newer version.
        if (err instanceof mongoose.Error.VersionError) continue;
        throw err;
      }
    }
  } finally {
    sweeping = false;
  }
}

// Started once, after the DB connects, only when scanning is on. unref()'d so
// it never keeps the process alive on its own. The interval is the tick rate;
// the outage ladder above decides whether a tick actually probes anything.
function startSweeper() {
  const intervalMs = Number(process.env.SCAN_RETRY_INTERVAL_MS) || 60000;
  const timer = setInterval(() => {
    sweepOnce().catch((err) => console.error("Scan sweep failed:", err));
  }, intervalMs);
  timer.unref();
}

module.exports = { sweepOnce, startSweeper, scannerIsUp, resetScannerBackoff };
