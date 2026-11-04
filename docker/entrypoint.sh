#!/bin/bash
set -e

# mongod's log lives on the logs volume (not the container layer) so it
# survives recreation and the app's retention sweep can rotate + prune it
# (--logRotate rename: the logRotate command renames the file with a timestamp
# suffix and starts a fresh one; utils/activityLog.js deletes suffixed ones
# older than 30 days).
LOGS_DIR="${LOGS_DIR:-/app/logs}"
mkdir -p "$LOGS_DIR"

# Loopback-only: mongo is never reachable from outside this container.
mongod --dbpath /data/db --bind_ip 127.0.0.1 --logpath "$LOGS_DIR/mongod.log" --logRotate rename --fork

ready=0
for i in $(seq 1 30); do
  if mongosh --quiet --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "mongod did not become ready in time; tail of mongod.log:"
  tail -n 50 "$LOGS_DIR/mongod.log"
  exit 1
fi

# A one-off command (for example the v4 migration) gets the same embedded
# Mongo startup and clean shutdown as the normal server, but never starts the
# API. `docker compose run ... node scripts/...` relies on this branch.
if [ "$#" -gt 0 ]; then
  set +e
  "$@"
  COMMAND_EXIT=$?
  mongod --shutdown --dbpath /data/db
  exit "$COMMAND_EXIT"
fi

# Virus scanning: both clamd and freshclam -d self-daemonize (clamd forks
# per stock clamd.conf, freshclam -d loops checking for updates in the
# background), so these calls return immediately and never block node. A
# scanner that fails to start must not take the whole app down with it
# (finalize with clamd unreachable accepts the file as pending_scan — held
# undownloadable until the sweeper rescans it) — so these are best-effort
# under `set -e`.
mkdir -p /var/run/clamav && chown clamav:clamav /var/run/clamav
freshclam -d || echo "freshclam failed to start; background signature updates unavailable"
clamd || echo "clamd failed to start; uploads pool as pending_scan (held, undownloadable) until it's back"
echo "clamd starting in the background; uploads finalized before it finishes loading signatures (~30-60s) are accepted as pending_scan and swept once it's up"

# node runs as a background child (not exec'd) so this script stays PID 1 and
# can give mongod a clean shutdown: exec'ing node meant `docker stop` SIGKILLed
# mongod with the PID namespace — an unclean WiredTiger shutdown on every
# deploy. Semantics kept: if the API dies on its own the container still exits
# with node's code, and restart:unless-stopped brings everything back up.
set +e # from here on, exit codes are data (node's code is forwarded), not fatal errors

node server.js &
NODE_PID=$!

# docker stop: forward the signal to node; the wait loop below picks up from there.
trap 'kill -TERM "$NODE_PID" 2>/dev/null' TERM INT

# The fiddly part: `wait` returns EARLY (128+signal) when a trap fires, which is
# indistinguishable from node itself dying on that code — so after every wait,
# re-check whether node is actually gone and wait again if not. The final
# NODE_EXIT is node's real exit code on both paths (signal-forwarded or
# died-on-its-own); bash remembers a reaped child's status, so re-waiting is safe.
wait "$NODE_PID"
NODE_EXIT=$?
while kill -0 "$NODE_PID" 2>/dev/null; do
  wait "$NODE_PID"
  NODE_EXIT=$?
done

# Node is down — stop mongod cleanly (checkpoint + journal quiesce) before the
# container's PID namespace teardown would SIGKILL it.
echo "node exited with code $NODE_EXIT; shutting mongod down cleanly"
mongod --shutdown --dbpath /data/db

exit "$NODE_EXIT"
