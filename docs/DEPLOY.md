# Deploy runbook

Server-side deploy of Sofos from released images. This is the "pull and run"
path — for building the image locally instead, see the root `README.md`.

## One-time setup

1. Install Docker (with the Compose plugin) on the server.
2. Make sure the server can reach your container registry (in this
   setup, a self-hosted Forgejo instance; the examples below call it
   `registry.example.com`).
3. Log in to the image registry (Forgejo's built-in registry). Use a Forgejo
   PAT with at least `read:package` scope:

   ```bash
   docker login registry.example.com -u your-username
   # paste the PAT as the password when prompted
   ```

4. Fetch the deploy files onto the server:

   ```bash
   SOFOS_REPO_URL=https://your-forgejo.example/owner/sofos
   curl -fsSL -o compose.deploy.yml "$SOFOS_REPO_URL/raw/branch/main/compose.deploy.yml"
   curl -fsSL -o .env.example "$SOFOS_REPO_URL/raw/branch/main/.env.example"
   ```

5. Create the real env file from the example and set a real secret:

   ```bash
   cp .env.example .env
   # edit .env: set JWT_SECRET to a long random string (e.g. `openssl rand -hex 32`)
   ```

## First run

```bash
docker compose -f compose.deploy.yml up -d
```

This pulls `registry.example.com/owner/sofos:latest`, starts the
container (Mongo + API + frontend, one process), and publishes it on
`SOFOS_PORT` (default `3000`, see `.env.example`). A fresh install is empty —
open the app and register your first account.

Check it came up:

```bash
docker compose -f compose.deploy.yml ps
curl -sf http://localhost:3000/api/health
```

## Updating to a new release

For an existing installation moving to the flat-workspace Sofos v4 data
model, follow [`SOFOS_V4_MIGRATION.md`](SOFOS_V4_MIGRATION.md) before starting
the new application image. That procedure copies storage, dry-runs the data
migration, audits sharing changes, and preserves a rollback path.

```bash
docker compose -f compose.deploy.yml pull
docker compose -f compose.deploy.yml up -d
```

This pulls the current `:latest` tag and recreates the container. The named
volume (`sofos-mongo-data`) is untouched by this, so data survives the
update.

**In-flight chunked uploads do not survive a deploy.** Upload sessions live
only in server memory, and the temp directory holding their chunks is swept
clean on container boot — any upload not yet finalized when you recreate the
container is lost and has to be restarted from the client side. Finalized
attachments (already in `sofos-uploads`) are unaffected.

To pin a specific version instead of always tracking `latest`, set `SOFOS_TAG`
in `.env` (or export it before the commands above):

```bash
echo "SOFOS_TAG=v1.2.0" >> .env
docker compose -f compose.deploy.yml pull
docker compose -f compose.deploy.yml up -d
```

**Upgrading from a pre-Phase-22 deployment:** run
`docker compose -f compose.deploy.yml exec sofos node scripts/backfill-task-order.js`
once, after the new container is up — it assigns every project's existing
tasks a dense `order` (tasks created before this phase have none); it's
idempotent, so re-running it later is harmless (already-ordered tasks are
skipped).

**Upgrading from a pre-Phase-26 deployment:** run
`docker compose -f compose.deploy.yml exec sofos node scripts/backfill-task-status.js`
once, after the new container is up — it assigns `status:"done"`/`"todo"` to
existing tasks based on their `completed` value (tasks created before this
phase have no `status`); it's idempotent, so re-running it later is harmless.

## Data and backups

Data lives in four named volumes: `sofos-mongo-data` (Mongo's `/data/db`),
`sofos-uploads` (uploaded file attachments, `/app/uploads`),
`sofos-backups` (account-deletion exports, `/app/backups`), and `sofos-logs`
(activity + mongod logs, `/app/logs` — see "Logs and retention" below). All
four persist across `pull` / `up -d` / container recreation. `docker compose -f
compose.deploy.yml down` keeps the volumes; `down -v` deletes them — don't
run that unless you mean to wipe the database, uploaded files, and account
export backups.

When a user deletes their account (`DELETE /api/auth/me`), the server writes
a full export of their tenant (all docs as JSON plus their uploaded file
binaries) to a dated folder under `sofos-backups` **before** purging the data
from the live database — export-then-purge, not purge-with-a-safety-net.
There is no in-app restore; restoring an exported account is a manual
operator job (read `account.json` out of the relevant folder and reinsert
what's needed by hand). Treat `sofos-backups` like any other data volume for
backup purposes — a plain tar through a throwaway container the same way
`sofos-uploads` is handled below works for it too.

To back up, stop the container first so nothing else holds the data
directory, then run a throwaway `mongod` against the same volume and dump it
to a host folder:

```bash
docker compose -f compose.deploy.yml stop
mkdir -p backup
docker run --rm -v sofos-mongo-data:/data/db -v "$(pwd)/backup":/backup mongo:7.0 \
  bash -c "mongod --dbpath /data/db --logpath /var/log/mongod.log --fork && mongodump --db sofos --out /backup && mongod --shutdown --dbpath /data/db"
docker compose -f compose.deploy.yml up -d
```

The dump lands in `./backup/sofos` on the host. Restore with `mongorestore`
the same way, against the same volume.

Uploaded files live separately on the `sofos-uploads` volume (raw files on
disk, keyed by `storageKey` — the `Attachment` documents that reference them
are in the Mongo dump above). Back them up with a plain tar through a
throwaway container:

```bash
docker run --rm -v sofos-uploads:/app/uploads -v "$(pwd)/backup":/backup mongo:7.0 \
  tar -C /app/uploads -czf /backup/uploads.tar.gz .
```

Restore by extracting the same tarball back into a fresh `sofos-uploads`
volume the same way, in reverse (`tar -xzf`).

## Logs and retention

The container keeps its logs on the `sofos-logs` volume (`/app/logs`), with
retention handled in-app — nothing to configure or cron:

- **Activity log**: the server writes one JSON line per request to
  `activity-YYYY-MM-DD.log` (UTC day): timestamp, method, normalized path
  (the route pattern — no raw ids or query strings), status, duration in ms,
  and the acting user's id when authenticated. Logging is fail-open: a
  logging error can never fail a request.
- **30/60/90 retention**: a sweep runs at boot and every 24h. Raw day-files
  older than 30 days are summed down to per-hour buckets
  (`activity-YYYY-MM-DD.hourly.json` — totals, status classes, unique
  users); hourly files older than 60 days collapse to a single daily bucket
  (`activity-YYYY-MM-DD.daily.json`); anything older than 90 days is
  deleted.
- **mongod log**: `mongod` writes to `mongod.log` on the same volume. The
  sweep asks it to rotate (timestamp-suffixed `mongod.log.*` files) and
  deletes rotated files older than 30 days — rotation + pruning only, no
  summarization.
- **stdout belt**: console output (startup lines, error stacks) still goes
  to the docker `json-file` driver, now capped in the compose file
  (`max-size: 10m`, `max-file: 5`) so it can't grow unbounded across months
  of uptime either.

Set `LOGS_DIR` in `.env` only if you have a reason to move the directory;
the baked default matches the volume mount.

## Virus scanning (ClamAV)

The image runs `clamd` in-container to scan uploads before they're stored
(`docker/entrypoint.sh` starts it after `mongod` is up). A few things to plan
for:

- **RAM**: budget roughly an extra 1.5GB for clamd's loaded signature
  database, on top of whatever Mongo + Node need.
- **First-boot warm-up**: clamd takes ~30-60s to load signatures after the
  container starts (and after every restart). Uploads finalized before its
  socket is ready are **accepted anyway**, marked `pending_scan`, and held —
  invisible to other users and undownloadable — until the background sweeper
  scans them once clamd is up. Nothing is served unscanned and no client
  retry is needed; this is expected and self-resolves. (An upload is only
  rejected at finalize — `422` — when clamd is up and actually finds
  malware.)
- **Disabling it**: scanning is baked ON (`SCAN_ENABLED=true` in the image).
  Set `SCAN_ENABLED=false` in `.env` to turn it off (e.g. on a box too small
  to spare the RAM) — see `.env.example`.

## Reverse proxy (`TRUST_PROXY`)

Serving Sofos directly or over Tailscale (the standard setup — see the root
README) needs no configuration; leave `TRUST_PROXY` unset. If you instead put
a reverse proxy (nginx, Caddy, etc.) in front of the container, set
`TRUST_PROXY=1` in `.env` — this tells Express there's exactly one hop in
front of it, so `req.ip` resolves to the real client's address (from
`X-Forwarded-For`) instead of the proxy's. This matters for the login/register
rate limiter (see `docs/API_GUIDE.md` §10), which is per-IP: without it,
every request behind the proxy shares one IP as far as Express can tell, so
the limiter's 150-per-15-minutes bucket is shared by ALL your users instead
of applied per visitor — one noisy client can lock everyone out. Only set
this to the number of proxies you actually run in front of the app; setting
it too high trusts a header an attacker could otherwise spoof.

The same applies to any future tunnel-style fronting (e.g. a Cloudflare
Tunnel): that's a reverse proxy too, so if the app is ever exposed that way,
set `TRUST_PROXY` accordingly — otherwise every visitor arrives as the
tunnel's IP and the login limiter throttles them all as one client.

## Environment variables

Everything below is read from `.env` (see `.env.example` for the full file
with comments). All are optional except `JWT_SECRET`.

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | — (required) | Signs auth tokens. Startup refuses to run if it's unset, shorter than 16 chars, or still the `.env.example` placeholder. |
| `SOFOS_PORT` | `3000` | Host port the container publishes. |
| `SCAN_ENABLED` | `true` (baked into the image) | Turns ClamAV scanning on/off. |
| `BACKUPS_DIR` | `/app/backups` (baked in) | Where account-deletion exports are written. |
| `LOGS_DIR` | `/app/logs` (baked in) | Where the activity log and mongod's log are written, with in-app 30/60/90 retention (see "Logs and retention" above). |
| `MAX_UPLOAD_BYTES` | unset (unlimited) | Total upload size cap in bytes, enforced per chunk and again at finalize. |
| `TRUST_PROXY` | unset | See above — set to `1` behind exactly one reverse proxy. |
| `SCAN_MAX_ATTEMPTS` | `5` | Failed scan attempts (scanner confirmed up — outages never count) before a `pending_scan` attachment is auto-quarantined. While clamd is down the sweeper re-probes on a 1/5/15/30/60-min ladder with loud logs and holds all pending files. |
| `SCAN_TIMEOUT_MS` | `60000` | Overall per-scan timeout once connected to clamd, guarding against a wedged scanner. |

## Server requirements

The image is `mongo:7.0`-based, which requires a CPU with AVX support on
x86-64 — or arm64 (no AVX requirement there). Confirm before deploying to a
new box; older/low-power x86-64 hardware without AVX cannot run this image.

**Why not MongoDB 8?** A P68 bump to `mongo:8.0` was reverted: mongod 8.0
hard-aborts at startup on Linux kernel 6.19 and newer (SERVER-121912), and
both the deploy host and the CI runner run kernel 7.0.0 — the 8.0 image
builds and boots fine on a Mac (Docker Desktop's older kernel) but never
becomes healthy on the real host. 7.0 is past its upstream support window but
is the only line that runs here. Any throwaway `mongod` you point at
`sofos-mongo-data` (the backup runbook above) must therefore stay `mongo:7.0`
— matching what actually writes the volume. Revisit the bump only when
MongoDB ships a release compatible with kernel 6.19+ and it's verified green
on the runner's kernel, not just locally.

## Release checklist

Before pushing a `vX.Y.Z` tag:

1. **Add a `docs/RELEASE_NOTES.json` entry for the version being cut** —
   newest-first in the array, with both a `user` and an `agent` bullet list
   (`GET /api/me`'s `whatsNew` and the frontend's What's-new modal are both
   sourced from this file at runtime; see `docs/API_GUIDE.md` §12). Skipping
   this doesn't break anything — the tagged image still reports the right
   `version` (baked in via `--build-arg`, below) — it just means nobody sees
   release notes for that version.
2. Push the tag. The **Release** workflow below handles the rest.

`--build-arg` note: on a tag push, `release.yml` passes
`--build-arg VERSION=$TAG` to the image build automatically, which the
Dockerfile bakes in as the `APP_VERSION` env var (read by `GET /api/health`'s
`version` field and `GET /api/me`'s `version.current`). Building the image by
hand outside CI (e.g. testing a release build locally) needs the same flag,
or the running container falls back to whatever `docs/RELEASE_NOTES.json`'s
newest entry says (`"0.0.0-dev"` if that's empty too):

```bash
docker build --build-arg VERSION=v2.1.0 -t sofos:v2.1.0 .
```

## CI/CD overview

- Every push runs the **Tests** workflow (API + frontend build) in Forgejo
  Actions.
- A push touching image-relevant paths (`Dockerfile`, `docker/**`,
  `compose.deploy.yml`, `docker-compose.yml`, `.dockerignore`) additionally
  runs the **docker-smoke** workflow: builds the image, boots it, and
  exercises health, upload+scan (clean file and EICAR), and restart
  persistence against a throwaway container.
- Pushing a tag matching `vX.Y.Z` runs the **Release** workflow: it re-runs
  the tests, runs the same smoke gates as docker-smoke against the built
  image, then pushes
  `registry.example.com/owner/sofos:vX.Y.Z` and `:latest`, and creates
  a Forgejo release. A broken image fails the release before anything is
  pushed to the registry.
- The release job authenticates to the registry with the repo secret
  `REGISTRY_TOKEN`.
- Nothing auto-deploys to a server on release — updating a running server is
  always the manual `pull` + `up -d` above, by design.
