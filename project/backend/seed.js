require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const SuperWorkspace = require("./models/SuperWorkspace");
const Workspace = require("./models/Workspace");
const Project = require("./models/Project");
const Task = require("./models/Task");
const Note = require("./models/Note");
const Goal = require("./models/Goal");
const Link = require("./models/Link");
const Attachment = require("./models/Attachment");
const Membership = require("./models/Membership");
const Revision = require("./models/Revision");
const Suggestion = require("./models/Suggestion");
const Comment = require("./models/Comment");
const Session = require("./models/Session");
const { ensureTenantDefaults } = require("./utils/defaults");

async function createUser(username, password, isAgent = false) {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ username, passwordHash, isAgent });
  if (isAgent) return { user, tenant: null };
  const tenant = await SuperWorkspace.create({ name: username, owner: user._id });
  await ensureTenantDefaults(tenant._id, user._id);
  return { user, tenant };
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = mongoose.connection.name;
  if (!dbName || !dbName.includes("test")) {
    throw new Error(`Refusing to seed '${dbName}'. Use a database name containing "test".`);
  }

  await Promise.all([
    User, SuperWorkspace, Workspace, Project, Task, Note, Goal, Link,
    Attachment, Membership, Revision, Suggestion, Comment, Session,
  ].map((Model) => Model.deleteMany({})));

  const adminPassword = process.env.SEED_PASSWORD || "changeme123";
  const admin = await createUser(process.env.SEED_USERNAME || "admin", adminPassword);
  const guest = await createUser("guest", "guest1234");
  const agent = await createUser("seedbot", "seedbot123", true);
  const home = await Workspace.findOne({ superWorkspace: admin.tenant._id, isDefault: true });

  const work = await Workspace.create({
    name: "Work",
    description: "A top-level workspace with direct content and projects",
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
  });
  const website = await Project.create({
    name: "Website",
    description: "Active client work",
    status: "active",
    tags: ["client-work"],
    workspace: work._id,
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
  });
  const launch = await Project.create({
    name: "Launch",
    description: "A child project",
    status: "blocked",
    workspace: work._id,
    parentProject: website._id,
    ancestors: [website._id],
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
  });

  await Task.create({
    title: "Review the weekly plan",
    workspace: work._id,
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
    order: 0,
  });
  const parentTask = await Task.create({
    title: "Prepare launch",
    workspace: work._id,
    project: launch._id,
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
    order: 0,
  });
  await Task.create({
    title: "Check deployment",
    workspace: work._id,
    project: launch._id,
    parentTask: parentTask._id,
    ancestors: [parentTask._id],
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
    order: 0,
  });
  await Note.create({
    title: "Work notes",
    content: "# Direct workspace note",
    workspace: work._id,
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
  });
  await Goal.create({
    title: "Launch the website",
    workspace: work._id,
    project: website._id,
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
    order: 0,
  });
  await Link.create({
    title: "Sofos repository",
    url: "https://example.com/sofos",
    workspace: work._id,
    superWorkspace: admin.tenant._id,
    createdBy: admin.user._id,
    updatedBy: admin.user._id,
    order: 0,
  });

  await Membership.create({
    user: guest.user._id,
    superWorkspace: admin.tenant._id,
    workspace: work._id,
    role: "reader",
    status: "active",
  });
  await Membership.create({
    user: agent.user._id,
    superWorkspace: admin.tenant._id,
    workspace: work._id,
    role: "suggester",
    status: "active",
  });

  console.log(JSON.stringify({
    database: dbName,
    users: { admin: adminPassword, guest: "guest1234", seedbot: "seedbot123" },
    home: String(home._id),
    workspace: String(work._id),
    project: String(website._id),
    childProject: String(launch._id),
  }, null, 2));
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
