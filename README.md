# Sofos

Sofos is a self-hosted app for organizing tasks, notes, goals, links and files.
You put things in **workspaces**, split workspaces into **projects** (and
sub-projects, as deep as you like), and share exactly the pieces you want with
other people or with AI agents.

It is built for people who have too many notes apps and want one place with
real structure.

> Formerly **Yitro**. It started as a Brandeis course project (COSI 152A) and
> grew from there.

## What it does

- **Workspaces and projects.** Workspaces are the top level. Projects live
  inside them and can nest. Tasks, notes, goals, links and files can sit on a
  workspace or on any project. Tasks can have subtasks.
- **Sharing.** Every account is private by default. You share a whole account
  or a single workspace as a *reader*, *suggester* or *writer*, with an
  optional expiry. The other person has to accept the invite.
- **Suggestions.** A suggester proposes a change (create, edit, delete), and it
  only takes effect when a writer or the owner approves it, much like
  "Suggesting" mode in Google Docs.
- **Agent accounts.** You can sign up an account meant for an LLM agent. It
  owns nothing itself and can only touch what you share with it. The API has a
  built-in guide (`GET /api/guide`) so an agent can onboard itself.
- **Notes.** Markdown notes with live preview (CodeMirror 6), threaded
  comments and word-level suggestion review.
- **Goals and roadmap.** Goals shown as a drag-to-reorder roadmap; tasks can
  be assigned to a goal.
- **History and trash.** Every edit is saved as a revision you can restore.
  Deletes go to a trash you can recover from. Two people editing the same
  thing get a conflict instead of silently overwriting each other.
- **File attachments.** Chunked uploads, virus-scanned by ClamAV inside the
  container before they are stored.
- **One container.** The Docker image bundles MongoDB, the API and the web
  app, so a self-hosted install is a single service.

## Tech stack

- Frontend: React 19 + Vite, React Router, CodeMirror 6, dnd-kit
- Backend: Node.js + Express 5, Mongoose, express-validator, JWT auth (bcrypt)
- Database: MongoDB 7
- Packaging: one Docker image (MongoDB + ClamAV + Node)

## Run it locally

### Option A: Docker (easiest)

Needs Docker with the Compose plugin.

```bash
git clone https://github.com/SamShmid/Yitro.git sofos
cd sofos
cp .env.example .env        # then set JWT_SECRET to a long random string
docker compose up -d --build
```

Open <http://localhost:3000> and register the first account. A fresh install
is empty.

The image runs ClamAV, which needs about 1.5 GB of RAM. On a small machine,
set `SCAN_ENABLED=false` in `.env`.

### Option B: Node + MongoDB (for development)

Needs Node.js 22 or newer and a MongoDB you can connect to (for example
`docker run -d -p 27017:27017 mongo:7.0`).

```bash
# Backend
cd project/backend
npm ci
export MONGODB_URI=mongodb://localhost:27017/sofos-dev
export JWT_SECRET=dev-only-secret
export SCAN_ENABLED=false
npm run seed      # DEV ONLY: wipes this database and adds demo accounts
npm run dev       # API on http://localhost:3000

# Frontend (second terminal)
cd project/frontend
npm ci
npm run dev       # app on http://localhost:5173, proxies /api to the backend
```

`npm run seed` creates demo accounts `admin`, `guest` and `agent`. Their
password is `changeme123` unless you set `SEED_PASSWORD`. Never run the seed
against a database you care about.

More detail (all environment variables, project layout) is in
[`project/README.md`](project/README.md).

## API overview

Everything is JSON under `/api`. Log in with `POST /api/auth/login` and send
the token as `Authorization: Bearer <token>`.

| Area | Path |
| --- | --- |
| Discovery (public) | `GET /api`, `GET /api/openapi.json`, `GET /api/guide` |
| Accounts and sessions | `/api/auth`, `/api/me` |
| Structure | `/api/workspaces`, `/api/projects` |
| Content | `/api/tasks`, `/api/notes`, `/api/goals`, `/api/links`, `/api/tags` |
| Files | `/api/uploads` (chunked upload), `/api/attachments` |
| Sharing | `/api/memberships` |
| Review | `/api/suggestions`, `/api/comments` |
| Safety nets | `/api/revisions`, `/api/trash` |
| Search | `/api/search` |

The full guide, written so an LLM agent can follow it, is
[`docs/API_GUIDE.md`](docs/API_GUIDE.md). The machine-readable spec is
[`docs/openapi.json`](docs/openapi.json).

## Tests

The tests are live API suites: they start from a real MongoDB and a running
server. Use a throwaway database.

```bash
cd project/backend
export MONGODB_URI=mongodb://localhost:28017/sofos-test JWT_SECRET=test PORT=3301 SCAN_ENABLED=false
npm run seed
node server.js &
API_URL=http://localhost:3301/api npm run test:api        # 54 checks

MONGODB_URI=mongodb://localhost:28017/sofos-migration-test npm run test:migration   # 20 checks
```

The frontend is checked with `npm run build` and `npm run lint` in
`project/frontend`.

## Self-hosting from a registry

[`docs/DEPLOY.md`](docs/DEPLOY.md) covers running a released image with
`compose.deploy.yml`, updates, backups and log retention.
[`docs/SOFOS_V4_MIGRATION.md`](docs/SOFOS_V4_MIGRATION.md) covers upgrading a
pre-v4 (Yitro) database.

CI lives in [`.forgejo/workflows`](.forgejo/workflows) because the project is
developed on a self-hosted Forgejo instance. Those workflows do not run on
GitHub.

## Status

- **Version 4.0.0** (October 2026). This is the release that renamed Yitro to
  Sofos and simplified the structure to workspaces and nested projects.
- I use it every day for my own tasks and projects, on my own server. There is
  no public hosted version.
- It is a one-person project. Expect rough edges: for example, the frontend
  ships as one large bundle (about 1 MB before gzip), and the UI has been
  checked mainly at a desktop width (1440px) and a phone width (390px).
- Design notes and mockups for ideas that are not built yet are in
  [`docs/design`](docs/design).

## License

See [`LICENSE`](LICENSE).
