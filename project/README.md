# Project Management Center

This app is a web application for managing notes and tasks across your entire life. It is meant for anyone, who like me struggles with having a million organized apple notes (or other note app equivalents) and need some structure in your life. It is meant to help with organizing everything to make it easy to find to get stuff done.

## Live Links

| Resource | URL |
|---|---|
| Frontend (deployed) | https://final-project-samshmid-1.onrender.com |
| Backend API (deployed) | https://final-project-samshmid.onrender.com |
| Demo video (Google Drive) | https://drive.google.com/file/d/1rP2wPuMGqG4wMNS-W45TdZPA3JCy5jUf/view?usp=sharing |


## Tech Stack

- **Frontend:** React + Vite, React Router, react-markdown + remark-gfm
- **Backend:** Node.js + Express, express-validator, express-rate-limit
- **Database:** MongoDB (Mongoose)
- **Authentication:** JWT (jsonwebtoken) + bcryptjs
- **Hosting:** Render (frontend Static Site + backend Web Service), MongoDB Atlas

## Features

- **Organization**: Workspaces (Overarching category) → Projects (Specific sub-category) → (Notes + Tasks) (Things in the category), 
- Every workspace has a Home (default) and a General project for items that cannot be easily organized
- **Markdown notes** with live rendering inside projects
- **Tasks** with complete/incomplete toggling
- **Auth:** register/login (JWT); writer role can edit, reader role is view-only
- **Cascade delete:** deleting a workspace/project removes everything inside it
- **Security: secrets** in env vars, input validation, CORS, and login rate-limiting

## Getting Started (Local Setup)

### Prerequisites

- Node.js 20+ and a MongoDB connection string (MongoDB Atlas)

### Installation & Run

```bash
# Backend
cd project/backend
npm install
npm run seed      # creates the Home workspace + General project + a writer account
npm run dev

# Frontend (separate terminal)
cd project/frontend
npm install
npm run dev
```

Frontend runs at <http://localhost:5173>, backend at <http://localhost:3000> (the Vite proxy forwards `/api` to the backend in dev).

## Environment Variables

Names only — never commit real values.

| Variable | Used by | Description |
|---|---|---|
| `MONGODB_URI` | backend | MongoDB Atlas connection string |
| `JWT_SECRET` | backend | Secret used to sign auth tokens |
| `PORT` | backend | Port to listen on (Render sets this automatically) |
| `CLIENT_URL` | backend | Allowed CORS origin (the deployed frontend URL) |
| `SEED_USERNAME` | backend | Username for the writer account created by `npm run seed` |
| `SEED_PASSWORD` | backend | Password for that seeded writer account |
| `VITE_API_URL` | frontend | Base URL of the backend API (empty in dev; backend URL in prod) |

## Project Structure

```
project/
├── frontend/    # React + Vite app (pages, components, services, AuthContext)
└── backend/     # Express API (models, controllers, routes, validators, middleware, seed.js)
```

## Author

Samuel Shmidman — samuelshmidman@brandeis.edu
