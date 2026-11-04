# Sofos v4 migration

Sofos v4 replaces nested workspaces and automatic General projects with a
simpler structure. Workspaces are top-level. Projects can contain projects.
Workspaces and projects can both own tasks, notes, goals, links, and files
directly.

The migration preserves content and identifiers wherever possible. It is a
dry run unless `--apply` is present.

## What the migration changes

- Each nested workspace becomes a project with the same MongoDB identifier.
- Its nested workspace children become child projects.
- Its existing projects stay beneath the converted project.
- Content from a General project moves directly onto its workspace or onto
  the converted project.
- Project tags such as `waiting` and `blocked` initialize the new project
  status. The `Academic Archive` tree and archive tags become archived.
- Existing share codes receive the `SF-` prefix without changing their
  random suffix.
- Project-level and nested-workspace grants are never widened silently. An
  apply stops unless `--promote-grants` is explicitly supplied.
- Trashed nested workspaces and trashed General projects are reported for
  manual review. They are not discarded.

## Safe upgrade sequence

1. Stop the existing deployment and make backups of MongoDB, uploads,
   account exports, and logs.
2. Copy the legacy volumes to new Sofos volumes. Keep the legacy volumes
   unchanged as the rollback point.
3. Run the new image against the copied volumes in migration-only mode.
4. Review the dry-run JSON. Resolve anything under `manualReview` and inspect
   every entry under `legacyScopedGrants`.
5. Apply the migration to the copied database.
6. Start Sofos and verify counts, representative files, project trees,
   archived projects, task nesting, and sharing.
7. Keep the old deployment stopped but intact until the verification window
   is complete.

Never test this migration for the first time against the only copy of the
database.

## Back up the legacy deployment

Set these placeholders to the actual legacy volume names shown by
`docker volume ls`.

```bash
mkdir -p migration-backup

docker run --rm \
  -v LEGACY_MONGO_VOLUME:/data/db \
  -v "$(pwd)/migration-backup":/backup \
  mongo:7.0 \
  bash -c "mongod --dbpath /data/db --logpath /tmp/mongod.log --fork && mongodump --out /backup/mongo && mongod --shutdown --dbpath /data/db"

docker run --rm \
  -v LEGACY_UPLOADS_VOLUME:/source \
  -v "$(pwd)/migration-backup":/backup \
  mongo:7.0 \
  tar -C /source -czf /backup/uploads.tar.gz .
```

Repeat the tar command for the account-export and logs volumes.

## Copy into the Sofos volumes

Create the new volumes first. The exact names may include the Compose project
prefix, so confirm them with `docker volume ls`.

```bash
docker volume create SOFOS_MONGO_VOLUME
docker volume create SOFOS_UPLOADS_VOLUME
docker volume create SOFOS_BACKUPS_VOLUME
docker volume create SOFOS_LOGS_VOLUME

docker run --rm \
  -v SOFOS_MONGO_VOLUME:/data/db \
  -v "$(pwd)/migration-backup":/backup \
  mongo:7.0 \
  bash -c "mongod --dbpath /data/db --logpath /tmp/mongod.log --fork && mongorestore --drop --nsFrom='LEGACY_DATABASE.*' --nsTo='sofos.*' /backup/mongo/LEGACY_DATABASE && mongod --shutdown --dbpath /data/db"

docker run --rm \
  -v SOFOS_UPLOADS_VOLUME:/target \
  -v "$(pwd)/migration-backup":/backup \
  mongo:7.0 \
  tar -C /target -xzf /backup/uploads.tar.gz
```

Restore the account-export and logs archives into their matching new volumes.

## Dry run

With `compose.deploy.yml` configured to use the copied Sofos volumes, pull
the v4 image and run the migration as a one-off command. The entrypoint starts
MongoDB, runs only the command, and shuts MongoDB down cleanly.

```bash
docker compose -f compose.deploy.yml pull
docker compose -f compose.deploy.yml run --rm --no-deps sofos \
  node scripts/migrate-sofos-v4.js
```

Save the JSON output. A dry run does not write to the database.

## Apply

If `legacyScopedGrants` is empty, apply with this command.

```bash
docker compose -f compose.deploy.yml run --rm --no-deps sofos \
  node scripts/migrate-sofos-v4.js --apply
```

If the dry run lists legacy scoped grants, review each one. Only if widening
those grants to the owning top-level workspace is acceptable, run this
explicit form.

```bash
docker compose -f compose.deploy.yml run --rm --no-deps sofos \
  node scripts/migrate-sofos-v4.js --apply --promote-grants
```

The migration is idempotent. A completed run records a row in the
`migrationstates` collection and can be rerun safely.

## Start and verify

```bash
docker compose -f compose.deploy.yml up -d
docker compose -f compose.deploy.yml ps
curl -sf http://localhost:3000/api/health
```

Verify these before considering the upgrade complete.

- Workspace count matches the former top-level workspace count.
- Converted nested workspaces appear as projects in the right workspace.
- Project and task trees retain their hierarchy.
- Former General content appears directly on the intended workspace or
  converted project.
- Archived projects are hidden by default and restore correctly.
- Uploaded files open and their attachment records point to the right place.
- Every sharing grant has the intended workspace scope.
- The migration report contains no unexplained manual-review item.

## Rollback

Stop Sofos and restart the legacy deployment using the untouched legacy
volumes. Do not point the legacy image at a database that the v4 migration
has modified. Any writes made after the Sofos cutover must be reconciled
manually before rollback.
