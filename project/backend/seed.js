require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Workspace = require("./models/Workspace");
const User = require("./models/User");
const { HOME_WORKSPACE_DESCRIPTION, ensureGeneralProject } = require("./utils/defaults");

// Run with:  npm run seed
// Sets up the default workspace and the writer users
const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    // 1. Default workspace (idempotent: upsert only inserts if missing)
    const home = await Workspace.findOneAndUpdate(
      { isDefault: true },
      { $setOnInsert: { name: "Home", description: HOME_WORKSPACE_DESCRIPTION, isDefault: true } },
      { upsert: true, new: true }
    );
    // Backfill the description if an older Home was created before this field existed.
    if (!home.description) {
      home.description = HOME_WORKSPACE_DESCRIPTION;
      await home.save();
    }
    // Home needs its "General" project too.
    await ensureGeneralProject(home._id);
    console.log("Default workspace ready:", home._id.toString());

    // 2. Writer account
    const username = process.env.SEED_USERNAME || "admin";
    const password = process.env.SEED_PASSWORD || "changeme123";
    const existing = await User.findOne({ username });
    if (existing) {
      console.log(`Writer user "${username}" already exists — skipping`);
    } else {
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({ username, passwordHash, role: "writer" });
      console.log(`Created writer user "${user.username}" (role: ${user.role})`);
    }

    await mongoose.connection.close();
    console.log("Done");
  } catch (err) {
    console.error(err);
    await mongoose.connection.close();
    process.exit(1);
  }
};

seed();
