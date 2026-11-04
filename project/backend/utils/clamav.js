const net = require("net");
const fs = require("fs");

// Hand-rolled clamd INSTREAM client over `net` — no new dependency.

const CONNECT_TIMEOUT_MS = 5000;
const SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS) || 60000;
const CHUNK_SIZE = 64 * 1024;

function scanEnabled() {
  return process.env.SCAN_ENABLED === "true";
}

function scannerUnavailable() {
  const e = new Error("Virus scanner unavailable");
  e.status = 503;
  return e;
}

// Dev runs clamd over TCP (standing container); production keeps the unix
// socket the image already ships (CLAMD_HOST/PORT unset there).
function connectToClamd() {
  return process.env.CLAMD_HOST && process.env.CLAMD_PORT
    ? net.createConnection({ host: process.env.CLAMD_HOST, port: Number(process.env.CLAMD_PORT) })
    : net.createConnection(process.env.CLAMD_SOCKET || "/var/run/clamav/clamd.ctl");
}

// zPING → PONG round-trip. Resolves a boolean, never rejects — the sweeper uses
// it to tell "scanner is down" apart from "this one file failed to scan", and
// only the latter counts against an attachment's attempt budget.
function pingScanner() {
  return new Promise((resolve) => {
    const socket = connectToClamd();
    let settled = false;
    let reply = "";
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(val);
    };
    const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
    });
    socket.on("error", () => finish(false));
    socket.on("end", () => finish(reply.replace(/\0/g, "").trim() === "PONG"));
  });
}

function scanFile(filePath) {
  return new Promise((resolve, reject) => {
    const socket = connectToClamd();

    let settled = false;
    let reply = "";
    let readStream;
    let scanTimer;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(scanTimer);
      if (readStream) readStream.destroy();
      socket.destroy();
      fn(arg);
    };

    const connectTimer = setTimeout(() => {
      finish(reject, scannerUnavailable());
    }, CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      // Covers everything after connect (streaming + waiting for the reply) —
      // a wedged clamd must not hang the finalize request or the sweeper forever.
      scanTimer = setTimeout(() => {
        finish(reject, scannerUnavailable());
      }, SCAN_TIMEOUT_MS);
      socket.write("zINSTREAM\0");

      readStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
      readStream.on("data", (chunk) => {
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(chunk.length, 0);
        const wroteLen = socket.write(lenBuf);
        const wroteChunk = socket.write(chunk);
        if (!wroteLen || !wroteChunk) {
          readStream.pause();
          socket.once("drain", () => readStream.resume());
        }
      });
      readStream.on("end", () => {
        socket.write(Buffer.alloc(4)); // zero-length terminator
      });
      readStream.on("error", (err) => finish(reject, err));
    });

    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
    });

    socket.on("error", () => finish(reject, scannerUnavailable()));

    socket.on("end", () => {
      // clamd's z-protocol replies are NUL-terminated; String.trim() leaves the
      // \0 in place, so strip it before matching OK/FOUND.
      const text = reply.replace(/\0/g, "").trim();
      if (text.endsWith("OK")) {
        finish(resolve, { clean: true });
        return;
      }
      if (text.endsWith("FOUND")) {
        const withoutFound = text.replace(/\s*FOUND$/, "");
        const signature = withoutFound.includes(":")
          ? withoutFound.slice(withoutFound.indexOf(":") + 1).trim()
          : withoutFound.trim();
        finish(resolve, { clean: false, signature });
        return;
      }
      // "... ERROR" or anything unrecognized
      finish(reject, scannerUnavailable());
    });
  });
}

module.exports = { scanEnabled, scanFile, pingScanner };
