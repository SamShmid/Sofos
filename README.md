[![Open in Codespaces](https://classroom.github.com/assets/launch-codespace-2972f46106e565e64193e422d61a12cf1da4916b45550586e14ef0a7c637dd04.svg)](https://classroom.github.com/open-in-codespaces?assignment_repo_id=24169085)
# COSI 152A: Web Application Development  

## Final Project  

**Due:** Wednesday, July 01, 11:59 PM     
---

## 1. Overview

The Final Project is a polished, deployed, full-stack web application of your own design. It is the capstone of the course: it asks you to combine everything you have practiced in the assignments — React frontend, an Express/Node backend, a database, authentication, and deployment — into one coherent product that you own end to end.

You will choose a project title and scope, build the application independently outside of class, deploy it to free hosting, and submit a short recorded demo of the finished product. The emphasis is on demonstrating that **you understand and can explain every part of what you built.**

---

## 2. Learning Goals

By completing this project you will demonstrate that you can:

- Design and build a complete full-stack web application from scratch.
- Implement a React frontend with client-side routing, forms, and state management.
- Design and implement a backend REST API with clean routing and middleware.
- Persist data in a database using a sensible schema.
- Implement a working authentication flow and protect routes.
- Deploy both frontend and backend to live, publicly reachable URLs.
- Communicate and defend your technical decisions clearly.

---

## 3. Requirements

Your application must be **full-stack** and **deployed**. Within that frame you have freedom of topic and technology — pick something you find genuinely interesting.

### 3.1 Required capabilities

Every project, regardless of topic, must include all of the following:

1. **React frontend (or equivalent component framework)** — a multi-view single-page application using client-side routing, with at least one meaningful form and managed application state.
2. **Backend REST API** — your own server exposing REST endpoints, with clean routing, middleware, and input validation. Node.js/Express is the default and fully supported; an equivalent backend (e.g., another Node framework) is acceptable if you can support it yourself.
3. **Database persistence** — data is stored in and queried from a database with a thought-out schema. Choice of database (SQL or NoSQL) is yours.
4. **Full CRUD** — users can create, read, update, and delete the core resource of your app through the UI, backed by the API and database.
5. **Authentication** — a real login/logout flow (e.g., JWT or session-based). At least some functionality or data must be gated behind authentication, with protected routes on both client and server.
6. **Security & configuration basics** — secrets in environment variables, input sanitization, and correct CORS configuration.
7. **Deployment** — frontend and backend both deployed to free hosting and reachable via public URLs. The deployed app must actually work, not just build.

> **Flexible stack note:** React, Node/Express, and MongoDB database is the supported, recommended path and matches what we covered in class. You may substitute comparable full-stack technologies of your choice, but you are then responsible for supporting your own tooling, and the required capabilities above still apply in full.

### 3.2 Scope guidance

Aim for **depth over breadth**: one core feature done well — with real CRUD, auth, persistence, and a clean UI — beats five half-built features. A good rule of thumb is a single primary resource (e.g., notes, tasks, recipes, bookmarks, reviews) that a logged-in user owns and manages, plus the supporting screens around it.

Because this is an accelerated summer course, choose a scope you can realistically finish and polish in the time available.

---

## 4. Repository Structure

This repository was created for you through GitHub Classroom and already contains the layout you must build into:

```
.
├── project/
│   ├── frontend/     # Your React app lives here
│   ├── backend/      # Your Express/Node API lives here
│   └── README.md     # Your project's README  
├── scripts/
│   ├── setup.sh      # Installs dependencies
│   └── submit.sh     # Commits and pushes your work
└── README.md         # This file — the project instructions
```

Build your application **inside the `project/` folder**, keeping your frontend and backend in their own subfolders. You may **rename `frontend/` and `backend/`** to match your project (e.g., `recipe-app-client/` and `recipe-app-server/`), and you are free to organize the contents of those folders as your project requires. Do not move or rename the top-level structure.

A **`project/README.md`** skeleton is already provided. Fill it in to document your specific application: project description, tech stack, local setup instructions, environment-variable list (names only, no secret values), and the deployed/demo links.  

---

## 5. Deliverables

Submit all of the following:

1. **GitHub repository** — this repo, with your complete frontend and backend inside `project/`, plus the completed `project/README.md` skeleton (see Section 4).
2. **Deployed links** — working public URL(s) for the live frontend, and the backend API (or a note on how the frontend reaches it). The app must be functional when opened. Place these in your `project/README.md`.
3. **Demo video** — a short screen recording (≈3–5 minutes) walking through the app's main features, including signing in and a full CRUD cycle. **Upload the video to your Google Drive** (sharing set so anyone with the link can view) and add the link to your `project/README.md` alongside the deployed links.

---

## 6. Demo Video & Optional Presentation

Your **recorded demo video** (Section 5) is the required demonstration of your project. A good demo covers:

- **What the app does**, shown end to end — including login and a full CRUD action.
- **The architecture** at a high level: how the frontend, backend, and database fit together.
- **A technical highlight:** one part you are proud of or found hard — e.g., the auth flow, a tricky piece of state, or an API endpoint — and *why* you built it that way.
- **A brief reflection:** what you would improve with more time.

In addition, there will be an **optional in-class presentation for extra credit** on a date announced on Moodle. If you choose to present, you'll give a brief live walkthrough and answer questions. Either way, be prepared to explain any part of your code.

---

## 7. Grading (30% of final grade)

Grading is holistic and weighted across the categories below. Each is assessed on whether the capability is present, works, and is something you can explain.

- **Functionality & completeness (~30%)** — required capabilities work end to end: full CRUD, persistence, and a usable UI. The deployed app actually functions.
- **Authentication & security (~15%)** — a working auth flow with protected routes; secrets and CORS handled correctly.
- **Full-stack integration & deployment (~20%)** — frontend, backend, and database are properly connected, and the app is live at public URLs.
- **Code quality & engineering practice (~15%)** — readable, organized code; sensible schema and API design; clean Git history and a clear README.
- **Demo & ownership (~20%)** — a clear demo video; you can explain your decisions and answer questions about your own code. *(An optional in-class presentation may earn extra credit; see Section 6.)*

Projects that are ambitious but partially complete, yet clearly understood and well explained, are valued over projects that appear complete but that you cannot account for.

---

## 8. Use of AI / LLM Tools

Per the course policy, you may use LLMs (ChatGPT, GitHub Copilot, Gemini, or similar) as **assistants, not authors.** AI tools should support your thinking; they should not replace your understanding. This applies fully to the Final Project.

You must:

1. Review and understand all code you submit.
2. Be able to explain your implementation in a quiz, in your demo, or if asked about your code.
3. Not use AI tools to write your reflection or to answer conceptual questions for you.

**If you cannot explain a piece of your code, do not submit it.** Your demo, quizzes, and any Q&A are designed to assess your personal understanding of your own work. Misrepresenting AI-generated code as your own work without understanding or reflection may be treated as academic misconduct. See the syllabus and Brandeis [Student Rights & Community Standards](https://www.brandeis.edu/student-rights-community-standards/).

---

## 9. Quick Checklist

Before you submit, confirm:

- [ ] React frontend with routing, a form, and managed state
- [ ] Express/Node (or equivalent) REST API with validation
- [ ] Database with a defined schema
- [ ] Full CRUD wired through UI → API → database
- [ ] Working login/logout with at least one protected route
- [ ] Secrets in env vars; CORS configured; nothing sensitive committed
- [ ] Frontend **and** backend deployed and reachable
- [ ] Code lives inside `project/` (frontend and backend subfolders, named as you like)
- [ ] `project/README.md` skeleton filled in with description, setup, deployed URLs, and demo link
- [ ] Demo video (≈3–5 min) recorded, uploaded to Google Drive, link added to `project/README.md`
- [ ] You can explain every part of your code

---

## Getting Started

If you are using GitHub Codespaces, the environment should be prepared automatically.

To install dependencies manually:

```bash
./scripts/setup.sh
```

---

## Working on the Project

Start from the project link posted on Moodle:

1. Click the project link.
2. Click **"Accept this assignment"** to create your personal repository.
3. Click **"Open in Codespaces"** to launch your dev environment.

You'll be taken to a fully configured cloud-based VSCode editor. No setup is needed — just log in and start coding. You do need an active internet connection.

---

## Submission

Work is submitted via GitHub. Commit and push:

```bash
./scripts/submit.sh
```

Your latest pushed version before the deadline will be graded.

---

## Feeling Stuck?

Here's what to do:

1. Review the project instructions and example materials posted on Moodle.
2. Post conceptual questions on the **"Ask the Class" forum** on Moodle. Do **not** post code publicly.
3. Search online for error messages or docs related to the issue.
4. Attend office hours for help.

---

Good luck and enjoy building your apps!

— Prof. Hadi Mohammadi
hadi@brandeis.edu

<!-- END GENERAL INSTRUCTIONS -->
