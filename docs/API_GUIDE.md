# Sofos API guide

Sofos organizes information in top-level workspaces. A workspace contains
projects, and projects can contain sub-projects. Tasks, notes, goals, links,
and files may live directly on either a workspace or a project. Tasks may
also contain subtasks.

All API responses are JSON except file downloads and `204 No Content`
responses. The base path is `/api`.

## Discover and authenticate

`GET /api` is public and returns the product name, current version, and links
to discovery endpoints. `GET /api/openapi.json` is also public.

Register a human account:

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "sam",
  "password": "a-long-password"
}
```

Register an agent account by adding `"isAgent": true`. Agents do not own an
account or workspace. The one-time `agentSetup` response includes the login
credentials, share code, guide URL, and first steps.

Log in:

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "sam",
  "password": "a-long-password"
}
```

Use the returned token on protected routes:

```http
Authorization: Bearer TOKEN
```

`POST /api/auth/logout` revokes only the current session. `DELETE
/api/auth/me` requires the password and exports an owner's account before
purging it.

## Core structure

```text
Account
└── Workspace
    ├── direct tasks, notes, goals, links, files
    └── Project
        ├── direct tasks, notes, goals, links, files
        └── Project
            └── ...
```

Every human account starts with one undeletable Home workspace. Sofos does
not create General projects. If an owner creates a task or note without a
container, it goes directly into Home. Agents must always name a workspace
or project.

Workspaces cannot be nested. A request containing `parentWorkspace` is
rejected. Use a project or sub-project instead.

## Roles and sharing

The role on a resource is one of these values:

- `reader` can view content
- `suggester` can submit changes for review
- `writer` can edit directly
- `owner` controls their full account

Sharing is account-wide or workspace-wide. A project cannot be shared on its
own. A workspace grant includes its projects and their content.

Create an invite:

```http
POST /api/memberships
Authorization: Bearer OWNER_TOKEN
Content-Type: application/json

{
  "shareCode": "SF-ABCDEFGH",
  "role": "suggester",
  "scope": "workspace",
  "target": "WORKSPACE_ID"
}
```

Use `"scope": "none"` and omit `target` for account-wide access. The grant
is pending until its recipient accepts it.

```text
GET    /memberships
POST   /memberships
PATCH  /memberships/:id
DELETE /memberships/:id
GET    /memberships/invites
POST   /memberships/invites/:id/accept
POST   /memberships/invites/:id/decline
```

## Workspaces

```text
GET    /workspaces
GET    /workspaces/:id
POST   /workspaces
PATCH  /workspaces/:id
DELETE /workspaces/:id
```

`GET /workspaces` returns `{ data: { owned, shared }, count }`. Workspace
creation is always top-level:

```json
{
  "name": "Work",
  "description": "Clients and internship work"
}
```

An account-level writer may create a workspace in a shared account by
including `superWorkspace`. A workspace writer cannot create sibling
workspaces. Deleting a workspace soft-deletes its projects and content. Home
cannot be deleted.

## Projects

```text
GET    /projects
GET    /projects/:id
POST   /projects
PATCH  /projects/:id
POST   /projects/:id/move
POST   /projects/:id/archive
POST   /projects/:id/restore
DELETE /projects/:id
```

Create a top-level project with `workspace`, or a sub-project with
`parentProject`. Exactly one is required.

```json
{
  "name": "Email RAG Assistant",
  "workspace": "WORKSPACE_ID",
  "status": "active",
  "tags": ["client-work", "ai"]
}
```

Project status is `active`, `blocked`, or `completed`. Status is for current
workflow state. Archive is separate. Archived project trees are hidden from
normal project lists, task lists, roll-ups, and search.

List options:

- `workspace=ID` lists top-level projects in a workspace
- `workspace=ID&deep=1` includes every project depth
- `parent=ID` lists direct sub-projects
- `tags=a,b` matches either tag
- `sort=az|za|newest|oldest`
- `archived=only` shows archived projects
- `archived=include` shows active and archived projects

Archive and restore always apply to the full project subtree.

Move a project tree beneath another project:

```json
{
  "parentProject": "DESTINATION_PROJECT_ID"
}
```

Move it to a workspace root, including a different workspace in the same
account:

