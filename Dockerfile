# Stage 1: build the frontend
FROM node:22-bookworm-slim AS client-build
WORKDIR /build
COPY project/frontend/package*.json ./
RUN npm ci
COPY project/frontend/ ./
RUN npm run build

# Stage 2: backend production deps
FROM node:22-bookworm-slim AS server-deps
WORKDIR /build
COPY project/backend/package*.json ./
RUN npm ci --omit=dev

# Stage 3: runtime — mongo image (multi-arch) + node runtime
# PINNED TO 7.0, do NOT bump to 8.0: mongod 8.0 hard-aborts on boot under Linux
# kernel 6.19+ (SERVER-121912), and the deploy host + CI runner are on kernel
# 7.0.0. The P68 8.0 bump passed local Docker Desktop (older LinuxKit kernel)
# but failed the release smoke gate on the real runner. 7.0 is EOL upstream but
# is the only line that boots on this host; revisit only when MongoDB ships a
# kernel-6.19+-compatible release AND it's verified on the runner's kernel.
FROM mongo:7.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg clamav-daemon clamav-freshclam \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Raise clamd's size limits (default 25M) to the practical ceiling this app
# uses instead of a hard max-file-size, then bake the signature DB into the
# image so a fresh container isn't scanning with an empty database.
RUN sed -i -E 's/^#?(StreamMaxLength|MaxScanSize|MaxFileSize)[[:space:]].*/\1 2000M/' /etc/clamav/clamd.conf \
 && for i in 1 2 3; do \
      freshclam && break; \
      if [ "$i" -lt 3 ]; then echo "freshclam attempt $i failed (mirror hiccup?), retrying in 30s"; sleep 30; else echo "freshclam failed after 3 attempts"; exit 1; fi; \
    done \
 && mkdir -p /var/run/clamav && chown clamav:clamav /var/run/clamav

WORKDIR /app
COPY project/backend/ ./
COPY docs/API_GUIDE.md ./docs/API_GUIDE.md
COPY docs/RELEASE_NOTES.json ./docs/RELEASE_NOTES.json
COPY docs/openapi.json ./docs/openapi.json
COPY --from=server-deps /build/node_modules ./node_modules
COPY --from=client-build /build/dist ./public
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
# Baked at image build (release.yml passes --build-arg VERSION=$TAG); read at
# runtime via process.env.APP_VERSION (utils/releaseNotes.js currentVersion()).
ARG VERSION
ENV APP_VERSION=$VERSION
ENV MONGODB_URI=mongodb://127.0.0.1:27017/sofos PORT=3000 NODE_ENV=production UPLOADS_DIR=/app/uploads BACKUPS_DIR=/app/backups LOGS_DIR=/app/logs SCAN_ENABLED=true
# Pre-created so the sofos-logs volume mounts onto an existing dir; both the
# entrypoint (mongod --logpath) and the app write here.
RUN mkdir -p /app/logs
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
