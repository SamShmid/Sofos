# Sofos

Self-hosted tasks, notes, goals and files, organized into workspaces and nested projects. Formerly Yitro.

- Share a workspace as reader, suggester or writer; suggestions wait for approval
- Agent accounts: an LLM agent sees only what you share, and `GET /api/guide` teaches it the API
- Markdown notes with comments, a goals roadmap, revision history and trash
- File uploads, virus-scanned with ClamAV
- One Docker image: MongoDB, API and web app

React 19 + Vite · Node.js + Express 5 · MongoDB 7

## Run

```bash
git clone https://github.com/SamShmid/Sofos.git && cd Sofos
cp .env.example .env    # set JWT_SECRET
docker compose up -d --build
```

Open http://localhost:3000 and register. ClamAV needs about 1.5 GB of RAM; set `SCAN_ENABLED=false` on small machines.

## Develop

Node.js 22+ and a MongoDB (`docker run -d -p 27017:27017 mongo:7.0`).

```bash
cd project/backend && npm ci
MONGODB_URI=mongodb://localhost:27017/sofos-dev JWT_SECRET=dev SCAN_ENABLED=false npm run dev   # :3000
cd project/frontend && npm ci && npm run dev                                                    # :5173
```

`npm run seed` wipes the database and adds demo accounts (`admin`, `guest`, `agent`). Dev only.

Tests: `npm run test:api` and `npm run test:migration` in `project/backend`, against a throwaway database. Details in [project/README.md](project/README.md).

## API

JSON under `/api`, bearer token from `POST /api/auth/login`. Guide: [docs/API_GUIDE.md](docs/API_GUIDE.md). Spec: [docs/openapi.json](docs/openapi.json).

## Deploy

[docs/DEPLOY.md](docs/DEPLOY.md) for running a released image. [docs/SOFOS_V4_MIGRATION.md](docs/SOFOS_V4_MIGRATION.md) for upgrading a Yitro database.

## License

MIT © 2026 Samuel Shmidman
