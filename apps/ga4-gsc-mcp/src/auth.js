/**
 * Auth middleware + routes
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("./db");

const router = express.Router();

// Check if initial setup is needed (no password set yet)
function isSetupComplete() {
  return !!db.getSetting("admin_password_hash");
}

// Auth middleware — protect API routes only, let static files through
function requireAuth(req, res, next) {
  // Always allow auth endpoints
  if (req.path.startsWith("/auth") || req.path.startsWith("/api/auth")) {
    return next();
  }
  // Only protect /api/ routes — static files (HTML, CSS, JS) pass through
  if (!req.path.startsWith("/api/")) {
    return next();
  }
  if (!isSetupComplete()) {
    return res.status(401).json({ error: "setup_required" });
  }
  if (!req.session.authenticated) {
    return res.status(401).json({ error: "not_authenticated" });
  }
  next();
}

// POST /api/auth/setup — first-time password creation
router.post("/api/auth/setup", (req, res) => {
  if (isSetupComplete()) {
    return res.status(400).json({ error: "Already configured" });
  }
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.setSetting("admin_password_hash", hash);
  req.session.authenticated = true;
  res.json({ ok: true });
});

// POST /api/auth/login
router.post("/api/auth/login", (req, res) => {
  const { password } = req.body;
  const hash = db.getSetting("admin_password_hash");
  if (!hash) {
    return res.status(400).json({ error: "setup_required" });
  }
  if (!bcrypt.compareSync(password || "", hash)) {
    return res.status(401).json({ error: "Invalid password" });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post("/api/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/auth/status
router.get("/api/auth/status", (req, res) => {
  res.json({
    setup_complete: isSetupComplete(),
    authenticated: !!req.session.authenticated,
  });
});

module.exports = { router, requireAuth };
