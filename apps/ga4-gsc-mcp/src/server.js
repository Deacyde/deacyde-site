/**
 * GA4 & GSC Custom MCP — Main server
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const { router: authRouter, requireAuth } = require("./auth");
const settingsRouter = require("./settings");
const chatRouter = require("./chat");

const app = express();
const PORT = process.env.PORT || 3100;

// Generate a session secret if not provided
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Ensure encryption secret exists
if (!process.env.MCP_ENCRYPTION_SECRET) {
  console.error("ERROR: MCP_ENCRYPTION_SECRET environment variable is required.");
  console.error("Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

// Auth gate
app.use(requireAuth);

// API routes
app.use(authRouter);
app.use(settingsRouter);
app.use(chatRouter);

// Static files
app.use(express.static(path.join(__dirname, "..", "public")));

// SPA fallback — serve index.html for all non-API routes
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 GA4 & GSC Custom MCP running on http://localhost:${PORT}`);
});