```json
{
  "parentProject": null,
  "workspace": "DESTINATION_WORKSPACE_ID"
}
```

The server restamps every descendant and contained item. Cross-account moves
are rejected.

## Tasks and subtasks

```text
GET    /tasks
GET    /tasks/:id
POST   /tasks
PATCH  /tasks/:id
POST   /tasks/reorder
DELETE /tasks/:id
```

Create a workspace task with `workspace`, a project task with `project`, or a
subtask by also providing `parentTask`.

```json
{
  "title": "Implement upload flow",
  "project": "PROJECT_ID",
  "parentTask": "PARENT_TASK_ID",
  "priority": "high"
}
```

A subtask must use the same workspace and project as its parent. Cycles are
rejected. `GET /tasks?project=ID` rolls up tasks from every non-archived
sub-project. Add `own=1` for only the named project. Workspace task lists
include direct and project tasks, excluding archived projects.

When a parent has unfinished descendants, completing it returns `409`:

```json
{
  "error": {
    "code": "INCOMPLETE_SUBTASKS",
    "message": "This task has 2 unfinished subtasks.",
    "details": { "count": 2 }
  }
}
```

After user confirmation, repeat the update with `"completeSubtasks": true`.
The server completes all descendants before the parent. Reopening a subtask
automatically reopens any completed ancestors. Deleting or restoring a task
applies to its task subtree.

## Goals and roadmaps

```text
GET    /goals?workspace=ID
GET    /goals?project=ID
GET    /goals/summary
GET    /goals/:id
POST   /goals
PATCH  /goals/:id
POST   /goals/reorder
DELETE /goals/:id
```

Project and workspace goal lists roll up by default. Add `own=1` for direct
goals only. Tasks assigned to a goal must be compatible with the goal's
container.

## Notes, links, and files

Notes:

```text
GET    /notes?workspace=ID
GET    /notes?project=ID
GET    /notes/:id
POST   /notes
PATCH  /notes/:id
DELETE /notes/:id
```

Links:

```text
GET    /links?workspace=ID
GET    /links?project=ID
GET    /links/:id
POST   /links
PATCH  /links/:id
POST   /links/reorder
DELETE /links/:id
```

Files are uploaded through the chunked `/uploads` workflow and read through
`/attachments`. See the OpenAPI document for upload request fields.

Notes, links, and attachments show only direct content by default. Add
`includeSubprojects=1` to include descendants. Archived project content is
excluded from roll-ups.

## Suggestions

A suggester sends the same resource payload inside a suggestion:

```json
{
  "resourceType": "Task",
  "op": "create",
  "project": "PROJECT_ID",
  "payload": {
    "title": "Review the implementation"
  }
}
```

```text
GET    /suggestions
GET    /suggestions/review-summary
GET    /suggestions/:id
POST   /suggestions
DELETE /suggestions/:id
POST   /suggestions/:id/approve
POST   /suggestions/:id/reject
POST   /suggestions/:id/unapprove
POST   /suggestions/:id/unreject
POST   /suggestions/:id/unretract
```

Sharing remains workspace-scoped even when a suggestion targets a project.
Approving a parent-task completion follows the same subtask completion rule
as a direct edit. If approval returns `INCOMPLETE_SUBTASKS`, ask for explicit
confirmation and repeat `POST /suggestions/:id/approve` with
`{"completeSubtasks": true}`.

## Search, overview, history, and trash

```text
GET /me
GET /search?q=TEXT
GET /revisions?resource=ID&resourceType=TYPE
POST /revisions/:id/restore
GET /trash
POST /trash/:resourceType/:id/restore
DELETE /trash/:resourceType/:id
```

Search returns up to five workspaces, projects, tasks, notes, and goals per
type. It never returns archived project content. Trash is owner-only.
Permanent deletion is only available for an item already in trash.

## Concurrency and errors

Updates may include `ifVersion` with the `__v` from the last read. A stale
version returns `409` instead of overwriting someone else's edit.

Errors use this shape:

```json
{
  "error": {
    "message": "Human-readable message",
    "details": []
  }
}
```

Common statuses are `400` for invalid input, `401` for a missing or expired
session, `403` for insufficient role, `404` for inaccessible or missing
resources, and `409` for a conflict.
