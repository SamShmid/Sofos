#!/usr/bin/env node
if (!process.env.API_URL) {
  console.error("Refusing to run without an explicit API_URL for an isolated test server.");
  process.exit(1);
}

let target;
try {
  target = new URL(process.env.API_URL);
} catch {
  console.error("API_URL must be a valid URL.");
  process.exit(1);
}
if (target.port === "3000") {
  console.error("Refusing to run against port 3000. Use a throwaway test server.");
  process.exit(1);
}

const BASE = process.env.API_URL.replace(/\/$/, "");
let checks = 0;

function ok(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`Check ${checks} failed. ${message}`);
}

async function request(method, path, { token, body, status = 200 } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status !== status) {
    throw new Error(`${method} ${path} returned ${response.status}, expected ${status}. ${JSON.stringify(payload)}`);
  }
  return payload;
}

const get = (path, token, status = 200) => request("GET", path, { token, status });
const post = (path, token, body, status = 200) => request("POST", path, { token, body, status });
const patch = (path, token, body, status = 200) => request("PATCH", path, { token, body, status });
const del = (path, token, status = 204) => request("DELETE", path, { token, status });

async function main() {
  const discovery = await get("");
  ok(discovery.data.name === "Sofos", "Discovery must use the Sofos name");

  const login = await post("/auth/login", null, { username: "admin", password: "changeme123" });
  const token = login.token;
  ok(Boolean(token), "Admin login must return a token");
  ok(login.data.shareCode.startsWith("SF-"), "Share codes must use the SF prefix");

  const initial = await get("/workspaces", token);
  const home = initial.data.owned.find((workspace) => workspace.isDefault);
  ok(Boolean(home), "A human account must have a Home workspace");
  ok(initial.data.owned.every((workspace) => workspace.parentWorkspace === undefined), "Workspaces must be top-level");
  const homeProjects = await get(`/projects?workspace=${home._id}&deep=1`, token);
  ok(homeProjects.data.every((project) => !project.isDefault), "Home must not contain a General project");

  const suffix = Date.now().toString(36);
  const alpha = (await post("/workspaces", token, { name: `Alpha ${suffix}` }, 201)).data;
  const beta = (await post("/workspaces", token, { name: `Beta ${suffix}` }, 201)).data;
  const nestedWorkspace = await post("/workspaces", token, { name: `Nested ${suffix}`, parentWorkspace: alpha._id }, 400);
  ok(nestedWorkspace.error.details.some((detail) => detail.path === "parentWorkspace"), "Nested workspaces must be rejected explicitly");
  await get(`/workspaces/${alpha._id}/move`, token, 404);
  checks += 1;

  const root = (await post("/projects", token, {
    name: `Root ${suffix}`,
    workspace: alpha._id,
    status: "active",
    tags: ["client-work"],
  }, 201)).data;
  const child = (await post("/projects", token, {
    name: `Child ${suffix}`,
    parentProject: root._id,
    status: "blocked",
  }, 201)).data;
  ok(child.status === "blocked", "Project lifecycle status must be saved");
  ok(String(child.parentProject) === root._id, "Projects must support sub-projects");

  const directTask = (await post("/tasks", token, { title: `Direct ${suffix}`, workspace: alpha._id }, 201)).data;
  ok(String(directTask.workspace) === alpha._id && directTask.project == null, "A workspace must own tasks directly");
  const directNote = (await post("/notes", token, { title: `Workspace note ${suffix}`, content: "direct", workspace: alpha._id }, 201)).data;
  ok(directNote.project == null, "A workspace must own notes directly");

  const rootNote = (await post("/notes", token, { title: `Root note ${suffix}`, content: "root", project: root._id }, 201)).data;
  const childNote = (await post("/notes", token, { title: `Child note ${suffix}`, content: "child", project: child._id }, 201)).data;
  const childComment = (await post("/comments", token, {
    note: childNote._id,
    body: "Follow this project move",
    anchor: { quote: "child", before: "", after: "" },
  }, 201)).data;
  const directComment = (await post("/comments", token, {
    note: directNote._id,
    body: "Follow this note move",
    anchor: { quote: "direct", before: "", after: "" },
  }, 201)).data;
  const ownNotes = await get(`/notes?project=${root._id}`, token);
  const rolledNotes = await get(`/notes?project=${root._id}&includeSubprojects=1`, token);
  ok(ownNotes.data.some((note) => note._id === rootNote._id) && !ownNotes.data.some((note) => note._id === childNote._id), "Notes must default to the current project only");
  ok(rolledNotes.data.some((note) => note._id === childNote._id), "Notes must optionally include sub-projects");

  await post("/links", token, { title: `Root link ${suffix}`, url: "https://example.com/root", project: root._id }, 201);
  const childLink = (await post("/links", token, { title: `Child link ${suffix}`, url: "https://example.com/child", project: child._id }, 201)).data;
  const ownLinks = await get(`/links?project=${root._id}`, token);
  const rolledLinks = await get(`/links?project=${root._id}&includeSubprojects=1`, token);
  ok(!ownLinks.data.some((link) => link._id === childLink._id), "Links must default to the current project only");
  ok(rolledLinks.data.some((link) => link._id === childLink._id), "Links must optionally include sub-projects");

  const parentTask = (await post("/tasks", token, { title: `Parent ${suffix}`, project: child._id }, 201)).data;
  const childTask = (await post("/tasks", token, { title: `Subtask ${suffix}`, project: child._id, parentTask: parentTask._id }, 201)).data;
  ok(String(childTask.parentTask) === parentTask._id && childTask.ancestors.map(String).includes(parentTask._id), "Tasks must support true nesting");
  await patch(`/tasks/${parentTask._id}`, token, { parentTask: childTask._id }, 400);
  checks += 1;

  const blockedCompletion = await patch(`/tasks/${parentTask._id}`, token, { status: "done" }, 409);
  ok(blockedCompletion.error.code === "INCOMPLETE_SUBTASKS", "Completing a parent with unfinished subtasks must require confirmation");
  await patch(`/tasks/${parentTask._id}`, token, { status: "done", completeSubtasks: true });
  let completedChild = (await get(`/tasks/${childTask._id}`, token)).data;
  ok(completedChild.status === "done" && completedChild.completed === true, "Confirmed completion must complete descendants");
  await patch(`/tasks/${childTask._id}`, token, { status: "todo" });
  const reopenedParent = (await get(`/tasks/${parentTask._id}`, token)).data;
  ok(reopenedParent.status === "todo" && reopenedParent.completed === false, "Reopening a subtask must reopen completed ancestors");

  const completionSuggestion = (await post("/suggestions", token, {
    resourceType: "Task",
    op: "update",
    resource: parentTask._id,
    payload: { status: "done" },
  }, 201)).data;
  const blockedApproval = await post(`/suggestions/${completionSuggestion._id}/approve`, token, undefined, 409);
  ok(blockedApproval.error.code === "INCOMPLETE_SUBTASKS", "Approving parent completion must require explicit subtask confirmation");
  await post(`/suggestions/${completionSuggestion._id}/approve`, token, { completeSubtasks: true });
  completedChild = (await get(`/tasks/${childTask._id}`, token)).data;
  ok(completedChild.status === "done", "Confirmed suggestion approval must complete descendants");

  const rolledTasks = await get(`/tasks?project=${root._id}`, token);
  const ownTasks = await get(`/tasks?project=${root._id}&own=1`, token);
  const rolledChild = rolledTasks.data.find((task) => task._id === childTask._id);
  ok(Boolean(rolledChild?.sourceProject?.name), "Rolled-up tasks must show their source project");
  ok(!ownTasks.data.some((task) => task._id === childTask._id), "own=1 must disable task roll-up");

  const childGoal = (await post("/goals", token, { title: `Child goal ${suffix}`, project: child._id }, 201)).data;
  const rolledGoals = await get(`/goals?project=${root._id}`, token);
  const ownGoals = await get(`/goals?project=${root._id}&own=1`, token);
  ok(rolledGoals.data.find((goal) => goal._id === childGoal._id)?.sourceProject?.name === child.name, "Rolled-up goals must show their source project");
  ok(!ownGoals.data.some((goal) => goal._id === childGoal._id), "own=1 must disable goal roll-up");

  await post(`/projects/${child._id}/archive`, token, {});
  const tasksWithArchivedChild = await get(`/tasks?project=${root._id}`, token);
  const goalsWithArchivedChild = await get(`/goals?project=${root._id}`, token);
  const notesWithArchivedChild = await get(`/notes?project=${root._id}&includeSubprojects=1`, token);
  ok(!tasksWithArchivedChild.data.some((task) => task._id === childTask._id), "Task roll-up must exclude archived sub-projects");
  ok(!goalsWithArchivedChild.data.some((goal) => goal._id === childGoal._id), "Goal roll-up must exclude archived sub-projects");
  ok(!notesWithArchivedChild.data.some((note) => note._id === childNote._id), "Note roll-up must exclude archived sub-projects");
  await post(`/projects/${child._id}/restore`, token, {});

  const independentLeaf = (await post("/projects", token, {
    name: `Independent archive ${suffix}`,
    parentProject: child._id,
  }, 201)).data;
  await post(`/projects/${independentLeaf._id}/archive`, token, {});

  const refileParent = (await post("/tasks", token, { title: `Refile parent ${suffix}`, workspace: alpha._id }, 201)).data;
  const refileChild = (await post("/tasks", token, {
    title: `Refile child ${suffix}`,
    workspace: alpha._id,
    parentTask: refileParent._id,
  }, 201)).data;
  await del(`/tasks/${refileChild._id}`, token);
  await patch(`/tasks/${refileParent._id}`, token, { workspace: beta._id });
  await post(`/trash/Task/${refileChild._id}/restore`, token, {});
  const restoredRefileChild = (await get(`/tasks/${refileChild._id}`, token)).data;
  ok(String(restoredRefileChild.workspace) === beta._id && restoredRefileChild.ancestors.map(String).includes(refileParent._id), "Re-filing must restamp trashed descendants before restore");

  await patch(`/notes/${directNote._id}`, token, { workspace: beta._id });

  await post(`/projects/${root._id}/move`, token, { workspace: beta._id, parentProject: null });
  const movedRoot = (await get(`/projects/${root._id}`, token)).data;
  const movedChild = (await get(`/projects/${child._id}`, token)).data;
  completedChild = (await get(`/tasks/${childTask._id}`, token)).data;
  ok(String(movedRoot.workspace._id) === beta._id, "A project tree must move between workspaces");
  ok(String(movedChild.workspace._id) === beta._id && movedChild.ancestors.map((ancestor) => String(ancestor._id || ancestor)).includes(root._id), "A move must restamp descendant projects");
  ok(String(completedChild.workspace) === beta._id, "A move must restamp contained items");

  await post(`/projects/${root._id}/archive`, token, {});
  const activeProjects = await get(`/projects?workspace=${beta._id}&deep=1`, token);
  const archivedProjects = await get(`/projects?workspace=${beta._id}&deep=1&archived=only`, token);
  const visibleTasks = await get(`/tasks?workspace=${beta._id}`, token);
  const searchArchived = await get(`/search?q=${encodeURIComponent(`Subtask ${suffix}`)}`, token);
  ok(!activeProjects.data.some((project) => project._id === root._id), "Archived projects must be hidden by default");
  ok(archivedProjects.data.some((project) => project._id === root._id) && archivedProjects.data.some((project) => project._id === child._id), "Archiving must cover the live project tree");
  ok(!visibleTasks.data.some((task) => task._id === childTask._id), "Archived project tasks must be hidden from workspace lists");
  ok(!searchArchived.data.tasks.some((task) => task._id === childTask._id), "Archived project content must be hidden from search");
  await post(`/projects/${child._id}/restore`, token, {}, 409);
  checks += 1;
  await post(`/projects/${root._id}/restore`, token, {});
  const restoredProjects = await get(`/projects?workspace=${beta._id}&deep=1`, token);
  ok(restoredProjects.data.some((project) => project._id === child._id), "Restore must restore the whole project tree");
  const stillArchivedProjects = await get(`/projects?workspace=${beta._id}&deep=1&archived=only`, token);
  ok(stillArchivedProjects.data.some((project) => project._id === independentLeaf._id), "Restoring a parent must preserve an independently archived descendant");

  await del(`/tasks/${parentTask._id}`, token);
  const trash = await get("/trash", token);
  ok(trash.data.some((item) => item.resourceType === "Task" && item.doc._id === parentTask._id), "Only the deleted task-tree root must appear in trash");
  ok(!trash.data.some((item) => item.resourceType === "Task" && item.doc._id === childTask._id), "Cascaded subtasks must be folded into their root in trash");
  await post(`/trash/Task/${childTask._id}/restore`, token, {}, 400);
  checks += 1;
  await post(`/trash/Task/${parentTask._id}/restore`, token, {});
  const restoredTaskTree = await get(`/tasks?project=${child._id}&own=1`, token);
  ok(restoredTaskTree.data.some((task) => task._id === childTask._id), "Restoring a task must restore its subtree");

  const inviteeName = `invitee_${suffix}`;
  const invitee = await post("/auth/register", null, { username: inviteeName, password: "test-password-123" }, 201);
  ok(invitee.data.shareCode.startsWith("SF-"), "New accounts must receive an SF share code");
  const badProjectGrant = await post("/memberships", token, {
    shareCode: invitee.data.shareCode,
    role: "reader",
    scope: "project",
    target: root._id,
  }, 400);
  ok(badProjectGrant.error.details.some((detail) => detail.path === "scope"), "Project-level sharing must be rejected");
  const invite = (await post("/memberships", token, {
    shareCode: invitee.data.shareCode,
    role: "reader",
    scope: "workspace",
    target: beta._id,
  }, 201)).data;
  ok(String(invite.workspace._id) === beta._id, "Workspace must be the smallest sharing scope");
  const inviteList = await get("/memberships/invites", invitee.token);
  ok(inviteList.data.some((item) => item._id === invite._id), "A workspace grant must remain pending until accepted");
  await post(`/memberships/invites/${invite._id}/accept`, invitee.token, {});
  const sharedWorkspace = await get(`/workspaces/${beta._id}`, invitee.token);
  const sharedProject = await get(`/projects/${root._id}`, invitee.token);
  ok(sharedWorkspace.effectiveRole === "reader", "An accepted workspace grant must expose the workspace");
  ok(sharedProject.effectiveRole === "reader", "Projects must inherit workspace sharing");
  await patch(`/tasks/${childTask._id}`, invitee.token, { title: "should fail" }, 403);
  checks += 1;
  await patch(`/memberships/${invite._id}`, token, { role: "writer" });
  await post(`/comments/${childComment._id}/replies`, invitee.token, { body: "Project-move access survived" });
  checks += 1;
  await post(`/comments/${directComment._id}/replies`, invitee.token, { body: "Note-move access survived" });
  checks += 1;

  console.log(`Sofos v4 API suite passed ${checks} checks.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
