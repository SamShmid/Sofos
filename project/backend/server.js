const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const cors = require("cors");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Resource routers
app.use("/api/auth", require("./routes/auth"));
app.use("/api/workspaces", require("./routes/workspaces"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/notes", require("./routes/notes"));
app.use("/api/tasks", require("./routes/tasks"));

// Central error handler (must be last, after the routes)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(err);
  res.status(status).json({
    error: {
      message: status < 500 ? err.message : "Internal server error",
      details: status < 500 ? err.details : undefined,
    },
  });
});

mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log("Connected to MongoDB!");
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.log("Failed to connect to MongoDB", err);
});
