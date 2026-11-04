# Project Management Center

This app is a web application for managing notes and tasks across your entire life. It is meant for anyone, who like me struggles with having a million organized apple notes (or other note app equivalents) and need some structure in your life. It is meant to help with organizing everything to make it easy to find to get stuff done.

See the root [`README.md`](../README.md) for the project overview and quickstart, and [`docs/`](../docs/) for the server deploy runbook and API guide.

## Tech Stack

- **Frontend:** React + Vite, React Router, react-markdown + remark-gfm, @dnd-kit (drag reorder)
- **Backend:** Node.js + Express, express-validator, express-rate-limit
- **Database:** MongoDB (Mongoose)
- **Authentication:** JWT (jsonwebtoken) + bcryptjs

## Features

- **Organization**: top-level workspaces → projects → sub-projects. Workspaces
  and projects directly own tasks, notes, goals, links, and files
- **Tasks:** true nested subtasks, roll-up views, and guarded parent completion
- **Project lifecycle:** active, blocked, and completed status plus a separate
  archive that is hidden by default and can be restored
- **Markdown notes** with live rendering inside projects
- **Goals & roadmap:** goal tracking with a visual roadmap view and drag-to-reorder; tasks can be assigned into a goal
- **Links:** a bookmark list per workspace/project, also drag-to-reorder
- **Auth & sharing:** open registration (JWT); every account is the owner of its own private space. Sharing works by share code at account or workspace scope as a reader, suggester, or writer, with an optional expiry date. A grant is a pending invite until the recipient accepts or declines it
- **Suggestions:** a suggester (or an agent with suggester access) proposes a create/update/delete, which takes effect only once a writer or the owner approves it
- **Agent accounts:** a signup flag for accounts meant to be driven by LLMs — they own no tenant of their own and act purely through grants given to them; onboarding is self-service via a `GET /api/guide` endpoint and an `agentSetup` block (credentials, share code, guide URL) returned on agent registration
- **History & trash:** every edit is recorded as a restorable revision; deletes are soft (recoverable from trash) with cascade semantics; concurrent edits are caught with optimistic-concurrency 409s
- **Cascade delete:** deleting a workspace/project removes everything inside it
- **Sessions:** per-device server-side sessions — logging in from a second device doesn't affect the first, and logout only revokes the calling device's session
- **Account deletion:** exports the account's data before purging it
- **File attachments:** chunked uploads per workspace/project, scanned in-container by ClamAV before they're stored
- **Security: secrets** in env vars, input validation, CORS, and login rate-limiting

## Getting Started (Local Setup)

### Prerequisites

- Node.js 22+ and a MongoDB connection string

### Installation & Run

```bash
# Backend
cd project/backend
npm install
npm run seed      # DEV ONLY: wipes the DB, seeds demo accounts (admin/guest/agent) with sample grants
npm run dev

# Frontend (separate terminal)
cd project/frontend
npm install
npm run dev
```

Frontend runs at <http://localhost:5173>, backend at <http://localhost:3000> (the Vite proxy forwards `/api` to the backend in dev).

## Self-hosting (Docker)

### Prerequisites

- Docker

### Run

```bash
cp .env.example .env    # then edit .env and set a real JWT_SECRET
docker compose up -d --build
```

Open <http://localhost:3000> and register your first account — a fresh install is empty, there is no seeding in the container. Data persists in the `sofos-mongo-data` volume across rebuilds. `docker compose down` keeps that data; `docker compose down -v` wipes it.

## Environment Variables

Names only — never commit real values.

### Container (root `.env`, used by `docker compose`)

| Variable | Description |
|---|---|
| `JWT_SECRET` | Secret used to sign auth tokens |
| `SOFOS_PORT` | Host port the app is published on (optional, default 3000) |

`MONGODB_URI` and `PORT` are baked into the image for the container (`mongodb://127.0.0.1:27017/sofos` and `3000`) and aren't configurable via `.env`. `VITE_API_URL` is unset because the container serves the frontend and API from the same origin.

### Dev (`project/backend/.env`, local development only)

| Variable | Used by | Description |
|---|---|---|
| `MONGODB_URI` | backend | MongoDB connection string |
| `JWT_SECRET` | backend | Secret used to sign auth tokens |
| `PORT` | backend | Port to listen on |
| `CLIENT_URL` | backend | Allowed CORS origin (the dev frontend URL) |
| `SEED_USERNAME` | backend | Username for the main account created by `npm run seed` |
| `SEED_PASSWORD` | backend | Password for that seeded account |
| `VITE_API_URL` | frontend | Base URL of the backend API (empty in dev; the Vite proxy handles `/api`) |

## Project Structure

```
project/
├── frontend/    # React + Vite app (pages, components, services, AuthContext)
└── backend/     # Express API (models, controllers, routes, validators, middleware, seed.js)
```

## Author

Samuel Shmidman
